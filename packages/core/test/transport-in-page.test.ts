import { describe, expect, it } from 'vitest'
import { ok } from '@toolmark/core'
import type { PageToAgentMessage } from '@toolmark/core/protocol'
import { bridge } from '@toolmark/core/bridge'
import { createInPageChannel } from '@toolmark/core/bridge/in-page'
import { createTestRegistry } from './helpers/create-test-registry.js'
import { settle } from './helpers/deferred.js'
import { tool } from './helpers/tools.js'

describe('createInPageChannel', () => {
  it('in_page_round_trip_with_bridge', async () => {
    const tm = createTestRegistry()
    tm.register(tool('greet', undefined, { run: () => ok({ hello: 'world' }) }))
    const { transport, agent } = createInPageChannel()
    const got: PageToAgentMessage[] = []
    agent.onMessage((m) => got.push(m))
    tm.use(bridge({ transport }))
    expect(got).toEqual([]) // delivery is asynchronous
    await settle()
    expect(got[0]).toMatchObject({ type: 'manifest', tools: [{ name: 'greet' }] })

    agent.send({
      protocol: 1,
      type: 'call',
      clientId: tm.clientId,
      id: 'c1',
      tool: 'greet',
      input: {},
    })
    await settle()
    expect(got.filter((m) => m.type === 'result')).toEqual([
      {
        protocol: 1,
        type: 'result',
        clientId: tm.clientId,
        id: 'c1',
        result: ok({ hello: 'world' }),
      },
    ])
  })

  it('in_page_close_stops_delivery', async () => {
    const { transport, agent } = createInPageChannel()
    const page: unknown[] = []
    transport.onMessage((m) => page.push(m))
    transport.close?.()
    agent.send({ protocol: 1, type: 'cancel', clientId: 'k', id: 'c' })
    await settle()
    expect(page).toEqual([])
  })
})
