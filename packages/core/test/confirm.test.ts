import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { ok, type ConfirmRequest, type ToolmarkEventMap, type ToolContext } from '@toolmark/core'
import { createTestRegistry } from './helpers/create-test-registry.js'
import { deferred, settle } from './helpers/deferred.js'

afterEach(() => {
  vi.useRealTimers()
})

function confirmEvents(tm: ReturnType<typeof createTestRegistry>): ToolmarkEventMap['confirm'][] {
  const out: ToolmarkEventMap['confirm'][] = []
  tm.events.on('confirm', (e) => out.push(e))
  return out
}

function saveTool(run = vi.fn((input: { title: string }, _ctx: ToolContext) => ok(input))) {
  return {
    name: 'save',
    title: 'Save it',
    description: 'Saves',
    input: z.object({ title: z.string().min(1) }),
    hints: { consequential: true },
    summary: (i: { title: string }) => `Save "${i.title}"`,
    run,
  }
}

describe('deferred confirmation', () => {
  it('deferred_confirm_returns_needs_confirmation', async () => {
    const tm = createTestRegistry()
    const events = confirmEvents(tm)
    const run = vi.fn((input: { title: string }, _ctx: ToolContext) => ok(input))
    tm.register(saveTool(run))
    const r = await tm.call('save', { title: 'A' }, { caller: 'inapp' })
    expect(r).toEqual({
      status: 'needs_confirmation',
      confirmId: expect.any(String) as string,
      summary: 'Save "A"',
    })
    expect(run).not.toHaveBeenCalled()
    if (r.status !== 'needs_confirmation') return
    const pending = tm.pendingConfirmations()
    expect(pending).toEqual([
      expect.objectContaining({
        confirmId: r.confirmId,
        tool: 'save',
        title: 'Save it',
        caller: 'inapp',
        input: { title: 'A' },
        summary: 'Save "A"',
      }),
    ])
    expect(pending[0]!.expiresAt - pending[0]!.createdAt).toBe(600000)
    expect(events).toEqual([{ confirmId: r.confirmId, tool: 'save', stage: 'pending' }])

    const done = await tm.confirmPending(r.confirmId, { approved: true })
    expect(done).toEqual(ok({ title: 'A' }))
    expect(run).toHaveBeenCalledTimes(1)
    expect(run.mock.calls[0]![1].caller).toBe('human')
    expect(events[1]).toEqual({
      confirmId: r.confirmId,
      tool: 'save',
      stage: 'approved',
      result: ok({ title: 'A' }),
    })
    expect(tm.pendingConfirmations()).toEqual([])
  })

  it('summary_falls_back_to_title_then_name', async () => {
    const tm = createTestRegistry()
    tm.register({
      name: 'a',
      title: 'Title A',
      description: 'd',
      hints: { consequential: true },
      run: () => ok(1),
    })
    tm.register({ name: 'b', description: 'd', hints: { destructive: true }, run: () => ok(1) })
    expect(await tm.call('a', {}, { caller: 'test' })).toMatchObject({ summary: 'Title A' })
    expect(await tm.call('b', {}, { caller: 'test' })).toMatchObject({ summary: 'b' })
  })

  it('deferred_confirm_edited_input_revalidated', async () => {
    const tm = createTestRegistry()
    const run = vi.fn((input: { title: string }, _ctx: ToolContext) => ok(input))
    tm.register(saveTool(run))
    const r = await tm.call('save', { title: 'A' }, { caller: 'inapp' })
    if (r.status !== 'needs_confirmation') throw new Error('expected needs_confirmation')
    const bad = await tm.confirmPending(r.confirmId, { approved: true, input: { title: '' } })
    expect(bad.status).toBe('invalid')
    expect(run).not.toHaveBeenCalled()

    const r2 = await tm.call('save', { title: 'A' }, { caller: 'inapp' })
    if (r2.status !== 'needs_confirmation') throw new Error('expected needs_confirmation')
    expect(
      await tm.confirmPending(r2.confirmId, { approved: true, input: { title: 'B' } }),
    ).toEqual(ok({ title: 'B' }))
  })

  it('deferred_reject_cancelled_operator', async () => {
    const tm = createTestRegistry()
    const events = confirmEvents(tm)
    const run = vi.fn((input: { title: string }, _ctx: ToolContext) => ok(input))
    tm.register(saveTool(run))
    const r = await tm.call('save', { title: 'A' }, { caller: 'inapp' })
    if (r.status !== 'needs_confirmation') throw new Error('expected needs_confirmation')
    expect(await tm.confirmPending(r.confirmId, { approved: false, reason: 'no' })).toEqual({
      status: 'cancelled',
      by: 'operator',
    })
    expect(run).not.toHaveBeenCalled()
    expect(events.map((e) => e.stage)).toEqual(['pending', 'rejected'])
  })

  it('deferred_expiry_then_confirm_refused', async () => {
    vi.useFakeTimers()
    const tm = createTestRegistry({ confirmExpiryMs: 1000 })
    const events = confirmEvents(tm)
    tm.register(saveTool())
    const r = await tm.call('save', { title: 'A' }, { caller: 'inapp' })
    if (r.status !== 'needs_confirmation') throw new Error('expected needs_confirmation')
    await vi.advanceTimersByTimeAsync(1000)
    expect(tm.pendingConfirmations()).toEqual([])
    expect(events.map((e) => e.stage)).toEqual(['pending', 'expired'])
    expect(await tm.confirmPending(r.confirmId, { approved: true })).toMatchObject({
      status: 'refused',
      code: 'confirmation_expired',
    })
  })

  it('confirm_pending_is_single_use', async () => {
    const tm = createTestRegistry()
    const run = vi.fn((input: { title: string }, _ctx: ToolContext) => ok(input))
    tm.register(saveTool(run))
    const r = await tm.call('save', { title: 'A' }, { caller: 'inapp' })
    if (r.status !== 'needs_confirmation') throw new Error('expected needs_confirmation')
    const [a, b] = await Promise.all([
      tm.confirmPending(r.confirmId, { approved: true }),
      tm.confirmPending(r.confirmId, { approved: true }),
    ])
    expect(a).toEqual(ok({ title: 'A' }))
    expect(b).toMatchObject({ status: 'refused', code: 'confirmation_expired' })
    expect(run).toHaveBeenCalledTimes(1)
    expect(await tm.confirmPending('unknown', { approved: true })).toMatchObject({
      code: 'confirmation_expired',
    })
  })

  it('confirm_pending_uses_scope_queue', async () => {
    const tm = createTestRegistry()
    const s = tm.scope('s')
    const order: string[] = []
    const gate = deferred()
    tm.register(
      {
        name: 'slow',
        description: 'd',
        run: async () => {
          order.push('slow:start')
          await gate.promise
          order.push('slow:end')
          return ok(1)
        },
      },
      { scope: s },
    )
    tm.register(
      { ...saveTool(vi.fn((i: { title: string }) => (order.push('save'), ok(i)))) },
      { scope: s },
    )
    const r = await tm.call('s.save', { title: 'A' }, { caller: 'inapp' })
    if (r.status !== 'needs_confirmation') throw new Error('expected needs_confirmation')
    const slow = tm.call('s.slow', {}, { caller: 'inapp' })
    await settle()
    const approved = tm.confirmPending(r.confirmId, { approved: true })
    await settle()
    expect(order).toEqual(['slow:start'])
    gate.resolve()
    await Promise.all([slow, approved])
    expect(order).toEqual(['slow:start', 'slow:end', 'save'])
  })

  it('pending_dropped_on_scope_dispose', async () => {
    const tm = createTestRegistry()
    const events = confirmEvents(tm)
    const s = tm.scope('s')
    tm.register(saveTool(), { scope: s })
    const r = await tm.call('s.save', { title: 'A' }, { caller: 'inapp' })
    if (r.status !== 'needs_confirmation') throw new Error('expected needs_confirmation')
    s.dispose()
    expect(tm.pendingConfirmations()).toEqual([])
    expect(events.map((e) => e.stage)).toEqual(['pending', 'expired'])
    expect(await tm.confirmPending(r.confirmId, { approved: true })).toMatchObject({
      code: 'confirmation_expired',
    })
  })
})

