import { emitEvent, type Scope, type Toolmark } from '@toolmark/core'
import { propsTools } from './props-tools.js'
import type { RouterLike } from './router-like.js'

/** Options for {@link inertiaPages}. */
export interface InertiaPagesOptions {
  /** Inertia's router (`router` from `@inertiajs/react`, 2.x or 3.x). */
  router: RouterLike
  /** The page Inertia rendered first (its `props` carry the initial server tools). */
  initialPage: { props: Record<string, unknown> }
  /** Page prop holding the server-declared tools. Default `'toolmark'`. */
  propsKey?: string
}

const DEFAULT_PROPS_KEY = 'toolmark'

/** Reads `value[key]` as an own property, tolerating any shape. */
function ownProp(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) return undefined
  return Object.hasOwn(value, key) ? (value as Record<string, unknown>)[key] : undefined
}

/** Canonical form of a props value, used to skip re-registering an unchanged tool list. */
function signature(value: unknown): string | undefined {
  try {
    return JSON.stringify(value) ?? 'undefined'
  } catch {
    return undefined
  }
}

/**
 * Keeps server-declared tools (spec §10.1, §12.4, D23) in sync with the current Inertia page.
 * Holds one **transparent** page scope (tool names are exactly the server's): on attach it
 * registers `initialPage.props[propsKey]`; on every `navigate` event it reads
 * `e.detail.page.props[propsKey]`, disposes the page scope and registers the new entries (see
 * {@link propsTools} for validation — malformed entries and collisions are events, never thrown).
 * An unchanged entry list (Inertia fires `navigate` on the initial load and after
 * `preserveState` visits) keeps the current scope and registrations, so it causes no revision
 * bump; a changed list bumps `rev` once. A navigation does not cancel in-flight props calls (a
 * props tool's own visit swaps the page before its `onSuccess`); only the returned disposer does.
 * Register `navigationTool` at the root scope, never in this page scope.
 * @param o - The router, the initial page and an optional `propsKey` (default `'toolmark'`).
 * @returns A consumer for `tm.use(...)`; its disposer removes the page tools, unsubscribes from the
 * router and resolves every in-flight props call as `cancelled` `signal`. Under SSR it does nothing.
 */
export function inertiaPages(o: InertiaPagesOptions): (tm: Toolmark) => () => void {
  return (tm) => {
    if (typeof document === 'undefined') return () => {}
    const key = o.propsKey ?? DEFAULT_PROPS_KEY
    const inflight = new AbortController()
    let scope: Scope | null = null
    let current: string | undefined
    let disposed = false

    const apply = (props: unknown): void => {
      if (disposed) return
      const raw = ownProp(props, key)
      const sig = signature(raw)
      if (scope !== null && sig !== undefined && sig === current) return
      scope?.dispose()
      scope = tm.scope('toolmark-page', { transparent: true })
      current = sig
      if (raw === undefined || raw === null) return
      if (!Array.isArray(raw)) {
        emitEvent(tm, 'error', {
          code: 'invalid_props_tool',
          message: `Page prop "${key}" is not an array of tool entries`,
        })
        return
      }
      propsTools(tm, raw, scope, { router: o.router, signal: inflight.signal })
    }

    const safeApply = (props: unknown): void => {
      try {
        apply(props)
      } catch (e) {
        // Never throw inside Inertia's event dispatch (it would break navigation).
        emitEvent(tm, 'error', {
          code: 'invalid_props_tool',
          message: 'Server-declared tools could not be applied',
          cause: e,
        })
      }
    }

    safeApply(o.initialPage.props)
    const off = o.router.on('navigate', (e) => {
      safeApply(ownProp(ownProp(e.detail, 'page'), 'props'))
    })

    return () => {
      if (disposed) return
      disposed = true
      off()
      inflight.abort()
      scope?.dispose()
      scope = null
    }
  }
}
