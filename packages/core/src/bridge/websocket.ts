/**
 * `@toolmark/core/bridge/websocket` — A reconnecting WebSocket bridge transport.
 * @packageDocumentation
 * @module @toolmark/core/bridge/websocket
 */
import { safeCall } from '../events.js'
import type { PageToAgentMessage } from '../protocol/messages.js'
import type { BridgeTransport } from './transport.js'

/** A connection state reported through {@link WebSocketTransportOptions.onStatus}. */
export interface WebSocketTransportStatus {
  /**
   * `connecting` (each attempt), `open` (after `onOpen` resolved), `closed` (a socket closed) or
   * `stopped` (terminal close code, rejecting `onOpen`, or `close()`; no further reconnects).
   */
  state: 'connecting' | 'open' | 'closed' | 'stopped'
  /** The close code, for `closed`. */
  closeCode?: number
  /** `true` on the `closed` status of the very first connection when it never opened. */
  firstConnectFailed?: boolean
}

/** Frame access for {@link WebSocketTransportOptions.onOpen}. */
export interface WebSocketOpenIo {
  /**
   * Resolves with the next parsed JSON frame received while `onOpen` runs (FIFO). Rejects with
   * `Error('receive timeout')` after `timeoutMs`, `Error('socket closed')` when the socket
   * closes, or `Error('receive unavailable')` when called after `onOpen` has finished.
   */
  receive(timeoutMs?: number): Promise<unknown>
}

/** Options for {@link websocketTransport}. */
export interface WebSocketTransportOptions {
  /** WebSocket URL (`wss://` in production). */
  url: string
  /** WebSocket sub-protocols. */
  protocols?: string | string[]
  /** Reconnect backoff cap in ms (default `30000`; the first delay is `500`, doubling). */
  maxDelayMs?: number
  /** Close codes that stop the transport instead of reconnecting (default `[]`). */
  terminalCloseCodes?: number[]
  /**
   * Runs (and is awaited) on every (re)connect before buffered bridge messages flush, e.g. for a
   * handshake. Frames arriving meanwhile go to `io.receive`, never to the bridge; frames `onOpen`
   * did not read are discarded when it resolves. A rejection stops the transport.
   */
  onOpen?: (socket: WebSocket, io: WebSocketOpenIo) => void | Promise<void>
  /** Connection status callback. */
  onStatus?: (status: WebSocketTransportStatus) => void
}

const FIRST_DELAY_MS = 500
const DEFAULT_MAX_DELAY_MS = 30000
const MAX_BUFFERED = 100
/** Frames kept for `io.receive` while `onOpen` runs; further frames are dropped. */
const MAX_RECEIVE_QUEUE = 100
/** Frames longer than this (UTF-16 code units; 4 × the bridge's default limit) are dropped unparsed. */
const MAX_FRAME_LENGTH = 4 * 1048576
/** `WebSocket.OPEN`. */
const OPEN = 1

interface Buffered {
  text: string
  resolve: () => void
  reject: (e: Error) => void
}

interface Waiter {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  timer?: ReturnType<typeof setTimeout>
}

interface Connection {
  ws: WebSocket
  phase: 'connecting' | 'onOpen' | 'ready' | 'closed'
  first: boolean
  opened: boolean
  frames: unknown[]
  waiters: Waiter[]
}

/**
 * WebSocket transport (JSON text frames) using the global `WebSocket` (Node ≥ 22.12, browsers).
 * Reconnects with exponential backoff (500 ms doubling, capped at `maxDelayMs`) until a terminal
 * close code, a rejecting `onOpen` or `close()`. Non-JSON, binary and oversized (> 4 MiB of text)
 * frames are ignored. The socket
 * opens on the first `send` or `onMessage`. A reconnect does not re-send the manifest: the bridge
 * sends one on the next registry revision, and protocol pairing (M3) handles a full resync.
 * @param o - Connection options; see {@link WebSocketTransportOptions}.
 * @returns A {@link BridgeTransport}. `send` resolves once the frame is written to an open socket;
 * it rejects with `Error('buffer overflow')` when evicted from the 100-message buffer (oldest
 * first) and with `Error('transport stopped')` after `close()` or a terminal stop.
 * @throws TypeError for an empty `url` or a non-positive `maxDelayMs`.
 */
