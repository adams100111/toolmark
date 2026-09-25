import type { IncomingMessage } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPairingServer, isAllowedUpgrade } from '../src/index.js'
import { normalizeCode } from '../src/pairing/code.js'
import {
  captureStderr,
  connectSocket,
  NativeWebSocket,
  rawUpgrade,
  TEST_ORIGIN,
  until,
} from './helpers/origin-websocket.js'

const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c()
})

async function start(o: { now?: () => number; handshakeTimeoutMs?: number } = {}) {
  const err = captureStderr()
  const server = await createPairingServer({
    port: 0,
    allowOrigins: [TEST_ORIGIN],
    stderr: err.stream,
    ...o,
  })
  cleanups.push(() => server.close())
  return { server, err, port: server.port }
}

function socket(port: number, origin?: string | null) {
  const s = connectSocket(port, origin)
  cleanups.push(() => {
    if (s.ws.readyState < 2) s.ws.close()
  })
  return s
}

/** Waits out the refusal window that follows every `4401`. */
const cooldown = () => new Promise((r) => setTimeout(r, 300))

async function pair(port: number, code: string) {
  const s = socket(port)
  await s.opened
  s.send({ type: 'pair', code })
  const reply = (await s.next()) as { type: string; token: string }
  expect(reply.type).toBe('paired')
  return { s, token: reply.token }
}

describe('upgrade checks', () => {
  it('rejects_bad_origin', async () => {
    const { port } = await start()
    const host = `127.0.0.1:${port}`
    expect(await rawUpgrade(port, { Host: host, Origin: 'http://evil.test' })).toBe(403)
    expect(await rawUpgrade(port, { Host: host, Origin: 'http://localhost:5174' })).toBe(403)
    expect(await rawUpgrade(port, { Host: host, Origin: TEST_ORIGIN })).toBe(101)
    const bad = socket(port, 'http://evil.test')
    await expect(bad.opened).rejects.toThrow()
  })

  it('rejects_missing_origin', async () => {
    const { port } = await start()
    expect(await rawUpgrade(port, { Host: `127.0.0.1:${port}` })).toBe(403)
    // Node's global WebSocket sends no Origin at all; its handshake fails (`error`, no `open`).
    const ws = new NativeWebSocket(`ws://127.0.0.1:${port}`)
    const outcome = await new Promise<string>((resolve) => {
      ws.addEventListener('open', () => resolve('open'))
      ws.addEventListener('error', () => resolve('error'))
    })
    expect(outcome).toBe('error')
  })

  it('rejects_bad_host', async () => {
    const { port } = await start()
    for (const host of ['evil.test', `evil.test:${port}`, `localhost:${port + 1}`, '127.0.0.1']) {
      expect(await rawUpgrade(port, { Host: host, Origin: TEST_ORIGIN })).toBe(403)
    }
    expect(await rawUpgrade(port, { Host: `localhost:${port}`, Origin: TEST_ORIGIN })).toBe(101)
  })

  it('rejects_non_loopback', () => {
    const req = (remoteAddress: string, headers: Record<string, string> = {}) =>
      ({
        headers: { host: '127.0.0.1:4000', origin: TEST_ORIGIN, ...headers },
        socket: { remoteAddress },
      }) as unknown as IncomingMessage
    const o = { allowOrigins: [TEST_ORIGIN], port: 4000 }
    expect(isAllowedUpgrade(req('10.0.0.5'), o)).toBe(false)
    expect(isAllowedUpgrade(req('192.168.1.2'), o)).toBe(false)
    for (const a of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
      expect(isAllowedUpgrade(req(a), o)).toBe(true)
    }
    expect(isAllowedUpgrade(req('127.0.0.1', { origin: 'null' }), o)).toBe(false)
  })

  it('non_upgrade_http_is_404', async () => {
    const { port } = await start()
    const res = await fetch(`http://127.0.0.1:${port}/`)
    expect(res.status).toBe(404)
  })
})

