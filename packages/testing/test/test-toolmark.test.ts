import { describe, expect, it } from 'vitest'
import { ok, type ToolDefinition, type ToolHints } from '@toolmark/core'
import { createTestToolmark } from '../src/test-toolmark.js'

function tool(name: string, hints?: ToolHints): ToolDefinition {
  return {
    name,
    description: `Tool ${name}`,
    ...(hints ? { hints } : {}),
    run: (input: unknown) => ok({ received: input }),
  }
}

/** Lets the microtask/macrotask queue drain a few turns (deferred confirmations settle async). */
function settle(turns = 3): Promise<void> {
  return (async () => {
    for (let i = 0; i < turns; i++) await new Promise((r) => setTimeout(r, 0))
  })()
}

describe('createTestToolmark', () => {
  it('test_toolmark_records_calls', async () => {
    const tm = createTestToolmark()
    tm.register(tool('ping'))
    const result = await tm.call('ping', { x: 1 }, { caller: 'test' })
    expect(result).toEqual(ok({ received: { x: 1 } }))
    expect(tm.calls).toEqual([{ tool: 'ping', caller: 'test', input: { x: 1 }, result }])
  })

  it('approve_all_runs_pending', async () => {
    const tm = createTestToolmark()
    tm.register(tool('save', { consequential: true }))
    const first = tm.call('save', {}, { caller: 'test' })
    const second = tm.call('save', {}, { caller: 'inapp' })
    await settle()
    expect(tm.pendingConfirmations()).toHaveLength(2)
    await tm.approveAll()
    expect((await first).status).toBe('needs_confirmation')
    expect((await second).status).toBe('needs_confirmation')
    expect(tm.pendingConfirmations()).toHaveLength(0)
    const humanCalls = tm.calls.filter((c) => c.caller === 'human')
    expect(humanCalls).toHaveLength(2)
    for (const c of humanCalls) expect(c.result.status).toBe('ok')
  })

  it('test_toolmark_keeps_production_modes', async () => {
    let seenTool: string | undefined
    const inline = createTestToolmark({
      inline: (req) => {
        seenTool = req.tool
        return Promise.resolve({ approved: true })
      },
    })
    inline.register(tool('save', { consequential: true }))
    const webmcpResult = await inline.call('save', {}, { caller: 'webmcp' })
    expect(webmcpResult.status).toBe('ok')
    expect(seenTool).toBe('save')
    expect(inline.confirms).toHaveLength(1)
    expect(inline.confirms[0]?.tool).toBe('save')

    const rejecting = createTestToolmark({ inline: 'reject' })
    rejecting.register(tool('save', { consequential: true }))
    const rejected = await rejecting.call('save', {}, { caller: 'tour' })
    expect(rejected).toEqual({ status: 'cancelled', by: 'operator' })

    const deferredTm = createTestToolmark()
    deferredTm.register(tool('save', { consequential: true }))
    const deferredResult = await deferredTm.call('save', {}, { caller: 'inapp' })
    expect(deferredResult.status).toBe('needs_confirmation')
  })
})
