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
 * Adapts an Inertia `<Form>` component (`@inertiajs/react` 2.1+, uncontrolled; spec §10.1, D11) to
 * form tools. `getValues`, `setValues`, `dirtyPaths`, `fields` and `dispose` come unmodified from
 * {@link domFormAdapter} over the `<Form>`'s underlying `<form>` element.
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
 * `"Form is not mounted"`, without attaching any listener.
 *
 * There is no visit id on the `start`/`finish` events (spec §10.1 amended nowhere covers this), so
 * "the next visit" is a simplifying assumption: a concurrent, unrelated visit that starts or
 * finishes while this one is in flight is not distinguished from it.
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

  return {
    ...base,
    submit(): Promise<ToolResult<unknown>> {
      const form = o.formRef.current
      if (!form) return Promise.resolve(errorOutcome('Form is not mounted'))

      return new Promise((resolve) => {
        let settled = false
        const unsubscribers: Array<() => void> = []
        const teardown = (): void => {
          for (const off of unsubscribers.splice(0)) off()
        }
        const settle = (result: ToolResult<unknown>): void => {
          if (settled) return
          settled = true
          teardown()
          resolve(result)
        }

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
        let sawInvalid = false
        let invalidDetail: unknown
        let sawRequestFailed = false
        let sawNetworkError = false

        unsubscribers.push(
          on('start', () => {
            armed = true
          }),
        )
        unsubscribers.push(
          on('error', (e) => {
            if (!armed) return
            sawInvalid = true
            invalidDetail = e.detail
          }),
        )
        unsubscribers.push(
          on('httpException', () => {
            if (armed) sawRequestFailed = true
          }),
        )
        unsubscribers.push(
          on('invalid', () => {
            if (armed) sawRequestFailed = true
          }),
        )
        unsubscribers.push(
          on('networkError', () => {
            if (armed) sawNetworkError = true
          }),
        )
        unsubscribers.push(
          on('exception', () => {
            if (armed) sawNetworkError = true
          }),
        )
        unsubscribers.push(
          on('finish', (e) => {
            if (!armed) return
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
      })
    },
  }
}