describe('pairing code', () => {
  it('rejects_wrong_code_and_rotates', async () => {
    const { port, err, server } = await start()
    const first = err.code()
    expect(first).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/)
    expect(server.link.pairingCode().code).toBe(first)
    for (let i = 0; i < 5; i++) {
      const s = socket(port)
      await s.opened
      s.send({ type: 'pair', code: 'ZZZZ-ZZZZ' === first ? 'YYYY-YYYY' : 'ZZZZ-ZZZZ' })
      expect(await s.closed).toBe(4401)
      await cooldown()
    }
    await until(() => err.codes().length === 2)
    const second = err.code()
    expect(second).not.toBe(first)
    expect(server.link.pairingCode().code).toBe(second)
    // The rotated code no longer pairs; the new one does.
    const old = socket(port)
    await old.opened
    old.send({ type: 'pair', code: first })
    expect(await old.closed).toBe(4401)
    await cooldown()
    await pair(port, second)
  })

  it('code_normalized_single_use_and_reissued', async () => {
    expect(normalizeCode(' ab1o-il0z ')).toBe('AB10110Z')
    expect(normalizeCode('abcd efgh')).toBe('ABCDEFGH')
    expect(normalizeCode('ABCD-EFG')).toBeNull()
    expect(normalizeCode('ABCD-EFGU')).toBeNull()
    expect(normalizeCode(42)).toBeNull()
    expect(normalizeCode('A'.repeat(10_000))).toBeNull()

    const { port, err } = await start()
    const code = err.code()
    const { token } = await pair(port, ` ${code.toLowerCase().replace('-', ' ')} `)
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    // Consumed: a fresh code is printed and the old one no longer works.
    await until(() => err.codes().length === 2)
    expect(err.code()).not.toBe(code)
    const again = socket(port)
    await again.opened
    again.send({ type: 'pair', code })
    expect(await again.closed).toBe(4401)
    // The code appears on stderr only in the pairing line.
    expect(err.lines.filter((l) => l.includes(code))).toHaveLength(1)
    expect(err.lines.join('\n')).not.toContain(token)
  })

  it('code_expires_after_300000_ms', async () => {
    let t = 1_000_000
    const { port, err, server } = await start({ now: () => t })
    const code = err.code()
    expect(server.link.pairingCode()).toEqual({ code, expiresInMs: 300_000 })
    t += 100_000
    expect(server.link.pairingCode()).toEqual({ code, expiresInMs: 200_000 })
    t += 200_000
    const s = socket(port)
    await s.opened
    s.send({ type: 'pair', code })
    expect(await s.closed).toBe(4401)
    await until(() => err.codes().length === 2)
    const fresh = err.code()
    expect(fresh).not.toBe(code)
    expect(server.link.pairingCode()).toEqual({ code: fresh, expiresInMs: 300_000 })
    t += 250
    await pair(port, fresh)
  })
})

