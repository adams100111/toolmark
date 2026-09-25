import { describe, expect, it } from 'vitest'
import type { Caller, ToolHints } from '@toolmark/core'
import { createTestRegistry } from './helpers/create-test-registry.js'
import { tool } from './helpers/tools.js'

const CALLERS: Caller[] = ['inapp', 'webmcp', 'mcp', 'test', 'tour', 'human']
const CLASSES: Record<string, ToolHints | undefined> = {
  readOnly: { readOnly: true },
  default: undefined,
  consequential: { consequential: true },
  destructive: { destructive: true },
}
// M1 constraints: default exposure.
const ALLOWED: Record<string, Caller[]> = {
  readOnly: CALLERS,
  default: CALLERS,
  consequential: ['inapp', 'webmcp', 'mcp', 'tour', 'test', 'human'],
  destructive: ['inapp', 'test', 'human'],
}

describe('policy', () => {
  it('policy_defaults_table', async () => {
    const tm = createTestRegistry({ confirm: () => Promise.resolve({ approved: true }) })
    for (const [cls, hints] of Object.entries(CLASSES)) tm.register(tool(cls, hints))
    for (const cls of Object.keys(CLASSES)) {
      for (const caller of CALLERS) {
        const r = await tm.call(cls, {}, { caller })
        const allowed = ALLOWED[cls]!.includes(caller)
        if (allowed) expect(r.status, `${cls} × ${caller}`).not.toBe('refused')
        else
          expect(r, `${cls} × ${caller}`).toMatchObject({ status: 'refused', code: 'not_allowed' })
        if (caller !== 'human') {
          const listed = tm.manifest({ caller }).tools.some((t) => t.name === cls)
          expect(listed, `${cls} listed for ${caller}`).toBe(allowed)
        }
      }
    }
  })

  it('confirmable_classes_need_confirmation_except_human', async () => {
    const tm = createTestRegistry()
    tm.register(tool('save', { consequential: true }))
    tm.register(tool('drop', { destructive: true }))
    for (const name of ['save', 'drop']) {
      for (const caller of ['inapp', 'test'] as const) {
        expect((await tm.call(name, {}, { caller })).status).toBe('needs_confirmation')
      }
    }
  })
})
