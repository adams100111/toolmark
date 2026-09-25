import type { Toolmark, ToolManifest, ToolResult } from '@toolmark/core'
import { authoredSteps, isTourMode, planSteps } from './planner.js'
import type { StartTourOptions, Tour, TourEvent, TourMode, TourState, TourStep } from './types.js'

/** `guide` mode: validation runs this long after the last `input` event (ms). */
const GUIDE_DEBOUNCE_MS = 400
/** `do` mode: each changed field is highlighted this long (ms). */
const HIGHLIGHT_MS = 600
/** Events kept for the first `on()` listener. */
const MAX_BACKLOG = 1000

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  const proto = Object.getPrototypeOf(v) as unknown
  return proto === Object.prototype || proto === null
}

function isAuthoredStep(s: unknown): s is TourStep {
  return (
    typeof s === 'object' &&
    s !== null &&
    typeof (s as TourStep).tool === 'string' &&
    typeof (s as TourStep).text === 'string'
  )
}

function prefersReducedMotion(): boolean {
  try {
    return (
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
    )
  } catch {
    return false
  }
}

/**
 * `do` mode input: form-fill field values are wrapped as `{ values }` when the tool's input schema
 * has a `values` property and `input` is a plain object without a `values` key; everything else
 * (wizard `{ steps }` fills included) is passed unchanged; `undefined` → `{}`.
 */
function toolInput(manifest: ToolManifest | undefined, input: unknown): unknown {
  if (input === undefined) return {}
  const props = manifest?.inputSchema.properties
  if (
    isPlainObject(input) &&
    !Object.hasOwn(input, 'values') &&
    isPlainObject(props) &&
    Object.hasOwn(props, 'values')
  ) {
    return { values: input }
  }
  return input
}

/** The `path`s of a fill result's `changes`, in order (empty when there are none). */
function changedPaths(data: unknown): string[] {
  const changes = isPlainObject(data) ? data.changes : undefined
  if (!Array.isArray(changes)) return []
  return changes.flatMap((c: unknown) =>
    isPlainObject(c) && typeof c.path === 'string' ? [c.path] : [],
  )
}

/** The message a failed `do` call stops the tour with. */
function failureMessage(result: ToolResult<unknown>): string {
  switch (result.status) {
    case 'invalid':
      return result.issues[0]?.message ?? 'Invalid input'
    case 'refused':
    case 'error':
      return result.message
    case 'cancelled':
      return `Cancelled (${result.by})`
    case 'needs_confirmation':
      return result.summary
    default:
      return 'Tool failed'
  }
}

/** Whether issue `path` concerns `param` (the param itself or a nested path; any without one). */
function concerns(path: string, param: string | undefined): boolean {
  return param === undefined || path === param || path.startsWith(`${param}.`)
}

/**
 * Whether an interaction event targets the step: the step's param or a nested path of it (same
 * prefix rule as {@link concerns}); a `submit` of a wizard step also covers the step's fields.
 */
function targets(e: { tool: string; param?: string; kind: string }, step: TourStep): boolean {
  if (e.tool !== step.tool) return false
  if (step.param === undefined) return true
  if (e.param !== undefined && concerns(e.param, step.param)) return true
  return e.kind === 'submit' && (e.param === undefined || step.param.startsWith(`${e.param}.`))
}

