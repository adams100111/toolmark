import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ok, type ToolDefinition, type ToolHints } from '@toolmark/core'
import { createTestToolmark } from '@toolmark/testing/vitest'
import { mcpPairing, type McpPairingStatus } from '../src/client/index.js'
import { createPairingServer } from '../src/index.js'
import {
  captureStderr,
  connectSocket,
  installOriginWebSocket,
  mapStorage,
  TEST_ORIGIN,
  until,
} from './helpers/origin-websocket.js'

const RELOAD_TEXT = 'The page reloaded before the result arrived; the outcome is unknown.'

const cleanups: (() => Promise<void> | void)[] = []
beforeEach(() => {
  cleanups.push(installOriginWebSocket())
  vi.stubGlobal('sessionStorage', mapStorage())
  cleanups.push(() => void vi.unstubAllGlobals())
})
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c()
})

async function start(o: { callTimeoutMs?: number } = {}) {
  const err = captureStderr()
  const server = await createPairingServer({
    port: 0,
    allowOrigins: [TEST_ORIGIN],
    stderr: err.stream,
    ...o,
  })
  cleanups.push(() => server.close())
  return { server, link: server.link, err, port: server.port }
}

function tool(name: string, hints?: ToolHints, extra?: Partial<ToolDefinition>): ToolDefinition {
  return {
    name,
    description: `Tool ${name}`,
    ...(hints ? { hints } : {}),
    run: () => ok({ name }),
    ...extra,
  }
}

/** Attaches `mcpPairing` to `tm`; returns the statuses seen and the disposer. */
function attach(tm: ReturnType<typeof createTestToolmark>, o: { code?: string; port: number }) {
  const statuses: McpPairingStatus[] = []
  const dispose = tm.use(mcpPairing({ ...o, onStatus: (s) => statuses.push(s) }))
  cleanups.push(dispose)
  return { statuses, dispose }
}

async function pairedPage(
  port: number,
  code: string,
  tools: ToolDefinition[],
  opts: Parameters<typeof createTestToolmark>[0] = {},
) {
  const tm = createTestToolmark(opts)
  for (const t of tools) tm.register(t)
  const page = attach(tm, { code, port })
  await until(() => page.statuses.includes('paired'))
  return { tm, ...page }
}

/** A raw page socket that pairs and then speaks bridge protocol by hand. */
async function rawPage(
  port: number,
  first: { type: 'pair'; code: string } | { type: 'resume'; token: string },
) {
  const s = connectSocket(port)
  cleanups.push(() => {
    if (s.ws.readyState < 2) s.ws.close()
  })
  await s.opened
  s.send(first)
  const reply = (await s.next()) as { type: 'paired'; token: string }
  expect(reply.type).toBe('paired')
  return { s, token: reply.token }
}

const summary = (name: string) => ({
  name,
  llmName: name.replaceAll('.', '__'),
  description: `Tool ${name}`,
  hints: {},
})

