import type { ToolResult } from '@toolmark/core'
import { cancelled, invalid, ok } from '@toolmark/core'

/**
 * Callbacks accepted by an Inertia visit (`router.visit` / `useForm().submit`),
 * structurally covering both Inertia 2's callback names (`onInvalid`, `onException`) and Inertia
 * 3's renamed ones (`onHttpException`, `onNetworkError`). Passing every name is harmless: whichever
 * major is installed simply never calls the names it doesn't recognize.
 */
export interface InertiaVisitCallbacks {
  /** The visit succeeded. */
  onSuccess?: () => void
  /** The server responded with validation errors, keyed by field. */
  onError?: (errors: Record<string, string>) => void
  /** Inertia 3: the server responded outside the Inertia protocol (non-2xx / non-Inertia body). */
  onHttpException?: (response: unknown) => void
  /** Inertia 3: the request failed before a response arrived (offline, aborted transport, …). */
  onNetworkError?: (error: unknown) => void
  /** Inertia 2: the server response did not carry the `X-Inertia` header. */
  onInvalid?: (response: unknown) => void
  /** Inertia 2: an unexpected error occurred during the visit. */
  onException?: (error: unknown) => void
  /** The visit was cancelled. */
  onCancel?: () => void
  /** Hands back a token whose `cancel()` aborts the in-flight visit. */
  onCancelToken?: (token: { cancel(): void }) => void
  /** The visit settled, one way or another. */
  onFinish?: (visit?: { cancelled?: boolean; interrupted?: boolean }) => void
}

/** @internal Builds a frozen `error` result without pulling in `@toolmark/core`'s internal helper. */
function errorOutcome(message: string): ToolResult<never> {
  return Object.freeze({ status: 'error' as const, message })
}

/**
 * @internal Builds one Inertia visit's callbacks together with a promise that settles exactly
 * once with the matching {@link ToolResult} (spec §10.1; M2's props tools reuse this mapping
 * unchanged): `onSuccess` → `ok({})`; `onError` → `invalid` (one issue per key); `onHttpException`
 * / `onInvalid` → `error` `"Request failed"`; `onNetworkError` / `onException` → `error`
 * `"Network error"`; `onCancel`, or `onFinish` reporting `cancelled`/`interrupted`, → `cancelled`
 * `'signal'`; `onFinish` with no earlier outcome (Inertia 2's HTTP/network failure path) →
 * `error` `"Visit did not complete"`. Every callback name is passed structurally, so both Inertia
 * majors are covered without knowing which is installed. Never hangs, and a later callback after
 * the first outcome is ignored.
 * @param o - `signal` cancels the visit (through the token Inertia hands back via
 * `onCancelToken`) when aborted, before or after the token arrives.
 */
export function visitOutcome(o?: { signal?: AbortSignal }): {
  callbacks: InertiaVisitCallbacks
  result: Promise<ToolResult<unknown>>
} {
  let settled = false
  let resolveResult!: (value: ToolResult<unknown>) => void
  const result = new Promise<ToolResult<unknown>>((resolve) => {
    resolveResult = resolve
  })
  const settle = (value: ToolResult<unknown>): void => {
    if (settled) return
    settled = true
    resolveResult(value)
  }

  let cancelToken: { cancel(): void } | null = null
  let abortRequested = false
  const requestCancel = (): void => {
    abortRequested = true
    cancelToken?.cancel()
  }
  const signal = o?.signal
  if (signal) {
    if (signal.aborted) requestCancel()
    else signal.addEventListener('abort', requestCancel, { once: true })
  }

  const callbacks: InertiaVisitCallbacks = {
    onSuccess: () => settle(ok({})),
    onError: (errors) => {
      settle(invalid(Object.entries(errors).map(([path, message]) => ({ path, message }))))
    },
    onHttpException: () => settle(errorOutcome('Request failed')),
    onInvalid: () => settle(errorOutcome('Request failed')),
    onNetworkError: () => settle(errorOutcome('Network error')),
    onException: () => settle(errorOutcome('Network error')),
    onCancel: () => settle(cancelled('signal')),
    onCancelToken: (token) => {
      cancelToken = token
      if (abortRequested) token.cancel()
    },
    onFinish: (visit) => {
      if (visit?.cancelled === true || visit?.interrupted === true) {
        settle(cancelled('signal'))
        return
      }
      settle(errorOutcome('Visit did not complete'))
    },
  }

  return { callbacks, result }
}
