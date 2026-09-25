import type { FormAdapter, ToolIssue, ToolResult } from '@toolmark/core'
import { cancelled, invalid, ok } from '@toolmark/core'
import { domFormAdapter } from '@toolmark/core/dom'
import type { InertiaEventName, RouterLike } from './router-like.js'

/**
 * @internal Builds a frozen `error` result without depending on `@toolmark/core`'s internal
 * helper (mirrors `visit-outcome.ts`, which does the same for the same reason).
 */
function errorOutcome(message: string): ToolResult<never> {
  return Object.freeze({ status: 'error' as const, message })
}

/** How long `submit()` waits for its visit's `start` event before settling `error`. */
const SUBMIT_START_WINDOW_MS = 1000

/**
 * @internal Extracts `{ path, message }` issues from a router `error` event's `CustomEvent.detail`
 * (shape `{ errors: Record<string, unknown> }` in both majors). Best-effort: a non-string message
 * (or the first entry of an array, for `withAllErrors`) coerces to a string; a missing/empty/
 * non-object `errors` map falls back to one root issue, mirroring the DOM adapter's default-submit
 * fallback (spec §10.2).
 */
function issuesFromErrorEvent(detail: unknown): ToolIssue[] {
  const errors = (detail as { errors?: unknown } | undefined)?.errors
  if (errors === null || typeof errors !== 'object') {
    return [{ path: '', message: 'The form is invalid' }]
  }
  const entries = Object.entries(errors as Record<string, unknown>)
  if (entries.length === 0) return [{ path: '', message: 'The form is invalid' }]
  return entries.map(([path, message]) => ({
    path,
    message: Array.isArray(message) ? String(message[0] ?? '') : String(message),
  }))
}

/**
 * @internal A visit's correlation key (`"<method> <url.href>"`) read from a router event's
 * `CustomEvent.detail.visit`. Both majors' `start`/`finish` details carry the visit, whose `url`
 * (a `URL`) and `method` are public in Inertia 2 and 3. `undefined` when the detail carries no
 * visit, or a visit without a readable `url`/`method`.
 */
function visitKey(detail: unknown): string | undefined {
  const visit = (detail as { visit?: { url?: { href?: unknown }; method?: unknown } } | undefined)
    ?.visit
  const href = visit?.url?.href
  const method = visit?.method
  if (typeof href !== 'string' || typeof method !== 'string') return undefined
  return `${method.toLowerCase()} ${href}`
}

/**
 * Adapts an Inertia `<Form>` component (`@inertiajs/react` 2.1+, uncontrolled; spec §10.1, D11) to
 * form tools. `getValues`, `setValues`, `dirtyPaths` and `fields` come unmodified from
 * {@link domFormAdapter} over the `<Form>`'s underlying `<form>` element; `dispose` extends its
 * `dispose` (see below).
 *
 * `submit()` calls `formRef.current.submit()` — the `<Form>`'s documented imperative ref method —
 * and settles from the *global* router events of the visit it starts: the `<Form>` component drives
 * its own visit internally, so there is no `router.visit` call here to attach per-visit callbacks
 * to (contrast `inertiaAdapter`, which submits and settles through `visit-outcome.ts`). It arms on
 * the next `start` event after `submit()` is called, then watches —
 * until that visit's `finish` — for: `error` (server-side validation errors) → settles `invalid`
 * (one issue per error key, `path: ''` with a generic message if none can be read);
 * `httpException` (Inertia 3) / `invalid` (Inertia 2) → settles `error` `"Request failed"`;
 * `networkError` (Inertia 3) / `exception` (Inertia 2) → settles `error` `"Network error"`;
 * otherwise, at `finish`, `visit.cancelled || visit.interrupted` → `cancelled` `'signal'`, else
 * `ok({})`. Both majors' event names are listened to (harmless: whichever major is installed never
 * fires the names it doesn't recognize — verified against the installed 3.7.1 and a packed 2.3.28),
 * and every listener is removed once the promise settles. A missing ref (`formRef.current` is
 * `null`, e.g. before the `<Form>` has mounted) settles immediately with `error`
 * `"Form is not mounted"`, without attaching any listener. If no `start` arrives within
 * 1000 ms of `formRef.current.submit()` (e.g. an `onBefore`
 * returned `false`, or the submit was swallowed), the call settles `error`
 * `"Submit did not start a visit"` and its listeners are removed; once a visit has started it may
 * take as long as it needs.
 *
 * **A bare `finish` maps to `ok` here.** A `finish` with no earlier failure event and no
 * `cancelled`/`interrupted` flag settles `ok({})` — unlike `visit-outcome.ts` (used by
 * `inertiaAdapter`), where a per-visit `onFinish` with no earlier outcome means `error`
 * `"Visit did not complete"`. The difference is deliberate: that path also receives the per-visit
 * `onSuccess`, so reaching `onFinish` without it means the request failed; here success is only
 * observable through the global `finish` itself.
 *
 * **Visit correlation.** The events carry no visit id, so the visit is correlated by `url` +
 * `method`: the first `start` after `submit()` records its `visit.url.href` and `visit.method`,
 * and from then on a `finish` — or an `error`/`httpException`/`invalid`/`networkError`/`exception`
 * that carries a `visit` — is only accepted when its url + method match; an interleaved, unrelated
 * visit (a background poll, another form) is ignored. Failure events without a `visit` (their
 * usual shape in both majors) are accepted while this visit is in flight, so an unrelated visit's
 * failure arriving in that window is still indistinguishable from this one's. When the `start`
 * visit has no readable url/method, every event is accepted (the pre-correlation behaviour).
 *
 * `dispose()` also tears down any in-flight `submit()`: its router listeners are removed and its
 * promise settles `cancelled` `'signal'`.
 *
 * @param o - `element` is the `<Form>`'s underlying `<form>` element; `formRef` is the ref object
 * passed to `<Form ref={...}>`; `router` is `@inertiajs/react`'s `router`, passed directly.
 * @returns A {@link FormAdapter}; call `dispose()` when the `<Form>` goes away.
 */
