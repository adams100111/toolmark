/**
 * `@toolmark/mcp/client`: the browser side of desktop MCP pairing (spec §11.3). Never imports
 * `ws` or `node:*`.
 * @packageDocumentation
 */
import type { Toolmark } from '@toolmark/core'
import { bridge, websocketTransport, type WebSocketTransportStatus } from '@toolmark/core/bridge'
import {
  DEFAULT_PAIRING_PORT,
  HANDSHAKE_TIMEOUT_MS,
  PAIRING_CLOSE_CODES,
  TERMINAL_CLOSE_CODES,
  TOKEN_PATTERN,
} from '../pairing/constants.js'

export { DEFAULT_PAIRING_PORT, PAIRING_CLOSE_CODES } from '../pairing/constants.js'

/**
 * Pairing state reported through {@link McpPairingOptions.onStatus}: `connecting` (each attempt),
 * `paired`, `rejected` (invalid frame, wrong code, unknown token or handshake timeout; stops),
 * `superseded` (a newer pairing replaced this page; stops), `disconnected` (reconnecting) and
 * `unreachable` (the first connection never opened; reconnecting).
 */
export type McpPairingStatus =
  'connecting' | 'paired' | 'rejected' | 'superseded' | 'disconnected' | 'unreachable'

/** Options of {@link mcpPairing}. */
export interface McpPairingOptions {
  /** The code shown by `toolmark-mcp` (`XXXX-XXXX`); without it the page resumes from its token. */
  code?: string
  /** The CLI's pairing port (default `17840`). */
  port?: number
  /** Pairing status callback, e.g. for the app's pairing panel. */
  onStatus?: (status: McpPairingStatus) => void
}

const memoryTokens = new Map<string, string>()

function readToken(key: string): string | null {
  try {
    const v = globalThis.sessionStorage?.getItem(key)
    if (typeof v === 'string') return TOKEN_PATTERN.test(v) ? v : null
  } catch {
    // Storage blocked: fall back to memory.
  }
  return memoryTokens.get(key) ?? null
}

function writeToken(key: string, token: string | null): void {
  if (token === null) memoryTokens.delete(key)
  else memoryTokens.set(key, token)
  try {
    const storage = globalThis.sessionStorage
    if (!storage) return
    if (token === null) storage.removeItem(key)
    else storage.setItem(key, token)
  } catch {
    // Storage blocked: the in-memory copy is used.
  }
}

/**
 * Pairs the page with a local `toolmark-mcp` (spec §11.3, D31): attach with
 * `tm.use(mcpPairing({ code, port, onStatus }))`. Connects to `ws://127.0.0.1:<port>`, sends
 * `{ type: 'pair', code }` (or `{ type: 'resume', token }` with the session token kept in
 * `sessionStorage` under `toolmark:mcp:<port>`), waits for `paired`, then serves the registry as a
 * bridge with caller `mcp` (inline confirmation). Close codes `4400`, `4401`, `4408` and `4409`
 * stop reconnecting; others reconnect with backoff and resume.
 * @param o - The code, port and status callback.
 * @returns A consumer for `tm.use`. Without a code and without a stored token it is inert (no
 * socket; the disposer does nothing).
 * @throws TypeError for a port outside 1–65535 or a non-string code.
 */
export function mcpPairing(o: McpPairingOptions = {}): (tm: Toolmark) => () => void {
  const port = o.port ?? DEFAULT_PAIRING_PORT
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new TypeError('port must be an integer from 1 to 65535')
  }
  if (o.code !== undefined && typeof o.code !== 'string') {
    throw new TypeError('code must be a string')
  }
  const key = `toolmark:mcp:${port}`

  return (tm) => {
    let code = o.code !== undefined && o.code.trim() !== '' ? o.code : undefined
    if (code === undefined && readToken(key) === null) return () => {}

    const report = (s: McpPairingStatus): void => {
      try {
        o.onStatus?.(s)
      } catch {
        // A failing status callback never breaks pairing.
      }
    }
    let lastHello: 'pair' | 'resume' | null = null
    let everPaired = false
    let terminalReported = false
    let disposed = false

    const onStatus = (s: WebSocketTransportStatus): void => {
      if (disposed) return
      switch (s.state) {
        case 'connecting':
          report('connecting')
          return
        case 'open':
          report('paired')
          return
        case 'closed': {
          const closeCode = s.closeCode ?? 0
          if (closeCode === PAIRING_CLOSE_CODES.superseded) {
            terminalReported = true
            report('superseded')
          } else if (TERMINAL_CLOSE_CODES.includes(closeCode)) {
            terminalReported = true
            if (closeCode === PAIRING_CLOSE_CODES.unauthorized && lastHello === 'resume') {
              writeToken(key, null)
            }
            report('rejected')
          } else {
            report(s.firstConnectFailed ? 'unreachable' : 'disconnected')
          }
          return
        }
        case 'stopped':
          // A stop without a terminal close code is a failed handshake on a live socket.
          if (!terminalReported) report('rejected')
          terminalReported = true
          return
      }
    }

    const transport = websocketTransport({
      url: `ws://127.0.0.1:${port}`,
      terminalCloseCodes: [...TERMINAL_CLOSE_CODES],
      onStatus,
      onOpen: async (socket, io) => {
        const token = readToken(key)
        let hello: { type: 'pair'; code: string } | { type: 'resume'; token: string }
        if (code !== undefined) hello = { type: 'pair', code }
        else if (token !== null) hello = { type: 'resume', token }
        else throw new Error('no code or session token')
        lastHello = hello.type
        socket.send(JSON.stringify(hello))
        const reply = (await io.receive(HANDSHAKE_TIMEOUT_MS)) as {
          type?: unknown
          token?: unknown
        }
        if (
          typeof reply !== 'object' ||
          reply === null ||
          reply.type !== 'paired' ||
          typeof reply.token !== 'string' ||
          !TOKEN_PATTERN.test(reply.token)
        ) {
          throw new Error('unexpected pairing reply')
        }
        writeToken(key, reply.token)
        code = undefined // reconnects always resume
        if (everPaired) {
          // The bridge sends its manifest only on attach and on revisions: resync the CLI.
          const m = tm.manifest({ caller: 'mcp' })
          socket.send(
            JSON.stringify({
              protocol: 1,
              type: 'manifest',
              clientId: tm.clientId,
              rev: m.rev,
              tools: m.tools,
            }),
          )
        }
        everPaired = true
      },
    })

    const detach = tm.use(bridge({ transport, caller: 'mcp' }))
    return () => {
      if (disposed) return
      disposed = true
      detach()
    }
  }
}
