import { createServer, type Server } from 'node:http'
import { readFile } from 'node:fs/promises'

/** A running fixture server started by {@link startStaticServer}. */
export interface StaticServer {
  /** Base URL, e.g. `http://127.0.0.1:54321`. */
  url: string
  /** Stops listening. */
  close(): Promise<void>
}

/** Serves a single file at `/` on an ephemeral localhost port, for `--url` collection tests. */
export async function startStaticServer(filePath: string): Promise<StaticServer> {
  const body = await readFile(filePath)
  const server: Server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(body)
  })
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('static server did not bind to a TCP port')
  }
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () => new Promise<void>((res, rej) => server.close((e) => (e ? rej(e) : res()))),
  }
}

/**
 * Accepts TCP connections but never writes a response (no headers, no body), for `--url`
 * navigation-timeout tests. Sockets are destroyed on {@link StaticServer.close} so a hung
 * in-flight request doesn't keep the server open.
 */
export async function startHangingServer(): Promise<StaticServer> {
  const sockets = new Set<import('node:net').Socket>()
  const server: Server = createServer(() => {
    // Intentionally never calls res.writeHead/res.end: the client hangs until it times out.
  })
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('static server did not bind to a TCP port')
  }
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () =>
      new Promise<void>((res, rej) => {
        for (const socket of sockets) socket.destroy()
        server.close((e) => (e ? rej(e) : res()))
      }),
  }
}
