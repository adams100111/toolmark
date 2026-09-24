import { afterEach, describe, expect, it, vi } from 'vitest'
import { ok, type ToolmarkErrorEvent, type ToolResult } from '@toolmark/core'
import type { PageToAgentMessage } from '@toolmark/core/protocol'
import { bridge, type BridgeTransport } from '@toolmark/core/bridge'
import { createTestRegistry } from './helpers/create-test-registry.js'
import { deferred, settle } from './helpers/deferred.js'
import { flushMicrotasks, tool } from './helpers/tools.js'

type Tm = ReturnType<typeof createTestRegistry>

/** In-memory fake transport: records sent messages, lets the test deliver inbound ones. */
function fakeTransport(opts?: { failSend?: boolean }) {
  const sent: PageToAgentMessage[] = []
  const handlers = new Set<(m: unknown) => void>()
  const close = vi.fn()
  const transport: BridgeTransport = {
    send(message) {
      sent.push(message)
      if (opts?.failSend) return Promise.reject(new Error('down'))
    },
    onMessage(handler) {
      handlers.add(handler)
      return () => {
        handlers.delete(handler)
      }
    },
    close,
  }
  return {
    transport,
    sent,
    close,
    handlers,
    deliver(m: unknown) {
      for (const h of [...handlers]) h(m)
    },
    results(id?: string) {
      return sent.filter(
        (m): m is Extract<PageToAgentMessage, { type: 'result' }> =>
          m.type === 'result' && (id === undefined || m.id === id),
      )
    },
  }
}

function errorsOf(tm: Tm): ToolmarkErrorEvent[] {
  const out: ToolmarkErrorEvent[] = []
  tm.events.on('error', (e) => out.push(e))
  return out
}

const call = (tm: Tm, id: string, name: string, input: unknown = {}) => ({
  protocol: 1,
  type: 'call',
  clientId: tm.clientId,
  id,
  tool: name,
  input,
})

afterEach(() => {
  vi.useRealTimers()
})

