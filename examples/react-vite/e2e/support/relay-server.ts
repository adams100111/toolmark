import { randomUUID } from 'node:crypto'
import { WebSocket, WebSocketServer, type RawData } from 'ws'

/**
 * The e2e relay (M4 T8): a Node `ws` server on `127.0.0.1`, port `0`, that forwards every text
 * frame to every other socket **in the same room**. The room is the URL path
 * (`ws://127.0.0.1:<port>/<room>`), so specs running in parallel (workers, browser projects) never
 * see each other's frames. Pages opt in with `?relay=<port>&room=<room>`; the test drives the
 * agent side over its own socket ({@link connectRelayAgent}).
 */
export interface RelayServer {
  readonly port: number
  close(): Promise<void>
}

/** Starts the relay on an ephemeral port. Always `close()` it (global teardown does). */
export function startRelayServer(): Promise<RelayServer> {
  return new Promise((resolve, reject) => {
    const rooms = new Map<string, Set<WebSocket>>()
    const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 })
    wss.once('error', reject)
    wss.on('connection', (socket, request) => {
      const room = request.url ?? '/'
      let peers = rooms.get(room)
      if (!peers) rooms.set(room, (peers = new Set()))
      peers.add(socket)
      socket.on('message', (data: RawData, isBinary: boolean) => {
        if (isBinary) return
        for (const peer of peers) {
          if (peer !== socket && peer.readyState === WebSocket.OPEN) peer.send(data.toString())
        }
      })
      socket.on('close', () => {
        peers.delete(socket)
        if (peers.size === 0) rooms.delete(room)
      })
    })
    wss.once('listening', () => {
      const address = wss.address()
      const port = typeof address === 'object' && address ? address.port : 0
      resolve({
        port,
        close: () =>
          new Promise<void>((done) => {
            for (const client of wss.clients) client.terminate()
            wss.close(() => done())
          }),
      })
    })
  })
}

/** The relay port published by `e2e/global-setup.ts`. */
export function relayPort(): number {
  const port = Number(process.env.TOOLMARK_RELAY_PORT)
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error('TOOLMARK_RELAY_PORT is not set: the relay starts in e2e/global-setup.ts')
  }
  return port
}

/** A fresh room name (one per test keeps parallel tests apart). */
export function newRoom(): string {
  return `room-${randomUUID()}`
}

/** The page URL (relative to `baseURL`) that opts a page into the relay room. */
export function relayPagePath(room: string, path = '/'): string {
  return `${path}?relay=${relayPort()}&room=${room}`
}

/** The agent side of a relay room, driven by the test. */
export interface RelayAgent {
  /** Every parsed JSON frame received so far, in order. */
  readonly messages: unknown[]
  send(message: unknown): void
  /**
   * Resolves with the first frame (already received or still to come) matching `pred`; rejects
   * after `timeoutMs` (default `10000`).
   */
  waitFor<T = Record<string, unknown>>(
    pred: (m: Record<string, unknown>) => boolean,
    timeoutMs?: number,
  ): Promise<T>
  close(): Promise<void>
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

/** Connects a test agent to `room` on the relay. Always `close()` it. */
export function connectRelayAgent(room: string): Promise<RelayAgent> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${relayPort()}/${room}`)
    const messages: unknown[] = []
    const waiters = new Set<(m: unknown) => void>()
    socket.on('message', (data: RawData, isBinary: boolean) => {
      if (isBinary) return
      let parsed: unknown
      try {
        parsed = JSON.parse(data.toString())
      } catch {
        return
      }
      messages.push(parsed)
      for (const wake of [...waiters]) wake(parsed)
    })
    socket.once('error', reject)
    socket.once('open', () => {
      resolve({
        messages,
        send: (message) => socket.send(JSON.stringify(message)),
        waitFor<T>(pred: (m: Record<string, unknown>) => boolean, timeoutMs = 10_000) {
          const match = (m: unknown): boolean => isObj(m) && pred(m)
          const seen = messages.find(match)
          if (seen !== undefined) return Promise.resolve(seen as T)
          return new Promise<T>((ok, fail) => {
            const timer = setTimeout(() => {
              waiters.delete(wake)
              fail(new Error(`relay agent: no matching frame within ${timeoutMs} ms`))
            }, timeoutMs)
            const wake = (m: unknown): void => {
              if (!match(m)) return
              clearTimeout(timer)
              waiters.delete(wake)
              ok(m as T)
            }
            waiters.add(wake)
          })
        },
        close: () =>
          new Promise<void>((done) => {
            if (socket.readyState === WebSocket.CLOSED) {
              done()
              return
            }
            socket.once('close', () => done())
            socket.close()
          }),
      })
    })
  })
}
