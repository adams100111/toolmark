import type { IncomingMessage } from 'node:http'

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

/**
 * Decides whether an HTTP upgrade may become a pairing WebSocket (spec §11.3, §14): the peer is
 * loopback (`127.0.0.1`, `::1`, `::ffff:127.0.0.1`), `Host` is `127.0.0.1:<port>` or
 * `localhost:<port>` (DNS-rebinding guard), and `Origin` is present and exactly one of
 * `allowOrigins`.
 * @param req - The upgrade request.
 * @param o - The allowed origins and the port the server listens on.
 * @returns `true` when the upgrade may proceed.
 */
export function isAllowedUpgrade(
  req: IncomingMessage,
  o: { allowOrigins: readonly string[]; port: number },
): boolean {
  const remote = req.socket?.remoteAddress
  if (typeof remote !== 'string' || !LOOPBACK.has(remote)) return false
  const host = req.headers.host
  if (typeof host !== 'string') return false
  const h = host.toLowerCase()
  if (h !== `127.0.0.1:${o.port}` && h !== `localhost:${o.port}`) return false
  const origin = req.headers.origin
  if (typeof origin !== 'string' || origin === '' || origin === 'null') return false
  return o.allowOrigins.includes(origin)
}
