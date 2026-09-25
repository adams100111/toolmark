const FOCUSABLE = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]',
].join(',')

function isFocusable(el: Element): el is HTMLElement {
  if (!(el instanceof HTMLElement) || !el.matches(FOCUSABLE)) return false
  if (el.tabIndex < 0) return false
  if (el.closest('[inert]')) return false
  return el.getClientRects().length > 0
}

/** Tab-reachable elements inside `root`, in DOM order (positive `tabindex` is not reordered). */
export function tabbables(root: Element): HTMLElement[] {
  return [...root.querySelectorAll(FOCUSABLE)].filter(isFocusable)
}

/** The element to focus for an anchor: the anchor itself when focusable, else its first tabbable. */
export function focusTargetOf(anchor: Element | null): HTMLElement | null {
  if (!anchor) return null
  if (isFocusable(anchor)) return anchor
  return tabbables(anchor)[0] ?? null
}

/** Focuses `el` without scrolling (the overlay scrolls the anchor itself). */
export function focusNoScroll(el: HTMLElement): void {
  el.focus({ preventScroll: true })
}

/**
 * Tab / Shift+Tab inside a trap: returns the element to focus next, cycling within `root`'s
 * tabbables. When nothing inside is tabbable, `fallback` (the dialog) keeps focus.
 */
export function nextInTrap(
  root: HTMLElement,
  fallback: HTMLElement,
  backwards: boolean,
): HTMLElement {
  const items = tabbables(root)
  if (items.length === 0) return fallback
  const active = document.activeElement
  const i = active instanceof HTMLElement ? items.indexOf(active) : -1
  if (i === -1) return backwards ? items[items.length - 1]! : items[0]!
  const n = items.length
  return items[(i + (backwards ? n - 1 : 1)) % n]!
}