describe('handshake', () => {
  it('pair_timeout_closes_4408', async () => {
    const { port } = await start({ handshakeTimeoutMs: 150 })
    const s = socket(port)
    await s.opened
    expect(await s.closed).toBe(4408)
  })

  it('pair_timeout_default_is_3000_ms', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true })
    cleanups.push(() => void vi.useRealTimers())
    const { port } = await start()
    const s = socket(port)
    await s.opened
    const state = () =>
      Promise.race([s.closed, new Promise((r) => setTimeout(() => r('open'), 50))])
    await vi.advanceTimersByTimeAsync(2900)
    expect(await state()).toBe('open')
    await vi.advanceTimersByTimeAsync(200)
    expect(await s.closed).toBe(4408)
  })

  it('oversize_first_frame_closes_4400', async () => {
    const { port, err } = await start()
    const s = socket(port)
    await s.opened
    s.send(JSON.stringify({ type: 'pair', code: `${err.code()}${' '.repeat(1100)}` }))
    expect(await s.closed).toBe(4400)
    const exact = socket(port)
    await exact.opened
    exact.send({ type: 'resume', token: 'x'.repeat(1024 - 28) })
    // At the limit the frame is parsed (and the unknown token refused).
    expect(await exact.closed).toBe(4401)
  })

  it('refuses_handshakes_for_250_ms_after_4401', async () => {
    let t = 1_000_000
    const { port, err } = await start({ now: () => t })
    const bad = socket(port)
    await bad.opened
    bad.send({ type: 'resume', token: 'A'.repeat(43) })
    expect(await bad.closed).toBe(4401)
    const early = socket(port)
    expect(await early.closed).toBe(4429)
    t += 249
    const still = socket(port)
    expect(await still.closed).toBe(4429)
    t += 1
    await pair(port, err.code())
  })

  it('invalid_first_frame_closes_4400', async () => {
    const { port, err } = await start()
    const frames: unknown[] = [
      'garbage',
      { type: 'pair' },
      { type: 'pair', code: 7 },
      { type: 'hello', code: err.code() },
      { type: 'pair', code: err.code(), extra: 1 },
      { type: 'resume' },
      [1, 2],
      null,
    ]
    for (const f of frames) {
      const s = socket(port)
      await s.opened
      s.send(f === 'garbage' ? '{not json' : JSON.stringify(f))
      expect(await s.closed).toBe(4400)
    }
    const bin = socket(port)
    await bin.opened
    bin.ws.send(new Uint8Array([1, 2, 3]))
    expect(await bin.closed).toBe(4400)
    // Invalid frames never consume the code.
    await pair(port, err.code())
  })

  it('second_handshake_closed_4429', async () => {
    const { port, err } = await start()
    const a = socket(port)
    await a.opened
    const b = socket(port)
    expect(await b.closed).toBe(4429)
    a.send({ type: 'pair', code: err.code() })
    expect(await a.next()).toMatchObject({ type: 'paired' })
    // Once the first handshake ends, another may start.
    const c = socket(port)
    await c.opened
    c.send({ type: 'resume', token: 'x'.repeat(43) })
    expect(await c.closed).toBe(4401)
  })
})

describe('session token', () => {
  it('resume_with_token', async () => {
    const { port, err } = await start()
    const { s, token } = await pair(port, err.code())
    s.ws.close()
    await s.closed
    const r = socket(port)
    await r.opened
    r.send({ type: 'resume', token })
    expect(await r.next()).toEqual({ type: 'paired', token })
  })

  it('unknown_token_closes_4401', async () => {
    const { port, err } = await start()
    const s = socket(port)
    await s.opened
    s.send({ type: 'resume', token: 'A'.repeat(43) })
    expect(await s.closed).toBe(4401)
    await cooldown()
    // No token has been issued yet; an empty token is invalid too.
    const e = socket(port)
    await e.opened
    e.send({ type: 'resume', token: '' })
    expect([4400, 4401]).toContain(await e.closed)
    await cooldown()
    await pair(port, err.code())
  })

  it('newer_pairing_supersedes_4409_and_revokes_token', async () => {
    const { port, err } = await start()
    const a = await pair(port, err.code())
    await until(() => err.codes().length === 2)
    const b = await pair(port, err.code())
    expect(await a.s.closed).toBe(4409)
    expect(b.token).not.toBe(a.token)
    // The old token is revoked.
    const stale = socket(port)
    await stale.opened
    stale.send({ type: 'resume', token: a.token })
    expect(await stale.closed).toBe(4401)
    await cooldown()
    // Resuming with the current token supersedes the socket holding it.
    const c = socket(port)
    await c.opened
    c.send({ type: 'resume', token: b.token })
    expect(await c.next()).toEqual({ type: 'paired', token: b.token })
    expect(await b.s.closed).toBe(4409)
  })

  it('oversize_frame_closes', async () => {
    const { port, err } = await start()
    const { s } = await pair(port, err.code())
    s.ws.send('x'.repeat(4_194_305))
    expect(await s.closed).toBe(1009)
    // Before pairing as well.
    const pre = socket(port)
    await pre.opened
    pre.ws.send('y'.repeat(4_194_305))
    expect(await pre.closed).toBe(1009)
  })

  it('close_ends_sockets_with_1001', async () => {
    const err = captureStderr()
    const server = await createPairingServer({
      port: 0,
      allowOrigins: [TEST_ORIGIN],
      stderr: err.stream,
    })
    expect(err.lines[0]).toBe(`Toolmark MCP: pairing server on ws://127.0.0.1:${server.port}`)
    const { s } = await pair(server.port, err.code())
    await server.close()
    expect(await s.closed).toBe(1001)
  })
})