describe('inline confirmation', () => {
  it('inline_confirm_approve_and_reject', async () => {
    const requests: ConfirmRequest[] = []
    let answer: { approved: true; input?: unknown } | { approved: false } = { approved: true }
    const tm = createTestRegistry({
      confirm: (req) => {
        requests.push(req)
        return Promise.resolve(answer)
      },
    })
    const events = confirmEvents(tm)
    const run = vi.fn((input: { title: string }, _ctx: ToolContext) => ok(input))
    tm.register(saveTool(run))
    expect(await tm.call('save', { title: 'A' }, { caller: 'webmcp' })).toEqual(ok({ title: 'A' }))
    expect(run.mock.calls[0]![1].caller).toBe('webmcp')
    expect(requests[0]).toEqual({
      confirmId: expect.any(String) as string,
      tool: 'save',
      title: 'Save it',
      caller: 'webmcp',
      input: { title: 'A' },
      hints: { consequential: true },
      summary: 'Save "A"',
    })
    answer = { approved: true, input: { title: 'Edited' } }
    expect(await tm.call('save', { title: 'A' }, { caller: 'mcp' })).toEqual(
      ok({ title: 'Edited' }),
    )
    answer = { approved: true, input: { title: '' } }
    expect((await tm.call('save', { title: 'A' }, { caller: 'mcp' })).status).toBe('invalid')
    answer = { approved: false }
    expect(await tm.call('save', { title: 'A' }, { caller: 'tour' })).toEqual({
      status: 'cancelled',
      by: 'operator',
    })
    expect(run).toHaveBeenCalledTimes(2)
    expect(events.filter((e) => e.stage === 'rejected')).toHaveLength(1)
  })

  it('inline_confirm_times_out', async () => {
    vi.useFakeTimers()
    const tm = createTestRegistry({
      confirmExpiryMs: 1000,
      confirm: () => new Promise(() => {}),
    })
    const events = confirmEvents(tm)
    const run = vi.fn((input: { title: string }, _ctx: ToolContext) => ok(input))
    tm.register(saveTool(run))
    const p = tm.call('save', { title: 'A' }, { caller: 'webmcp' })
    await vi.advanceTimersByTimeAsync(1000)
    expect(await p).toEqual({ status: 'cancelled', by: 'operator' })
    expect(events.map((e) => e.stage)).toEqual(['pending', 'expired'])

    const ac = new AbortController()
    const p2 = tm.call('save', { title: 'A' }, { caller: 'webmcp', signal: ac.signal })
    await vi.advanceTimersByTimeAsync(10)
    ac.abort()
    expect(await p2).toEqual({ status: 'cancelled', by: 'signal' })
    expect(run).not.toHaveBeenCalled()
  })

  it('inline_mode_configurable_for_inapp', async () => {
    const tm = createTestRegistry({
      confirmMode: { inapp: 'inline' },
      confirm: () => Promise.resolve({ approved: true }),
    })
    tm.register(saveTool())
    expect(await tm.call('save', { title: 'A' }, { caller: 'inapp' })).toEqual(ok({ title: 'A' }))
    expect((await tm.call('save', { title: 'A' }, { caller: 'test' })).status).toBe(
      'needs_confirmation',
    )
  })
})
