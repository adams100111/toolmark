/**
 * `@toolmark/tour/overlay` — the styled, themeable tour overlay (spec §11.5, D30). Vanilla DOM, so
 * it works in any app. Import `@toolmark/tour/styles.css` once for the default look.
 * @packageDocumentation
 * @module @toolmark/tour/overlay
 */
import type { Tour, TourState } from '../types.js'
import { focusNoScroll, focusTargetOf, nextInTrap } from './focus.js'
import { computePosition, type Rect } from './position.js'
import { createView } from './render.js'

/** App-supplied overlay strings (spec §15: the app localizes; English defaults). */
export interface TourStrings {
  /** Next button. Default `"Next"`. */
  next: string
  /** Back button. Default `"Back"`. */
  back: string
  /** Accessible name of the close button. Default `"Close tour"`. */
  close: string
  /** Next button on the last step. Default `"Done"`. */
  done: string
  /** Announced while an inline confirmation is pending. Default `"Waiting for your confirmation"`. */
  confirming: string
  /** Announced while a `do` step's call is in flight (Next/Back unavailable). Default `"Working…"`. */
  busy: string
  /**
   * Step counter. Default `` (i, n) => `Step ${i} of ${n}` ``.
   * @param i - 1-based step number.
   * @param n - Number of steps.
   */
  stepOf(i: number, n: number): string
}

/** The English default {@link TourStrings}. */
export const defaultTourStrings: Readonly<TourStrings> = Object.freeze({
  next: 'Next',
  back: 'Back',
  close: 'Close tour',
  done: 'Done',
  confirming: 'Waiting for your confirmation',
  busy: 'Working…',
  stepOf: (i: number, n: number) => `Step ${i} of ${n}`,
})