function createEngine(
  tm: Toolmark,
  mode: TourMode,
  steps: readonly TourStep[],
  reducedMotion: boolean,
  outer: AbortSignal | undefined,
): { tour: Tour; start(backlog: TourEvent[]): void } {
  const ac = new AbortController()
  const stateListeners = new Set<(s: TourState) => void>()
  const eventListeners = new Set<(e: TourEvent) => void>()
  let backlog: TourEvent[] | null = []
  let state: TourState = Object.freeze({
    status: 'idle',
    mode,
    index: 0,
    steps,
    anchor: null,
    highlight: null,
    busy: false,
  })
  let ended = false
  /** Incremented on every step entry; async work of an older entry is ignored. */
  let token = 0
  /** `do` steps whose call already ran (never repeated after `back()`). */
  const ran = new Set<number>()
  let inFlight = false
  /**
   * Every inline confirmation announced `pending` by the registry's `confirm` events and not yet
   * answered — any tool, any caller (the tour's own call, `ctx.confirm`, an MCP/WebMCP agent…).
   * While any is pending the tour is `confirming`: the app's confirmation UI must be reachable.
   */
  const pendingConfirms = new Set<string>()
  /** A hinted `do` call is in flight and its first `confirm` event has not arrived yet. */
  let hintedAwaitingConfirm = false
  /** The status the tour would have without a pending confirmation. */
  let baseStatus: TourState['status'] = 'idle'
  /** The current `do` step was entered by `back()` and has not run: `next()` runs it. */
  let awaitingRun = false
  /** Whether the current step's tool was describable for `tour` on entry. */
  let stepKnown = false
  /** Releases the current step's listeners and timers. */
  let stepCleanup: (() => void)[] = []
  const globalCleanup: (() => void)[] = []

  function update(
    patch: Partial<Omit<TourState, 'message'>> & { message?: string | undefined },
  ): void {
    const { message, ...rest } = patch
    if (rest.status !== undefined) baseStatus = rest.status
    const next: TourState = { ...state, ...rest, status: effectiveStatus() }
    if (message !== undefined) next.message = message
    else if ('message' in patch) delete next.message
    state = Object.freeze(next)
    for (const fn of [...stateListeners]) {
      try {
        fn(state)
      } catch (e) {
        console.error('[toolmark] tour state listener threw', e)
      }
    }
  }

  /** `confirming` over `running`/`waiting` while an inline confirmation is pending. */
  function effectiveStatus(): TourState['status'] {
    const confirming = pendingConfirms.size > 0 || hintedAwaitingConfirm
    return confirming && (baseStatus === 'running' || baseStatus === 'waiting')
      ? 'confirming'
      : baseStatus
  }

  /** Re-publishes the state when a confirmation change flips the effective status. */
  function syncConfirming(): void {
    if (state.status !== effectiveStatus()) update({})
  }

  function emit(e: TourEvent): void {
    if (backlog) {
      if (backlog.length < MAX_BACKLOG) backlog.push(e)
      return
    }
    for (const fn of [...eventListeners]) {
      try {
        fn(e)
      } catch (err) {
        console.error('[toolmark] tour event listener threw', err)
      }
    }
  }

  function clearStep(): void {
    const fns = stepCleanup
    stepCleanup = []
    for (const fn of fns) fn()
  }

  function end(status: 'done' | 'stopped', message?: string): void {
    if (ended) return
    ended = true
    token++
    clearStep()
    for (const fn of globalCleanup.splice(0)) fn()
    ac.abort()
    update({ status, anchor: null, highlight: null, busy: false, message })
    if (status === 'done') emit({ type: 'done' })
  }

  /** Enters the first step from `start` that has an anchor. `auto`: run an unrun `do` step. */
  function enter(start: number, auto = true): void {
    clearStep()
    awaitingRun = false
    const t = ++token
    for (let i = start; ; i++) {
      if (ended || t !== token) return
      if (i >= steps.length) {
        end('done')
        return
      }
      const step = steps[i]!
      stepKnown = tm.describe(step.tool, { caller: 'tour' }) !== undefined
      const anchor = tm.anchor(step.tool, step.param)
      update({ status: 'running', index: i, anchor, highlight: null, message: undefined })
      emit({ type: 'step_entered', step, index: i })
      if (ended || t !== token) return
      if (!anchor) {
        emit({ type: 'anchor_missing', step, reason: 'anchor_missing' })
        continue
      }
      if (mode === 'guide') guide(step, t)
      else if (mode === 'do' && !ran.has(i)) {
        if (auto) run(step, i, t)
        else awaitingRun = true
      }
      return
    }
  }

  function advance(): void {
    enter(state.index + 1)
  }

  function guide(step: TourStep, t: number): void {
    const waitFor = step.waitFor ?? 'input'
    let sawInput = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const validate = (): void => {
      clearTimeout(timer)
      if (ended || t !== token) return
      const issues = (tm.state(step.tool)?.issues ?? []).filter((i) => concerns(i.path, step.param))
      const first = issues[0]
      if (first) update({ status: 'waiting', message: first.message })
      else advance()
    }
    const off = tm.events.on('interaction', (e) => {
      if (!targets(e, step)) return
      if (waitFor === 'submit') {
        if (e.kind === 'submit') validate()
        return
      }
      if (e.kind !== 'input') return
      sawInput = true
      clearTimeout(timer)
      timer = setTimeout(validate, GUIDE_DEBOUNCE_MS)
    })
    stepCleanup.push(off, () => clearTimeout(timer))
    if (waitFor === 'input' && typeof document !== 'undefined') {
      // Leaving the anchor validates at once (listener on the document: the anchor may change).
      const onFocusOut = (e: FocusEvent): void => {
        const anchor = state.anchor
        if (!sawInput || !anchor || !(e.target instanceof Node) || !anchor.contains(e.target)) {
          return
        }
        if (e.relatedTarget instanceof Node && anchor.contains(e.relatedTarget)) return
        validate()
      }
      document.addEventListener('focusout', onFocusOut, true)
      stepCleanup.push(() => document.removeEventListener('focusout', onFocusOut, true))
    }
  }

  function run(step: TourStep, index: number, t: number): void {
    ran.add(index)
    awaitingRun = false
    const manifest = tm.describe(step.tool, { caller: 'tour' })
    const hinted = manifest?.hints.consequential === true || manifest?.hints.destructive === true
    // A hinted tool is `confirming` from the start, until its first confirmation event arrives
    // (then the tour-wide `pendingConfirms` takes over; see `onConfirm`).
    const offConfirm = tm.events.on('confirm', (e) => {
      if (e.tool !== step.tool || !hintedAwaitingConfirm) return
      hintedAwaitingConfirm = false
      if (!ended && t === token) syncConfirming()
    })
    stepCleanup.push(offConfirm)
    inFlight = true
    hintedAwaitingConfirm = hinted
    update({ busy: true })
    const settle = (result: ToolResult<unknown>): void => {
      offConfirm()
      inFlight = false
      hintedAwaitingConfirm = false
      if (ended || t !== token) return
      if (result.status !== 'ok') {
        end('stopped', failureMessage(result))
        return
      }
      update({ status: 'running', busy: false })
      const paths = reducedMotion ? [] : changedPaths(result.data)
      highlight(step, paths, 0, t)
    }
    tm.call(step.tool, toolInput(manifest, step.input), { caller: 'tour', signal: ac.signal }).then(
      settle,
      () => settle({ status: 'error', message: 'Tool failed' }),
    )
  }

  function highlight(step: TourStep, paths: string[], k: number, t: number): void {
    if (ended || t !== token) return
    const path = paths[k]
    if (path === undefined) {
      advance()
      return
    }
    update({ highlight: tm.anchor(step.tool, path) ?? state.anchor })
    const timer = setTimeout(() => highlight(step, paths, k + 1, t), HIGHLIGHT_MS)
    stepCleanup.push(() => clearTimeout(timer))
  }

  function onConfirm(e: { confirmId: string; stage: string }): void {
    if (e.stage === 'pending') pendingConfirms.add(e.confirmId)
    else pendingConfirms.delete(e.confirmId)
    if (!ended) syncConfirming()
  }

  function onChange(): void {
    if (ended || inFlight || state.status === 'idle') return
    const step = steps[state.index]
    if (!step) return
    if (stepKnown && tm.describe(step.tool, { caller: 'tour' }) === undefined) {
      emit({ type: 'step_skipped', step, reason: 'tool_removed' })
      if (!ended) advance()
      return
    }
    const anchor = tm.anchor(step.tool, step.param)
    if (anchor && anchor !== state.anchor) update({ anchor })
  }

  function stop(): void {
    end('stopped')
  }

  const tour: Tour = {
    get state() {
      return state
    },
    next() {
      if (ended || inFlight || state.status === 'idle') return Promise.resolve()
      if (awaitingRun) run(steps[state.index]!, state.index, token)
      else advance()
      return Promise.resolve()
    },
    back() {
      if (ended || inFlight || state.status === 'idle' || state.index === 0) return
      enter(state.index - 1, false)
    },
    stop,
    subscribe(fn) {
      stateListeners.add(fn)
      return () => {
        stateListeners.delete(fn)
      }
    },
    on(fn) {
      eventListeners.add(fn)
      if (backlog) {
        const pending = backlog
        backlog = null
        for (const e of pending) {
          try {
            fn(e)
          } catch (err) {
            console.error('[toolmark] tour event listener threw', err)
          }
        }
      }
      return () => {
        eventListeners.delete(fn)
      }
    },
  }

  return {
    tour,
    start(initial) {
      for (const e of initial) emit(e)
      if (outer?.aborted) {
        stop()
        return
      }
      if (outer) {
        outer.addEventListener('abort', stop, { once: true })
        globalCleanup.push(() => outer.removeEventListener('abort', stop))
      }
      if (steps.length === 0) {
        end('stopped', 'no valid steps')
        return
      }
      globalCleanup.push(tm.events.on('change', onChange), tm.events.on('confirm', onConfirm))
      enter(0)
    },
  }
}

