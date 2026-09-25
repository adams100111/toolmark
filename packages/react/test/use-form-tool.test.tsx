import { StrictMode, type ReactElement } from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  createToolmark,
  flatten,
  ok,
  setPath,
  type FormAdapter,
  type ToolmarkErrorEvent,
  type ToolResult,
} from '@toolmark/core'
import { ToolmarkProvider, ToolScope, useFormTool } from '../src/index.js'

afterEach(cleanup)

interface Values extends Record<string, unknown> {
  title: string
}

function makeAdapter(initial: Values): FormAdapter<Values> {
  let values: Values = initial
  const dirty = new Set<string>()
  return {
    getValues: () => values,
    setValues(patch) {
      for (const [path, value] of Object.entries(patch)) {
        values = setPath(values, path, value === null ? undefined : value)
      }
    },
    dirtyPaths: () => [...dirty],
    submit: (): Promise<ToolResult<unknown>> => Promise.resolve(ok(values)),
    fields: () => Object.keys(flatten(values)).map((path) => ({ path })),
  }
}

describe('useFormTool', () => {
  it('form_tool_registers_fill_and_submit_under_scope', () => {
    const tm = createToolmark({ dev: true })
    const schema = z.object({ title: z.string() })
    const adapter = makeAdapter({ title: '' })

    function FormComp(): null {
      useFormTool(adapter, { name: 'form', description: 'A form', input: schema })
      return null
    }

    render(
      <ToolmarkProvider toolmark={tm}>
        <ToolScope name="f">
          <FormComp />
        </ToolScope>
      </ToolmarkProvider>,
    )

    expect(
      tm
        .manifest()
        .tools.map((t) => t.name)
        .sort(),
    ).toEqual(['f.form.fill', 'f.form.submit'])
  })

  it('form_tool_stable_across_renders', async () => {
    const tm = createToolmark({ dev: true })
    const schema = z.object({ title: z.string() })
    const adapter = makeAdapter({ title: '' })

    function FormComp({ n }: { n: number }): ReactElement {
      useFormTool(adapter, { name: 'form', description: 'A form', input: schema })
      return <div>{n}</div>
    }

    const { rerender } = render(
      <ToolmarkProvider toolmark={tm}>
        <FormComp n={0} />
      </ToolmarkProvider>,
    )
    await Promise.resolve()
    const revBefore = tm.rev

    for (let i = 1; i <= 5; i++) {
      rerender(
        <ToolmarkProvider toolmark={tm}>
          <FormComp n={i} />
        </ToolmarkProvider>,
      )
    }
    await Promise.resolve()

    expect(tm.rev).toBe(revBefore)
    expect(
      tm
        .manifest()
        .tools.map((t) => t.name)
        .sort(),
    ).toEqual(['form.fill', 'form.submit'])
  })

  it('strict_mode_form_tool_inside_scope_registered_once', () => {
    const tm = createToolmark({ dev: true })
    const errors: ToolmarkErrorEvent[] = []
    tm.events.on('error', (e) => errors.push(e))
    const schema = z.object({ title: z.string() })
    const adapter = makeAdapter({ title: '' })

    function FormComp(): null {
      useFormTool(adapter, { name: 'form', description: 'A form', input: schema })
      return null
    }

    render(
      <StrictMode>
        <ToolmarkProvider toolmark={tm}>
          <ToolScope name="f">
            <FormComp />
          </ToolScope>
        </ToolmarkProvider>
      </StrictMode>,
    )

    expect(
      tm
        .manifest()
        .tools.map((t) => t.name)
        .sort(),
    ).toEqual(['f.form.fill', 'f.form.submit'])
    // `missing_confirm_handler` is an expected dev-mode advisory here (no inline `confirm` handler
    // was configured, so `.submit` is hidden from webmcp/mcp/tour); StrictMode-safety means no
    // `duplicate_name`/`scope_disposed` error, not a wholly event-free registration.
    expect(
      errors.filter((e) => e.code === 'scope_disposed' || e.code === 'duplicate_name'),
    ).toEqual([])
  })
})
