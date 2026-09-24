import { StrictMode, useState, type ReactElement } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { createToolmark, ok, type ToolmarkErrorEvent } from '@toolmark/core'
import { ToolmarkProvider, ToolScope, useTool } from '../src/index.js'

afterEach(cleanup)

function GreetTool({ name = 'greet' }: { name?: string }): null {
  useTool({
    name,
    description: 'Greets the user',
    run: () => ok(null),
  })
  return null
}

function collectErrors(tm: ReturnType<typeof createToolmark>): ToolmarkErrorEvent[] {
  const errors: ToolmarkErrorEvent[] = []
  tm.events.on('error', (e) => errors.push(e))
  return errors
}

describe('useTool', () => {
  it('strict_mode_double_mount_keeps_tool', () => {
    const tm = createToolmark({ dev: true })
    const errors = collectErrors(tm)

    render(
      <StrictMode>
        <ToolmarkProvider toolmark={tm}>
          <GreetTool />
        </ToolmarkProvider>
      </StrictMode>,
    )

    expect(tm.manifest().tools.map((t) => t.name)).toEqual(['greet'])
    expect(errors).toEqual([])
  })

  it('strict_mode_tool_inside_scope_registered_once', () => {
    const tm = createToolmark({ dev: true })
    const errors = collectErrors(tm)

    render(
      <StrictMode>
        <ToolmarkProvider toolmark={tm}>
          <ToolScope name="a">
            <GreetTool name="tool" />
          </ToolScope>
        </ToolmarkProvider>
      </StrictMode>,
    )

    expect(tm.manifest().tools.map((t) => t.name)).toEqual(['a.tool'])
    expect(errors.filter((e) => e.code === 'scope_disposed' || e.code === 'duplicate_name')).toEqual(
      [],
    )
  })

  it('latest_closure_used', async () => {
    const tm = createToolmark({ dev: true })

    function Counter(): ReactElement {
      const [n, setN] = useState(0)
      useTool({
        name: 'counter',
        description: 'returns n',
        run: () => ok(n),
      })
      return (
        <button type="button" onClick={() => setN((x) => x + 1)}>
          inc
        </button>
      )
    }

    render(
      <ToolmarkProvider toolmark={tm}>
        <Counter />
      </ToolmarkProvider>,
    )

    const revBefore = tm.rev
    fireEvent.click(screen.getByText('inc'))
    fireEvent.click(screen.getByText('inc'))

    expect(tm.rev).toBe(revBefore)
    const result = await tm.call('counter', undefined, { caller: 'test' })
    expect(result).toEqual({ status: 'ok', data: 2 })
  })

  it('reregisters_on_description_change', async () => {
    const tm = createToolmark({ dev: true })

    function Described({ description }: { description: string }): null {
      useTool({ name: 'd', description, run: () => ok(null) })
      return null
    }

    const { rerender } = render(
      <ToolmarkProvider toolmark={tm}>
        <Described description="first" />
      </ToolmarkProvider>,
    )
    // Let the registry's queued microtask flush (resets its internal notify-pending gate) before
    // reading `rev`, so the next round of registration changes is free to bump it again.
    await Promise.resolve()
    expect(tm.describe('d')?.description).toBe('first')
    const revBefore = tm.rev

    rerender(
      <ToolmarkProvider toolmark={tm}>
        <Described description="second" />
      </ToolmarkProvider>,
    )
    await Promise.resolve()

    expect(tm.describe('d')?.description).toBe('second')
    expect(tm.rev).toBeGreaterThan(revBefore)
  })

  it('unmount_disposes', () => {
    const tm = createToolmark({ dev: true })
    const { unmount } = render(
      <ToolmarkProvider toolmark={tm}>
        <GreetTool />
      </ToolmarkProvider>,
    )
    expect(tm.manifest().tools.map((t) => t.name)).toEqual(['greet'])
    unmount()
    expect(tm.manifest().tools).toEqual([])
  })

  it('use_toolmark_outside_provider_throws', () => {
    expect(() => render(<GreetTool />)).toThrow(
      'useToolmark must be used inside <ToolmarkProvider>',
    )
  })
})
