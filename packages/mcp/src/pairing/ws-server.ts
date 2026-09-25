import { createServer, type IncomingMessage } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Duplex, Writable } from 'node:stream'
import { WebSocketServer, type RawData, type WebSocket } from 'ws'
import type { PageLink } from '../server/server.js'
import { expiresInMinutes } from '../server/pairing-tool.js'
import { isPlainObject } from '../server/tool-mapping.js'
import { createPairingCodes, type PairingCodes } from './code.js'
import {
  FIRST_FRAME_TIMEOUT_MS,
  MAX_HANDSHAKE_FRAME_BYTES,
  PAIRING_CLOSE_CODES,
  UNAUTHORIZED_COOLDOWN_MS,
} from './constants.js'
import { createPageLink } from './page-link.js'
import { generateToken, tokenMatches } from './token.js'
import { isAllowedUpgrade } from './upgrade.js'

/** Default call deadline (`--call-timeout`): the deferred-confirmation expiry. */
export const DEFAULT_CALL_TIMEOUT_MS = 600_000
/** Largest WebSocket frame accepted from a page; larger frames close the socket with `1009`. */
export const MAX_FRAME_BYTES = 4_194_304
/** Largest timer delay Node accepts; longer call timeouts are rejected. */
const MAX_TIMEOUT_MS = 2_147_483_647
/** Time close() waits for sockets to finish the closing handshake before terminating them. */
const CLOSE_WAIT_MS = 1000

/** Options of {@link createPairingServer}. */
export interface PairingServerOptions {
  /** Port on `127.0.0.1` (`0`: OS-assigned). */
  port: number
  /** Exact page origins allowed to connect (`--allow-origin`); at least one. */
  allowOrigins: string[]
  /** Deadline of each page call in ms (default `600000`). */
  callTimeoutMs?: number
  /** Diagnostics sink: the listen line, every pairing code, and dropped-frame notes. */
  stderr: Writable
  /** Clock for code expiry and the post-`4401` refusal window (default `Date.now`). */
  now?: () => number
  /** @internal First-frame (handshake) timeout in ms (default `3000`; tests shorten it). */
  handshakeTimeoutMs?: number
}

/** A running pairing server. */
export interface PairingServer {
  /** The paired-page link for {@link startMcpServer}. */
  link: PageLink
  /** The port actually listened on. */
  port: number
  /** Closes page sockets with `1001`, stops listening and fails pending calls. Idempotent. */
  close(): Promise<void>
}

type Phase = 'handshake' | 'paired' | 'closed'

function frameBytes(data: RawData): number {
  if (Array.isArray(data)) return data.reduce((n, b) => n + b.length, 0)
  return data.byteLength
}

function frameText(data: RawData): string {
  if (Buffer.isBuffer(data)) return data.toString('utf8')
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8')
  return Buffer.from(data).toString('utf8')
}

/** Parses the first frame: exactly `{ type: 'pair', code }` or `{ type: 'resume', token }`. */
function parseHello(
  text: string,
): { type: 'pair'; code: string } | { type: 'resume'; token: string } | null {
  let v: unknown
  try {
    v = JSON.parse(text)
  } catch {
    return null
  }
  if (!isPlainObject(v)) return null
  const keys = Object.keys(v)
  if (keys.length !== 2) return null
  if (v.type === 'pair' && typeof v.code === 'string') return { type: 'pair', code: v.code }
  if (v.type === 'resume' && typeof v.token === 'string') return { type: 'resume', token: v.token }
  return null
}

function reject403(socket: Duplex): void {
  socket.on('error', () => {})
  socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
  socket.destroy()
}

/**
 * Starts the pairing server (spec §11.3, §14, §23 "MCP pairing (R3)"): HTTP on `127.0.0.1` only
 * (non-upgrade requests get `404`), upgrades gated by {@link isAllowedUpgrade} (`403` otherwise),
 * one handshake at a time (`4429`), a `pair` / `resume` first frame of at most `1024` bytes
 * within `3000` ms (`4408`, `4400`), single-use codes (`4401` on a miss; five misses rotate the
 * code), no new handshake for `250` ms after any `4401` (`4429`), one valid session token at a
 * time, and supersede (`4409`). Prints the listen line and every new pairing code to
 * `stderr`.
 * @param o - Port, allowed origins, call deadline, stderr sink and clock.
 * @returns The link, the bound port and `close()`.
 * @throws TypeError for invalid options; rejects with the listen error (e.g. `EADDRINUSE`).
 */