/** Options for {@link mountTourOverlay}. */
export interface TourOverlayOptions {
  /** Element the overlay is appended to. Default `document.body`. Theme variables set on it apply. */
  container?: HTMLElement
  /** Overrides for the default strings. */
  strings?: Partial<TourStrings>
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

function toRect(r: DOMRect): Rect {
  return { top: r.top, left: r.left, width: r.width, height: r.height }
}

const TERMINAL = new Set<TourState['status']>(['done', 'stopped'])

/**
 * Renders a running tour: a spotlight around the step's anchor and a dialog beside it (Next, Back,
 * Close, step counter, live status). The overlay is modal (`aria-modal`, focus trap) only in `do`
 * mode; while `status` is `confirming` it releases the trap, hides the backdrop, drops its stacking
 * and lets pointer input pass through the dialog, so the app's inline confirmation stays usable.
 * While `busy` (a `do` call in flight), Next/Back are `aria-disabled` and the status says so. `show`/`guide` leave the anchor operable (`guide` focuses it;
 * `F6`/`Alt+T` toggle focus between dialog and anchor). Arrow keys move between steps (mirrored in
 * RTL) and `Esc` stops the tour while focus is in the dialog. The overlay removes itself when the
 * tour is `done` or `stopped` and returns focus to the element focused before it mounted.
 *
 * All step text is rendered as text, never as markup.
 * @param tour - The tour from `startTour`.
 * @param o - Container and string overrides.
 * @returns Unmounts the overlay (idempotent; does not stop the tour).
 * @example
 * ```ts
 * import '@toolmark/tour/styles.css'
 * const tour = await startTour(tm, { mode: 'show', steps })
 * const unmount = mountTourOverlay(tour)
 * ```
 */
export function mountTourOverlay(tour: Tour, o: TourOverlayOptions = {}): () => void {
  const strings: TourStrings = { ...defaultTourStrings, ...o.strings }
  const doc = o.container?.ownerDocument ?? document
  const container = o.container ?? doc.body
  const win = doc.defaultView ?? window
  const previous = doc.activeElement instanceof HTMLElement ? doc.activeElement : null
  const view = createView(doc)
  const { root, dialog } = view

  let destroyed = false
  let state = tour.state
  let enteredIndex: number | null = null
  let target: Element | null = null
  let wasConfirming = false
  let frame = 0
  let placed = false

  const trapActive = (): boolean => state.mode === 'do' && state.status !== 'confirming'
  const isRtl = (): boolean => {
    const from = state.anchor ?? container
    return win.getComputedStyle(from).direction === 'rtl'
  }

  const position = (): void => {
    if (destroyed) return
    const rect = target?.isConnected ? toRect(target.getBoundingClientRect()) : null
    const viewport = {
      width: doc.documentElement.clientWidth,
      height: doc.documentElement.clientHeight,
    }
    const size = { width: dialog.offsetWidth, height: dialog.offsetHeight }
    // The first placement must not animate in from the top-left corner.
    const jump = !placed
    if (jump) dialog.style.transition = 'none'
    view.place(rect, computePosition(rect, size, viewport, dialog.dir === 'rtl'))
    if (jump) {
      void dialog.offsetWidth
      dialog.style.transition = ''
      placed = true
    }
  }
  const schedule = (): void => {
    if (frame || destroyed) return
    frame = win.requestAnimationFrame(() => {
      frame = 0
      position()
    })
  }
  const resizes = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null

  const focusDialog = (): void => focusNoScroll(dialog)
  const focusAnchor = (): boolean => {
    const t = focusTargetOf(state.anchor)
    if (t) focusNoScroll(t)
    return t !== null
  }

  const render = (s: TourState): void => {
    if (destroyed) return
    state = s
    if (TERMINAL.has(s.status)) {
      destroy()
      return
    }
    root.style.display = s.status === 'idle' ? 'none' : ''
    const confirming = s.status === 'confirming'
    const step = s.steps[s.index]
    const n = s.steps.length
    const last = s.index >= n - 1
    const reducedMotion = prefersReducedMotion()
    view.update({
      title: step?.title ?? strings.stepOf(s.index + 1, n),
      text: step?.text ?? '',
      counter: strings.stepOf(s.index + 1, n),
      message: confirming ? strings.confirming : s.busy ? strings.busy : (s.message ?? ''),
      nextLabel: last ? strings.done : strings.next,
      backLabel: strings.back,
      closeLabel: strings.close,
      canGoBack: s.index > 0,
      rtl: isRtl(),
      modal: trapActive(),
      confirming,
      busy: s.busy,
      blocking: trapActive(),
      mode: s.mode,
      status: s.status,
      reducedMotion,
    })

    const nextTarget = s.highlight ?? s.anchor
    if (nextTarget !== target) {
      if (target) resizes?.unobserve(target)
      target = nextTarget
      if (target) {
        resizes?.observe(target)
        target.scrollIntoView({
          behavior: reducedMotion ? 'auto' : 'smooth',
          block: 'nearest',
          inline: 'nearest',
        })
      }
    }
    position()

    if (s.status !== 'idle' && s.index !== enteredIndex) {
      enteredIndex = s.index
      if (s.mode === 'guide') {
        if (!focusAnchor()) focusDialog()
      } else if (!dialog.contains(doc.activeElement)) {
        focusDialog()
      }
    } else if (
      wasConfirming &&
      !confirming &&
      trapActive() &&
      !dialog.contains(doc.activeElement)
    ) {
      focusDialog()
    }
    wasConfirming = confirming
  }

  const onKeyDown = (e: KeyboardEvent): void => {
    if (destroyed || e.defaultPrevented) return
    if (e.key === 'Tab' && trapActive()) {
      e.preventDefault()
      focusNoScroll(nextInTrap(dialog, dialog, e.shiftKey))
      return
    }
    const inDialog = dialog.contains(doc.activeElement)
    if ((e.key === 'F6' || (e.altKey && e.code === 'KeyT')) && !trapActive()) {
      e.preventDefault()
      if (!inDialog || !focusAnchor()) focusDialog()
      return
    }
    if (!inDialog || e.ctrlKey || e.metaKey || e.altKey) return
    if (e.key === 'Escape') {
      e.preventDefault()
      tour.stop()
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      const forward = (e.key === 'ArrowRight') !== (dialog.dir === 'rtl')
      if (state.busy) return
      if (forward) void tour.next()
      else if (state.index > 0) tour.back()
    }
  }

  const onFocusIn = (e: FocusEvent): void => {
    if (destroyed || !trapActive()) return
    if (e.target instanceof Node && !dialog.contains(e.target)) focusDialog()
  }

  view.closeButton.addEventListener('click', () => tour.stop())
  view.backButton.addEventListener('click', () => {
    if (!state.busy) tour.back()
  })
  view.nextButton.addEventListener('click', () => {
    if (!state.busy) void tour.next()
  })

  container.append(root)
  resizes?.observe(dialog)
  doc.addEventListener('keydown', onKeyDown, true)
  doc.addEventListener('focusin', onFocusIn, true)
  win.addEventListener('resize', schedule)
  win.addEventListener('scroll', schedule, { capture: true, passive: true })
  const unsubscribe = tour.subscribe(render)

  function destroy(): void {
    if (destroyed) return
    destroyed = true
    unsubscribe()
    resizes?.disconnect()
    if (frame) win.cancelAnimationFrame(frame)
    doc.removeEventListener('keydown', onKeyDown, true)
    doc.removeEventListener('focusin', onFocusIn, true)
    win.removeEventListener('resize', schedule)
    win.removeEventListener('scroll', schedule, { capture: true })
    root.remove()
    if (previous?.isConnected) focusNoScroll(previous)
  }

  render(state)
  return destroy
}
