// Regression tests for the re-review follow-ups of the 2026 security review
// (docs/security/review-2026.md, "Re-review follow-ups").
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { ok } from '@toolmark/core'
import { createTestRegistry } from './helpers/create-test-registry.js'

describe('SEC-11: an edited approval keeps redacted secrets', () => {
  const secretTool = (runs: unknown[]) => ({
    name: 'pay',
    description: 'd',
    hints: { consequential: true },
    input: z.object({
      password: z.string(),
      card: z.object({ number: z.string(), name: z.string() }),
      note: z.string().optional(),
    }),
    sensitivePaths: () => ['password', 'card.number'],
    run: (input: unknown) => {
      runs.push(input)
      return ok(true)
    },
  })
  const input = { password: 'hunter2', card: { number: '4111111111111111', name: 'Ann' } }

  it('sec_11_deferred_edit_restores_redacted_secrets', async () => {
    const tm = createTestRegistry()
    const runs: unknown[] = []
    tm.register(secretTool(runs))
    const r = await tm.call('pay', input, { caller: 'inapp' })
    if (r.status !== 'needs_confirmation') throw new Error('expected needs_confirmation')
    const [pending] = tm.pendingConfirmations()
    const edited = { ...(pending?.input as object), note: 'x' }
    expect(JSON.stringify(edited)).not.toContain('4111')
    expect(await tm.confirmPending(r.confirmId, { approved: true, input: edited })).toEqual(
      ok(true),
    )
    expect(runs).toEqual([{ ...input, note: 'x' }])
  })

  it('sec_11_deferred_edit_keeps_a_changed_secret', async () => {
    const tm = createTestRegistry()
    const runs: unknown[] = []
    tm.register(secretTool(runs))
    const r = await tm.call('pay', input, { caller: 'inapp' })
    if (r.status !== 'needs_confirmation') throw new Error('expected needs_confirmation')
    const [pending] = tm.pendingConfirmations()
    const pub = pending?.input as { card: object }
    const edited = { ...pub, password: 'new-pass', card: { ...pub.card, name: 'Bob' } }
    expect((await tm.confirmPending(r.confirmId, { approved: true, input: edited })).status).toBe(
      'ok',
    )
    expect(runs).toEqual([
      { password: 'new-pass', card: { number: '4111111111111111', name: 'Bob' } },
    ])
  })

  it('sec_11_inline_edit_restores_redacted_secrets', async () => {
    const tm = createTestRegistry({
      confirm: (req) =>
        Promise.resolve({ approved: true, input: { ...(req.input as object), note: 'y' } }),
    })
    const runs: unknown[] = []
    tm.register(secretTool(runs))
    expect((await tm.call('pay', input, { caller: 'mcp' })).status).toBe('ok')
    expect(runs).toEqual([{ ...input, note: 'y' }])
  })

  it('sec_11_placeholder_outside_a_sensitive_path_is_kept', async () => {
    const tm = createTestRegistry()
    const runs: unknown[] = []
    tm.register(secretTool(runs))
    const r = await tm.call('pay', input, { caller: 'inapp' })
    if (r.status !== 'needs_confirmation') throw new Error('expected needs_confirmation')
    const [pending] = tm.pendingConfirmations()
    const edited = { ...(pending?.input as object), note: '[redacted]' }
    await tm.confirmPending(r.confirmId, { approved: true, input: edited })
    expect(runs).toEqual([{ ...input, note: '[redacted]' }])
  })
})
