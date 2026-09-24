import type { JSX } from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { createToolmark, ok, type ToolResult } from '@toolmark/core'
import { ToolmarkProvider, useAgentActivity } from '../src/index.js'

afterEach(cleanup)

function ActivityProbe(): JSX.Element {
  const { active } = useAgentActivity()
  return <div data-testid="active">{active.map((c) => `${c.tool}:${c.caller}`).join(',')}</div>
}

describe('useAgentActivity', () => {
  it('agent_activity_tracks_inflight_calls', async () => {
    const tm = createToolmark({ dev: true })
    let resolveRun: ((r: ToolResult<null>) => void) | undefined
    tm.register({
      name: 'slow',
      description: 'A slow tool',
      run: () =>
        new Promise<ToolResult<null>>((resolve) => {
          resolveRun = resolve
        }),
    })

    render(
      <ToolmarkProvider toolmark={tm}>
        <ActivityProbe />
      </ToolmarkProvider>,
    )
    expect(screen.getByTestId('active').textContent).toBe('')

    let callPromise!: Promise<ToolResult<unknown>>
    await act(async () => {
      callPromise = tm.call('slow', undefined, { caller: 'test' })
      await Promise.resolve()
    })
    expect(screen.getByTestId('active').textContent).toBe('slow:test')

    await act(async () => {
      resolveRun?.(ok(null))
      await callPromise
    })
    expect(screen.getByTestId('active').textContent).toBe('')
  })
})
