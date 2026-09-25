// Regression tests for the re-review follow-ups of the 2026 security review
// (docs/security/review-2026.md, "Re-review follow-ups").
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { ok, type ToolResult } from '@toolmark/core'
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

  // Superseded by SEC-28: a placeholder the approver adds outside a sensitive path is refused.
  it('sec_11_placeholder_outside_a_sensitive_path_is_refused', async () => {
    const tm = createTestRegistry()
    const runs: unknown[] = []
    tm.register(secretTool(runs))
    const r = await tm.call('pay', input, { caller: 'inapp' })
    if (r.status !== 'needs_confirmation') throw new Error('expected needs_confirmation')
    const [pending] = tm.pendingConfirmations()
    const edited = { ...(pending?.input as object), note: '[redacted]' }
    expect(await tm.confirmPending(r.confirmId, { approved: true, input: edited })).toEqual({
      status: 'invalid',
      issues: [{ path: 'note', message: 'Re-enter sensitive field' }],
    })
    expect(runs).toEqual([])
  })
})

describe('SEC-12: an inline ctx.confirm pauses the call deadline', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('sec_12_inline_ctx_confirm_is_not_cut_off_by_call_timeout', async () => {
    vi.useFakeTimers()
    const tm = createTestRegistry({
      callTimeoutMs: 50,
      abortGraceMs: 10,
      confirm: () => new Promise((resolve) => setTimeout(() => resolve({ approved: true }), 100)),
    })
    let aborted: boolean | undefined
    tm.register({
      name: 'save',
      description: 'd',
      run: async (_i, ctx): Promise<ToolResult<string>> => {
        const outcome = await ctx.confirm({ summary: 'Save?' })
        aborted = ctx.signal.aborted
        return outcome.approved ? ok('saved') : ok('declined')
      },
    })
    const p = tm.call('save', {}, { caller: 'mcp' })
    await vi.advanceTimersByTimeAsync(200)
    expect(await p).toEqual(ok('saved'))
    expect(aborted).toBe(false)
  })

  it('sec_12_deadline_resumes_after_the_confirmation', async () => {
    vi.useFakeTimers()
    const tm = createTestRegistry({
      callTimeoutMs: 50,
      abortGraceMs: 10,
      confirm: () => new Promise((resolve) => setTimeout(() => resolve({ approved: true }), 30)),
    })
    let signal: AbortSignal | undefined
    tm.register({
      name: 'hang',
      description: 'd',
      run: async (_i, ctx): Promise<ToolResult<string>> => {
        signal = ctx.signal
        await new Promise((r) => setTimeout(r, 10))
        await ctx.confirm({ summary: 'Go?' })
        return new Promise<never>(() => undefined)
      },
    })
    const p = tm.call('hang', {}, { caller: 'mcp' })
    // 10 ms of run, 30 ms paused in the confirmation, then 40 ms of the budget remain.
    await vi.advanceTimersByTimeAsync(79)
    expect(signal?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(signal?.aborted).toBe(true)
    await vi.advanceTimersByTimeAsync(10)
    expect(await p).toEqual({ status: 'cancelled', by: 'signal' })
  })

  // M5 final review m-8: the pause holds while any of several concurrent confirmations is open.
  it('sec_12_concurrent_confirms_keep_the_deadline_paused_until_the_last_settles', async () => {
    vi.useFakeTimers()
    const delays = [30, 100]
    const tm = createTestRegistry({
      callTimeoutMs: 50,
      abortGraceMs: 10,
      confirm: () => {
        const ms = delays.shift() ?? 0
        return new Promise((resolve) => setTimeout(() => resolve({ approved: true }), ms))
      },
    })
    let signal: AbortSignal | undefined
    tm.register({
      name: 'both',
      description: 'd',
      run: async (_i, ctx): Promise<ToolResult<string>> => {
        signal = ctx.signal
        await Promise.all([ctx.confirm({ summary: 'A?' }), ctx.confirm({ summary: 'B?' })])
        return new Promise<never>(() => undefined)
      },
    })
    const p = tm.call('both', {}, { caller: 'mcp' })
    // Paused 0–100 ms (the first confirmation settling at 30 ms does not resume it), then 50 ms.
    await vi.advanceTimersByTimeAsync(149)
    expect(signal?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(signal?.aborted).toBe(true)
    await vi.advanceTimersByTimeAsync(10)
    expect(await p).toEqual({ status: 'cancelled', by: 'signal' })
  })
})
