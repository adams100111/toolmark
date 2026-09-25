import { useState, type JSX } from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createToolmark, ok, type FormAdapter, type WizardStep } from '@toolmark/core'
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

  it('wizard_hook_missing_stepwise_callbacks_misconfigured', () => {
    // This suite's browser environment has no `import.meta.env.DEV`/`MODE` and no global
    // `process` (see the report's Ruling on `isDevEnvironment`), so the hook's dev/prod heuristic
    // resolves to "production" here: the reachable, tested path is the `error` event, mirroring
    // core's own `wizard_misconfigured` prod behaviour (never thrown, `render` never throws).
    const tm = createToolmark({ dev: true })
    const errors: { code: string; message: string }[] = []
    tm.events.on('error', (e) => errors.push(e))
    const steps: WizardStep[] = [{ name: 'a', input: z.object({ a: z.string() }) }]

    function Harness(): null {
      useWizardTool({
        name: 'wiz',
        description: 'A wizard',
        steps,
        current: 'a',
        goTo: () => {},
        submit: () => Promise.resolve(ok({})),
        // no data/setData and no next/previous/currentAdapter: stepwise mode is misconfigured.
      })
      return null
    }

    expect(() =>
      render(
        <ToolmarkProvider toolmark={tm}>
          <Harness />
        </ToolmarkProvider>,
      ),
    ).not.toThrow()

    expect(errors.map((e) => e.code)).toContain('wizard_misconfigured')
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
})
