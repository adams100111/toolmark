/**
 * `@toolmark/core/bridge/in-page` — An in-page channel: the page transport and the agent handle (`createInPageChannel`).
 * @packageDocumentation
 * @module @toolmark/core/bridge/in-page
 */
import { safeCall } from '../events.js'
import type { AgentToPageMessage, PageToAgentMessage } from '../protocol/messages.js'
import type { BridgeTransport } from './transport.js'

/** The agent side of an in-page channel. */
export interface InPageAgent {
  /** Sends an agent→page message (delivered asynchronously). */
  send(message: AgentToPageMessage): void
  /**
   * Subscribes to page→agent messages.
   * @returns An unsubscribe function.
   */
  onMessage(handler: (message: PageToAgentMessage) => void): () => void
}

/**
 * Creates an in-page channel: a page-side {@link BridgeTransport} for `bridge({ transport })` and an
 * `agent` handle for a client-side LLM loop or tests. Both directions are delivered asynchronously
 * (`queueMicrotask`); a throwing handler is logged and never breaks delivery to the others.
 * `transport.close()` stops delivery in both directions.
 * @returns `{ transport, agent }`.
 */
export function createInPageChannel(): { transport: BridgeTransport; agent: InPageAgent } {
  const pageHandlers = new Set<(message: unknown) => void>()
  const agentHandlers = new Set<(message: PageToAgentMessage) => void>()
  let closed = false

  const deliver = <T>(handlers: Set<(m: T) => void>, message: T, what: string): void => {
    if (closed) return
    queueMicrotask(() => {
      if (closed) return
      for (const h of [...handlers]) safeCall(() => h(message), what)
    })
  }

  const subscribe = <T>(handlers: Set<T>, handler: T): (() => void) => {
    handlers.add(handler)
    return () => {
      handlers.delete(handler)
    }
  }

  return {
    transport: {
      send(message) {
        deliver(agentHandlers, message, 'in-page agent handler')
      },
      onMessage: (handler) => subscribe(pageHandlers, handler),
      close() {
        closed = true
        pageHandlers.clear()
        agentHandlers.clear()
      },
    },
    agent: {
      send(message) {
        deliver(pageHandlers, message as unknown, 'in-page page handler')
      },
      onMessage: (handler) => subscribe(agentHandlers, handler),
    },
  }
}