describe('PageLink', () => {
  it('manifest_change_notifies_client', async () => {
    const { link, err, port } = await start()
    expect(link.state()).toBe('unpaired')
    expect(await link.manifest()).toEqual([])
    let changes = 0
    link.onChange(() => changes++)
    const { tm } = await pairedPage(port, err.code(), [tool('crm.search', { readOnly: true })])
    await until(() => link.state() === 'paired')
    expect(changes).toBeGreaterThanOrEqual(1)
    expect((await link.manifest()).map((t) => t.name)).toEqual(['crm.search'])
    const before = changes
    tm.register(tool('crm.add'))
    await until(() => changes > before)
    expect((await link.manifest()).map((t) => t.name)).toEqual(['crm.add', 'crm.search'])
    const r = await link.call('crm.search', {}, { signal: new AbortController().signal })
    expect(r).toEqual({ status: 'ok', data: { name: 'crm.search' } })
  })

  it('unpaired_grace_2000_ms', async () => {
    const { link, err, port } = await start()
    const transitions: string[] = []
    link.onChange(() => transitions.push(link.state()))
    const page = await pairedPage(port, err.code(), [tool('crm.search')])
    await until(() => link.state() === 'paired')
    transitions.length = 0
    page.dispose()
    const closedAt = Date.now()
    await new Promise((r) => setTimeout(r, 1500))
    expect(link.state()).toBe('paired')
    expect(transitions).toEqual([])
    await until(() => link.state() === 'unpaired', 2000)
    expect(Date.now() - closedAt).toBeGreaterThanOrEqual(1900)
    expect(transitions).toEqual(['unpaired'])
    expect(await link.manifest()).toEqual([])
  })

  it('reconnect_inside_grace_sends_no_change', async () => {
    const { link, err, port } = await start()
    const first = await rawPage(port, { type: 'pair', code: err.code() })
    first.s.send({
      protocol: 1,
      type: 'manifest',
      clientId: 'page-a',
      rev: 1,
      tools: [summary('a.b')],
    })
    await until(() => link.state() === 'paired')
    let changes = 0
    link.onChange(() => changes++)
    first.s.ws.close()
    await first.s.closed
    const again = await rawPage(port, { type: 'resume', token: first.token })
    again.s.send({
      protocol: 1,
      type: 'manifest',
      clientId: 'page-a',
      rev: 1,
      tools: [summary('a.b')],
    })
    await new Promise((r) => setTimeout(r, 2300))
    expect(link.state()).toBe('paired')
    expect(changes).toBe(0)
  })

  it('describe_cached_per_rev', async () => {
    const { link, err, port } = await start()
    const { s } = await rawPage(port, { type: 'pair', code: err.code() })
    let describes = 0
    s.ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data as string) as {
        type: string
        id: string
        tool: string
        clientId: string
      }
      if (m.type !== 'describe') return
      describes++
      s.send({
        protocol: 1,
        type: 'result',
        clientId: 'page-a',
        id: m.id,
        result: {
          status: 'ok',
          data: { ...summary(m.tool), inputSchema: { type: 'object', properties: {} } },
        },
      })
    })
    s.send({
      protocol: 1,
      type: 'manifest',
      clientId: 'page-a',
      rev: 1,
      tools: [summary('a.b'), summary('a.c')],
    })
    await until(() => link.state() === 'paired')
    expect((await link.manifest()).map((t) => t.name)).toEqual(['a.b', 'a.c'])
    expect(describes).toBe(2)
    await link.manifest()
    expect(describes).toBe(2)
    let changes = 0
    link.onChange(() => changes++)
    s.send({ protocol: 1, type: 'manifest', clientId: 'page-a', rev: 2, tools: [summary('a.b')] })
    await until(() => changes > 0)
    expect((await link.manifest()).map((t) => t.name)).toEqual(['a.b'])
    expect(describes).toBe(3)
  })

  it('failed_describe_skips_tool', async () => {
    const { link, err, port } = await start()
    const { s } = await rawPage(port, { type: 'pair', code: err.code() })
    s.ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data as string) as { type: string; id: string; tool: string }
      if (m.type !== 'describe') return
      const result =
        m.tool === 'a.bad'
          ? { status: 'refused', code: 'unknown_tool', message: 'no' }
          : m.tool === 'a.liar'
            ? { status: 'ok', data: { ...summary('a.other'), inputSchema: {} } }
            : { status: 'ok', data: { ...summary(m.tool), inputSchema: {} } }
      s.send({ protocol: 1, type: 'result', clientId: 'page-a', id: m.id, result })
    })
    s.send({
      protocol: 1,
      type: 'manifest',
      clientId: 'page-a',
      rev: 1,
      tools: [summary('a.good'), summary('a.bad'), summary('a.liar')],
    })
    await until(() => link.state() === 'paired')
    expect((await link.manifest()).map((t) => t.name)).toEqual(['a.good'])
    expect(err.lines.some((l) => l.includes('a.bad'))).toBe(true)
  })

  it('drops_invalid_and_foreign_client_frames', async () => {
    const { link, err, port } = await start()
    const { s } = await rawPage(port, { type: 'pair', code: err.code() })
    // Frames before the first manifest never pair the link.
    s.send({ protocol: 1, type: 'changed', clientId: 'page-a', rev: 3 })
    s.send({ protocol: 1, type: 'manifest', clientId: 'page-a', rev: 1, tools: [summary('a.b')] })
    await until(() => link.state() === 'paired')
    const linesBefore = err.lines.length
    s.send('{not json')
    s.send({ protocol: 1, type: 'manifest', clientId: 'page-a', rev: 'x', tools: [] })
    s.send({ protocol: 1, type: 'call', clientId: 'page-a', id: '1', tool: 'a.b', input: {} })
    await until(() => err.lines.length >= linesBefore + 3)
    // A foreign clientId is ignored: the tool list stays page-a's.
    let changes = 0
    link.onChange(() => changes++)
    s.send({
      protocol: 1,
      type: 'manifest',
      clientId: 'page-b',
      rev: 9,
      tools: [summary('evil.x')],
    })
    await new Promise((r) => setTimeout(r, 100))
    expect(changes).toBe(0)
    // A foreign result for a pending call is ignored as well.
    const seen: { id: string }[] = []
    s.ws.addEventListener('message', (e) =>
      seen.push(JSON.parse(e.data as string) as { id: string }),
    )
    const controller = new AbortController()
    const pending = link.call('a.b', {}, { signal: controller.signal })
    await until(() => seen.length > 0)
    const id = seen[0]!.id
    s.send({
      protocol: 1,
      type: 'result',
      clientId: 'page-b',
      id,
      result: { status: 'ok', data: 'evil' },
    })
    s.send({
      protocol: 1,
      type: 'result',
      clientId: 'page-a',
      id,
      result: { status: 'ok', data: 'real' },
    })
    expect(await pending).toEqual({ status: 'ok', data: 'real' })
    // Invalid lines never echo page content at length.
    expect(err.lines.every((l) => l.length <= 300)).toBe(true)
  })

  it('timeout_sends_cancel_and_page_does_not_run', async () => {
    const { link, err, port } = await start({ callTimeoutMs: 200 })
    const run = vi.fn(() => ok('ran'))
    const { tm } = await pairedPage(
      port,
      err.code(),
      [tool('crm.send', { consequential: true }, { run })],
      { inline: () => new Promise(() => {}) },
    )
    await until(() => link.state() === 'paired')
    const started = Date.now()
    const r = await link.call('crm.send', {}, { signal: new AbortController().signal })
    expect(r).toEqual({ status: 'cancelled', by: 'signal' })
    expect(Date.now() - started).toBeGreaterThanOrEqual(190)
    // The page received `cancel`: the inline confirmation is withdrawn and the call settles.
    await until(() => tm.calls.length === 1)
    expect(tm.confirms).toHaveLength(1)
    expect(tm.calls[0]?.result).toMatchObject({ status: 'cancelled' })
    await new Promise((r) => setTimeout(r, 100))
    expect(run).not.toHaveBeenCalled()
    expect(err.lines.join('\n')).not.toMatch(/invalid|dropped/i)
  })

  it('mcp_cancel_forwarded_to_page', async () => {
    const { link, err, port } = await start()
    let aborted = false
    let started = false
    const slow = tool(
      'crm.slow',
      { readOnly: true },
      {
        run: (_input, ctx) =>
          new Promise((resolve) => {
            started = true
            ctx.signal.addEventListener('abort', () => {
              aborted = true
              resolve(ok('late'))
            })
          }),
      },
    )
    await pairedPage(port, err.code(), [slow])
    await until(() => link.state() === 'paired')
    const controller = new AbortController()
    const pending = link.call('crm.slow', {}, { signal: controller.signal })
    await until(() => started)
    controller.abort()
    expect(await pending).toEqual({ status: 'cancelled', by: 'signal' })
    await until(() => aborted)
  })

  it('reload_new_client_id_fails_pending_calls', async () => {
    const { link, err, port } = await start()
    const a = await rawPage(port, { type: 'pair', code: err.code() })
    a.s.send({ protocol: 1, type: 'manifest', clientId: 'page-a', rev: 1, tools: [summary('a.b')] })
    await until(() => link.state() === 'paired')
    const pending = link.call('a.b', {}, { signal: new AbortController().signal })
    await a.s.next()
    a.s.ws.close()
    await a.s.closed
    const b = await rawPage(port, { type: 'resume', token: a.token })
    b.s.send({ protocol: 1, type: 'manifest', clientId: 'page-b', rev: 1, tools: [summary('a.b')] })
    expect(await pending).toEqual({ status: 'error', message: RELOAD_TEXT })
  })

  it('page_gone_fails_pending_calls_after_grace', async () => {
    const { link, err, port } = await start()
    const a = await rawPage(port, { type: 'pair', code: err.code() })
    a.s.send({ protocol: 1, type: 'manifest', clientId: 'page-a', rev: 1, tools: [summary('a.b')] })
    await until(() => link.state() === 'paired')
    const pending = link.call('a.b', {}, { signal: new AbortController().signal })
    await a.s.next()
    a.s.ws.close()
    const r = await pending
    expect(r.status).toBe('error')
    expect(link.state()).toBe('unpaired')
    // Calls while unpaired resolve at once.
    expect((await link.call('a.b', {}, { signal: new AbortController().signal })).status).toBe(
      'error',
    )
  })

  it('call_ended_while_detached_cancelled_on_same_client_resume', async () => {
    const { link, err, port } = await start({ callTimeoutMs: 200 })
    const a = await rawPage(port, { type: 'pair', code: err.code() })
    a.s.send({ protocol: 1, type: 'manifest', clientId: 'page-a', rev: 1, tools: [summary('a.b')] })
    await until(() => link.state() === 'paired')
    const controller = new AbortController()
    const timedOut = link.call('a.b', {}, { signal: new AbortController().signal })
    const aborted = link.call('a.b', {}, { signal: controller.signal })
    const sent = [(await a.s.next()) as { id: string }, (await a.s.next()) as { id: string }]
    a.s.ws.close()
    await a.s.closed
    controller.abort()
    // Both end inside the grace while no socket is attached: the page still holds them.
    expect(await aborted).toEqual({ status: 'cancelled', by: 'signal' })
    expect(await timedOut).toEqual({ status: 'cancelled', by: 'signal' })
    const b = await rawPage(port, { type: 'resume', token: a.token })
    b.s.send({ protocol: 1, type: 'manifest', clientId: 'page-a', rev: 1, tools: [summary('a.b')] })
    const first = [await b.s.next(), await b.s.next()]
    expect(first).toEqual([
      { protocol: 1, type: 'cancel', clientId: 'page-a', id: sent[1]!.id },
      { protocol: 1, type: 'cancel', clientId: 'page-a', id: sent[0]!.id },
    ])
    // Sent once: a later resume of the same page gets none.
    b.s.ws.close()
    await b.s.closed
    const c = await rawPage(port, { type: 'resume', token: a.token })
    c.s.send({ protocol: 1, type: 'manifest', clientId: 'page-a', rev: 1, tools: [summary('a.b')] })
    await new Promise((r) => setTimeout(r, 200))
    expect(c.s.frames).toHaveLength(1)
  })

  it('call_ended_while_detached_not_cancelled_on_other_client', async () => {
    const { link, err, port } = await start({ callTimeoutMs: 200 })
    const a = await rawPage(port, { type: 'pair', code: err.code() })
    a.s.send({ protocol: 1, type: 'manifest', clientId: 'page-a', rev: 1, tools: [summary('a.b')] })
    await until(() => link.state() === 'paired')
    const timedOut = link.call('a.b', {}, { signal: new AbortController().signal })
    await a.s.next()
    a.s.ws.close()
    await a.s.closed
    expect(await timedOut).toEqual({ status: 'cancelled', by: 'signal' })
    const b = await rawPage(port, { type: 'resume', token: a.token })
    b.s.send({ protocol: 1, type: 'manifest', clientId: 'page-b', rev: 1, tools: [summary('a.b')] })
    await new Promise((r) => setTimeout(r, 200))
    // Only the `paired` reply: nothing is cancelled on a different page.
    expect(b.s.frames).toHaveLength(1)
    // The queue was cleared, so the old page returning later gets nothing either.
    b.s.ws.close()
    await b.s.closed
    const c = await rawPage(port, { type: 'resume', token: a.token })
    c.s.send({ protocol: 1, type: 'manifest', clientId: 'page-a', rev: 1, tools: [summary('a.b')] })
    await new Promise((r) => setTimeout(r, 200))
    expect(c.s.frames).toHaveLength(1)
  })

  it('grace_expiry_cancels_on_same_client_return', async () => {
    const { link, err, port } = await start()
    const a = await rawPage(port, { type: 'pair', code: err.code() })
    a.s.send({ protocol: 1, type: 'manifest', clientId: 'page-a', rev: 1, tools: [summary('a.b')] })
    await until(() => link.state() === 'paired')
    const pending = link.call('a.b', {}, { signal: new AbortController().signal })
    const sent = (await a.s.next()) as { id: string }
    a.s.ws.close()
    expect((await pending).status).toBe('error')
    expect(link.state()).toBe('unpaired')
    const b = await rawPage(port, { type: 'resume', token: a.token })
    b.s.send({ protocol: 1, type: 'manifest', clientId: 'page-a', rev: 1, tools: [summary('a.b')] })
    expect(await b.s.next()).toEqual({
      protocol: 1,
      type: 'cancel',
      clientId: 'page-a',
      id: sent.id,
    })
  })

  it('oversize_call_input_fails_fast', async () => {
    const { link, err, port } = await start()
    const a = await rawPage(port, { type: 'pair', code: err.code() })
    a.s.send({ protocol: 1, type: 'manifest', clientId: 'page-a', rev: 1, tools: [summary('a.b')] })
    await until(() => link.state() === 'paired')
    const r = await link.call(
      'a.b',
      { big: 'x'.repeat(1_100_000) },
      {
        signal: new AbortController().signal,
      },
    )
    expect(r.status).toBe('error')
  })
})
