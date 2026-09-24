import { StrictMode, type ReactElement } from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { createToolmark, ok } from '@toolmark/core'
import { ToolmarkProvider, ToolScope, useTool } from '../src/index.js'

afterEach(cleanup)

function GreetTool({ name = 'tool' }: { name?: string }): null {
  useTool({ name, description: 'Greets', run: () => ok(null) })
  return null
}

describe('ToolScope', () => {
  it('scope_nests_names', () => {
    const tm = createToolmark({ dev: true })
    render(
      <ToolmarkProvider toolmark={tm}>
        <ToolScope name="a">
          <ToolScope name="b">
            <GreetTool />
          </ToolScope>
        </ToolScope>
      </ToolmarkProvider>,
    )
    expect(tm.manifest().tools.map((t) => t.name)).toEqual(['a.b.tool'])
  })

  it('scope_when_false_hides', () => {
    const tm = createToolmark({ dev: true })

    function Wrapper({ when }: { when: boolean }): ReactElement {
      return (
        <ToolScope name="a" when={when}>
          <GreetTool />
        </ToolScope>
      )
    }

    const { rerender } = render(
      <ToolmarkProvider toolmark={tm}>
        <Wrapper when={false} />
      </ToolmarkProvider>,
    )
    expect(tm.manifest().tools).toEqual([])

    rerender(
      <ToolmarkProvider toolmark={tm}>
        <Wrapper when />
      </ToolmarkProvider>,
    )
    expect(tm.manifest().tools.map((t) => t.name)).toEqual(['a.tool'])
  })

  it('strict_mode_nested_scopes_register_once', () => {
    const tm = createToolmark({ dev: true })
    const errors: string[] = []
    tm.events.on('error', (e) => errors.push(e.code))

    render(
      <StrictMode>
        <ToolmarkProvider toolmark={tm}>
          <ToolScope name="a">
            <ToolScope name="b">
              <GreetTool />
            </ToolScope>
          </ToolScope>
        </ToolmarkProvider>
      </StrictMode>,
    )

    expect(tm.manifest().tools.map((t) => t.name)).toEqual(['a.b.tool'])
    expect(errors).toEqual([])
  })

  it('disposing_a_scope_disposes_its_descendants', () => {
    const tm = createToolmark({ dev: true })
    const { unmount } = render(
      <ToolmarkProvider toolmark={tm}>
        <ToolScope name="a">
          <ToolScope name="b">
            <GreetTool />
          </ToolScope>
        </ToolScope>
      </ToolmarkProvider>,
    )
    expect(tm.manifest().tools.map((t) => t.name)).toEqual(['a.b.tool'])
    unmount()
    expect(tm.manifest().tools).toEqual([])
  })
})
