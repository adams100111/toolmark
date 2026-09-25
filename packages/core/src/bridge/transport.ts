import type { PageToAgentMessage } from '../protocol/messages.js'

/**
 * A duplex channel between the page and an agent (spec §11.1). Inbound messages are untrusted:
 * the bridge bounds, validates and filters everything a transport hands to `onMessage`.
 */
export interface BridgeTransport {
  /**
   * Sends one page→agent message. A rejected promise (or a throw) is reported as the `error` event
   * `transport_failed`; it never reaches the registry.
   */
  send(message: PageToAgentMessage): void | Promise<void>
  /**
   * Subscribes to inbound (agent→page) messages.
   * @param handler - Receives each inbound message, unvalidated.
   * @returns An unsubscribe function.
   */
  onMessage(handler: (message: unknown) => void): () => void
  /** Releases the transport (called by the bridge disposer). */
  close?(): void
}
