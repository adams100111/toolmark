import { useEffect } from 'react'
import type { Toolmark } from '@toolmark/core'
import { useToolmark } from './provider.js'

/** Whether `el` is a DOM `Element` (any kind, SVG and custom elements included). */
const isElement = (el: unknown): el is Element =>
  typeof Element !== 'undefined' && el instanceof Element

/** A ref callback returned by {@link useToolAnchor}. */
type AnchorRefCallback = (el: Element | null) => void

/**
 * @internal One entry per `(toolmark, tool, param)`: the ref callback and the element it last
 * attached (`null` when detached). `attached` is mutated only by `ref` itself, never by the
 * re-apply effect below — the effect's cleanup clears the registry override but must leave
 * `attached` alone so a StrictMode dev remount (effect cleanup immediately followed by another
 * setup, DOM untouched) re-applies the same element instead of leaving the anchor cleared.
 *
 * This lives outside React's per-fiber hook state deliberately: on React 18, StrictMode's dev-only
 * double-render of a mounting component's function body discards the first pass's hook state
 * entirely (fresh `useRef`/`useCallback` both times), so a hook-backed ref callback would come back
 * as a *different* function object from that throwaway pass — breaking the stable-identity contract
 * this hook documents. React 19 reuses hook state across the two passes, so this bug is React
 * 18-only, but caching by `(tool, param)` here keeps the callback identity (and the last-attached
 * element) stable on both. Entries persist for the `toolmark` instance's lifetime rather than being
 * freed on unmount — the intended `(tool, param)` surface is small and stable (see the docs below),
 * and freeing them safely on unmount can't be done from inside the effect, since nothing there can
 * tell a real final unmount apart from a StrictMode-simulated one.
 */
interface AnchorEntry {
  attached: Element | null
  readonly ref: AnchorRefCallback
}

const anchorEntries = new WeakMap<Toolmark, Map<string, AnchorEntry>>()

function anchorKey(tool: string, param: string | undefined): string {
  return param === undefined ? tool : `${tool}\u0000${param}`
}

function getAnchorEntry(toolmark: Toolmark, tool: string, param: string | undefined): AnchorEntry {
  let byKey = anchorEntries.get(toolmark)
  if (!byKey) {
    byKey = new Map()
    anchorEntries.set(toolmark, byKey)
  }
  const key = anchorKey(tool, param)
  const existing = byKey.get(key)
  if (existing) return existing

  const entry: AnchorEntry = {
    attached: null,
    ref(el) {
      if (isElement(el)) {
        if (entry.attached === el) return // already attached: skip the redundant setAnchor
        entry.attached = el
        toolmark.setAnchor(tool, param, el)
      } else if (entry.attached !== null) {
        entry.attached = null
        toolmark.setAnchor(tool, param, null)
      }
    },
  }
  byKey.set(key, entry)
  return entry
}

/**
 * Anchors a tool (or one of its params) to a custom widget for tours (spec §13): returns a ref
 * callback to put on the element, e.g. `<canvas ref={useToolAnchor('chart.zoom', 'level')} />`.
 *
 * On attach it calls `tm.setAnchor(tool, param, el)`, which wins over the tool's own anchors; on
 * detach or unmount it clears the override with `tm.setAnchor(tool, param, null)`. The registry
 * drops a tool's overrides when the tool is disposed, so the override is re-applied after every
 * registry revision while the element stays attached (a StrictMode remount or a `useTool`
 * dependency change re-registers the tool). Values that are not DOM elements are ignored.
 *
 * The callback is stable for a given `tool` and `param`; changing either detaches the old anchor
 * and attaches the new one.
 *
 * One override exists per `(tool, param)`: when two mounted components anchor the same pair, the
 * last one to attach (or re-apply) wins, and the first to detach may clear it for both. Anchor each
 * `(tool, param)` from one component only.
 * @param tool - Full tool name, as in the manifest (scope path included).
 * @param param - Input path the element stands for; omit for the tool's own element.
 * @returns A ref callback.
 */
export function useToolAnchor(tool: string, param?: string): AnchorRefCallback {
  const toolmark = useToolmark()
  const entry = getAnchorEntry(toolmark, tool, param)

  // Re-apply after re-registrations (they drop overrides); clear on unmount.
  useEffect(() => {
    const reapply = (): void => {
      if (entry.attached) toolmark.setAnchor(tool, param, entry.attached)
    }
    reapply()
    const off = toolmark.subscribe(reapply)
    return () => {
      off()
      if (entry.attached) toolmark.setAnchor(tool, param, null)
    }
  }, [toolmark, tool, param, entry])

  return entry.ref
}
