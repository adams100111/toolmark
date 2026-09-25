import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createToolmark,
  emitEvent,
  ok,
  invalid,
  type ConfirmOutcome,
  type ToolDefinition,
  type Toolmark,
  type ToolState,
} from '@toolmark/core'
import { startTour, type Tour, type TourEvent, type TourState } from '../src/index.js'

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

const created: Element[] = []

function el(tag = 'div', id?: string): HTMLElement {
  const node = document.createElement(tag)
  if (id) node.id = id
  document.body.append(node)
  created.push(node)
  return node
}

afterEach(() => {
  vi.useRealTimers()
  for (const node of created.splice(0)) node.remove()
})

function deferred<T>(): { promise: Promise<T>; resolve(v: T): void } {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

function registry(confirm?: () => Promise<ConfirmOutcome>): Toolmark {
  return createToolmark({ confirm: confirm ?? (() => Promise.resolve({ approved: true })) })
}

const FILL_SCHEMA = {
  type: 'object',
  properties: {
    values: {
      type: 'object',
      properties: { email: { type: 'string' }, name: { type: 'string' } },
    },
    overwrite: { type: 'boolean' },
  },
  required: ['values'],
}

function tool(name: string, extra: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    name,
    description: `Tool ${name} for tests`,
    jsonSchema: { type: 'object', properties: {} },
    run: () => ok({ changes: [], skipped: [] }),
    ...extra,
  }
}

function record(tour: Tour): { events: TourEvent[]; states: TourState[] } {
  const events: TourEvent[] = []
  const states: TourState[] = []
  tour.on((e) => events.push(e))
  tour.subscribe((s) => states.push(s))
  return { events, states }
}

const types = (events: TourEvent[]): string[] =>
  events.map((e) =>
    e.type === 'step_entered'
      ? `entered:${e.index}`
      : e.type === 'done'
        ? 'done'
        : `${e.type}:${e.step.tool}:${e.reason}`,
  )

// ---------------------------------------------------------------------------------------------
// show mode
// ---------------------------------------------------------------------------------------------

