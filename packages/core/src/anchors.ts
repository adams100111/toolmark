import type { AnchorSpec } from './tool.js'

/** Map key for the tool's own (param-less) anchor; a real param is prefixed so it never collides. */
const ROOT_KEY = '\u0000'
const keyOf = (param: string | undefined): string => (param === undefined ? ROOT_KEY : `p:${param}`)

/**
 * @internal Per-registry store of `tm.setAnchor` overrides, keyed by full tool name and then by
 * param (`undefined` = the tool's own element). The registry drops a tool's overrides when the tool
 * is disposed.
 */
export interface AnchorOverrides {
  /** The override for `(tool, param)`, if any. */
  get(tool: string, param: string | undefined): Element | undefined
  /** Sets the override for `(tool, param)`; `null` clears it. */
  set(tool: string, param: string | undefined, el: Element | null): void
  /** Drops every override of `tool`. */
  drop(tool: string): void
}

/** @internal Creates an empty override store. */
export function createAnchorOverrides(): AnchorOverrides {
  const byTool = new Map<string, Map<string, Element>>()
  return {
    get(tool, param) {
      return byTool.get(tool)?.get(keyOf(param))
    },
    set(tool, param, el) {
      const key = keyOf(param)
      if (el === null) {
        const forTool = byTool.get(tool)
        if (!forTool) return
        forTool.delete(key)
        if (forTool.size === 0) byTool.delete(tool)
        return
      }
      let forTool = byTool.get(tool)
      if (!forTool) {
        forTool = new Map<string, Element>()
        byTool.set(tool, forTool)
      }
      forTool.set(key, el)
    },
    drop(tool) {
      byTool.delete(tool)
    },
  }
}

/**
 * @internal Resolves a tool's anchor from its {@link AnchorSpec} (overrides are checked by the
 * caller first): with `param`, `params[param]()` (own keys only) and then `resolve(param)`; without,
 * `element()`. Returns `null` when nothing matches. Spec functions may throw; the caller catches.
 */
export function anchorFromSpec(spec: AnchorSpec | undefined, param?: string): Element | null {
  if (!spec) return null
  if (param === undefined) return spec.element?.() ?? null
  const params = spec.params
  if (params && Object.hasOwn(params, param)) {
    const fn = params[param]
    const found = typeof fn === 'function' ? fn.call(params) : null
    if (found) return found
  }
  return spec.resolve?.(param) ?? null
}
