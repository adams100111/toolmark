import axe from 'axe-core'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { createToolmark, ok, type ConfirmOutcome, type ToolDefinition } from '@toolmark/core'
import { startTour, type Tour, type TourState, type TourStep } from '../src/index.js'
import { computePosition } from '../src/overlay/position.js'
import { mountTourOverlay } from '../src/overlay/index.js'
import css from '../src/styles.css?raw'

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

const created: Element[] = []
const unmounts: (() => void)[] = []
let style: HTMLStyleElement | null = null

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  css: Partial<CSSStyleDeclaration> = {},
  parent: HTMLElement = document.body,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  Object.assign(node.style, css)
  parent.append(node)
  if (parent === document.body) created.push(node)
  return node
}

/** A fixed-position anchor button at the given viewport rect. */
function anchorAt(top: number, left: number, width = 120, height = 40): HTMLButtonElement {
  const b = el('button', {
    position: 'fixed',
    top: `${top}px`,
    left: `${left}px`,
    width: `${width}px`,
    height: `${height}px`,
  })
  b.textContent = 'Anchor'
  return b
}

function mount(tour: Tour, o?: Parameters<typeof mountTourOverlay>[1]): HTMLElement {
  const unmount = mountTourOverlay(tour, o)
  unmounts.push(unmount)
  const root = document.querySelector<HTMLElement>('.toolmark-tour')
  if (!root) throw new Error('overlay root not rendered')
  return root
}

const dialogOf = (root: HTMLElement): HTMLElement => root.querySelector('[role="dialog"]')!
const liveOf = (root: HTMLElement): HTMLElement => root.querySelector('[aria-live="polite"]')!
const backdropOf = (root: HTMLElement): HTMLElement =>
  root.querySelector('.toolmark-tour__backdrop')!
const cutoutOf = (root: HTMLElement): HTMLElement => root.querySelector('.toolmark-tour__cutout')!
const buttonByText = (root: HTMLElement, text: string): HTMLButtonElement =>
  [...root.querySelectorAll('button')].find((b) => b.textContent === text)!

const STEPS: TourStep[] = [
  { tool: 'a', title: 'First', text: 'Click here' },
  { tool: 'b', title: 'Second', text: 'Then here' },
]

type FakeTour = Omit<Tour, 'next' | 'back' | 'stop'> & {
  set: (p: Partial<TourState>) => void
  next: Mock<() => Promise<void>>
  back: Mock<() => void>
  stop: Mock<() => void>
}

function fakeTour(init: Partial<TourState>): FakeTour {
  let state: TourState = Object.freeze({
    status: 'running',
    mode: 'show',
    index: 0,
    steps: STEPS,
    anchor: null,
    highlight: null,
    busy: false,
    ...init,
  } satisfies TourState)
  const subs = new Set<(s: TourState) => void>()
  const set = (p: Partial<TourState>): void => {
    state = Object.freeze({ ...state, ...p })
    for (const fn of subs) fn(state)
  }
  return {
    get state() {
      return state
    },
    set,
    next: vi.fn(() => Promise.resolve()),
    back: vi.fn(),
    stop: vi.fn(() => set({ status: 'stopped', anchor: null, highlight: null })),
    subscribe(fn) {
      subs.add(fn)
      return () => subs.delete(fn)
    },
    on: () => () => {},
  }
}

function withStyles(): void {
  style = document.createElement('style')
  style.textContent = css
  document.head.append(style)
}

const frames = async (n = 2): Promise<void> => {
  for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(() => r(null)))
}

function mockReducedMotion(reduce: boolean): void {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: reduce && query.includes('prefers-reduced-motion'),
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList,
  )
}

beforeAll(async () => {
  await page.viewport(1024, 768)
})

beforeEach(() => {
  withStyles()
})

