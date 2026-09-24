import type { JSX } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createToolmark, ok } from '@toolmark/core'
import { ToolmarkProvider, ToolScope, useAgentActivity, useTool } from '../src/index.js'

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
})
