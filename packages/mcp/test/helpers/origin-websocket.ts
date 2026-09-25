import { request } from 'node:http'
import { Writable } from 'node:stream'

/** The page origin every test server allows. */
export const TEST_ORIGIN = 'http://localhost:5173'

/** Node's global (undici) WebSocket, captured before any test replaces it. */
export const NativeWebSocket: typeof WebSocket = globalThis.WebSocket

/**
 * Installs a global `WebSocket` that sends `Origin: <origin>` (Node's global undici `WebSocket`
 * sends none; its `headers` init does). Returns the restorer.
 */
export function installOriginWebSocket(origin = TEST_ORIGIN): () => void {
  const previous = globalThis.WebSocket
  globalThis.WebSocket = class extends NativeWebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, { protocols, headers: { Origin: origin } } as unknown as string[])
    }
  }
  return () => {
    globalThis.WebSocket = previous
  }
}

/** A raw WebSocket client for driving the pairing server frame by frame. */
export interface TestSocket {
  ws: WebSocket
  /** Parsed frames received so far. */
  frames: unknown[]
  /** Resolves on `open`, rejects if the socket closes first. */
  opened: Promise<void>
  /** Resolves with the close code. */
  closed: Promise<number>
  /** Sends a JSON value (or a raw string). */
  send(v: unknown): void
  /** Resolves with the next frame (or the first unread one). */
  next(timeoutMs?: number): Promise<unknown>
}

/** Opens a raw socket to `ws://127.0.0.1:<port>` with `Origin: origin` (`null`: none). */
export function connectSocket(port: number, origin: string | null = TEST_ORIGIN): TestSocket {
  const init =
    origin === null ? undefined : ({ headers: { Origin: origin } } as unknown as string[])
  const ws = new NativeWebSocket(`ws://127.0.0.1:${port}`, init)
  const frames: unknown[] = []
  let read = 0
  const waiters: (() => void)[] = []
  ws.addEventListener('message', (e) => {
    frames.push(typeof e.data === 'string' ? JSON.parse(e.data) : e.data)
    for (const w of waiters.splice(0)) w()
  })
  let everOpened = false
  const closed = new Promise<number>((resolve) => {
    ws.addEventListener('close', (e) => {
      resolve(e.code)
      for (const w of waiters.splice(0)) w()
    })
    // Node's undici WebSocket fires only `error` (no `close`) when the handshake fails.
    ws.addEventListener('error', () => {
      if (!everOpened) resolve(1006)
    })
  })
  const opened = new Promise<void>((resolve, reject) => {
    ws.addEventListener('open', () => {
      everOpened = true
      resolve()
    })
    ws.addEventListener('close', () => reject(new Error('closed before open')))
    ws.addEventListener('error', () => reject(new Error('failed before open')))
  })
  opened.catch(() => {})
  return {
    ws,
    frames,
    opened,
    closed,
    send(v) {
      ws.send(typeof v === 'string' ? v : JSON.stringify(v))
    },
    async next(timeoutMs = 3000) {
      const deadline = Date.now() + timeoutMs
      while (read >= frames.length) {
        if (ws.readyState === 3) throw new Error('socket closed')
        if (Date.now() > deadline) throw new Error('no frame')
        await new Promise<void>((resolve) => {
          waiters.push(resolve)
          setTimeout(resolve, 50)
        })
      }
      return frames[read++]
    },
  }
}

/** Sends a raw HTTP upgrade request and resolves with the response status (`101` on upgrade). */
export function rawUpgrade(port: number, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request({
      host: '127.0.0.1',
      port,
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
        ...headers,
      },
    })
    req.on('upgrade', (res, socket) => {
      socket.destroy()
      resolve(res.statusCode ?? 0)
    })
    req.on('response', (res) => {
      res.resume()
      resolve(res.statusCode ?? 0)
    })
    req.on('error', reject)
    req.end()
  })
}

/** A `Writable` collecting complete lines, plus the pairing codes printed so far. */
export function captureStderr() {
  const lines: string[] = []
  let buf = ''
  const stream = new Writable({
    write(chunk: Buffer | string, _enc, cb) {
      buf += chunk.toString()
      let i: number
      while ((i = buf.indexOf('\n')) >= 0) {
        lines.push(buf.slice(0, i))
        buf = buf.slice(i + 1)
      }
      cb()
    },
  })
  const codes = () =>
    lines.flatMap((l) => {
      const m = /^Toolmark pairing code: (\S+) \(expires in \d+ minutes\)$/.exec(l)
      return m ? [m[1]!] : []
    })
  return { stream, lines, codes, code: () => codes().at(-1)! }
}

/** A `Map`-backed `sessionStorage` stand-in. */
export function mapStorage(): Storage & { map: Map<string, string> } {
  const map = new Map<string, string>()
  return {
    map,
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => {
      map.delete(k)
    },
    setItem: (k, v) => {
      map.set(k, String(v))
    },
  }
}

/** Polls `fn` until it returns truthy (default 3 s). */
export async function until(fn: () => unknown, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!fn()) {
    if (Date.now() > deadline) throw new Error('condition not met in time')
    await new Promise((r) => setTimeout(r, 10))
  }
}
