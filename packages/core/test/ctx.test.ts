import { describe, expect, it, vi } from 'vitest'
import {
  ok,
  type ConfirmOutcome,
  type ConfirmRequest,
  type ToolmarkErrorEvent,
} from '@toolmark/core'
import { createTestRegistry } from './helpers/create-test-registry.js'

function asker(tm: ReturnType<typeof createTestRegistry>, hints = {}) {
  const outcomes: ConfirmOutcome[] = []
  tm.register({
    name: 'ask',
    description: 'd',
    hints,
    run: async (_i, ctx) => {
      outcomes.push(
        await ctx.confirm({ summary: 'Sure?', changes: [{ path: 'a', before: 1, after: 2 }] }),
      )
      return ok(null)
    },
  })
  return outcomes
}

describe('ctx.confirm', () => {
  it('ctx_confirm_modes', async () => {
    // human → approved
    const plain = createTestRegistry()
    const humanOutcomes = asker(plain)
    await plain.call('ask', { x: 1 }, { caller: 'human' })
    expect(humanOutcomes).toEqual([{ approved: true }])

    // webmcp with handler → handler called
    const requests: ConfirmRequest[] = []
    const withHandler = createTestRegistry({
      confirm: (req) => {
        requests.push(req)
        return Promise.resolve({ approved: false, reason: 'user said no' })
      },
    })
    const confirmStages: string[] = []
    withHandler.events.on('confirm', (e) => confirmStages.push(e.stage))
    const outcomes = asker(withHandler)
    await withHandler.call('ask', { x: 1 }, { caller: 'webmcp' })
    expect(outcomes).toEqual([{ approved: false, reason: 'user said no' }])
    expect(requests[0]).toMatchObject({
      confirmId: expect.any(String) as string,
      tool: 'ask',
      caller: 'webmcp',
      input: { x: 1 },
      summary: 'Sure?',
      changes: [{ path: 'a', before: 1, after: 2 }],
    })
    expect(confirmStages).toEqual(['pending', 'rejected'])

    // inapp (deferred) → unavailable + one dev event
    const deferredTm = createTestRegistry()
    const errs: ToolmarkErrorEvent[] = []
    deferredTm.events.on('error', (e) => errs.push(e))
    const deferredOutcomes = asker(deferredTm)
    await deferredTm.call('ask', {}, { caller: 'inapp' })
    expect(deferredOutcomes).toEqual([{ approved: false, reason: 'confirmation_unavailable' }])
    expect(errs.map((e) => e.code)).toEqual(['ctx_confirm_unavailable'])

    // webmcp without handler (readOnly tool) → unavailable
    const noHandler = createTestRegistry()
    const noHandlerOutcomes = asker(noHandler, { readOnly: true })
    await noHandler.call('ask', {}, { caller: 'webmcp' })
    expect(noHandlerOutcomes).toEqual([{ approved: false, reason: 'confirmation_unavailable' }])
  })

  it('ctx_confirm_unavailable_event_dev_only', async () => {
    const tm = createTestRegistry({ dev: false })
    const errs: ToolmarkErrorEvent[] = []
    tm.events.on('error', (e) => errs.push(e))
    asker(tm)
    await tm.call('ask', {}, { caller: 'inapp' })
    expect(errs).toEqual([])
  })

  it('ctx_confirm_signal_and_expiry', async () => {
    vi.useFakeTimers()
    try {
      const tm = createTestRegistry({ confirmExpiryMs: 500, confirm: () => new Promise(() => {}) })
      const outcomes = asker(tm)
      const p = tm.call('ask', {}, { caller: 'webmcp' })
      await vi.advanceTimersByTimeAsync(500)
      await p
      expect(outcomes).toEqual([{ approved: false, reason: 'expired' }])

      const tm2 = createTestRegistry({ abortGraceMs: 10_000, confirm: () => new Promise(() => {}) })
      const outcomes2 = asker(tm2)
      const ac = new AbortController()
      const p2 = tm2.call('ask', {}, { caller: 'mcp', signal: ac.signal })
      await vi.advanceTimersByTimeAsync(5)
      ac.abort()
      await vi.advanceTimersByTimeAsync(0)
      expect(outcomes2).toEqual([{ approved: false, reason: 'signal' }])
      expect(await p2).toEqual(ok(null))
    } finally {
      vi.useRealTimers()
    }
  })
})