afterEach(() => {
  for (const u of unmounts.splice(0)) u()
  for (const node of created.splice(0)) node.remove()
  style?.remove()
  style = null
  window.scrollTo(0, 0)
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------------------------

describe('overlay', () => {
  it('renders_dialog_near_anchor', async () => {
    const a = anchorAt(100, 100)
    const b = anchorAt(300, 400)
    const tm = createToolmark({ confirm: () => Promise.resolve({ approved: true }) })
    const tool = (name: string, anchor: Element): ToolDefinition => ({
      name,
      description: `Tool ${name} for tests`,
      jsonSchema: { type: 'object', properties: {} },
      anchors: { element: () => anchor },
      run: () => ok(null),
    })
    tm.register(tool('a', a))
    tm.register(tool('b', b))
    const tour = await startTour(tm, { mode: 'show', steps: STEPS })

    const root = mount(tour)
    const dialog = dialogOf(root)
    expect(dialog).toBeTruthy()
    expect(dialog.getAttribute('aria-modal')).toBe('false')
    const title = document.getElementById(dialog.getAttribute('aria-labelledby')!)
    const desc = document.getElementById(dialog.getAttribute('aria-describedby')!)
    expect(title?.textContent).toBe('First')
    expect(desc?.textContent).toBe('Click here')
    expect(liveOf(root).textContent).toContain('Step 1 of 2')

    // Beside the anchor: bottom is preferred.
    const ar = a.getBoundingClientRect()
    const dr = dialog.getBoundingClientRect()
    expect(dr.top).toBeGreaterThanOrEqual(ar.bottom)
    expect(dr.top).toBeLessThan(ar.bottom + 40)
    expect(dialog.dataset.side).toBe('bottom')

    // Spotlight: backdrop hidden from AT, cut-out around the anchor, anchor still clickable.
    expect(backdropOf(root).getAttribute('aria-hidden')).toBe('true')
    const cr = cutoutOf(root).getBoundingClientRect()
    expect(Math.abs(cr.left - ar.left)).toBeLessThanOrEqual(8)
    expect(Math.abs(cr.top - ar.top)).toBeLessThanOrEqual(8)
    expect(Math.abs(cr.width - ar.width)).toBeLessThanOrEqual(16)
    expect(getComputedStyle(cutoutOf(root)).pointerEvents).toBe('none')
    expect(document.elementFromPoint(ar.left + 10, ar.top + 10)).toBe(a)

    await userEvent.click(buttonByText(root, 'Next'))
    await expect.poll(() => tour.state.index).toBe(1)
    expect(liveOf(root).textContent).toContain('Step 2 of 2')
    expect(buttonByText(root, 'Done')).toBeTruthy()
    const br = b.getBoundingClientRect()
    await expect
      .poll(() => dialogOf(root).getBoundingClientRect().top)
      .toBeGreaterThanOrEqual(br.bottom)

    await userEvent.click(buttonByText(root, 'Done'))
    await expect.poll(() => tour.state.status).toBe('done')
    expect(document.querySelector('.toolmark-tour')).toBeNull()
  })

  it('repositions_on_resize', async () => {
    const spacer = el('div', { height: '3000px' })
    const anchor = el('button', {
      position: 'absolute',
      top: '200px',
      left: '100px',
      width: '120px',
      height: '40px',
    })
    anchor.textContent = 'Anchor'
    void spacer
    mockReducedMotion(true)
    const tour = fakeTour({ anchor })
    const root = mount(tour)
    window.scrollTo(0, 0)
    await frames()
    const top0 = dialogOf(root).getBoundingClientRect().top
    expect(top0).toBeGreaterThanOrEqual(240)

    // The anchor grows: ResizeObserver repositions the dialog.
    anchor.style.height = '140px'
    await expect.poll(() => dialogOf(root).getBoundingClientRect().top).toBeGreaterThanOrEqual(340)
    const top1 = dialogOf(root).getBoundingClientRect().top

    // The page scrolls: the dialog and the cut-out follow the anchor.
    window.scrollTo(0, 100)
    await expect.poll(() => dialogOf(root).getBoundingClientRect().top).toBeCloseTo(top1 - 100, 0)
    await expect
      .poll(() => cutoutOf(root).getBoundingClientRect().top)
      .toBeCloseTo(anchor.getBoundingClientRect().top - 4, 0)
  })

  it('rtl_placement_mirrored', () => {
    // Pure placement: bottom, then top, then end, then start; end/start mirror in RTL.
    const viewport = { width: 1000, height: 600 }
    const box = { width: 200, height: 100 }
    const tall = { top: 0, left: 400, width: 200, height: 600 }
    expect(computePosition(tall, box, viewport, false)).toMatchObject({ side: 'end', left: 612 })
    expect(computePosition(tall, box, viewport, true)).toMatchObject({ side: 'end', left: 188 })
    const nearRight = { top: 0, left: 700, width: 200, height: 600 }
    expect(computePosition(nearRight, box, viewport, false).side).toBe('start')
    expect(computePosition(nearRight, box, viewport, true).side).toBe('end')
    const short = { top: 100, left: 400, width: 200, height: 40 }
    expect(computePosition(short, box, viewport, false)).toMatchObject({ side: 'bottom', top: 152 })
    // Bottom/top placements align to the anchor's start edge.
    expect(computePosition(short, box, viewport, false).left).toBe(400)
    expect(computePosition(short, box, viewport, true).left).toBe(400)
    const low = { top: 500, left: 400, width: 200, height: 40 }
    expect(computePosition(low, box, viewport, false).side).toBe('top')

    // Rendered: a full-height anchor forces a side placement.
    const ltr = anchorAt(0, 300, 200, 768)
    const t1 = fakeTour({ anchor: ltr })
    const root1 = mount(t1)
    expect(dialogOf(root1).dir).toBe('ltr')
    expect(dialogOf(root1).dataset.side).toBe('end')
    expect(dialogOf(root1).getBoundingClientRect().left).toBeGreaterThanOrEqual(500)
    unmounts.pop()!()

    const wrapper = el('div')
    wrapper.dir = 'rtl'
    const rtl = anchorAt(0, 500, 200, 768)
    wrapper.append(rtl)
    const t2 = fakeTour({ anchor: rtl })
    const root2 = mount(t2)
    expect(dialogOf(root2).dir).toBe('rtl')
    expect(dialogOf(root2).dataset.side).toBe('end')
    expect(dialogOf(root2).getBoundingClientRect().right).toBeLessThanOrEqual(500)
  })

  it('rtl_arrow_keys_mirrored', async () => {
    const outside = el('input')
    const wrapper = el('div')
    wrapper.dir = 'rtl'
    const anchor = anchorAt(100, 600)
    wrapper.append(anchor)
    const rtl = fakeTour({ anchor, index: 1 })
    mount(rtl)
    // Show mode: focus is in the dialog.
    await userEvent.keyboard('{ArrowLeft}')
    expect(rtl.next).toHaveBeenCalledTimes(1)
    await userEvent.keyboard('{ArrowRight}')
    expect(rtl.back).toHaveBeenCalledTimes(1)
    // Only while focus is in the dialog.
    outside.focus()
    await userEvent.keyboard('{ArrowLeft}{ArrowRight}')
    expect(rtl.next).toHaveBeenCalledTimes(1)
    expect(rtl.back).toHaveBeenCalledTimes(1)
    unmounts.pop()!()

    const ltr = fakeTour({ anchor: anchorAt(100, 100), index: 1 })
    mount(ltr)
    await userEvent.keyboard('{ArrowLeft}')
    expect(ltr.back).toHaveBeenCalledTimes(1)
    await userEvent.keyboard('{ArrowRight}')
    expect(ltr.next).toHaveBeenCalledTimes(1)
  })

  it('reduced_motion_no_transition', () => {
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {})
    const anchor = anchorAt(100, 100)

    mockReducedMotion(true)
    const reduced = mount(fakeTour({ anchor }))
    expect(scroll).toHaveBeenLastCalledWith(expect.objectContaining({ behavior: 'auto' }))
    expect(reduced.hasAttribute('data-reduced-motion')).toBe(true)
    for (const node of [dialogOf(reduced), cutoutOf(reduced)]) {
      const durations = getComputedStyle(node)
        .transitionDuration.split(',')
        .map((s) => s.trim())
      expect(durations.every((d) => d === '0s')).toBe(true)
    }
    unmounts.pop()!()

    mockReducedMotion(false)
    const animated = mount(fakeTour({ anchor }))
    expect(scroll).toHaveBeenLastCalledWith(expect.objectContaining({ behavior: 'smooth' }))
    expect(animated.hasAttribute('data-reduced-motion')).toBe(false)
    expect(getComputedStyle(dialogOf(animated)).transitionDuration).not.toBe('0s')
  })

  it('keyboard_focus_management', async () => {
    const before = el('button')
    before.textContent = 'Opener'
    before.focus()
    const tour = fakeTour({ mode: 'do', anchor: anchorAt(100, 100) })
    const root = mount(tour)
    const dialog = dialogOf(root)
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.contains(document.activeElement)).toBe(true)

    // Tab and Shift+Tab cycle inside the dialog.
    const seen = new Set<Element>()
    for (let i = 0; i < 5; i++) {
      await userEvent.keyboard('{Tab}')
      expect(dialog.contains(document.activeElement)).toBe(true)
      seen.add(document.activeElement!)
    }
    expect(seen.size).toBeGreaterThanOrEqual(2)
    for (let i = 0; i < 5; i++) {
      await userEvent.keyboard('{Shift>}{Tab}{/Shift}')
      expect(dialog.contains(document.activeElement)).toBe(true)
    }

    // Focus leaving the dialog is pulled back while modal.
    before.focus()
    expect(dialog.contains(document.activeElement)).toBe(true)

    // Esc closes; focus returns to the previously focused element.
    await userEvent.keyboard('{Escape}')
    expect(tour.stop).toHaveBeenCalledTimes(1)
    expect(document.querySelector('.toolmark-tour')).toBeNull()
    expect(document.activeElement).toBe(before)
  })

  it('guide_mode_not_modal_anchor_focusable', async () => {
    const field = el('div', { position: 'fixed', top: '100px', left: '100px' })
    const input = document.createElement('input')
    input.setAttribute('aria-label', 'Email')
    field.append(input)
    const tour = fakeTour({ mode: 'guide', anchor: field })
    const root = mount(tour)
    const dialog = dialogOf(root)
    expect(dialog.getAttribute('aria-modal')).toBe('false')
    // Step entry focuses the anchor's field; it stays operable.
    expect(document.activeElement).toBe(input)
    await userEvent.click(input)
    await userEvent.type(input, 'abc')
    expect(input.value).toBe('abc')

    // F6 and Alt+T toggle focus between the dialog and the anchor.
    await userEvent.keyboard('{F6}')
    expect(dialog.contains(document.activeElement)).toBe(true)
    await userEvent.keyboard('{F6}')
    expect(document.activeElement).toBe(input)
    await userEvent.keyboard('{Alt>}t{/Alt}')
    expect(dialog.contains(document.activeElement)).toBe(true)

    // Esc is ignored while focus is outside the dialog.
    input.focus()
    await userEvent.keyboard('{Escape}')
    expect(tour.stop).not.toHaveBeenCalled()

    // No trap: Tab leaves the dialog.
    const buttons = [...dialog.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
    buttons.at(-1)!.focus()
    await userEvent.keyboard('{Tab}')
    expect(dialog.contains(document.activeElement)).toBe(false)

    // Show mode: not modal, focus goes to the dialog.
    unmounts.pop()!()
    const show = mount(fakeTour({ mode: 'show', anchor: field }))
    expect(dialogOf(show).getAttribute('aria-modal')).toBe('false')
    expect(dialogOf(show).contains(document.activeElement)).toBe(true)
  })

  it('confirming_releases_trap_and_backdrop', async () => {
    const tour = fakeTour({ mode: 'do', anchor: anchorAt(100, 100) })
    const root = mount(tour)
    const dialog = dialogOf(root)
    expect(getComputedStyle(backdropOf(root)).display).not.toBe('none')

    tour.set({ status: 'confirming' })
    expect(getComputedStyle(backdropOf(root)).display).toBe('none')
    expect(dialog.getAttribute('aria-modal')).toBe('false')
    expect(liveOf(root).textContent).toContain('Waiting for your confirmation')

    // The app's own confirm UI is reachable and operable.
    const confirm = el('button', { position: 'fixed', top: '400px', left: '400px' })
    confirm.textContent = 'Approve'
    const approve = vi.fn()
    confirm.addEventListener('click', approve)
    confirm.focus()
    expect(document.activeElement).toBe(confirm)
    await userEvent.click(confirm)
    expect(approve).toHaveBeenCalledTimes(1)
    await userEvent.keyboard('{Tab}')
    expect(dialog.contains(document.activeElement)).toBe(false)

    // Restored afterwards.
    tour.set({ status: 'running' })
    expect(getComputedStyle(backdropOf(root)).display).not.toBe('none')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(liveOf(root).textContent).not.toContain('Waiting for your confirmation')
    expect(dialog.contains(document.activeElement)).toBe(true)
    confirm.focus()
    expect(dialog.contains(document.activeElement)).toBe(true)
  })

  it('ctx_confirm_in_do_call_releases_trap_until_answered', async () => {
    const anchor = anchorAt(100, 100)
    const outside = el('button')
    outside.textContent = 'Outside'
    let approve!: (o: ConfirmOutcome) => void
    let finish!: () => void
    const finished = new Promise<void>((r) => (finish = r))
    const tm = createToolmark({
      confirm: () => new Promise<ConfirmOutcome>((r) => (approve = r)),
    })
    tm.register({
      name: 'save',
      description: 'Tool save for tests',
      jsonSchema: { type: 'object', properties: {} },
      anchors: { element: () => anchor },
      // Not hinted: the confirmation comes from ctx.confirm inside run.
      run: async (_input, ctx) => {
        await ctx.confirm({ summary: 'Save?' })
        await finished
        return ok({ changes: [], skipped: [] })
      },
    })
    const tour = await startTour(tm, {
      mode: 'do',
      reducedMotion: true,
      steps: [{ tool: 'save', text: 'Save it' }],
    })
    const root = mount(tour)
    const dialog = dialogOf(root)
    await expect.poll(() => root.dataset.status).toBe('confirming')
    expect(getComputedStyle(backdropOf(root)).display).toBe('none')
    expect(dialog.getAttribute('aria-modal')).toBe('false')
    expect(liveOf(root).textContent).toContain('Waiting for your confirmation')

    // The app's confirm card sits where the dialog is (not in the top layer): it is on top.
    const dr = dialog.getBoundingClientRect()
    const card = el('button', {
      position: 'fixed',
      top: `${dr.top}px`,
      left: `${dr.left}px`,
      width: `${dr.width}px`,
      height: `${dr.height}px`,
      zIndex: '10',
    })
    card.textContent = 'Approve'
    card.addEventListener('click', () => approve({ approved: true }))
    const cx = dr.left + dr.width / 2
    const cy = dr.top + dr.height / 2
    expect(document.elementFromPoint(cx, cy)).toBe(card)
    card.focus()
    expect(document.activeElement).toBe(card)
    await userEvent.click(card)

    // Approved, call still running: the trap returns and Next/Back report busy.
    await expect.poll(() => root.dataset.status).toBe('running')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(getComputedStyle(backdropOf(root)).display).not.toBe('none')
    expect(dialog.contains(document.activeElement)).toBe(true)
    outside.focus()
    expect(dialog.contains(document.activeElement)).toBe(true)
    expect(buttonByText(root, 'Done').getAttribute('aria-disabled')).toBe('true')
    expect(liveOf(root).textContent).toContain('Working')

    finish()
    await expect.poll(() => tour.state.status).toBe('done')
    expect(document.querySelector('.toolmark-tour')).toBeNull()
  })

  it('busy_marks_navigation_disabled', async () => {
    const tour = fakeTour({ mode: 'do', index: 1, busy: true, anchor: anchorAt(100, 100) })
    const root = mount(tour)
    const next = buttonByText(root, 'Done')
    const back = buttonByText(root, 'Back')
    expect(next.getAttribute('aria-disabled')).toBe('true')
    expect(back.getAttribute('aria-disabled')).toBe('true')
    expect(liveOf(root).textContent).toContain('Working')
    // (Playwright refuses to click aria-disabled elements; dispatch the clicks directly.)
    next.click()
    back.click()
    next.focus()
    await userEvent.keyboard('{ArrowRight}')
    await userEvent.keyboard('{ArrowLeft}')
    expect(tour.next).not.toHaveBeenCalled()
    expect(tour.back).not.toHaveBeenCalled()

    tour.set({ busy: false })
    expect(next.hasAttribute('aria-disabled')).toBe(false)
    expect(back.hasAttribute('aria-disabled')).toBe(false)
    expect(liveOf(root).textContent).not.toContain('Working')
    await userEvent.click(next)
    expect(tour.next).toHaveBeenCalledTimes(1)
  })

  it('confirming_does_not_cover_app_card', () => {
    const tour = fakeTour({ mode: 'do', anchor: anchorAt(100, 100) })
    const root = mount(tour)
    const dialog = dialogOf(root)
    tour.set({ status: 'confirming' })
    const dr = dialog.getBoundingClientRect()
    const card = el('div', {
      position: 'fixed',
      top: `${dr.top}px`,
      left: `${dr.left}px`,
      width: `${dr.width}px`,
      height: `${dr.height}px`,
    })
    expect(document.elementFromPoint(dr.left + dr.width / 2, dr.top + dr.height / 2)).toBe(card)
    tour.set({ status: 'running' })
    expect(dialog.contains(document.elementFromPoint(dr.left + 10, dr.top + 10))).toBe(true)
  })

  it('overlay_axe_clean', async () => {
    const dark: Record<string, string> = {
      '--toolmark-tour-bg': '#111827',
      '--toolmark-tour-fg': '#f9fafb',
      '--toolmark-tour-accent': '#93c5fd',
    }
    for (const theme of [{} as Record<string, string>, dark]) {
      for (const dir of ['ltr', 'rtl'] as const) {
        for (const mode of ['show', 'guide', 'do'] as const) {
          for (const status of ['running', 'waiting', 'confirming'] as const) {
            const host = el('div')
            host.dir = dir
            for (const [k, v] of Object.entries(theme)) host.style.setProperty(k, v)
            const anchor = anchorAt(100, 300)
            host.append(anchor)
            const tour = fakeTour({
              mode,
              status,
              anchor,
              busy: mode === 'do' && status !== 'waiting',
              ...(status === 'waiting' ? { message: 'Enter a valid email' } : {}),
            })
            const root = mount(tour, { container: host })
            const res = await axe.run(root, { resultTypes: ['violations'] })
            const bad = res.violations
              .filter((v) => v.impact === 'serious' || v.impact === 'critical')
              .map(
                (v) =>
                  `${mode}/${dir}/${status}/${Object.keys(theme).length ? 'dark' : 'light'}: ${v.id}`,
              )
            expect(bad).toEqual([])
            unmounts.pop()!()
          }
        }
      }
    }
  })

  it('works_without_stylesheet', async () => {
    style?.remove()
    const host = el('div')
    const anchor = anchorAt(100, 100)
    const tour = fakeTour({ anchor })
    const root = mount(tour, { container: host })
    expect(getComputedStyle(root).position).toBe('fixed')
    expect(getComputedStyle(root).zIndex).toBe('2147483000')
    const dialog = dialogOf(root)
    expect(getComputedStyle(dialog).position).toBe('absolute')
    expect(dialog.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      anchor.getBoundingClientRect().bottom,
    )
    await userEvent.click(buttonByText(root, 'Next'))
    expect(tour.next).toHaveBeenCalledTimes(1)
    expect(document.elementFromPoint(110, 110)).toBe(anchor)
    unmounts.pop()!()

    // The z-index variable applies inline.
    host.style.setProperty('--toolmark-tour-z', '5')
    const root2 = mount(fakeTour({ anchor }), { container: host })
    expect(getComputedStyle(root2).zIndex).toBe('5')
  })

  it('strings_overridable', () => {
    const anchor = anchorAt(100, 100)
    const tour = fakeTour({ anchor })
    const root = mount(tour, {
      strings: {
        next: 'Suivant',
        back: 'Précédent',
        close: 'Fermer la visite',
        done: 'Terminé',
        confirming: 'En attente de votre confirmation',
        stepOf: (i, n) => `Étape ${i} sur ${n}`,
      },
    })
    expect(buttonByText(root, 'Suivant')).toBeTruthy()
    expect(buttonByText(root, 'Précédent')).toBeTruthy()
    expect(root.querySelector('[aria-label="Fermer la visite"]')).toBeTruthy()
    expect(liveOf(root).textContent).toContain('Étape 1 sur 2')
    tour.set({ index: 1 })
    expect(buttonByText(root, 'Terminé')).toBeTruthy()
    tour.set({ mode: 'do', status: 'confirming' })
    expect(liveOf(root).textContent).toContain('En attente de votre confirmation')
    unmounts.pop()!()

    // A partial override keeps the other defaults.
    const partial = mount(fakeTour({ anchor }), { strings: { next: 'Weiter' } })
    expect(buttonByText(partial, 'Weiter')).toBeTruthy()
    expect(buttonByText(partial, 'Back')).toBeTruthy()
    expect(partial.querySelector('[aria-label="Close tour"]')).toBeTruthy()
  })

  it('step_text_is_rendered_as_text', () => {
    const anchor = anchorAt(100, 100)
    const payload = '<img src=x onerror="window.__pwned=1"><b>bold</b>'
    const tour = fakeTour({
      anchor,
      steps: [{ tool: 'a', title: payload, text: payload }],
      status: 'waiting',
      message: payload,
    })
    const root = mount(tour)
    expect(root.querySelector('img, b')).toBeNull()
    expect(dialogOf(root).textContent).toContain(payload)
  })

  it('no_anchor_centres_dialog_and_hides_cutout', () => {
    const root = mount(fakeTour({ anchor: null }))
    const dr = dialogOf(root).getBoundingClientRect()
    expect(Math.abs(dr.left + dr.width / 2 - 512)).toBeLessThanOrEqual(2)
    expect(getComputedStyle(cutoutOf(root)).display).toBe('none')
  })
})
