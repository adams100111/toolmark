import { StrictMode, useState, type JSX } from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { createToolmark, ok } from '@toolmark/core'
import { ToolmarkProvider, useTool, useToolAnchor } from '../src/index.js'

afterEach(cleanup)

const flush = () => act(() => new Promise<void>((r) => setTimeout(r, 0)))

describe('useToolAnchor', () => {
  it('use_tool_anchor_sets_and_clears', async () => {
    const tm = createToolmark({ dev: true })
    const refs: unknown[] = []
    let setShown: (v: boolean) => void = () => undefined
    let setDesc: (v: string) => void = () => undefined

    function Widget(): JSX.Element {
      const ref = useToolAnchor('chart.zoom', 'level')
      const own = useToolAnchor('chart.zoom')
      refs.push(ref)
      return (
        <div>
          <span data-testid="level" ref={ref}>
            level
          </span>
          <svg data-testid="own" ref={own} />
        </div>
      )
    }
    function App(): JSX.Element {
      const [shown, s] = useState(true)
      const [desc, d] = useState('Zoom the chart.')
      setShown = s
      setDesc = d
      useTool({ name: 'chart.zoom', description: desc, run: () => ok(null) })
      return shown ? <Widget /> : <p>none</p>
    }

    render(
      <StrictMode>
        <ToolmarkProvider toolmark={tm}>
          <App />
        </ToolmarkProvider>
      </StrictMode>,
    )
    await flush()
    const level = screen.getByTestId('level')
    const own = screen.getByTestId('own')
    // Survives the StrictMode remount (the tool re-registered and dropped its overrides).
    expect(tm.anchor('chart.zoom', 'level')).toBe(level)
    expect(tm.anchor('chart.zoom')).toBe(own)
    // Stable ref callback across renders.
    expect(new Set(refs.slice(-2)).size).toBe(1)

    // A re-registration (description change) keeps the anchor.
    act(() => setDesc('Zoom the chart in or out.'))
    await flush()
    expect(tm.anchor('chart.zoom', 'level')).toBe(level)

    // Unmount clears the override.
    act(() => setShown(false))
    await flush()
    expect(tm.anchor('chart.zoom', 'level')).toBeNull()
    expect(tm.anchor('chart.zoom')).toBeNull()
  })
})
