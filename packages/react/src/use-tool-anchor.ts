import { useCallback, useEffect, useRef } from 'react'
import { useToolmark } from './provider.js'

/** Whether `el` is a DOM `Element` (any kind, SVG and custom elements included). */
const isElement = (el: unknown): el is Element =>
  typeof Element !== 'undefined' && el instanceof Element

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
 * @param tool - Full tool name, as in the manifest (scope path included).
 * @param param - Input path the element stands for; omit for the tool's own element.
 * @returns A ref callback.
 */
export function useToolAnchor(tool: string, param?: string): (el: Element | null) => void {
  const toolmark = useToolmark()
  const attached = useRef<Element | null>(null)

  const ref = useCallback(
    (el: Element | null): void => {
      if (isElement(el)) {
        attached.current = el
        toolmark.setAnchor(tool, param, el)
      } else {
        attached.current = null
        toolmark.setAnchor(tool, param, null)
      }
    },
    [toolmark, tool, param],
  )

  // Re-apply after re-registrations (they drop overrides); clear on unmount.
  useEffect(() => {
    const reapply = (): void => {
      if (attached.current) toolmark.setAnchor(tool, param, attached.current)
    }
    reapply()
    const off = toolmark.subscribe(reapply)
    return () => {
      off()
      if (attached.current) toolmark.setAnchor(tool, param, null)
    }
  }, [toolmark, tool, param])

  return ref
}
