import { createToolmark, ok, type ToolResult } from '@toolmark/core'
// Relative import: this package's own `./page` entry, exercised as source (never through its own
// package name, so this dev page needs no self-referencing dependency on `@toolmark/testing`).
import { installTestHook } from '../../src/page/install-test-hook.js'

interface SaveInput {
  title: string
}

const tm = createToolmark({ confirm: () => Promise.resolve({ approved: true }) })

tm.register({
  name: 'ping',
  description: 'Echoes the given input back.',
  hints: { readOnly: true },
  run: (input: unknown): ToolResult<unknown> => ok({ echo: input }),
})

let state = { title: 'Untitled' }

tm.register({
  name: 'save',
  title: 'Save',
  description: 'Saves the given title.',
  hints: { consequential: true },
  summary: (input: SaveInput) => `Save "${input.title}"`,
  run: (input: unknown): ToolResult<unknown> => {
    const next = input as SaveInput
    const before = state.title
    state = { title: next.title }
    return ok({ changes: [{ path: 'title', before, after: next.title }] })
  },
})

// `?nohook=1` lets fixture.spec.ts exercise the missing-hook path against a real page.
if (!new URLSearchParams(location.search).has('nohook')) {
  installTestHook(tm)
}
