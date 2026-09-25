import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WebSocketServer } from 'ws'
import { ok, type ToolDefinition } from '@toolmark/core'
import { createTestToolmark } from '@toolmark/testing/vitest'
import { mcpPairing, type McpPairingStatus } from '../src/client/index.js'
import { createPairingServer } from '../src/index.js'
import {
  captureStderr,
  installOriginWebSocket,
  mapStorage,
  TEST_ORIGIN,
  until,
} from './helpers/origin-websocket.js'

const cleanups: (() => Promise<void> | void)[] = []
let storage: ReturnType<typeof mapStorage>
beforeEach(() => {
  cleanups.push(installOriginWebSocket())
  storage = mapStorage()
  vi.stubGlobal('sessionStorage', storage)
  cleanups.push(() => void vi.unstubAllGlobals())
})
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c()
})

async function start() {
  const err = captureStderr()
  const server = await createPairingServer({
    port: 0,
    allowOrigins: [TEST_ORIGIN],
    stderr: err.stream,
  })
  cleanups.push(() => server.close())
  return { server, link: server.link, err, port: server.port }
}

const search: ToolDefinition = {
  name: 'crm.search',
  description: 'Searches contacts.',
  hints: { readOnly: true },
  run: () => ok(['ada']),
}

function page(o: { code?: string; port: number }) {
  const tm = createTestToolmark()
  tm.register(search)
  const statuses: McpPairingStatus[] = []
  const dispose = tm.use(mcpPairing({ ...o, onStatus: (s) => statuses.push(s) }))
  cleanups.push(dispose)
  return { tm, statuses, dispose }
}

describe('mcpPairing', () => {
  it('client_pairs_and_serves_calls', async () => {
    const { link, err, port } = await start()
    const p = page({ code: err.code(), port })
    await until(() => p.statuses.includes('paired'))
    expect(p.statuses[0]).toBe('connecting')
    await until(() => link.state() === 'paired')
    expect((await link.manifest()).map((t) => t.llmName)).toEqual(['crm__search'])
    const r = await link.call('crm.search', {}, { signal: new AbortController().signal })
    expect(r).toEqual({ status: 'ok', data: ['ada'] })
    expect(p.tm.calls.map((c) => c.caller)).toEqual(['mcp'])
    expect(storage.map.get(`toolmark:mcp:${port}`)).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('client_waits_for_paired_before_flush', async () => {
    const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 })
    cleanups.push(() => new Promise<void>((r) => wss.close(() => r())))
    await new Promise((r) => wss.once('listening', r))
    const port = (wss.address() as { port: number }).port
    const frames: { type: string }[] = []
    let answer!: () => void
    wss.on('connection', (ws) => {
      ws.on('message', (data) =>
        frames.push(JSON.parse((data as Buffer).toString('utf8')) as { type: string }),
      )
      answer = () => ws.send(JSON.stringify({ type: 'paired', token: 'T'.repeat(43) }))
    })
    const p = page({ code: 'ABCD-EFGH', port })
    await until(() => frames.length === 1)
    expect(frames[0]).toEqual({ type: 'pair', code: 'ABCD-EFGH' })
    await new Promise((r) => setTimeout(r, 150))
    expect(frames).toHaveLength(1)
    expect(p.statuses).not.toContain('paired')
    answer()
    await until(() => frames.length >= 2)
    expect(frames[1]).toMatchObject({ protocol: 1, type: 'manifest', clientId: p.tm.clientId })
    expect(p.statuses.at(-1)).toBe('paired')
  })

  it('reload_resumes_with_token', async () => {
    const { link, err, port } = await start()
    const first = page({ code: err.code(), port })
    await until(() => first.statuses.includes('paired'))
    await until(() => link.state() === 'paired')
    const token = storage.map.get(`toolmark:mcp:${port}`)
    first.dispose()
    // The "reloaded" page has no code: it resumes from sessionStorage.
    const second = page({ port })
    await until(() => second.statuses.includes('paired'))
    expect(storage.map.get(`toolmark:mcp:${port}`)).toBe(token)
    expect(err.codes()).toHaveLength(2) // the initial code and the one issued after pairing
    const r = await link.call('crm.search', {}, { signal: new AbortController().signal })
    expect(r.status).toBe('ok')
    expect(second.tm.calls).toHaveLength(1)
    expect(first.tm.calls).toHaveLength(0)
  })

  it('replaced_page_does_not_reconnect', async () => {
    const { link, err, port } = await start()
    const first = page({ code: err.code(), port })
    await until(() => first.statuses.includes('paired'))
    await until(() => err.codes().length === 2)
    const second = page({ code: err.code(), port })
    await until(() => second.statuses.includes('paired'))
    await until(() => first.statuses.includes('superseded'))
    const attempts = first.statuses.filter((s) => s === 'connecting').length
    await new Promise((r) => setTimeout(r, 1200))
    expect(first.statuses.filter((s) => s === 'connecting').length).toBe(attempts)
    expect(first.statuses.at(-1)).toBe('superseded')
    await until(() => link.state() === 'paired')
    expect(second.statuses.at(-1)).toBe('paired')
  })

  it('rejected_code_stops_and_reports', async () => {
    const { link, port } = await start()
    const p = page({ code: 'ZZZZ-ZZZZ', port })
    await until(() => p.statuses.includes('rejected'))
    await new Promise((r) => setTimeout(r, 1200))
    expect(p.statuses.filter((s) => s === 'connecting')).toHaveLength(1)
    expect(link.state()).toBe('unpaired')
    expect(storage.map.size).toBe(0)
  })

  it('rejected_token_is_removed', async () => {
    const { port } = await start()
    storage.map.set(`toolmark:mcp:${port}`, 'A'.repeat(43))
    const p = page({ port })
    await until(() => p.statuses.includes('rejected'))
    expect(storage.map.has(`toolmark:mcp:${port}`)).toBe(false)
  })

  it('unreachable_then_keeps_reconnecting', async () => {
    // Browsers fire `close` (1006) when a connection is refused; Node's undici fires only `error`,
    // so a fake socket stands in for the browser here.
    let created = 0
    vi.stubGlobal(
      'WebSocket',
      class extends EventTarget {
        readyState = 0
        constructor() {
          super()
          created++
          setTimeout(() => {
            this.readyState = 3
            this.dispatchEvent(Object.assign(new Event('close'), { code: 1006 }))
          }, 0)
        }
        send() {}
        close() {}
      },
    )
    const p = page({ code: 'ABCD-EFGH', port: 17840 })
    await until(() => p.statuses.includes('unreachable'))
    await until(() => created >= 2, 2000)
    expect(p.statuses.slice(0, 2)).toEqual(['connecting', 'unreachable'])
    expect(p.statuses.at(-1)).not.toBe('rejected')
    p.dispose()
  })

  it('no_code_no_token_is_inert', () => {
    const spy = vi.fn()
    vi.stubGlobal(
      'WebSocket',
      class {
        constructor() {
          spy()
        }
      },
    )
    const p = page({ port: 17840 })
    expect(spy).not.toHaveBeenCalled()
    expect(p.statuses).toEqual([])
    p.dispose()
    expect(() => mcpPairing({ port: 0 })).toThrow(TypeError)
    expect(() => mcpPairing({ port: 70000 })).toThrow(TypeError)
  })
})
