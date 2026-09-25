/**
 * `@toolmark/core/webmcp` — the WebMCP consumer. **Experimental** (D28): WebMCP is an origin-trial
 * browser API, so this entry is outside the semver promise until the spec leaves origin trial.
 * @packageDocumentation
 */
import type { ToolManifest } from '../manifest.js'
import { emitEvent, type Toolmark } from '../registry.js'
import {
  resolveModelContext,
  type ModelContextLike,
  type WebMcpPolyfillModule,
} from './model-context.js'
import { createSync } from './sync.js'

export type {
  ModelContextLike,
  WebMcpExecuteOptions,
  WebMcpPolyfillModule,
  WebMcpRegisterToolOptions,
  WebMcpToolAnnotations,
  WebMcpToolDescriptor,
} from './model-context.js'

/**
 * Options for {@link webmcp}.
 * @experimental WebMCP is an origin-trial API; this adapter is outside semver (D28).
 */
export interface WebMcpOptions {
  /**
   * `'none'` (default) or an app-supplied loader, e.g. `() => import('@mcp-b/webmcp-polyfill')`,
   * used only when the browser has no model context. The adapter never imports the polyfill itself,
   * so bundlers resolve the optional peer only when the app opts in.
   */
  polyfill?: 'none' | (() => Promise<WebMcpPolyfillModule>)
  /** Narrows the tools registered with WebMCP (applied after the `webmcp` caller policy). */
  filter?: (t: ToolManifest) => boolean
  /** Origins allowed to call the tools (native WebMCP only; the polyfill reports it as a failure). */
  exposedTo?: string[]
  /**
   * Advanced: supplies the model context (node tests, embedders). When it returns `undefined`, the
   * adapter falls back to `document.modelContext`, then the legacy `navigator.modelContext`.
   */
  modelContext?: () => ModelContextLike | undefined
}

/**
 * Registers the registry's tools with WebMCP (`document.modelContext.registerTool`), for browser
 * agents. Use as `tm.use(webmcp())`.
 *
 * - Registers the tools visible to caller `webmcp` (policy-filtered; destructive tools are hidden
 *   by default) under their full names, one `AbortSignal` each, with `readOnlyHint`,
 *   `consequentialHint` (consequential or destructive) and `untrustedContentHint`.
 * - `execute` runs `tm.call(name, input, { caller: 'webmcp' })` — consequential tools confirm inline
 *   through the app's `confirm` handler — and resolves the `ToolResult` object.
 * - Re-syncs on every revision: removed or changed tools are unregistered, new or changed ones
 *   registered, unchanged ones kept. Native declarative forms the browser already exposes
 *   (`tm.info(name).nativeName`) are skipped.
 * - Without a model context (and no polyfill, or a polyfill that installs none, e.g. in an insecure
 *   context), emits the `error` event `webmcp_unavailable` once and stays inactive; it never throws.
 *   A rejected registration emits `webmcp_register_failed` `{ tool, cause }` and is retried only
 *   when the tool changes.
 *
 * @experimental WebMCP is an origin-trial API; this adapter is outside semver (D28).
 * @param o - Options.
 * @returns A consumer for `tm.use`; its disposer unregisters every tool and stops syncing.
 */
export function webmcp(o: WebMcpOptions = {}): (tm: Toolmark) => () => void {
  const polyfill = typeof o.polyfill === 'function' ? o.polyfill : undefined
  const exposedTo = Array.isArray(o.exposedTo) ? [...o.exposedTo] : undefined
  return (tm) => {
    let disposed = false
    let stop: (() => void) | undefined

    const unavailable = (cause?: unknown): void => {
      emitEvent(tm, 'error', {
        code: 'webmcp_unavailable',
        message:
          'WebMCP is not available (no document.modelContext); the webmcp consumer is inactive.',
        ...(cause !== undefined ? { cause } : {}),
      })
    }

    const start = async (): Promise<void> => {
      let mc = resolveModelContext(o.modelContext)
      if (!mc && polyfill) {
        try {
          const mod = await polyfill()
          if (disposed) return
          mod.initializeWebMCPPolyfill()
        } catch (e) {
          if (!disposed) unavailable(e)
          return
        }
        mc = resolveModelContext(o.modelContext)
      }
      if (disposed) return
      if (!mc) {
        unavailable()
        return
      }
      const sync = createSync(tm, mc, { filter: o.filter, exposedTo })
      const unsubscribe = tm.subscribe(() => sync.schedule())
      stop = () => {
        unsubscribe()
        sync.dispose()
      }
      sync.schedule()
    }

    start().catch((e: unknown) => {
      if (!disposed) unavailable(e)
    })

    return () => {
      if (disposed) return
      disposed = true
      stop?.()
    }
  }
}
