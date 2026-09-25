import { fromJsonSchema, invalid, ok, refuse, type ToolDefinition } from '@toolmark/core'
import { resolveSameOriginUrl } from './router-like.js'

/**
 * A named route builder (Wayfinder- or Ziggy-style): returns the URL and HTTP method for the
 * given parameters. It may throw (e.g. a missing parameter); the navigation tool refuses then.
 */
export type RouteFn = (params?: Record<string, unknown>) => { url: string; method: string }

/** Input of the navigation tool. */
export interface NavigationInput {
  /** Route name (one of the configured route keys). */
  route: string
  /**
   * Route parameters passed to the {@link RouteFn}. Keys `__proto__`, `constructor` and
   * `prototype` (at any depth) are rejected as `invalid`. Parameters the route does not consume may
   * become query-string values of the (same-origin) URL, as Wayfinder/Ziggy do.
   */
  params?: Record<string, unknown>
}

/** Options for {@link navigationTool}. */
export interface NavigationToolOptions {
  /** Navigable routes by name; their keys become the `route` enum. */
  routes: Record<string, RouteFn>
  /** Starts the visit (typically `(url, opts) => router.visit(url, opts)`). */
  visit: (url: string, opts: { method: 'get' }) => void
  /** Tool name. Default `navigate`. */
  name?: string
  /** Tool description. Default `"Navigate to a page in this app. Use route names from the enum."` */
  description?: string
}

const DEFAULT_NAME = 'navigate'
const DEFAULT_DESCRIPTION = 'Navigate to a page in this app. Use route names from the enum.'
const FORBIDDEN_PARAM_KEYS: readonly string[] = ['__proto__', 'constructor', 'prototype']

/** Dotted path of the first prototype-polluting key anywhere in `value`, if any. */
function forbiddenKeyPath(value: unknown, path: string[]): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const keys = Array.isArray(value) ? value.map((_, i) => String(i)) : Object.keys(value)
  for (const key of keys) {
    if (!Array.isArray(value) && FORBIDDEN_PARAM_KEYS.includes(key)) {
      return [...path, key].join('.')
    }
    const hit = forbiddenKeyPath((value as Record<string, unknown>)[key], [...path, key])
    if (hit !== undefined) return hit
  }
  return undefined
}

const NON_GET_MESSAGE = 'Only GET routes can be navigated; declare a server tool for mutations'

/**
 * Builds the navigation tool (spec §10.1, D23). Input `route` is an enum of the route keys; `run`
 * builds the route with `params` and, for a same-origin GET route, calls `visit(url, { method:
 * 'get' })` and returns `ok({ url })` immediately — before the page swap disposes the page scope
 * (a `changed`/manifest follows). **GET only**: a route whose method is not `get`
 * (case-insensitive) → `refused` `navigation_failed` ("Only GET routes can be navigated; declare a
 * server tool for mutations"); a throwing route, a malformed route result or a URL outside this
 * page's origin → `refused` `navigation_failed`. No hints. Register it at the root scope (never
 * inside the `inertiaPages` page scope), so it survives navigation. The visit receives the canonical
 * absolute URL; empty `routes` yields an empty `route` enum, so every call is `invalid`; `params` with a `__proto__`/`constructor`/`prototype` key are `invalid`.
 * @param o - Routes, the visit function and optional name/description.
 * @returns A tool definition for `tm.register`.
 */
export function navigationTool(
  o: NavigationToolOptions,
): ToolDefinition<NavigationInput, { url: string }> {
  const routes = o.routes
  const input = fromJsonSchema<NavigationInput>({
    type: 'object',
    properties: {
      route: { type: 'string', enum: Object.keys(routes), description: 'Route name.' },
      params: { type: 'object', description: 'Route parameters.' },
    },
    required: ['route'],
    additionalProperties: false,
  })
  return {
    name: o.name ?? DEFAULT_NAME,
    description: o.description ?? DEFAULT_DESCRIPTION,
    input,
    run({ route, params }) {
      const forbidden = forbiddenKeyPath(params, ['params'])
      if (forbidden !== undefined) {
        return invalid([{ path: forbidden, message: 'Forbidden parameter name' }])
      }
      const fn = Object.hasOwn(routes, route) ? routes[route] : undefined
      if (typeof fn !== 'function') {
        return refuse('navigation_failed', `Unknown route "${route}"`)
      }
      let target: unknown
      try {
        target = fn(params)
      } catch {
        return refuse('navigation_failed', `Route "${route}" could not be built`)
      }
      const url = (target as { url?: unknown } | null)?.url
      const method = (target as { method?: unknown } | null)?.method
      if (typeof url !== 'string' || typeof method !== 'string') {
        return refuse('navigation_failed', `Route "${route}" did not return a URL and method`)
      }
      if (method.toLowerCase() !== 'get') return refuse('navigation_failed', NON_GET_MESSAGE)
      const href = resolveSameOriginUrl(url)
      if (href === null) {
        return refuse('navigation_failed', 'Only same-origin routes can be navigated')
      }
      try {
        o.visit(href, { method: 'get' })
      } catch {
        return refuse('navigation_failed', `Navigation to "${route}" could not be started`)
      }
      return ok({ url })
    },
  }
}
