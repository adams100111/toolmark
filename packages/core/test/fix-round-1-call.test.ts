import { describe, expect, it, vi } from 'vitest'
import {
  ok,
  type Caller,
  type StandardSchemaV1,
  type ToolmarkErrorEvent,
  type ToolmarkEventMap,
} from '@toolmark/core'
import { createTestRegistry } from './helpers/create-test-registry.js'
import { deferred, settle } from './helpers/deferred.js'

/** A Standard Schema whose validate throws for inputs carrying `boom: true`. */
const throwing: StandardSchemaV1<unknown, { boom?: boolean }> = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate: (v) => {
      if ((v as { boom?: boolean }).boom) throw new Error('validator exploded')
      return { value: v as { boom?: boolean } }
    },
  },
}

function track(tm: ReturnType<typeof createTestRegistry>) {
  const errs: ToolmarkErrorEvent[] = []
  const calls: string[] = []
  const results: ToolmarkEventMap['result'][] = []
  tm.events.on('error', (e) => errs.push(e))
  tm.events.on('call', (e) => calls.push(e.callId))
  tm.events.on('result', (e) => results.push(e))
  return { errs, calls, results }
}

describe('fix round 1 — call pipeline', () => {
  it('throwing_validator_becomes_error_result_on_call', async () => {
    const tm = createTestRegistry({ dev: false })
    const t = track(tm)
    const run = vi.fn(() => ok(1))
    tm.register({
      name: 'x',
      description: 'd',
      jsonSchema: { type: 'object' },
      input: throwing,
      run,
    })
    await expect(tm.call('x', { boom: true }, { caller: 'inapp' })).resolves.toEqual({
      status: 'error',
      message: 'Tool failed',
    })
    expect(run).not.toHaveBeenCalled()
    expect(t.errs).toEqual([expect.objectContaining({ code: 'tool_threw', tool: 'x' })])
    expect(t.errs[0]!.cause).toBeInstanceOf(Error)
    expect(t.results.map((r) => r.callId)).toEqual(t.calls)
  })

  it('throwing_validator_on_confirm_pending_edited_input', async () => {
    const tm = createTestRegistry({ dev: false })
    const t = track(tm)
    const run = vi.fn(() => ok(1))
    tm.register({
      name: 'x',
      description: 'd',
      jsonSchema: { type: 'object' },
      input: throwing,
      hints: { consequential: true },
      run,
    })
    const r = await tm.call('x', {}, { caller: 'inapp' })
    if (r.status !== 'needs_confirmation') throw new Error('expected needs_confirmation')
    await expect(
      tm.confirmPending(r.confirmId, { approved: true, input: { boom: true } }),
    ).resolves.toEqual({ status: 'error', message: 'Tool failed' })
    expect(run).not.toHaveBeenCalled()
    expect(t.errs.map((e) => e.code)).toEqual(['tool_threw'])
  })

  it('throwing_validator_on_inline_confirm_edited_input', async () => {
    const tm = createTestRegistry({
      dev: false,
      confirm: () => Promise.resolve({ approved: true, input: { boom: true } }),
    })
    const t = track(tm)
    const run = vi.fn(() => ok(1))
    tm.register({
      name: 'x',
      description: 'd',
      jsonSchema: { type: 'object' },
      input: throwing,
      hints: { consequential: true },
      run,
    })
    await expect(tm.call('x', {}, { caller: 'webmcp' })).resolves.toEqual({
      status: 'error',
      message: 'Tool failed',
    })
    expect(run).not.toHaveBeenCalled()
    expect(t.errs.map((e) => e.code)).toEqual(['tool_threw'])
    expect(t.results.map((r) => r.callId)).toEqual(t.calls)
  })

  it('unknown_caller_is_rejected_safely', async () => {
    const tm = createTestRegistry()
    tm.register({ name: 'x', description: 'd', run: () => ok(1) })
    for (const bad of ['__proto__', 'constructor', 'admin', 'toString']) {
      const caller = bad as Caller
      await expect(tm.call('x', {}, { caller })).resolves.toMatchObject({
        status: 'refused',
        code: 'not_allowed',
      })
      expect(tm.manifest({ caller }).tools).toEqual([])
      expect(tm.describe('x', { caller })).toBeUndefined()
    }
  })

  it('pending_input_is_copied', async () => {
    const tm = createTestRegistry()
    const run = vi.fn((i: { list: number[] }) => ok(i.list.slice()))
    tm.register({
      name: 'x',
      description: 'd',
      hints: { consequential: true },
      jsonSchema: { type: 'object' },
      input: {
        '~standard': {
          version: 1,
          vendor: 't',
          validate: (v) => ({ value: v as { list: number[] } }),
        },
      },
      run,
    })
    const input = { list: [1] }
    const r = await tm.call('x', input, { caller: 'inapp' })
    if (r.status !== 'needs_confirmation') throw new Error('expected needs_confirmation')
    input.list.push(2)
    const listed = tm.pendingConfirmations()[0]!.input as { list: number[] }
    listed.list.push(3)
    expect(await tm.confirmPending(r.confirmId, { approved: true })).toEqual(ok([1]))
  })

  it('pending_store_capped_at_100', async () => {
    const tm = createTestRegistry()
    const stages: ToolmarkEventMap['confirm'][] = []
    tm.events.on('confirm', (e) => stages.push(e))
    tm.register({ name: 'x', description: 'd', hints: { consequential: true }, run: () => ok(1) })
    const ids: string[] = []
    for (let i = 0; i < 101; i++) {
      const r = await tm.call('x', {}, { caller: 'inapp' })
      if (r.status === 'needs_confirmation') ids.push(r.confirmId)
    }
    expect(tm.pendingConfirmations()).toHaveLength(100)
    expect(stages.filter((s) => s.stage === 'expired').map((s) => s.confirmId)).toEqual([ids[0]])
    expect(await tm.confirmPending(ids[0]!, { approved: true })).toMatchObject({
      code: 'confirmation_expired',
    })
    expect((await tm.confirmPending(ids[1]!, { approved: true })).status).toBe('ok')
  })

  it('undo_runs_on_scope_queue', async () => {
    const tm = createTestRegistry()
    const s = tm.scope('s')
    const order: string[] = []
    const gate = deferred()
    let undoCallId = ''
    tm.register(
      {
        name: 'edit',
        description: 'd',
        run: (_i, ctx) => {
          undoCallId = ctx.callId
          ctx.registerUndo(() => {
            order.push('undo')
            return ok({ changes: [] })
          })
          return ok(1)
        },
      },
      { scope: s },
    )
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
    await tm.call('s.edit', {}, { caller: 'inapp' })
    const slow = tm.call('s.slow', {}, { caller: 'inapp' })
    await settle()
    const undone = tm.undo(undoCallId)
    await settle()
    expect(order).toEqual(['slow:start'])
    gate.resolve()
    await Promise.all([slow, undone])
    expect(order).toEqual(['slow:start', 'slow:end', 'undo'])
  })
})

describe('fix round 2 — deferred input keeps class instances', () => {
  it('deferred_run_keeps_transformed_class_instances', async () => {
    class Money {
      constructor(readonly cents: number) {}
      format(): string {
        return `$${(this.cents / 100).toFixed(2)}`
      }
    }
    const tm = createTestRegistry()
    const input: StandardSchemaV1<unknown, { price: Money }> = {
      '~standard': {
        version: 1,
        vendor: 't',
        validate: (v) => ({ value: { price: new Money((v as { cents: number }).cents) } }),
      },
    }
    tm.register({
      name: 'buy',
      description: 'd',
      jsonSchema: { type: 'object' },
      hints: { consequential: true },
      input,
      run: (i) => ok(i.price.format()),
    })
    const r = await tm.call('buy', { cents: 1234 }, { caller: 'inapp' })
    if (r.status !== 'needs_confirmation') throw new Error('expected needs_confirmation')
    expect(await tm.confirmPending(r.confirmId, { approved: true })).toEqual(ok('$12.34'))
  })
})