export function inertiaFormComponentAdapter(o: {
  element: HTMLFormElement
  formRef: { current: { submit(): void } | null }
  router: RouterLike
}): FormAdapter & { dispose(): void } {
  const base = domFormAdapter(o.element)
  /** Cancels each in-flight `submit()` (tears down its listeners, settles it `cancelled`). */
  const inFlight = new Set<() => void>()

  return {
    ...base,
    dispose(): void {
      for (const cancel of [...inFlight]) cancel()
      base.dispose()
    },
    submit(): Promise<ToolResult<unknown>> {
      const form = o.formRef.current
      if (!form) return Promise.resolve(errorOutcome('Form is not mounted'))

      return new Promise((resolve) => {
        let settled = false
        const unsubscribers: Array<() => void> = []
        let startTimer: ReturnType<typeof setTimeout> | undefined
        const teardown = (): void => {
          if (startTimer !== undefined) clearTimeout(startTimer)
          startTimer = undefined
          for (const off of unsubscribers.splice(0)) off()
        }
        const cancelOnDispose = (): void => settle(cancelled('signal'))
        const settle = (result: ToolResult<unknown>): void => {
          if (settled) return
          settled = true
          inFlight.delete(cancelOnDispose)
          teardown()
          resolve(result)
        }
        inFlight.add(cancelOnDispose)

        // `RouterLike.on` is typed for only the five events both Inertia majors dispatch
        // (start/navigate/success/error/finish — task 8 Ruling 6); the request-failure names below
        // exist solely in the wider `InertiaEventName` union. Both majors' real `router.on` adds a
        // plain `document` listener for `inertia:<name>` regardless of the name it is given
        // (verified against the installed 3.7.1 and a packed 2.3.28 tarball), so this widening
        // cast is a verified runtime no-op, not an unsafe assumption.
        const on = o.router.on.bind(o.router) as unknown as (
          event: InertiaEventName,
          cb: (e: CustomEvent) => void,
        ) => () => void

        let armed = false
        /** This visit's `"<method> <href>"`, from its `start`; `undefined` = uncorrelated. */
        let ownKey: string | undefined
        let sawInvalid = false
        let invalidDetail: unknown
        let sawRequestFailed = false
        let sawNetworkError = false

        /** Armed, and the event carries no visit or this visit (see "Visit correlation"). */
        const isOwn = (detail: unknown): boolean => {
          if (!armed) return false
          if (ownKey === undefined) return true
          const key = visitKey(detail)
          return key === undefined || key === ownKey
        }

        unsubscribers.push(
          on('start', (e) => {
            if (armed) return
            armed = true
            ownKey = visitKey(e.detail)
            if (startTimer !== undefined) clearTimeout(startTimer)
            startTimer = undefined
          }),
        )
        unsubscribers.push(
          on('error', (e) => {
            if (!isOwn(e.detail)) return
            sawInvalid = true
            invalidDetail = e.detail
          }),
        )
        unsubscribers.push(
          on('httpException', (e) => {
            if (isOwn(e.detail)) sawRequestFailed = true
          }),
        )
        unsubscribers.push(
          on('invalid', (e) => {
            if (isOwn(e.detail)) sawRequestFailed = true
          }),
        )
        unsubscribers.push(
          on('networkError', (e) => {
            if (isOwn(e.detail)) sawNetworkError = true
          }),
        )
        unsubscribers.push(
          on('exception', (e) => {
            if (isOwn(e.detail)) sawNetworkError = true
          }),
        )
        unsubscribers.push(
          on('finish', (e) => {
            if (!isOwn(e.detail)) return
            if (sawInvalid) {
              settle(invalid(issuesFromErrorEvent(invalidDetail)))
              return
            }
            if (sawRequestFailed || sawNetworkError) {
              settle(errorOutcome(sawNetworkError ? 'Network error' : 'Request failed'))
              return
            }
            const visit = (
              e.detail as { visit?: { cancelled?: boolean; interrupted?: boolean } } | undefined
            )?.visit
            if (visit?.cancelled === true || visit?.interrupted === true) {
              settle(cancelled('signal'))
              return
            }
            settle(ok({}))
          }),
        )

        form.submit()
        if (!settled && !armed) {
          startTimer = setTimeout(() => {
            startTimer = undefined
            if (!armed) settle(errorOutcome('Submit did not start a visit'))
          }, SUBMIT_START_WINDOW_MS)
        }
      })
    },
  }
}
