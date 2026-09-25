import type { Placement, Rect } from './position.js'

/** Everything the overlay shows for one state. All text is set as text nodes, never as markup. */
export interface ViewModel {
  title: string
  text: string
  counter: string
  message: string
  nextLabel: string
  backLabel: string
  closeLabel: string
  canGoBack: boolean
  rtl: boolean
  modal: boolean
  /** Hide the backdrop (an inline confirmation is pending). */
  confirming: boolean
  /** Shades block pointer input outside the cut-out (`do` mode). */
  blocking: boolean
  mode: string
  status: string
  reducedMotion: boolean
}

/** The overlay's DOM. */
export interface View {
  root: HTMLDivElement
  dialog: HTMLDivElement
  closeButton: HTMLButtonElement
  backButton: HTMLButtonElement
  nextButton: HTMLButtonElement
  update(m: ViewModel): void
  /** Places the spotlight around `target` (padded) and the dialog at `placement`. */
  place(target: Rect | null, placement: Placement): void
}

/** Padding of the cut-out around the anchor. */
export const CUTOUT_PAD = 4

let seq = 0

function node<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className: string,
  style = '',
): HTMLElementTagNameMap[K] {
  const el = doc.createElement(tag)
  el.className = className
  if (style) el.setAttribute('style', style)
  return el
}

function box(el: HTMLElement, top: number, left: number, width: number, height: number): void {
  el.style.top = `${top}px`
  el.style.left = `${left}px`
  el.style.width = `${Math.max(0, width)}px`
  el.style.height = `${Math.max(0, height)}px`
}

function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text
}

/**
 * Builds the overlay DOM. Layout-critical styles (position, stacking, pointer events) are inline so
 * the overlay works without the stylesheet; colours, spacing and motion live in `styles.css`.
 */
export function createView(doc: Document): View {
  const id = `toolmark-tour-${++seq}`
  const root = node(
    doc,
    'div',
    'toolmark-tour',
    'position:fixed;inset:0;z-index:var(--toolmark-tour-z, 2147483000);pointer-events:none;',
  )

  const backdrop = node(
    doc,
    'div',
    'toolmark-tour__backdrop',
    'position:absolute;inset:0;pointer-events:none;',
  )
  backdrop.setAttribute('aria-hidden', 'true')
  const shade = (): HTMLDivElement =>
    node(doc, 'div', 'toolmark-tour__shade', 'position:absolute;pointer-events:none;')
  const shades = [shade(), shade(), shade(), shade()] as const
  const cutout = node(doc, 'div', 'toolmark-tour__cutout', 'position:absolute;pointer-events:none;')
  backdrop.append(...shades, cutout)

  const dialog = node(
    doc,
    'div',
    'toolmark-tour__dialog',
    'position:absolute;top:0;left:0;pointer-events:auto;',
  )
  dialog.setAttribute('role', 'dialog')
  dialog.tabIndex = -1
  dialog.setAttribute('aria-labelledby', `${id}-title`)
  dialog.setAttribute('aria-describedby', `${id}-text`)

  const closeButton = node(doc, 'button', 'toolmark-tour__close')
  closeButton.type = 'button'
  closeButton.textContent = '×'
  const title = node(doc, 'h2', 'toolmark-tour__title')
  title.id = `${id}-title`
  const text = node(doc, 'p', 'toolmark-tour__text')
  text.id = `${id}-text`
  const status = node(doc, 'div', 'toolmark-tour__status')
  status.setAttribute('aria-live', 'polite')
  const counter = node(doc, 'span', 'toolmark-tour__counter')
  const message = node(doc, 'span', 'toolmark-tour__message')
  status.append(counter, ' ', message)
  const actions = node(doc, 'div', 'toolmark-tour__actions')
  const backButton = node(doc, 'button', 'toolmark-tour__back')
  backButton.type = 'button'
  const nextButton = node(doc, 'button', 'toolmark-tour__next')
  nextButton.type = 'button'
  actions.append(backButton, nextButton)
  dialog.append(closeButton, title, text, status, actions)
  root.append(backdrop, dialog)

  return {
    root,
    dialog,
    closeButton,
    backButton,
    nextButton,
    update(m) {
      const dir = m.rtl ? 'rtl' : 'ltr'
      if (root.dir !== dir) root.dir = dir
      if (dialog.dir !== dir) dialog.dir = dir
      root.dataset.mode = m.mode
      root.dataset.status = m.status
      root.toggleAttribute('data-reduced-motion', m.reducedMotion)
      dialog.setAttribute('aria-modal', String(m.modal))
      backdrop.style.display = m.confirming ? 'none' : ''
      for (const s of shades) s.style.pointerEvents = m.blocking ? 'auto' : 'none'
      closeButton.setAttribute('aria-label', m.closeLabel)
      setText(title, m.title)
      setText(text, m.text)
      setText(counter, m.counter)
      setText(message, m.message)
      setText(backButton, m.backLabel)
      setText(nextButton, m.nextLabel)
      backButton.disabled = !m.canGoBack
    },
    place(target, placement) {
      const [top, bottom, start, end] = shades
      const vw = doc.documentElement.clientWidth
      const vh = doc.documentElement.clientHeight
      if (!target) {
        box(top, 0, 0, vw, vh)
        for (const s of [bottom, start, end]) box(s, 0, 0, 0, 0)
        cutout.style.display = 'none'
      } else {
        const t = target.top - CUTOUT_PAD
        const l = target.left - CUTOUT_PAD
        const w = target.width + 2 * CUTOUT_PAD
        const h = target.height + 2 * CUTOUT_PAD
        box(top, 0, 0, vw, t)
        box(bottom, t + h, 0, vw, vh - (t + h))
        box(start, t, 0, l, h)
        box(end, t, l + w, vw - (l + w), h)
        cutout.style.display = ''
        box(cutout, t, l, w, h)
      }
      dialog.style.top = `${placement.top}px`
      dialog.style.left = `${placement.left}px`
      dialog.dataset.side = placement.side
    },
  }
}
