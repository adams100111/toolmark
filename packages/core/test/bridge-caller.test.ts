import { describe, expect, it, vi } from 'vitest'
import type { PageToAgentMessage } from '@toolmark/core/protocol'
import { bridge, type BridgeTransport } from '@toolmark/core/bridge'
import type { ConfirmRequest } from '@toolmark/core'
import { createTestRegistry } from './helpers/create-test-registry.js'
import { deferred, settle } from './helpers/deferred.js'
import { flushMicrotasks, tool } from './helpers/tools.js'

function fakeTransport() {
  const sent: PageToAgentMessage[] = []
  const handlers = new Set<(m: unknown) => void>()
  const transport: BridgeTransport = {
    send(message) {
      sent.push(message)
    },
    onMessage(handler) {
      handlers.add(handler)
      return () => {
        handlers.delete(handler)
      }
    },
    close: () => undefined,
  }
  return {
    transport,
    sent,
    deliver(m: unknown) {
      for (const h of [...handlers]) h(m)
    },
    results(id: string) {
      return sent.filter(
        (m): m is Extract<PageToAgentMessage, { type: 'result' }> =>
          m.type === 'result' && m.id === id,
      )
    },
    manifests() {
      return sent.filter(
        (m): m is Extract<PageToAgentMessage, { type: 'manifest' }> => m.type === 'manifest',
      )
    },
  }
}

describe('bridge caller', () => {
  it('mcp_caller_does_not_see_destructive_tools', async () => {
    const tm = createTestRegistry({ confirm: () => Promise.resolve({ approved: true }) })
    const run = vi.fn(() => ({ status: 'ok' as const, data: 'deleted' }))
    tm.register(tool('wipe', { destructive: true }, { run }))
    tm.register(tool('read', { readOnly: true }))
    await flushMicrotasks()
    const t = fakeTransport()
    tm.use(bridge({ transport: t.transport, caller: 'mcp' }))

    // Attach manifest and each revision's manifest are filtered for `mcp`.
    expect(t.manifests()[0]!.tools.map((x) => x.name)).toEqual(['read'])
    tm.register(tool('wipe2', { destructive: true }))
    tm.register(tool('read2', { readOnly: true }))
    await flushMicrotasks()
    expect(t.manifests()).toHaveLength(2)
    expect(t.manifests()[1]!.tools.map((x) => x.name)).toEqual(['read', 'read2'])
    // The unfiltered registry does know it.
    expect(tm.manifest().tools.map((x) => x.name)).toContain('wipe')

    t.deliver({ protocol: 1, type: 'describe', clientId: tm.clientId, id: 'd', tool: 'wipe' })
    t.deliver({
      protocol: 1,
      type: 'call',
      clientId: tm.clientId,
      id: 'c',
      tool: 'wipe',
      input: {},
    })
    await settle()
    expect(t.results('d')[0]!.result).toMatchObject({ status: 'refused', code: 'unknown_tool' })
    expect(t.results('c')[0]!.result).toMatchObject({ status: 'refused', code: 'not_allowed' })
    expect(run).not.toHaveBeenCalled()

    // The same registry through an `inapp` bridge does list it (caller is per bridge).
    const inapp = fakeTransport()
    tm.use(bridge({ transport: inapp.transport }))
    expect(inapp.manifests()[0]!.tools.map((x) => x.name)).toContain('wipe')
  })

  it('mcp_caller_consequential_confirms_inline', async () => {
    const approval = deferred<{ approved: true }>()
    const requests: ConfirmRequest[] = []
    const tm = createTestRegistry({
      confirm: (req) => {
        requests.push(req)
        return approval.promise
      },
    })
    tm.register(
      tool('save', { consequential: true }, { run: () => ({ status: 'ok', data: 'saved' }) }),
    )
    await flushMicrotasks()
    const t = fakeTransport()
    tm.use(bridge({ transport: t.transport, caller: 'mcp' }))
    expect(t.manifests()[0]!.tools.map((x) => x.name)).toEqual(['save'])

    t.deliver({
      protocol: 1,
      type: 'call',
      clientId: tm.clientId,
      id: 'c',
      tool: 'save',
      input: {},
    })
    await settle()
    // The call awaits the inline handler; nothing answered yet.
    expect(requests).toMatchObject([{ tool: 'save', caller: 'mcp' }])
    expect(t.results('c')).toEqual([])
    approval.resolve({ approved: true })
    await settle()
    expect(t.results('c')[0]!.result).toEqual({ status: 'ok', data: 'saved' })
    expect(t.sent.some((m) => m.type === 'confirmed')).toBe(false)
    expect(tm.pendingConfirmations()).toEqual([])
  })

  it('caller_validated_at_runtime', () => {
    const t = fakeTransport()
    for (const caller of ['human', 'test', 'webmcp', 'tour', '', 42, undefined]) {
      if (caller === undefined) continue
      expect(() => bridge({ transport: t.transport, caller: caller as 'inapp' })).toThrow(TypeError)
    }
    expect(() => bridge({ transport: t.transport, caller: 'mcp' })).not.toThrow()
    expect(() => bridge({ transport: t.transport, caller: 'inapp' })).not.toThrow()
  })
})