export async function createPairingServer(o: PairingServerOptions): Promise<PairingServer> {
  if (!Number.isInteger(o.port) || o.port < 0 || o.port > 65535) {
    throw new TypeError('port must be an integer from 0 to 65535')
  }
  if (
    !Array.isArray(o.allowOrigins) ||
    o.allowOrigins.length === 0 ||
    !o.allowOrigins.every((x) => typeof x === 'string' && x !== '' && x !== '*' && x !== 'null')
  ) {
    throw new TypeError('allowOrigins must list at least one exact origin')
  }
  const callTimeoutMs = o.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS
  if (!Number.isInteger(callTimeoutMs) || callTimeoutMs <= 0 || callTimeoutMs > MAX_TIMEOUT_MS) {
    throw new TypeError('callTimeoutMs must be a positive integer')
  }
  const handshakeTimeoutMs = o.handshakeTimeoutMs ?? FIRST_FRAME_TIMEOUT_MS
  const allowOrigins = [...o.allowOrigins]
  const now = o.now ?? Date.now
  const write = (line: string): void => {
    try {
      o.stderr.write(`${line}\n`)
    } catch {
      // Diagnostics never break the server.
    }
  }

  let codes: PairingCodes | null = null
  const link = createPageLink({
    callTimeoutMs,
    stderr: o.stderr,
    pairingCode: () => codes!.current(),
  })

  const http = createServer((_req, res) => {
    res.writeHead(404, { 'Content-Length': '0', Connection: 'close' }).end()
  })
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES })
  const sockets = new Set<WebSocket>()
  let port = o.port
  let closing = false
  let handshaking: WebSocket | null = null
  let token: string | null = null
  let session: WebSocket | null = null
  /** Handshakes are refused (`4429`) until this time (set after every `4401`). */
  let refuseUntil = -Infinity

  const unauthorized = (ws: WebSocket): void => {
    refuseUntil = now() + UNAUTHORIZED_COOLDOWN_MS
    ws.close(PAIRING_CLOSE_CODES.unauthorized)
  }

  const paired = (ws: WebSocket, how: 'pair' | 'resume'): void => {
    const previous = session
    session = ws
    ws.send(JSON.stringify({ type: 'paired', token }))
    link.attach(ws, how)
    if (previous && previous !== ws) previous.close(PAIRING_CLOSE_CODES.superseded)
  }

  const onConnection = (ws: WebSocket): void => {
    sockets.add(ws)
    let phase: Phase = 'handshake'
    ws.on('error', () => {})
    if (handshaking !== null || closing || now() < refuseUntil) {
      phase = 'closed'
      ws.close(closing ? PAIRING_CLOSE_CODES.goingAway : PAIRING_CLOSE_CODES.busy)
    } else {
      handshaking = ws
    }
    const timer =
      phase === 'handshake'
        ? setTimeout(() => {
            if (phase !== 'handshake') return
            phase = 'closed'
            handshaking = null
            ws.close(PAIRING_CLOSE_CODES.handshakeTimeout)
          }, handshakeTimeoutMs)
        : undefined

    ws.on('message', (data, isBinary) => {
      if (phase === 'paired') {
        if (isBinary) return
        link.receive(ws, frameText(data))
        return
      }
      if (phase !== 'handshake') return
      clearTimeout(timer)
      handshaking = null
      phase = 'closed'
      const hello =
        isBinary || frameBytes(data) > MAX_HANDSHAKE_FRAME_BYTES
          ? null
          : parseHello(frameText(data))
      if (hello === null) {
        ws.close(PAIRING_CLOSE_CODES.invalidFrame)
        return
      }
      if (hello.type === 'pair') {
        if (!codes!.verify(hello.code)) {
          unauthorized(ws)
          return
        }
        token = generateToken()
      } else if (!tokenMatches(token, hello.token)) {
        codes!.fail()
        unauthorized(ws)
        return
      }
      phase = 'paired'
      paired(ws, hello.type)
    })

    ws.on('close', () => {
      sockets.delete(ws)
      clearTimeout(timer)
      if (handshaking === ws) handshaking = null
      if (session === ws) session = null
      phase = 'closed'
      link.detach(ws)
    })
  }

  http.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (closing || !isAllowedUpgrade(req, { allowOrigins, port })) {
      reject403(socket)
      return
    }
    socket.on('error', () => {})
    wss.handleUpgrade(req, socket, head, onConnection)
  })
  http.on('clientError', (_e, socket) => socket.destroy())

  await new Promise<void>((resolve, reject) => {
    const onError = (e: Error): void => {
      wss.close()
      reject(e)
    }
    http.once('error', onError)
    http.listen(o.port, '127.0.0.1', () => {
      http.off('error', onError)
      resolve()
    })
  })
  http.on('error', (e) => write(`Toolmark MCP: pairing server error: ${e.message}`))
  port = (http.address() as AddressInfo).port
  write(`Toolmark MCP: pairing server on ws://127.0.0.1:${port}`)
  codes = createPairingCodes({
    now,
    onIssue: (display, ms) =>
      write(`Toolmark pairing code: ${display} (expires in ${expiresInMinutes(ms)} minutes)`),
  })

  let closed: Promise<void> | null = null
  return {
    link,
    port,
    close() {
      closed ??= (async () => {
        closing = true
        link.dispose()
        const open = [...sockets]
        await Promise.all(
          open.map(
            (ws) =>
              new Promise<void>((resolve) => {
                if (ws.readyState === ws.CLOSED) return resolve()
                const t = setTimeout(() => {
                  ws.terminate()
                  resolve()
                }, CLOSE_WAIT_MS)
                ws.once('close', () => {
                  clearTimeout(t)
                  resolve()
                })
                ws.close(PAIRING_CLOSE_CODES.goingAway)
              }),
          ),
        )
        await new Promise<void>((resolve) => wss.close(() => resolve()))
        await new Promise<void>((resolve) => {
          http.close(() => resolve())
          http.closeAllConnections()
        })
      })()
      return closed
    },
  }
}