describe('bridge', () => {
  it('sends_manifest_on_attach', async () => {
    const tm = createTestRegistry()
    tm.register(tool('a'))
    await flushMicrotasks()
    const t = fakeTransport()
    tm.use(bridge({ transport: t.transport }))
    expect(t.sent).toEqual([
      {
        protocol: 1,
        type: 'manifest',
        clientId: tm.clientId,
        rev: 1,
        tools: tm.manifest({ caller: 'inapp' }).tools,
      },
    ])
    expect(t.sent[0]).toMatchObject({ tools: [{ name: 'a' }] })
  })

  it('sends_manifest_on_change', async () => {
    const tm = createTestRegistry()
    const t = fakeTransport()
    tm.use(bridge({ transport: t.transport }))
    tm.register(tool('a'))
    await flushMicrotasks()
    expect(t.sent).toHaveLength(2)
    expect(t.sent[1]).toMatchObject({ type: 'manifest', rev: 1, tools: [{ name: 'a' }] })
  })

  it('sends_changed_when_configured', async () => {
    const tm = createTestRegistry()
    const t = fakeTransport()
    tm.use(bridge({ transport: t.transport, onChange: 'changed' }))
    tm.register(tool('a'))
    await flushMicrotasks()
    expect(t.sent[1]).toEqual({ protocol: 1, type: 'changed', clientId: tm.clientId, rev: 1 })
  })

  it('ignores_call_for_other_client', async () => {
    const tm = createTestRegistry()
    const run = vi.fn(() => ok(1))
    tm.register(tool('a', undefined, { run }))
    const errors = errorsOf(tm)
    const t = fakeTransport()
    tm.use(bridge({ transport: t.transport }))
    t.deliver({ ...call(tm, 'c1', 'a'), clientId: 'someone-else' })
    t.deliver({ protocol: 2, type: 'call', clientId: 'someone-else', id: 'c2' })
    await settle()
    expect(run).not.toHaveBeenCalled()
    expect(t.results()).toEqual([])
    expect(errors).toEqual([])
  })

  it('call_returns_single_result', async () => {
    const tm = createTestRegistry()
    tm.register(tool('a'))
    const t = fakeTransport()
    tm.use(bridge({ transport: t.transport }))
    t.deliver(call(tm, 'c1', 'a'))
    await settle()
    expect(t.results()).toEqual([
      { protocol: 1, type: 'result', clientId: tm.clientId, id: 'c1', result: ok({ name: 'a' }) },
    ])
  })

  it('duplicate_call_id_ignored', async () => {
    const tm = createTestRegistry()
    const gate = deferred()
    const run = vi.fn(async () => {
      await gate.promise
      return ok(1)
    })
    tm.register(tool('a', undefined, { run }))
    const t = fakeTransport()
    tm.use(bridge({ transport: t.transport }))
    t.deliver(call(tm, 'c1', 'a'))
    t.deliver(call(tm, 'c1', 'a')) // in flight
    gate.resolve()
    await settle()
    t.deliver(call(tm, 'c1', 'a')) // recently answered
    await settle()
    expect(run).toHaveBeenCalledTimes(1)
    expect(t.results('c1')).toHaveLength(1)
  })

  it('describe_shares_dedupe_id_space', async () => {
    const tm = createTestRegistry()
    const run = vi.fn(() => ok(1))
    tm.register(tool('a', undefined, { run }))
    const t = fakeTransport()
    tm.use(bridge({ transport: t.transport }))
    t.deliver({ protocol: 1, type: 'describe', clientId: tm.clientId, id: 'x', tool: 'a' })
    t.deliver(call(tm, 'x', 'a'))
    await settle()
    expect(run).not.toHaveBeenCalled()
    expect(t.results('x')).toHaveLength(1)
    t.deliver(call(tm, 'y', 'a'))
    await settle()
    t.deliver({ protocol: 1, type: 'describe', clientId: tm.clientId, id: 'y', tool: 'a' })
    await settle()
    expect(t.results('y')).toHaveLength(1)
    expect(t.results('y')[0]!.result).toEqual(ok(1))
  })

  it('describe_ok_and_unknown', async () => {
    const tm = createTestRegistry()
    tm.register(tool('a'))
    const t = fakeTransport()
    tm.use(bridge({ transport: t.transport }))
    t.deliver({ protocol: 1, type: 'describe', clientId: tm.clientId, id: 'd1', tool: 'a' })
    t.deliver({ protocol: 1, type: 'describe', clientId: tm.clientId, id: 'd2', tool: 'nope' })
    await settle()
    expect(t.results('d1')[0]!.result).toEqual(ok(tm.describe('a', { caller: 'inapp' })))
    expect(t.results('d2')[0]!.result).toMatchObject({ status: 'refused', code: 'unknown_tool' })
  })

  it('describe_respects_caller_policy', async () => {
    const tm = createTestRegistry({ policy: { inapp: { tools: { deny: ['secret'] } } } })
    tm.register(tool('secret'))
    tm.register(tool('open'))
    await flushMicrotasks()
    const t = fakeTransport()
    tm.use(bridge({ transport: t.transport }))
    const manifest = t.sent[0] as Extract<PageToAgentMessage, { type: 'manifest' }>
    expect(manifest.tools.map((x) => x.name)).toEqual(['open'])
    t.deliver({ protocol: 1, type: 'describe', clientId: tm.clientId, id: 'd', tool: 'secret' })
    await settle()
    expect(t.results('d')[0]!.result).toMatchObject({ status: 'refused', code: 'unknown_tool' })
  })

  it('cancel_yields_cancelled_signal_once', async () => {
    const tm = createTestRegistry()
    let seen: AbortSignal | undefined
    tm.register(
      tool('slow', undefined, {
        run: (_input, ctx) => {
          seen = ctx.signal
          return new Promise<ToolResult<unknown>>(() => {
            /* ignores its signal: the registry's grace period ends it */
          })
        },
      }),
    )
    vi.useFakeTimers()
    const t = fakeTransport()
    tm.use(bridge({ transport: t.transport }))
    t.deliver(call(tm, 'c1', 'slow'))
    await vi.advanceTimersByTimeAsync(0)
    t.deliver({ protocol: 1, type: 'cancel', clientId: tm.clientId, id: 'c1' })
    t.deliver({ protocol: 1, type: 'cancel', clientId: tm.clientId, id: 'c1' })
    expect(seen?.aborted).toBe(true)
    await vi.advanceTimersByTimeAsync(6000)
    t.deliver({ protocol: 1, type: 'cancel', clientId: tm.clientId, id: 'c1' })
    await vi.advanceTimersByTimeAsync(10)
    expect(t.results('c1')).toEqual([
      {
        protocol: 1,
        type: 'result',
        clientId: tm.clientId,
        id: 'c1',
        result: { status: 'cancelled', by: 'signal' },
      },
    ])
  })

  it('cancel_unknown_id_ignored', async () => {
    const tm = createTestRegistry()
    const errors = errorsOf(tm)
    const t = fakeTransport()
    tm.use(bridge({ transport: t.transport }))
    t.deliver({ protocol: 1, type: 'cancel', clientId: tm.clientId, id: 'ghost' })
    await settle()
    expect(t.sent).toHaveLength(1) // the attach manifest only
    expect(errors).toEqual([])
  })

  it('deferred_confirmation_forwarded_as_confirmed', async () => {
    const tm = createTestRegistry()
    tm.register(tool('save', { consequential: true }, { run: () => ok({ saved: true }) }))
    const t = fakeTransport()
    tm.use(bridge({ transport: t.transport }))
    t.deliver(call(tm, 'c1', 'save'))
    await settle()
    const r = t.results('c1')[0]!.result
    expect(r.status).toBe('needs_confirmation')
    if (r.status !== 'needs_confirmation') return
    // A confirmation the bridge did not create is not forwarded.
    await tm.call('save', {}, { caller: 'test' })
    await tm.confirmPending(r.confirmId, { approved: true })
    await settle()
    const confirmed = t.sent.filter((m) => m.type === 'confirmed')
    expect(confirmed).toEqual([
      {
        protocol: 1,
        type: 'confirmed',
        clientId: tm.clientId,
        confirmId: r.confirmId,
        result: ok({ saved: true }),
      },
    ])
  })

  it('expired_confirmation_forwarded_as_refused', async () => {
    const tm = createTestRegistry({ confirmExpiryMs: 1000 })
    tm.register(tool('save', { consequential: true }))
    vi.useFakeTimers()
    const t = fakeTransport()
    tm.use(bridge({ transport: t.transport }))
    t.deliver(call(tm, 'c1', 'save'))
    await vi.advanceTimersByTimeAsync(10)
    const r = t.results('c1')[0]!.result
    if (r.status !== 'needs_confirmation') throw new Error('expected needs_confirmation')
    await vi.advanceTimersByTimeAsync(1000)
    expect(t.sent.filter((m) => m.type === 'confirmed')).toEqual([
      {
        protocol: 1,
        type: 'confirmed',
        clientId: tm.clientId,
        confirmId: r.confirmId,
        result: expect.objectContaining({
          status: 'refused',
          code: 'confirmation_expired',
        }) as unknown,
      },
    ])
  })

  it('unsupported_protocol_replies_error', async () => {
    const tm = createTestRegistry()
    const t = fakeTransport()
    tm.use(bridge({ transport: t.transport }))
    t.deliver({ protocol: 2, type: 'call', clientId: tm.clientId, id: 'c9', tool: 'a', input: {} })
    t.deliver({ protocol: 2, type: 'call', clientId: tm.clientId, id: 'c9', tool: 'a', input: {} })
    t.deliver({ protocol: 2, type: 'call', id: 'c10' }) // unaddressed: no reply
    await settle()
    expect(t.results()).toEqual([
      {
        protocol: 1,
        type: 'result',
        clientId: tm.clientId,
        id: 'c9',
        result: { status: 'error', message: 'unsupported protocol' },
      },
    ])
  })

  it('invalid_message_dropped_with_event', async () => {
    const tm = createTestRegistry()
    const errors = errorsOf(tm)
    const t = fakeTransport()
    tm.use(bridge({ transport: t.transport }))
    t.deliver({ protocol: 1, type: 'call', clientId: tm.clientId, id: 'c1' }) // no tool/input
    t.deliver('not an object')
    t.deliver({ protocol: 1, type: 'manifest', clientId: tm.clientId, rev: 0, tools: [] })
    await settle()
    expect(t.sent).toHaveLength(1)
    expect(errors.map((e) => e.code)).toEqual([
      'invalid_message',
      'invalid_message',
      'invalid_message',
    ])
  })

  it('oversized_message_dropped', async () => {
    const tm = createTestRegistry()
    const run = vi.fn(() => ok(1))
    tm.register(tool('a', undefined, { run }))
    const errors = errorsOf(tm)
    const t = fakeTransport()
    tm.use(bridge({ transport: t.transport, maxMessageBytes: 200 }))
    t.deliver(call(tm, 'c1', 'a', { s: 'é'.repeat(100) })) // > 200 UTF-8 bytes
    let deep: unknown = 1
    for (let i = 0; i < 70; i++) deep = { d: deep }
    t.deliver(call(tm, 'c2', 'a', deep))
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    t.deliver(call(tm, 'c3', 'a', cyclic))
    await settle()
    expect(run).not.toHaveBeenCalled()
    expect(t.results()).toEqual([])
    expect(errors.map((e) => e.code)).toEqual([
      'invalid_message',
      'invalid_message',
      'invalid_message',
    ])
  })

  it('non_serializable_result_becomes_error', async () => {
    const tm = createTestRegistry()
    const self: Record<string, unknown> = {}
    self.self = self
    tm.register(tool('cyc', undefined, { run: () => ok({ self }) }))
    tm.register(tool('date', undefined, { run: () => ok({ at: new Date(0) }) }))
    tm.register(tool('nan', undefined, { run: () => ok(Number.NaN) }))
    const errors = errorsOf(tm)
    const t = fakeTransport()
    tm.use(bridge({ transport: t.transport }))
    t.deliver(call(tm, 'c1', 'cyc'))
    t.deliver(call(tm, 'c2', 'date'))
    t.deliver(call(tm, 'c3', 'nan'))
    await settle()
    for (const id of ['c1', 'c2', 'c3']) {
      expect(t.results(id)).toEqual([
        {
          protocol: 1,
          type: 'result',
          clientId: tm.clientId,
          id,
          result: { status: 'error', message: 'Result not serializable' },
        },
      ])
    }
    expect(errors.map((e) => e.code)).toEqual([
      'transport_failed',
      'transport_failed',
      'transport_failed',
    ])
  })

  it('result_sent_after_scope_disposed', async () => {
    const tm = createTestRegistry()
    const scope = tm.scope('page')
    const gate = deferred()
    tm.register(
      tool('slow', undefined, {
        run: async () => {
          await gate.promise
          return ok('done')
        },
      }),
      { scope },
    )
    const t = fakeTransport()
    tm.use(bridge({ transport: t.transport }))
    t.deliver(call(tm, 'c1', 'page.slow'))
    await settle()
    scope.dispose()
    gate.resolve()
    await settle()
    expect(t.results('c1')).toHaveLength(1)
    expect(t.results('c1')[0]!.result.status).toBeDefined()
  })

  it('transport_send_rejection_reported', async () => {
    const tm = createTestRegistry()
    const errors = errorsOf(tm)
    const t = fakeTransport({ failSend: true })
    expect(() => tm.use(bridge({ transport: t.transport }))).not.toThrow()
    await settle()
    expect(errors.map((e) => e.code)).toEqual(['transport_failed'])
  })

  it('dispose_aborts_inflight_and_closes_transport', async () => {
    const tm = createTestRegistry()
    let seen: AbortSignal | undefined
    tm.register(
      tool('slow', undefined, {
        run: (_i, ctx) => {
          seen = ctx.signal
          return new Promise<ToolResult<unknown>>((resolve) => {
            ctx.signal.addEventListener('abort', () => resolve(ok('late')))
          })
        },
      }),
    )
    const t = fakeTransport()
    const dispose = tm.use(bridge({ transport: t.transport }))
    t.deliver(call(tm, 'c1', 'slow'))
    await settle()
    const before = t.sent.length
    dispose()
    expect(seen?.aborted).toBe(true)
    expect(t.close).toHaveBeenCalledTimes(1)
    expect(t.handlers.size).toBe(0)
    tm.register(tool('later'))
    await settle()
    expect(t.sent).toHaveLength(before) // no late result, no manifest after dispose
  })
})
