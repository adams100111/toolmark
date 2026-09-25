/** A viewport rectangle (CSS pixels). */
export interface Rect {
  top: number
  left: number
  width: number
  height: number
}

/** Logical side of the anchor the dialog is placed on; `center` when there is no anchor. */
export type Side = 'bottom' | 'top' | 'end' | 'start' | 'center'

/** Where to put the dialog (viewport coordinates of its top-left corner). */
export interface Placement {
  top: number
  left: number
  side: Side
}

/** Gap between anchor and dialog. */
export const GAP = 12
/** Minimum distance from the viewport edges. */
export const MARGIN = 8

const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(v, max))

/**
 * Places a dialog of `box` size beside `anchor` inside `viewport`. Preferred sides: bottom, top,
 * end, start (end/start are mirrored in RTL). Bottom/top placements align with the anchor's start
 * edge; every placement is clamped into the viewport. No anchor centres the dialog.
 * @param anchor - The anchor's viewport rect, or `null`.
 * @param box - The dialog's size.
 * @param viewport - The viewport size.
 * @param rtl - Right-to-left layout.
 */
export function computePosition(
  anchor: Rect | null,
  box: { width: number; height: number },
  viewport: { width: number; height: number },
  rtl: boolean,
): Placement {
  const maxLeft = Math.max(MARGIN, viewport.width - box.width - MARGIN)
  const maxTop = Math.max(MARGIN, viewport.height - box.height - MARGIN)
  if (!anchor) {
    return {
      side: 'center',
      top: clamp((viewport.height - box.height) / 2, MARGIN, maxTop),
      left: clamp((viewport.width - box.width) / 2, MARGIN, maxLeft),
    }
  }
  const right = anchor.left + anchor.width
  const bottom = anchor.top + anchor.height
  const alignedLeft = clamp(rtl ? right - box.width : anchor.left, MARGIN, maxLeft)
  const alignedTop = clamp(anchor.top, MARGIN, maxTop)

  const fitsRight = right + GAP + box.width <= viewport.width - MARGIN
  const fitsLeft = anchor.left - GAP - box.width >= MARGIN
  const toRight = right + GAP
  const toLeft = anchor.left - GAP - box.width

  if (bottom + GAP + box.height <= viewport.height - MARGIN) {
    return { side: 'bottom', top: bottom + GAP, left: alignedLeft }
  }
  if (anchor.top - GAP - box.height >= MARGIN) {
    return { side: 'top', top: anchor.top - GAP - box.height, left: alignedLeft }
  }
  const fitsEnd = rtl ? fitsLeft : fitsRight
  const fitsStart = rtl ? fitsRight : fitsLeft
  if (fitsEnd) return { side: 'end', top: alignedTop, left: rtl ? toLeft : toRight }
  if (fitsStart) return { side: 'start', top: alignedTop, left: rtl ? toRight : toLeft }
  return { side: 'bottom', top: clamp(bottom + GAP, MARGIN, maxTop), left: alignedLeft }
}
