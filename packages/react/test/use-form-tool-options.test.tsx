import { cleanup, render, act } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  createToolmark,
  flatten,
  ok,
  setPath,
  type FormAdapter,
  type ToolResult,
} from '@toolmark/core'
import { ToolmarkProvider, useFormTool } from '../src/index.js'

afterEach(cleanup)

interface Values extends Record<string, unknown> {
  owner: string
}

function makeAdapter(initial: Values): FormAdapter<Values> {
  let values: Values = initial
  return {
    getValues: () => values,
    setValues(patch) {
      for (const [path, value] of Object.entries(patch)) {
        values = setPath(values, path, value === null ? undefined : value)
      }
    },
    dirtyPaths: () => [],
    submit: (): Promise<ToolResult<unknown>> => Promise.resolve(ok(values)),
    fields: () => Object.keys(flatten(values)).map((path) => ({ path })),
  }
}

describe('useFormTool options/files pass-through', () => {
  it('form_tool_options_provider_latest_no_reregister', async () => {
    const tm = createToolmark({ dev: true })
    const schema = z.object({ owner: z.string() })

    function Harness({ n }: { n: number }): null {
      const adapter = makeAdapter({ owner: '' })
      useFormTool(adapter, {
        name: 'form',
        description: 'A form',
        input: schema,
        options: {
          owner: () => Promise.resolve([{ value: `v${n}`, title: `t${n}` }]),
        },
      })
      return null
    }

    const { rerender } = render(
      <ToolmarkProvider toolmark={tm}>
        <Harness n={0} />
      </ToolmarkProvider>,
    )
    await act(() => Promise.resolve())
    const revBefore = tm.rev

    // A fresh provider closure and a fresh adapter object every render must not re-register.
    for (let i = 1; i <= 3; i++) {
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
    ).toEqual(['form.fill', 'form.options', 'form.submit'])

    // The latest provider closure (n=3) is the one actually called, not the one captured at
    // registration time (n=0).
    const result = await act(() =>
      tm.call('form.options', { field: 'owner', query: '' }, { caller: 'test' }),
    )
    expect(result.status).toBe('ok')
    if (result.status === 'ok') {
      const data = result.data as { options: { value: string; title: string }[] }
      expect(data.options[0]?.value).toBe('v3')
    }
  })
})