/**
 * Starts a guided tour over the registry's tools (spec §11.5). Pass exactly one source: authored
 * `steps`, or a `goal` with an app-supplied `planner` (whose steps are validated against what
 * caller `tour` can see; invalid ones are dropped with `step_invalid`).
 *
 * - `show` waits for `next()` on every step.
 * - `guide` waits for the user's interaction events on the step's tool/param and validates via
 *   `tm.state()` (400 ms after the last input, or at once when focus leaves the anchor).
 * - `do` calls each step's tool as caller `tour` (policy and inline confirmation apply; state
 *   `busy` while the call is in flight),
 *   then highlights each changed field for 600 ms (none with reduced motion) and advances.
 *
 * In every mode the state is `confirming` while any inline confirmation announced by the
 * registry's `confirm` events is pending (the tour's own call, `ctx.confirm`, or any other tool
 * and caller, e.g. an MCP/WebMCP agent), and returns to `running`/`waiting` when none is.
 *
 * Steps whose anchor is not rendered are skipped (`anchor_missing`); a step whose tool disappears
 * is skipped (`step_skipped`). The tour never reads DOM values: only anchors, `tm.state()` (redacted
 * by each tool) and interaction events.
 * @param tm - The registry.
 * @param o - Mode, the step source, `reducedMotion` and an optional stop `signal`.
 * @returns The running tour (already on its first step, or `stopped` when no step is valid).
 * @throws TypeError (as a rejection) when the options are invalid; the planner's error when it rejects.
 */