describe('tour engine', () => {
  it('authored_show_mode_advances', async () => {
    const tm = registry()
    const a = el()
    const b = el()
    tm.register(tool('a', { anchors: { element: () => a } }))
    tm.register(tool('b', { anchors: { params: { email: () => b } } }))
    const tour = await startTour(tm, {
      mode: 'show',
      steps: [
        { tool: 'a', title: 'First', text: 'This is A' },
        { tool: 'b', param: 'email', text: 'This is B' },
      ],
    })
    expect(tour.state).toMatchObject({ status: 'running', mode: 'show', index: 0, anchor: a })
    expect(tour.state.steps).toHaveLength(2)
    const { events } = record(tour)
    // The first listener receives the events emitted before it subscribed.
    expect(types(events)).toEqual(['entered:0'])
    // Show mode waits for next(): nothing happens on its own.
    await new Promise((r) => setTimeout(r, 20))
    expect(tour.state.index).toBe(0)
    await tour.next()
    expect(tour.state).toMatchObject({ status: 'running', index: 1, anchor: b })
    await tour.next()
    expect(tour.state).toMatchObject({ status: 'done', anchor: null })
    expect(types(events)).toEqual(['entered:0', 'entered:1', 'done'])
    // next() after done is a no-op.
    await tour.next()
    expect(tour.state.status).toBe('done')
    expect(Object.isFrozen(tour.state)).toBe(true)
  })

  it('missing_anchor_skips_step', async () => {
    const tm = registry()
    const a = el()
    const c = el()
    tm.register(tool('a', { anchors: { element: () => a } }))
    tm.register(tool('hidden', { anchors: { element: () => null } }))
    tm.register(tool('c', { anchors: { element: () => c } }))
    const tour = await startTour(tm, {
      mode: 'show',
      steps: [
        { tool: 'a', text: 'A' },
        { tool: 'hidden', text: 'not rendered' },
        { tool: 'c', text: 'C' },
      ],
    })
    const { events } = record(tour)
    await tour.next()
    expect(tour.state).toMatchObject({ status: 'running', index: 2, anchor: c })
    expect(types(events)).toEqual([
      'entered:0',
      'entered:1',
      'anchor_missing:hidden:anchor_missing',
      'entered:2',
    ])
    // A missing anchor on the last step finishes the tour.
    const tour2 = await startTour(tm, {
      mode: 'show',
      steps: [{ tool: 'hidden', text: 'x' }],
    })
    expect(tour2.state.status).toBe('done')
  })

  // -------------------------------------------------------------------------------------------
  // guide mode
  // -------------------------------------------------------------------------------------------

  it('guide_waits_until_valid', async () => {
    vi.useFakeTimers()
    const tm = registry()
    const email = el('input')
    const name = el('input')
    const form = el('form')
    let issues: ToolState<unknown>['issues'] = [{ path: 'email', message: 'Invalid email' }]
    tm.register(
      tool('f.fill', {
        jsonSchema: FILL_SCHEMA,
        anchors: { element: () => form, params: { email: () => email, name: () => name } },
        state: () => ({
          values: {},
          issues: [...issues, { path: 'other', message: 'Unrelated issue' }],
        }),
      }),
    )
    tm.register(tool('f.submit', { anchors: { element: () => form } }))
    const tour = await startTour(tm, {
      mode: 'guide',
      steps: [
        { tool: 'f.fill', param: 'email', text: 'Type your email' },
        { tool: 'f.fill', param: 'name', text: 'Type your name' },
        { tool: 'f.submit', text: 'Send it', waitFor: 'submit' },
      ],
    })
    const human = { caller: 'human' as const }
    expect(tour.state).toMatchObject({ status: 'running', index: 0, anchor: email })

    // Events on other tools/params are ignored.
    emitEvent(tm, 'interaction', { tool: 'f.fill', param: 'name', kind: 'input', ...human })
    emitEvent(tm, 'interaction', { tool: 'g.fill', param: 'email', kind: 'input', ...human })
    await vi.advanceTimersByTimeAsync(1000)
    expect(tour.state).toMatchObject({ status: 'running', index: 0 })

    // 400 ms debounce after the last input event.
    emitEvent(tm, 'interaction', { tool: 'f.fill', param: 'email', kind: 'input', ...human })
    await vi.advanceTimersByTimeAsync(300)
    emitEvent(tm, 'interaction', { tool: 'f.fill', param: 'email', kind: 'input', ...human })
    await vi.advanceTimersByTimeAsync(399)
    expect(tour.state.status).toBe('running')
    await vi.advanceTimersByTimeAsync(1)
    expect(tour.state).toMatchObject({ status: 'waiting', index: 0, message: 'Invalid email' })

    // The user fixes it; leaving the field validates at once (no debounce wait).
    issues = []
    emitEvent(tm, 'interaction', { tool: 'f.fill', param: 'email', kind: 'input', ...human })
    email.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    expect(tour.state).toMatchObject({ status: 'running', index: 1, anchor: name })
    expect(tour.state.message).toBeUndefined()

    // Focus leaving before any input does not validate.
    name.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    expect(tour.state.index).toBe(1)
    // A nested issue under the param counts.
    issues = [{ path: 'name.first', message: 'Too short' }]
    emitEvent(tm, 'interaction', { tool: 'f.fill', param: 'name', kind: 'input', ...human })
    await vi.advanceTimersByTimeAsync(400)
    expect(tour.state).toMatchObject({ status: 'waiting', message: 'Too short' })
    issues = []
    emitEvent(tm, 'interaction', { tool: 'f.fill', param: 'name', kind: 'input', ...human })
    await vi.advanceTimersByTimeAsync(400)
    expect(tour.state).toMatchObject({ status: 'running', index: 2, anchor: form })

    // waitFor 'submit': inputs do not advance, the user's submit does.
    emitEvent(tm, 'interaction', { tool: 'f.submit', kind: 'input', ...human })
    await vi.advanceTimersByTimeAsync(1000)
    expect(tour.state.index).toBe(2)
    emitEvent(tm, 'interaction', { tool: 'f.submit', kind: 'submit', ...human })
    expect(tour.state.status).toBe('done')
  })

  // -------------------------------------------------------------------------------------------
  // do mode
  // -------------------------------------------------------------------------------------------

  it('do_mode_calls_as_tour_and_wraps_fill_values', async () => {
    const tm = registry()
    const anchor = el()
    const calls: { tool: string; input: unknown; caller: string }[] = []
    const make = (
      name: string,
      jsonSchema: NonNullable<ToolDefinition['jsonSchema']>,
    ): ToolDefinition =>
      tool(name, {
        jsonSchema,
        anchors: { element: () => anchor, resolve: () => anchor },
        run: (input, ctx) => {
          calls.push({ tool: name, input, caller: ctx.caller })
          return ok({ changes: [], skipped: [] })
        },
      })
    tm.register(make('f.fill', FILL_SCHEMA))
    tm.register(make('plain', { type: 'object', properties: { x: { type: 'number' } } }))
    const tour = await startTour(tm, {
      mode: 'do',
      reducedMotion: true,
      steps: [
        { tool: 'f.fill', param: 'email', text: 'Fill email', input: { email: 'a@b.co' } },
        { tool: 'f.fill', text: 'Already wrapped', input: { values: { name: 'Ann' } } },
        { tool: 'f.fill', text: 'Not an object', input: 'raw' },
        { tool: 'plain', text: 'Not a fill', input: { x: 1 } },
        { tool: 'plain', text: 'No input' },
      ],
    })
    await vi.waitFor(() => expect(tour.state.status).toBe('done'))
    expect(calls).toEqual([
      { tool: 'f.fill', input: { values: { email: 'a@b.co' } }, caller: 'tour' },
      { tool: 'f.fill', input: { values: { name: 'Ann' } }, caller: 'tour' },
      { tool: 'f.fill', input: 'raw', caller: 'tour' },
      { tool: 'plain', input: { x: 1 }, caller: 'tour' },
      { tool: 'plain', input: {}, caller: 'tour' },
    ])
  })

  it('do_mode_wizard_fill_not_wrapped', async () => {
    const tm = registry()
    const anchor = el()
    const inputs: unknown[] = []
    tm.register(
      tool('w.fill', {
        jsonSchema: {
          type: 'object',
          properties: {
            steps: {
              type: 'object',
              properties: { details: { type: 'object', properties: { title: {} } } },
            },
            overwrite: { type: 'boolean' },
          },
          required: ['steps'],
        },
        anchors: { element: () => anchor, resolve: () => anchor },
        run: (input) => {
          inputs.push(input)
          return ok({ changes: [], skipped: [] })
        },
      }),
    )
    const tour = await startTour(tm, {
      mode: 'do',
      reducedMotion: true,
      steps: [
        {
          tool: 'w.fill',
          param: 'details.title',
          text: 'Title',
          input: { steps: { details: { title: 'Hi' } } },
        },
      ],
    })
    await vi.waitFor(() => expect(tour.state.status).toBe('done'))
    expect(inputs).toEqual([{ steps: { details: { title: 'Hi' } } }])
  })

  it('do_mode_consequential_sets_confirming', async () => {
    const approval = deferred<ConfirmOutcome>()
    let asked = 0
    const tm = registry(() => {
      asked++
      return approval.promise
    })
    const anchor = el()
    const plainRun = deferred<void>()
    let ran = 0
    tm.register(
      tool('slow', {
        anchors: { element: () => anchor },
        run: async () => {
          await plainRun.promise
          return ok({ changes: [], skipped: [] })
        },
      }),
    )
    tm.register(
      tool('publish', {
        hints: { consequential: true },
        anchors: { element: () => anchor },
        run: () => {
          ran++
          return ok({ changes: [], skipped: [] })
        },
      }),
    )
    const tour = await startTour(tm, {
      mode: 'do',
      reducedMotion: true,
      steps: [
        { tool: 'slow', text: 'Not consequential' },
        { tool: 'publish', text: 'Publish it' },
      ],
    })
    // A plain in-flight call is `running`, not `confirming`.
    expect(tour.state).toMatchObject({ status: 'running', index: 0 })
    // next()/back() are ignored while a call is in flight.
    await tour.next()
    tour.back()
    expect(tour.state.index).toBe(0)
    plainRun.resolve()
    await vi.waitFor(() => expect(asked).toBe(1))
    expect(tour.state).toMatchObject({ status: 'confirming', index: 1 })
    expect(ran).toBe(0)
    approval.resolve({ approved: true })
    await vi.waitFor(() => expect(tour.state.status).toBe('done'))
    expect(ran).toBe(1)
  })

  it('do_mode_highlights_changes', async () => {
    vi.useFakeTimers()
    const tm = registry()
    const form = el('form')
    const a = el('input')
    const b = el('input')
    tm.register(
      tool('f.fill', {
        jsonSchema: FILL_SCHEMA,
        anchors: {
          element: () => form,
          params: { email: () => a, name: () => b },
        },
        run: () =>
          ok({
            changes: [
              { path: 'name', before: '', after: 'Ann' },
              { path: 'email', before: '', after: 'a@b.co' },
              { path: 'unanchored', before: 1, after: 2 },
            ],
            skipped: [],
          }),
      }),
    )
    const steps = [{ tool: 'f.fill', text: 'Fill', input: { name: 'Ann', email: 'a@b.co' } }]
    const tour = await startTour(tm, { mode: 'do', reducedMotion: false, steps })
    await vi.advanceTimersByTimeAsync(0)
    // Changes in `changes` order, 600 ms each; unanchored falls back to the step's anchor.
    expect(tour.state).toMatchObject({ index: 0, highlight: b })
    await vi.advanceTimersByTimeAsync(599)
    expect(tour.state.highlight).toBe(b)
    await vi.advanceTimersByTimeAsync(1)
    expect(tour.state.highlight).toBe(a)
    await vi.advanceTimersByTimeAsync(600)
    expect(tour.state).toMatchObject({ index: 0, highlight: form })
    await vi.advanceTimersByTimeAsync(600)
    expect(tour.state).toMatchObject({ status: 'done', highlight: null })

    // Reduced motion: no highlight sequence, advance immediately.
    const tour2 = await startTour(tm, { mode: 'do', reducedMotion: true, steps })
    const { states } = record(tour2)
    await vi.advanceTimersByTimeAsync(0)
    expect(tour2.state.status).toBe('done')
    expect(states.every((s) => s.highlight == null)).toBe(true)
  })

  it('do_mode_failure_stops_with_message', async () => {
    const tm = registry()
    const anchor = el()
    tm.register(
      tool('bad', {
        anchors: { element: () => anchor },
        run: () => invalid([{ path: 'email', message: 'Bad email' }]),
      }),
    )
    tm.register(
      tool('gone', {
        hints: { destructive: true },
        anchors: { element: () => anchor },
      }),
    )
    const tour = await startTour(tm, {
      mode: 'do',
      reducedMotion: true,
      steps: [
        { tool: 'bad', text: 'Fails' },
        { tool: 'bad', text: 'Never reached' },
      ],
    })
    await vi.waitFor(() => expect(tour.state.status).toBe('stopped'))
    expect(tour.state).toMatchObject({ index: 0, message: 'Bad email' })

    // Policy still applies: a destructive tool is refused to caller `tour` by default.
    const tour2 = await startTour(tm, {
      mode: 'do',
      reducedMotion: true,
      steps: [{ tool: 'gone', text: 'Delete' }],
    })
    await vi.waitFor(() => expect(tour2.state.status).toBe('stopped'))
    expect(tour2.state.message).toEqual(expect.any(String))
    expect(tour2.state.message).not.toBe('')
  })

  // -------------------------------------------------------------------------------------------
  // lifecycle
  // -------------------------------------------------------------------------------------------

  it('lifecycle_events_and_back_never_undoes', async () => {
    vi.useFakeTimers()
    const tm = registry()
    const a = el()
    const b = el()
    let runs = 0
    const undo = vi.spyOn(tm, 'undo')
    tm.register(
      tool('f.fill', {
        jsonSchema: FILL_SCHEMA,
        anchors: { element: () => a, params: { name: () => b } },
        run: (_input, ctx) => {
          runs++
          ctx.registerUndo(() => ok({ changes: [] }))
          return ok({ changes: [{ path: 'name', before: '', after: 'x' }], skipped: [] })
        },
      }),
    )
    const tour = await startTour(tm, {
      mode: 'do',
      reducedMotion: false,
      steps: [
        { tool: 'f.fill', text: 'One', input: { name: 'x' } },
        { tool: 'f.fill', text: 'Two', input: { name: 'y' } },
      ],
    })
    const { events } = record(tour)
    await vi.advanceTimersByTimeAsync(600)
    expect(tour.state.index).toBe(1)
    await vi.advanceTimersByTimeAsync(0)
    expect(runs).toBe(2)
    // Back during the highlight sequence: index moves, nothing undone or re-run.
    tour.back()
    expect(tour.state).toMatchObject({ status: 'running', index: 0, anchor: a, highlight: null })
    await vi.advanceTimersByTimeAsync(5000)
    expect(tour.state.index).toBe(0)
    expect(runs).toBe(2)
    expect(undo).not.toHaveBeenCalled()
    // Already-run steps wait for next() and are not called again.
    await tour.next()
    await vi.advanceTimersByTimeAsync(5000)
    expect(tour.state).toMatchObject({ status: 'running', index: 1 })
    expect(runs).toBe(2)
    await tour.next()
    expect(tour.state.status).toBe('done')
    expect(types(events)).toEqual(['entered:0', 'entered:1', 'entered:0', 'entered:1', 'done'])

    // back() at index 0 is a no-op; stop() and an aborted signal stop the tour.
    const show = await startTour(tm, { mode: 'show', steps: [{ tool: 'f.fill', text: 'x' }] })
    show.back()
    expect(show.state.index).toBe(0)
    show.stop()
    expect(show.state.status).toBe('stopped')
    show.stop()
    await show.next()
    expect(show.state.status).toBe('stopped')

    const ac = new AbortController()
    const guided = await startTour(tm, {
      mode: 'guide',
      signal: ac.signal,
      steps: [{ tool: 'f.fill', param: 'name', text: 'x' }],
    })
    ac.abort()
    expect(guided.state.status).toBe('stopped')
    // Listeners are released: interactions no longer do anything.
    emitEvent(tm, 'interaction', { tool: 'f.fill', param: 'name', kind: 'input', caller: 'human' })
    await vi.advanceTimersByTimeAsync(1000)
    expect(guided.state.status).toBe('stopped')

    const aborted = new AbortController()
    aborted.abort()
    const never = await startTour(tm, {
      mode: 'show',
      signal: aborted.signal,
      steps: [{ tool: 'f.fill', text: 'x' }],
    })
    expect(never.state.status).toBe('stopped')
  })

  it('tool_removed_mid_tour_skips', async () => {
    const tm = registry()
    const a = el()
    const b = el()
    const reg = tm.register(tool('a', { anchors: { element: () => a } }))
    tm.register(tool('b', { anchors: { element: () => b } }))
    const tour = await startTour(tm, {
      mode: 'show',
      steps: [
        { tool: 'a', text: 'A' },
        { tool: 'b', text: 'B' },
      ],
    })
    const { events } = record(tour)
    reg.dispose()
    await vi.waitFor(() => expect(tour.state.index).toBe(1))
    expect(tour.state.anchor).toBe(b)
    expect(types(events)).toEqual(['entered:0', 'step_skipped:a:tool_removed', 'entered:1'])
  })

  // -------------------------------------------------------------------------------------------
  // fix round 1
  // -------------------------------------------------------------------------------------------

  it('do_mode_ctx_confirm_sets_confirming_and_busy', async () => {
    const approval = deferred<ConfirmOutcome>()
    const finish = deferred<void>()
    let asked = 0
    const tm = registry(() => {
      asked++
      return approval.promise
    })
    const anchor = el()
    tm.register(
      tool('other', {
        anchors: { element: () => anchor },
      }),
    )
    tm.register(
      tool('save', {
        // Not hinted: the confirmation comes from ctx.confirm inside run.
        anchors: { element: () => anchor },
        run: async (_input, ctx) => {
          const o = await ctx.confirm({ summary: 'Save?' })
          if (!o.approved) return ok({ changes: [], skipped: [] })
          await finish.promise
          return ok({ changes: [], skipped: [] })
        },
      }),
    )
    const tour = await startTour(tm, {
      mode: 'do',
      reducedMotion: true,
      steps: [{ tool: 'save', text: 'Save it' }],
    })
    expect(tour.state).toMatchObject({ busy: true })
    await vi.waitFor(() => expect(asked).toBe(1))
    expect(tour.state).toMatchObject({ status: 'confirming', busy: true, index: 0 })
    approval.resolve({ approved: true })
    // Approved: the confirmation is over but the call is still running.
    await vi.waitFor(() => expect(tour.state.status).toBe('running'))
    expect(tour.state.busy).toBe(true)
    finish.resolve()
    await vi.waitFor(() => expect(tour.state.status).toBe('done'))
    expect(tour.state.busy).toBe(false)
  })

  it('do_mode_two_consequential_steps_each_confirmed', async () => {
    const approvals: ((o: ConfirmOutcome) => void)[] = []
    const tm = registry(() => new Promise<ConfirmOutcome>((r) => approvals.push(r)))
    const anchor = el()
    const ran: string[] = []
    for (const name of ['one', 'two']) {
      tm.register(
        tool(name, {
          hints: { consequential: true },
          anchors: { element: () => anchor },
          run: () => {
            ran.push(name)
            return ok({ changes: [], skipped: [] })
          },
        }),
      )
    }
    const tour = await startTour(tm, {
      mode: 'do',
      reducedMotion: true,
      steps: [
        { tool: 'one', text: 'One' },
        { tool: 'two', text: 'Two' },
      ],
    })
    await vi.waitFor(() => expect(approvals).toHaveLength(1))
    expect(tour.state).toMatchObject({ status: 'confirming', index: 0 })
    approvals[0]!({ approved: true })
    await vi.waitFor(() => expect(approvals).toHaveLength(2))
    // The second step asks again; its call has not run yet.
    expect(tour.state).toMatchObject({ status: 'confirming', index: 1 })
    expect(ran).toEqual(['one'])
    approvals[1]!({ approved: true })
    await vi.waitFor(() => expect(tour.state.status).toBe('done'))
    expect(ran).toEqual(['one', 'two'])
  })

  it('do_mode_rejected_confirmation_stops', async () => {
    const tm = registry(() => Promise.resolve({ approved: false, reason: 'nope' }))
    const anchor = el()
    let ran = 0
    tm.register(
      tool('publish', {
        hints: { consequential: true },
        anchors: { element: () => anchor },
        run: () => {
          ran++
          return ok({ changes: [], skipped: [] })
        },
      }),
    )
    const tour = await startTour(tm, {
      mode: 'do',
      reducedMotion: true,
      steps: [
        { tool: 'publish', text: 'Publish' },
        { tool: 'publish', text: 'Never reached' },
      ],
    })
    await vi.waitFor(() => expect(tour.state.status).toBe('stopped'))
    expect(tour.state).toMatchObject({ index: 0, busy: false })
    expect(tour.state.message).toEqual(expect.any(String))
    expect(tour.state.message).not.toBe('')
    expect(ran).toBe(0)
  })

  it('guide_nested_input_satisfies_parent_param', async () => {
    vi.useFakeTimers()
    const tm = registry()
    const field = el()
    tm.register(
      tool('addr.fill', {
        anchors: { element: () => field, params: { address: () => field } },
      }),
    )
    const tour = await startTour(tm, {
      mode: 'guide',
      steps: [{ tool: 'addr.fill', param: 'address', text: 'Address' }],
    })
    emitEvent(tm, 'interaction', {
      tool: 'addr.fill',
      param: 'address.city',
      kind: 'input',
      caller: 'human',
    })
    await vi.advanceTimersByTimeAsync(400)
    expect(tour.state.status).toBe('done')
  })

  it('do_mode_back_to_unrun_step_runs_only_on_next', async () => {
    vi.useFakeTimers()
    const tm = registry()
    let aAnchor: HTMLElement | null = null
    const b = el()
    let runsA = 0
    let runsB = 0
    tm.register(
      tool('a', {
        anchors: { element: () => aAnchor },
        run: () => {
          runsA++
          return ok({ changes: [], skipped: [] })
        },
      }),
    )
    tm.register(
      tool('b.fill', {
        jsonSchema: FILL_SCHEMA,
        anchors: { element: () => b },
        run: () => {
          runsB++
          return ok({ changes: [{ path: 'name', before: '', after: 'x' }], skipped: [] })
        },
      }),
    )
    const tour = await startTour(tm, {
      mode: 'do',
      reducedMotion: false,
      steps: [
        { tool: 'a', text: 'A' },
        { tool: 'b.fill', text: 'B', input: { name: 'x' } },
      ],
    })
    await vi.advanceTimersByTimeAsync(0)
    // A was skipped (no anchor); B ran and is highlighting.
    expect(tour.state.index).toBe(1)
    expect(runsB).toBe(1)
    aAnchor = el()
    tour.back()
    expect(tour.state).toMatchObject({ status: 'running', index: 0, anchor: aAnchor })
    await vi.advanceTimersByTimeAsync(5000)
    // Entering A via back() does not run it.
    expect(runsA).toBe(0)
    expect(tour.state.index).toBe(0)
    // next() runs it, then the tour moves on to B (already run: waits).
    await tour.next()
    await vi.advanceTimersByTimeAsync(0)
    expect(runsA).toBe(1)
    expect(tour.state).toMatchObject({ status: 'running', index: 1 })
    await vi.advanceTimersByTimeAsync(5000)
    expect(runsB).toBe(1)
    await tour.next()
    expect(tour.state.status).toBe('done')
  })

  it('exactly_one_source_required', async () => {
    const tm = registry()
    const planner = { plan: () => Promise.resolve([]) }
    const steps = [{ tool: 'a', text: 'A' }]
    await expect(startTour(tm, { mode: 'show' })).rejects.toBeInstanceOf(TypeError)
    await expect(startTour(tm, { mode: 'show', steps, goal: 'x', planner })).rejects.toBeInstanceOf(
      TypeError,
    )
    await expect(startTour(tm, { mode: 'show', steps, planner })).rejects.toBeInstanceOf(TypeError)
    await expect(startTour(tm, { mode: 'show', goal: 'x' })).rejects.toBeInstanceOf(TypeError)
    await expect(startTour(tm, { mode: 'show', planner })).rejects.toBeInstanceOf(TypeError)
    await expect(startTour(tm, { mode: 'nope' as 'show', steps })).rejects.toBeInstanceOf(TypeError)
    // Zero authored steps: stopped with "no valid steps".
    const empty = await startTour(tm, { mode: 'show', steps: [] })
    expect(empty.state).toMatchObject({ status: 'stopped', message: 'no valid steps' })
  })

  // -------------------------------------------------------------------------------------------
  // final fix wave: `confirming` for ANY pending inline confirmation
  // -------------------------------------------------------------------------------------------

  it('do_mode_other_tool_inline_confirm_sets_confirming (MCP/WebMCP caller)', async () => {
    const approvals: ((o: ConfirmOutcome) => void)[] = []
    const tm = registry(() => new Promise<ConfirmOutcome>((r) => approvals.push(r)))
    const anchor = el()
    const finish = deferred<void>()
    tm.register(
      tool('slow', {
        anchors: { element: () => anchor },
        run: async () => {
          await finish.promise
          return ok({ changes: [], skipped: [] })
        },
      }),
    )
    tm.register(tool('danger', { hints: { consequential: true } }))
    const tour = await startTour(tm, {
      mode: 'do',
      reducedMotion: true,
      steps: [{ tool: 'slow', text: 'Slow step' }],
    })
    expect(tour.state).toMatchObject({ status: 'running', busy: true })

    // An agent calls another (consequential) tool while the tour's call is in flight: its inline
    // confirmation must release the tour's focus trap too.
    const agentCall = tm.call('danger', {}, { caller: 'mcp' })
    await vi.waitFor(() => expect(approvals).toHaveLength(1))
    expect(tour.state).toMatchObject({ status: 'confirming', busy: true, index: 0 })
    approvals[0]!({ approved: true })
    await vi.waitFor(() => expect(tour.state.status).toBe('running'))
    expect(tour.state.busy).toBe(true)

    finish.resolve()
    await vi.waitFor(() => expect(tour.state.status).toBe('done'))
    // The agent's call runs once the tour's call is no longer in flight.
    await expect(agentCall).resolves.toMatchObject({ status: 'ok' })
  })

  it('show_mode_any_pending_confirm_sets_confirming_until_none_pending', async () => {
    const approvals: ((o: ConfirmOutcome) => void)[] = []
    const tm = registry(() => new Promise<ConfirmOutcome>((r) => approvals.push(r)))
    const anchor = el()
    tm.register(tool('a', { anchors: { element: () => anchor } }))
    tm.register(tool('danger', { hints: { consequential: true } }))
    const tour = await startTour(tm, { mode: 'show', steps: [{ tool: 'a', text: 'Look' }] })
    expect(tour.state.status).toBe('running')

    const first = tm.call('danger', {}, { caller: 'webmcp' })
    const second = tm.call('danger', {}, { caller: 'mcp' })
    await vi.waitFor(() => expect(approvals).toHaveLength(2))
    expect(tour.state.status).toBe('confirming')
    approvals[0]!({ approved: true })
    await first
    // One confirmation still pending.
    expect(tour.state.status).toBe('confirming')
    approvals[1]!({ approved: false })
    await second
    await vi.waitFor(() => expect(tour.state.status).toBe('running'))
    expect(tour.state.busy).toBe(false)
  })

  it('guide_mode_confirm_restores_waiting_with_its_message', async () => {
    vi.useFakeTimers()
    const tm = registry()
    const email = el('input')
    const form = el('form')
    tm.register(
      tool('f.fill', {
        jsonSchema: FILL_SCHEMA,
        anchors: { element: () => form, params: { email: () => email } },
        state: () => ({ values: {}, issues: [{ path: 'email', message: 'Invalid email' }] }),
      }),
    )
    const tour = await startTour(tm, {
      mode: 'guide',
      steps: [{ tool: 'f.fill', param: 'email', text: 'Type your email' }],
    })
    emitEvent(tm, 'interaction', { tool: 'f.fill', param: 'email', kind: 'input', caller: 'human' })
    await vi.advanceTimersByTimeAsync(400)
    expect(tour.state).toMatchObject({ status: 'waiting', message: 'Invalid email' })

    emitEvent(tm, 'confirm', { confirmId: 'c1', tool: 'elsewhere', stage: 'pending' })
    expect(tour.state.status).toBe('confirming')
    emitEvent(tm, 'confirm', { confirmId: 'c1', tool: 'elsewhere', stage: 'expired' })
    expect(tour.state).toMatchObject({ status: 'waiting', message: 'Invalid email' })
  })
})