export function websocketTransport(o: WebSocketTransportOptions): BridgeTransport {
  if (typeof o.url !== 'string' || o.url === '')
    throw new TypeError('url must be a non-empty string')
  const maxDelay = o.maxDelayMs ?? DEFAULT_MAX_DELAY_MS
  if (!Number.isFinite(maxDelay) || maxDelay <= 0) {
    throw new TypeError('maxDelayMs must be a positive number')
  }
  const terminal = new Set(o.terminalCloseCodes ?? [])
  const handlers = new Set<(message: unknown) => void>()
  const buffer: Buffered[] = []
  let conn: Connection | null = null
  let started = false
  let stopped = false
  let attempts = 0
  let delay = FIRST_DELAY_MS
  let timer: ReturnType<typeof setTimeout> | undefined

  const status = (s: WebSocketTransportStatus): void => {
    const onStatus = o.onStatus
    if (onStatus) safeCall(() => onStatus(s), 'websocket onStatus')
  }

  const rejectWaiters = (c: Connection, message: string): void => {
    const waiters = c.waiters
    c.waiters = []
    c.frames = []
    for (const w of waiters) {
      if (w.timer !== undefined) clearTimeout(w.timer)
      w.reject(new Error(message))
    }
  }

  const ioFor = (c: Connection): WebSocketOpenIo => ({
    receive(timeoutMs) {
      return new Promise<unknown>((resolve, reject) => {
        if (c.phase !== 'onOpen') {
          reject(new Error(c.phase === 'closed' ? 'socket closed' : 'receive unavailable'))
          return
        }
        if (c.frames.length > 0) {
          resolve(c.frames.shift())
          return
        }
        const waiter: Waiter = { resolve, reject }
        if (timeoutMs !== undefined) {
          waiter.timer = setTimeout(() => {
            const i = c.waiters.indexOf(waiter)
            if (i >= 0) c.waiters.splice(i, 1)
            reject(new Error('receive timeout'))
          }, timeoutMs)
        }
        c.waiters.push(waiter)
      })
    },
  })

  const flush = (c: Connection): void => {
    while (buffer.length > 0 && conn === c && c.phase === 'ready' && c.ws.readyState === OPEN) {
      const item = buffer.shift()!
      try {
        c.ws.send(item.text)
        item.resolve()
      } catch (e) {
        item.reject(e instanceof Error ? e : new Error(String(e)))
      }
    }
  }

  const stop = (): void => {
    if (stopped) return
    stopped = true
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    const c = conn
    conn = null
    if (c) {
      c.phase = 'closed'
      rejectWaiters(c, 'socket closed')
      try {
        c.ws.close(1000)
      } catch {
        // already closing
      }
    }
    for (const item of buffer.splice(0)) item.reject(new Error('transport stopped'))
    status({ state: 'stopped' })
  }

  const onOpened = async (c: Connection): Promise<void> => {
    if (conn !== c || stopped) return
    c.opened = true
    const onOpen = o.onOpen
    if (onOpen) {
      c.phase = 'onOpen'
      try {
        await onOpen(c.ws, ioFor(c))
      } catch {
        // A handshake failure on the live socket is terminal; a socket that already closed has
        // scheduled its reconnect.
        if (conn === c) stop()
        return
      }
      if (conn !== c || stopped) return
      rejectWaiters(c, 'receive unavailable')
    }
    c.phase = 'ready'
    delay = FIRST_DELAY_MS
    status({ state: 'open' })
    flush(c)
  }

  const onFrame = (c: Connection, event: Event): void => {
    if (conn !== c) return
    const data: unknown = (event as MessageEvent).data
    if (typeof data !== 'string' || data.length > MAX_FRAME_LENGTH) return
    let message: unknown
    try {
      message = JSON.parse(data)
    } catch {
      return
    }
    if (c.phase === 'onOpen') {
      const waiter = c.waiters.shift()
      if (waiter) {
        if (waiter.timer !== undefined) clearTimeout(waiter.timer)
        waiter.resolve(message)
      } else if (c.frames.length < MAX_RECEIVE_QUEUE) {
        c.frames.push(message)
      }
      return
    }
    if (c.phase !== 'ready') return
    for (const h of [...handlers]) safeCall(() => h(message), 'websocket message handler')
  }

  const handleClosed = (c: Connection, code: number): void => {
    if (conn !== c) return
    conn = null
    c.phase = 'closed'
    rejectWaiters(c, 'socket closed')
    status({
      state: 'closed',
      closeCode: code,
      ...(c.first && !c.opened ? { firstConnectFailed: true } : {}),
    })
    if (stopped) return
    if (terminal.has(code)) {
      stop()
      return
    }
    timer = setTimeout(connect, delay)
    delay = Math.min(delay * 2, maxDelay)
  }

  const onClosed = (c: Connection, event: Event): void => {
    handleClosed(c, (event as CloseEvent).code)
  }

  /**
   * Node's global `WebSocket` fires `error` (never `close`) when a connection fails before
   * opening (e.g. `ECONNREFUSED`); browsers fire both. Treat a pre-open `error` as an abnormal
   * close (1006) so both environments report status and reconnect the same way. `handleClosed`'s
   * `conn !== c` guard (it clears `conn` before returning) makes this idempotent: a browser's
   * subsequent real `close` for the same socket is a no-op here.
   */
  const onError = (c: Connection, _event: Event): void => {
    if (conn !== c || c.opened) return
    handleClosed(c, 1006)
  }

  function connect(): void {
    timer = undefined
    if (stopped) return
    status({ state: 'connecting' })
    const first = attempts === 0
    attempts++
    let ws: WebSocket
    try {
      ws = o.protocols === undefined ? new WebSocket(o.url) : new WebSocket(o.url, o.protocols)
    } catch {
      // An invalid URL or protocol list never succeeds: stop instead of looping.
      stop()
      return
    }
    const c: Connection = { ws, phase: 'connecting', first, opened: false, frames: [], waiters: [] }
    conn = c
    ws.addEventListener('open', () => void onOpened(c))
    ws.addEventListener('message', (e) => onFrame(c, e))
    ws.addEventListener('close', (e) => onClosed(c, e))
    ws.addEventListener('error', (e) => onError(c, e))
  }

  const start = (): void => {
    if (started || stopped) return
    started = true
    connect()
  }

  return {
    send(message: PageToAgentMessage): Promise<void> {
      start()
      if (stopped) return Promise.reject(new Error('transport stopped'))
      let text: string
      try {
        text = JSON.stringify(message)
      } catch (e) {
        return Promise.reject(e instanceof Error ? e : new Error(String(e)))
      }
      const c = conn
      if (c && c.phase === 'ready' && c.ws.readyState === OPEN && buffer.length === 0) {
        try {
          c.ws.send(text)
          return Promise.resolve()
        } catch (e) {
          return Promise.reject(e instanceof Error ? e : new Error(String(e)))
        }
      }
      return new Promise<void>((resolve, reject) => {
        buffer.push({ text, resolve, reject })
        while (buffer.length > MAX_BUFFERED) buffer.shift()!.reject(new Error('buffer overflow'))
      })
    },
    onMessage(handler) {
      handlers.add(handler)
      start()
      return () => {
        handlers.delete(handler)
      }
    },
    close() {
      handlers.clear()
      stop()
    },
  }
}