export async function startTour(tm: Toolmark, o: StartTourOptions): Promise<Tour> {
  if (typeof o !== 'object' || o === null) throw new TypeError('startTour options are required')
  if (!isTourMode(o.mode)) throw new TypeError(`Unknown tour mode ${JSON.stringify(o.mode)}`)
  const planned = o.goal !== undefined || o.planner !== undefined
  if ((o.steps !== undefined) === planned) {
    throw new TypeError('startTour needs exactly one of `steps` or `goal` + `planner`')
  }
  let steps: TourStep[]
  let events: TourEvent[] = []
  if (planned) {
    if (typeof o.goal !== 'string' || typeof o.planner?.plan !== 'function') {
      throw new TypeError('A planned tour needs both `goal` (string) and `planner`')
    }
    ;({ steps, events } = await planSteps(
      tm,
      o.planner,
      o.goal,
      o.mode,
      o.signal ?? new AbortController().signal,
    ))
  } else {
    if (!Array.isArray(o.steps) || !o.steps.every(isAuthoredStep)) {
      throw new TypeError('Tour steps must be objects with string `tool` and `text`')
    }
    steps = authoredSteps(o.steps)
  }
  const engine = createEngine(
    tm,
    o.mode,
    Object.freeze(steps),
    o.reducedMotion ?? prefersReducedMotion(),
    o.signal,
  )
  engine.start(events)
  return engine.tour
}
