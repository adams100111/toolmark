import type { JSX } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { createToolmark, ok } from '@toolmark/core'
import { ToolmarkProvider, ToolScope, useAgentActivity, useTool } from '../src/index.js'

// This suite runs in a real browser (`document` exists and is non-configurable, so it cannot be
// stubbed to simulate SSR); substitute the module `<ToolScope>` uses to detect a DOM-less
// environment instead, matching what a genuine `renderToString` server runtime would see.
vi.mock('../src/is-server.js', () => ({ isServerEnvironment: () => true }))

function App(): JSX.Element {
  useTool({ name: 'x', description: 'x', run: () => ok(null) })
  const { active } = useAgentActivity()
  return <div>{active.length}</div>
}

describe('SSR', () => {
  it('ssr_render_to_string_is_inert', () => {
    const tm = createToolmark({ dev: true, __environment: 'server' })

    let html = ''
    expect(() => {
      html = renderToString(
        <ToolmarkProvider toolmark={tm}>
          <ToolScope name="a">
            <App />
          </ToolScope>
        </ToolmarkProvider>,
      )
    }).not.toThrow()

    expect(html).toContain('0')
    expect(tm.manifest().tools).toEqual([])
  })

  it('ssr_scope_does_not_leak_children_across_repeated_renders', () => {
    const tm = createToolmark({ dev: true, __environment: 'server' })
    const scopeSpy = vi.spyOn(tm, 'scope')

    function Page(): JSX.Element {
      return (
        <ToolmarkProvider toolmark={tm}>
          <ToolScope name="a">
            <ToolScope name="b">
              <App />
            </ToolScope>
          </ToolScope>
        </ToolmarkProvider>
      )
    }

    for (let i = 0; i < 5; i++) {
      expect(() => renderToString(<Page />)).not.toThrow()
    }

    // Render-time scope creation is skipped server-side; nothing ever calls `Toolmark.scope()`
    // (or, transitively, a parent scope's `Scope.scope()`), so repeated renders against this one
    // module-level registry never accumulate never-disposed child `ScopeNode`s.
    expect(scopeSpy).not.toHaveBeenCalled()
  })
})
