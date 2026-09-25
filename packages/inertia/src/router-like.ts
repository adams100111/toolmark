import type { InertiaVisitCallbacks } from './visit-outcome.js'

/**
 * Inertia global router event names Toolmark may subscribe to. Covers both majors: Inertia 2's
 * `invalid`/`exception` and Inertia 3's `httpException`/`networkError`; `navigate` fires in both
 * after every page swap, including the initial page load.
 */
export type InertiaEventName =
  | 'start'
  | 'navigate'
  | 'success'
  | 'error'
  | 'finish'
  | 'httpException'
  | 'networkError'
  | 'invalid'
  | 'exception'

/**
 * A value Inertia can send as visit data (mirrors Inertia's `FormDataConvertible`, declared
 * locally so emitted types never import `@inertiajs/*`). JSON tool input always fits.
 */
export type VisitDataValue =
  | VisitDataValue[]
  | { [key: string]: VisitDataValue }
  | Blob
  | string
  | Date
  | boolean
  | number
  | null
  | undefined

/**
 * Options for {@link RouterLike.visit}: the subset of Inertia's `VisitOptions` Toolmark passes,
 * plus the per-visit callbacks of both majors.
 */
export type RouterVisitOptions = {
  /** HTTP method (lowercase, as Inertia expects). */
  method?: 'get' | 'post' | 'put' | 'patch' | 'delete'
  /** Request payload (query string for `get`). */
  data?: Record<string, VisitDataValue>
  /** Keep the current page component's local state across the visit. */
  preserveState?: boolean
} & InertiaVisitCallbacks

/**
 * The {@link InertiaEventName}s both Inertia majors dispatch. {@link RouterLike.on} accepts only
 * these: a real router's `on` is typed with its own major's event names, so a signature naming
 * `invalid`/`exception` (Inertia 2 only) or `httpException`/`networkError` (Inertia 3 only) would
 * make neither major's `router` assignable to {@link RouterLike}.
 */
export type InertiaCommonEventName = Extract<
  InertiaEventName,
  'start' | 'navigate' | 'success' | 'error' | 'finish'
>

/**
 * The subset of `@inertiajs/react`'s `router` Toolmark needs, structurally compatible with the
 * Inertia 2 and Inertia 3 routers (pass `router` from `@inertiajs/react` directly). Declared
 * locally so Toolmark's emitted types never import `@inertiajs/*`.
 */
export interface RouterLike {
  /**
   * Subscribes to a global router event.
   * @param event - An event both majors dispatch; `inertiaPages` listens to `navigate` (whose
   * `detail.page.props` holds the new page's props).
   * @param cb - Receives the DOM `CustomEvent` Inertia dispatches.
   * @returns An unsubscribe function.
   */
  on(event: InertiaCommonEventName, cb: (e: CustomEvent) => void): () => void
  /**
   * Starts a visit.
   * @param url - Target URL.
   * @param opts - Method, data, `preserveState` and per-visit callbacks.
   */
  visit(url: string, opts?: RouterVisitOptions): void
}

/**
 * @internal Whether `url` resolves to this page's own origin over `http:`/`https:`. Server- or
 * route-supplied URLs pointing anywhere else are refused so Inertia's request (and its XSRF
 * header) never leaves the app's origin.
 */
export function isSameOriginUrl(url: string): boolean {
  if (typeof location === 'undefined') return false
  let resolved: URL
  try {
    resolved = new URL(url, location.href)
  } catch {
    return false
  }
  return (
    (resolved.protocol === 'https:' || resolved.protocol === 'http:') &&
    resolved.origin === location.origin &&
    resolved.username === '' &&
    resolved.password === ''
  )
}
