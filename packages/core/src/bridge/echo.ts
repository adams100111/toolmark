import type { PageToAgentMessage } from '../protocol/messages.js'
import type { BridgeTransport } from './transport.js'

/** The subset of Laravel Echo the transport uses (private channels only — D20). */
export interface EchoLike {
  /** Joins an authorized private channel. */
  private(channel: string): {
    listen(event: string, cb: (payload: unknown) => void): unknown
    stopListening(event: string): unknown
  }
}

/** Options for {@link echoTransport}. */
export interface EchoTransportOptions {
  /** The app's Laravel Echo instance. */
  echo: EchoLike
  /** Private channel name (per user and conversation, §12.2); joined with `echo.private`. */
  channel: string
  /** Broadcast event name (default `'.toolmark.message'`). */
  event?: string
  /** URL the page POSTs its messages to (same origin; cookies sent). */
  postUrl: string
  /**
   * Extra request headers, read on every send (e.g. a CSRF token). The fixed `Content-Type`,
   * `Accept` and `X-Requested-With` headers override anything this returns.
   */
  headers?: () => Record<string, string>
}

const DEFAULT_EVENT = '.toolmark.message'

/**
 * Laravel Echo transport: agent messages arrive on an authorized **private** channel (D20) and page
 * messages are POSTed as JSON with `credentials: 'same-origin'`. A broadcast payload may be the
 * message itself or `{ message }`.
 * @param o - Echo instance, channel, event and POST target; see {@link EchoTransportOptions}.
 * @returns A {@link BridgeTransport}; `send` rejects on network failure or a non-2xx status, and
 * `close()` stops listening on the channel.
 */
export function echoTransport(o: EchoTransportOptions): BridgeTransport {
  if (typeof o.channel !== 'string' || o.channel === '') {
    throw new TypeError('channel must be a non-empty string')
  }
  const event = o.event ?? DEFAULT_EVENT
  const handlers = new Set<(message: unknown) => void>()
  let channel: ReturnType<EchoLike['private']> | undefined
  let closed = false

  const deliver = (payload: unknown): void => {
    if (closed) return
    const message =
      typeof payload === 'object' &&
      payload !== null &&
      !Object.prototype.hasOwnProperty.call(payload, 'protocol') &&
      Object.prototype.hasOwnProperty.call(payload, 'message')
        ? (payload as { message: unknown }).message
        : payload
    for (const h of [...handlers]) h(message)
  }

  return {
    async send(message: PageToAgentMessage): Promise<void> {
      if (closed) throw new Error('transport stopped')
      const response = await fetch(o.postUrl, {
        method: 'POST',
        headers: {
          ...(o.headers?.() ?? {}),
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify(message),
        credentials: 'same-origin',
      })
      if (!response.ok) throw new Error(`Bridge POST failed with status ${response.status}`)
    },
    onMessage(handler) {
      if (!closed && channel === undefined) {
        channel = o.echo.private(o.channel)
        channel.listen(event, deliver)
      }
      handlers.add(handler)
      return () => {
        handlers.delete(handler)
      }
    },
    close() {
      if (closed) return
      closed = true
      handlers.clear()
      channel?.stopListening(event)
    },
  }
}
