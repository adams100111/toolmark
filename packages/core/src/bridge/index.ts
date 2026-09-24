/**
 * `@toolmark/core/bridge` — the in-app bridge consumer (protocol v1) and its transport interface.
 * Transports ship in their own subpaths (`@toolmark/core/bridge/echo`, `…/websocket`,
 * `…/post-message`, `…/in-page`).
 * @packageDocumentation
 */
export type { BridgeTransport } from './transport.js'
export type { BridgeOptions } from './bridge.js'
export { bridge } from './bridge.js'
