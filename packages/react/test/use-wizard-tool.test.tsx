import { StrictMode, useState, type JSX, type ReactNode } from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  createToolmark,
  ok,
  ToolmarkError,
  type FormAdapter,
  type ToolResult,
  type WizardStep,
} from '@toolmark/core'
import { ToolmarkProvider, useWizardTool } from '../src/index.js'

afterEach(cleanup)

function noAdapter(initial: Record<string, unknown>): FormAdapter {
  let values = initial
  return {
    getValues: () => values,
    setValues: (patch) => {
      values = { ...values, ...patch }
    },
    dirtyPaths: () => [],
    submit: () => Promise.resolve(ok({})),
    fields: () => [],
  }
}

describe('useWizardTool', () => {
  it('wizard_hook_parent_state_mode', async () => {
    const tm = createToolmark({ dev: true })
    const steps: WizardStep[] = [
      { name: 'basicInfo', input: z.object({ title: z.string() }) },
      { name: 'details', input: z.object({ age: z.number() }) },
    ]
    const captured: {
      current?: { data: Record<string, Record<string, unknown>>; current: string }
    } = {}

    function Harness(): null {
      const [data, setData] = useState<Record<string, Record<string, unknown>>>({
        basicInfo: { title: '' },
        details: { age: 0 },
      })
      const [current, setCurrent] = useState('basicInfo')
      useWizardTool({
        name: 'wiz',
        description: 'A wizard',
        steps,
        data,
        setData,
        current,
        goTo: setCurrent,
        submit: () => Promise.resolve(ok({})),
      })
      captured.current = { data, current }
      return null
    }

    render(
      <ToolmarkProvider toolmark={tm}>
        <Harness />
      </ToolmarkProvider>,
    )

    expect(
      tm
        .manifest()
        .tools.map((t) => t.name)
        .sort(),
    ).toEqual(['wiz.fill', 'wiz.goTo', 'wiz.submit'])

    // Fill the non-current step ('details') while 'basicInfo' is current.
    const fillResult = await act(() =>
      tm.call('wiz.fill', { steps: { details: { age: 42 } } }, { caller: 'test' }),
    )
    expect(fillResult.status).toBe('ok')
    expect(captured.current?.data).toEqual({ basicInfo: { title: '' }, details: { age: 42 } })

    // Navigate to it: the data is already present, independent of navigation.
    await act(() => tm.call('wiz.goTo', { step: 'details' }, { caller: 'test' }))
    expect(captured.current?.current).toBe('details')
    expect(captured.current?.data.details).toEqual({ age: 42 })

    // Requirement (a): back-to-back fills, before React has re-rendered between them, must not
    // lose either write (the parent getter sees the first fill's write synchronously).
    await act(async () => {
      const r1 = await tm.call(
        'wiz.fill',
        { steps: { basicInfo: { title: 'Hello' } } },
        { caller: 'test' },
      )
      const r2 = await tm.call('wiz.fill', { steps: { details: { age: 7 } } }, { caller: 'test' })
      expect(r1.status).toBe('ok')
      expect(r2.status).toBe('ok')
    })
    expect(captured.current?.data).toEqual({ basicInfo: { title: 'Hello' }, details: { age: 7 } })
  })

  it('wizard_hook_stepwise_mode', async () => {
    const tm = createToolmark({ dev: true })
    const steps: WizardStep[] = [
      { name: 'a', input: z.object({ a: z.string() }) },
      { name: 'b', input: z.object({ b: z.number() }) },
    ]

    function Harness(): JSX.Element {
      const [current, setCurrent] = useState('a')
      const adapter = noAdapter({ a: '' })
      useWizardTool({
        name: 'wiz',
        description: 'A wizard',
        steps,
        current,
        goTo: setCurrent,
        currentAdapter: adapter,
        next: () => Promise.resolve(ok({})),
        previous: () => setCurrent('a'),
        submit: () => Promise.resolve(ok({})),
      })
      return <div>{current}</div>
    }

    render(
      <ToolmarkProvider toolmark={tm}>
        <Harness />
      </ToolmarkProvider>,
    )

    expect(
      tm
        .manifest()
        .tools.map((t) => t.name)
        .sort(),
    ).toEqual(['wiz.next', 'wiz.previous', 'wiz.step.fill', 'wiz.submit'])

    const fillResult = await act(() =>
      tm.call('wiz.step.fill', { values: { a: 'hi' } }, { caller: 'test' }),
    )
    expect(fillResult.status).toBe('ok')
  })

  it('wizard_hook_stepwise_refresh_on_current_change', async () => {
    const tm = createToolmark({ dev: true })
    const steps: WizardStep[] = [
      { name: 'a', input: z.object({ a: z.string() }) },
      { name: 'b', input: z.object({ b: z.number() }) },
    ]

    function Harness({ current }: { current: string }): null {
      const adapter = noAdapter({})
      useWizardTool({
        name: 'wiz',
        description: 'A wizard',
        steps,
        current,
        goTo: () => {},
        currentAdapter: adapter,
        next: () => Promise.resolve(ok({})),
        previous: () => {},
        submit: () => Promise.resolve(ok({})),
      })
      return null
    }

    const { rerender } = render(
      <ToolmarkProvider toolmark={tm}>
        <Harness current="a" />
      </ToolmarkProvider>,
    )

    const beforeSwitch = await act(() =>
      tm.call('wiz.step.fill', { values: { b: 5 } }, { caller: 'test' }),
    )
    expect(beforeSwitch.status).toBe('invalid')

    rerender(
      <ToolmarkProvider toolmark={tm}>
        <Harness current="b" />
      </ToolmarkProvider>,
    )
    await act(() => Promise.resolve())

    const afterSwitch = await act(() =>
      tm.call('wiz.step.fill', { values: { b: 5 } }, { caller: 'test' }),
    )
    expect(afterSwitch.status).toBe('ok')
  })

  function MisconfiguredHarness(): null {
    useWizardTool({
      name: 'wiz',
      description: 'A wizard',
      steps: [{ name: 'a', input: z.object({ a: z.string() }) }],
      current: 'a',
      goTo: () => {},
      submit: () => Promise.resolve(ok({})),
      // no data/setData and no next/previous/currentAdapter: stepwise mode is misconfigured.
    })
    return null
  }

  it('wizard_hook_missing_stepwise_callbacks_misconfigured_prod_event', () => {
    // Driven by the registry's own `dev` flag (not a bundler heuristic): `dev: false` → `error` event.
    const tm = createToolmark({ dev: false })
    const errors: { code: string; message: string }[] = []
    tm.events.on('error', (e) => errors.push(e))

    expect(() =>
      render(
        <ToolmarkProvider toolmark={tm}>
          <MisconfiguredHarness />
        </ToolmarkProvider>,
      ),
    ).not.toThrow()

    expect(errors.map((e) => e.code)).toContain('wizard_misconfigured')
    expect(tm.manifest().tools).toEqual([])
  })

  it('wizard_hook_missing_stepwise_callbacks_misconfigured_dev_throws', () => {
    const tm = createToolmark({ dev: true })
    const errors: { code: string }[] = []
    tm.events.on('error', (e) => errors.push(e))

    let thrown: unknown
    try {
      render(
        <ToolmarkProvider toolmark={tm}>
          <MisconfiguredHarness />
        </ToolmarkProvider>,
      )
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(ToolmarkError)
    expect((thrown as ToolmarkError).code).toBe('wizard_misconfigured')
    expect(errors).toEqual([])
    expect(tm.manifest().tools).toEqual([])
  })

  it('wizard_hook_stable_across_renders', async () => {
    const tm = createToolmark({ dev: true })
    const steps: WizardStep[] = [{ name: 'a', input: z.object({ a: z.string() }) }]

    function Harness({ n }: { n: number }): JSX.Element {
      const [data, setData] = useState<Record<string, Record<string, unknown>>>({ a: { a: '' } })
      useWizardTool({
        name: 'wiz',
        description: 'A wizard',
        steps,
        data,
        setData,
        current: 'a',
        goTo: () => {},
        submit: () => Promise.resolve(ok({})),
      })
      return <div>{n}</div>
    }

    const { rerender } = render(
      <ToolmarkProvider toolmark={tm}>
        <Harness n={0} />
      </ToolmarkProvider>,
    )
    await act(() => Promise.resolve())
    const revBefore = tm.rev

    for (let i = 1; i <= 5; i++) {
      rerender(
        <ToolmarkProvider toolmark={tm}>
          <Harness n={i} />
        </ToolmarkProvider>,
      )
    }
    await act(() => Promise.resolve())

    expect(tm.rev).toBe(revBefore)
    expect(
      tm
        .manifest()
        .tools.map((t) => t.name)
        .sort(),
    ).toEqual(['wiz.fill', 'wiz.goTo', 'wiz.submit'])
  })

  async function submitSeesSyncedStep(wrap: (n: ReactNode) => ReactNode): Promise<void> {
    const tm = createToolmark({ dev: true })
    const steps: WizardStep[] = [
      { name: 'basicInfo', input: z.object({ title: z.string() }) },
      { name: 'details', input: z.object({ age: z.number() }) },
    ]
    const seen: {
      arg?: Record<string, Record<string, unknown>>
      closure?: Record<string, Record<string, unknown>>
    } = {}

    function Harness(): null {
      const [data, setData] = useState<Record<string, Record<string, unknown>>>({
        basicInfo: { title: '' },
        details: { age: 1 },
      })
      useWizardTool({
        name: 'wiz',
        description: 'A wizard',
        steps,
        data,
        setData,
        current: 'basicInfo',
        goTo: () => {},
        // The mounted step form holds an edit not yet in `data`.
        currentAdapter: noAdapter({ title: 'Typed' }),
        submit: (merged): Promise<ToolResult<unknown>> => {
          seen.arg = merged
          seen.closure = data
          return Promise.resolve(ok({}))
        },
      })
      return null
    }

    render(<ToolmarkProvider toolmark={tm}>{wrap(<Harness />)}</ToolmarkProvider>)

    await act(async () => {
      const r = await tm.call('wiz.submit', {}, { caller: 'test' })
      const final =
        r.status === 'needs_confirmation'
          ? await tm.confirmPending(r.confirmId, { approved: true })
          : r
      expect(final.status).toBe('ok')
    })

    // The argument carries the synced current step; the closed-over state is the pre-merge snapshot.
    expect(seen.arg).toEqual({ basicInfo: { title: 'Typed' }, details: { age: 1 } })
    expect(seen.closure?.basicInfo).toEqual({ title: '' })
  }

  it('wizard_hook_submit_receives_synced_parent_data', async () => {
    await submitSeesSyncedStep((n) => n)
  })

  it('wizard_hook_submit_receives_synced_parent_data_strict_mode', async () => {
    await submitSeesSyncedStep((n) => <StrictMode>{n}</StrictMode>)
  })

  it('wizard_hook_zero_arg_submit_still_works', async () => {
    const tm = createToolmark({ dev: true })
    let called = 0
    function Harness(): null {
      const [data, setData] = useState<Record<string, Record<string, unknown>>>({ a: { a: 'x' } })
      useWizardTool({
        name: 'wiz',
        description: 'A wizard',
        steps: [{ name: 'a', input: z.object({ a: z.string() }) }],
        data,
        setData,
        current: 'a',
        goTo: () => {},
        submit: () => {
          called += 1
          return Promise.resolve(ok({}))
        },
      })
      return null
    }
    render(
      <ToolmarkProvider toolmark={tm}>
        <Harness />
      </ToolmarkProvider>,
    )
    await act(async () => {
      const r = await tm.call('wiz.submit', {}, { caller: 'test' })
      if (r.status === 'needs_confirmation')
        await tm.confirmPending(r.confirmId, { approved: true })
    })
    expect(called).toBe(1)
  })
})
