import type { PageToAgentMessage } from '../protocol/messages.js'
import type { BridgeTransport } from './transport.js'

/** Options for {@link postMessageTransport}. */
export interface PostMessageTransportOptions {
  /** The window the agent lives in (an iframe's `contentWindow`, the opener, the parent…). */
  target: Window
  /** Exact origin messages are posted to; `'*'` is rejected. */
  targetOrigin: string
  /** Exact origins accepted for inbound messages; must be non-empty, without `'*'` or `'null'`. */
  allowedOrigins: string[]
}

/**
 * `postMessage` transport for iframes and extensions. Outgoing messages are wrapped as
 * `{ toolmark: 1, message }` and posted to the exact `targetOrigin`. An inbound `message` event is
 * accepted only when its data carries that envelope, its origin is in `allowedOrigins` **and** its
 * source is `target`; anything else is ignored silently.
 * @param o - Target window and origins; see {@link PostMessageTransportOptions}.
 * @returns A {@link BridgeTransport}.
 * @throws TypeError for a wildcard/empty `targetOrigin` or an empty, `'*'` or `'null'` allow-list.
 */
export function postMessageTransport(o: PostMessageTransportOptions): BridgeTransport {
  const { target, targetOrigin } = o
  if (typeof targetOrigin !== 'string' || targetOrigin === '' || targetOrigin === '*') {
    throw new TypeError('targetOrigin must be an exact origin')
  }
  if (
    !Array.isArray(o.allowedOrigins) ||
    o.allowedOrigins.length === 0 ||
    o.allowedOrigins.some((x) => typeof x !== 'string' || x === '' || x === '*' || x === 'null')
  ) {
    throw new TypeError(
      "allowedOrigins must be a non-empty list of exact origins (no '*' or 'null')",
    )
  }
  const allowed = new Set(o.allowedOrigins)
  const handlers = new Set<(message: unknown) => void>()
  let listening = false
  let closed = false

  const onEvent = (event: Event): void => {
    const e = event as MessageEvent
    if (closed || e.source !== target || !allowed.has(e.origin)) return
    const data: unknown = e.data
    if (typeof data !== 'object' || data === null) return
    const envelope = data as { toolmark?: unknown; message?: unknown }
    if (envelope.toolmark !== 1 || !Object.prototype.hasOwnProperty.call(envelope, 'message')) {
      return
    }
    for (const h of [...handlers]) h(envelope.message)
  }

  return {
    send(message: PageToAgentMessage): void {
      if (closed) throw new Error('transport stopped')
      target.postMessage({ toolmark: 1, message }, targetOrigin)
    },
    onMessage(handler) {
      if (!closed && !listening) {
        listening = true
        globalThis.addEventListener('message', onEvent)
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
      if (listening) globalThis.removeEventListener('message', onEvent)
    },
  }
}
