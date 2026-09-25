/**
 * `@toolmark/core/bridge` — the in-app bridge consumer (protocol v1) and its transport interface.
 * The transports are re-exported here and also ship in their own subpaths
 * (`@toolmark/core/bridge/echo`, `…/websocket`, `…/post-message`, `…/in-page`).
 * @packageDocumentation
 * @module @toolmark/core/bridge
 */
export type { BridgeTransport } from './transport.js'
export type { BridgeOptions } from './bridge.js'
export { bridge } from './bridge.js'
export type { EchoLike, EchoTransportOptions } from './echo.js'
export { echoTransport } from './echo.js'
export type {
  WebSocketOpenIo,
  WebSocketTransportOptions,
  WebSocketTransportStatus,
} from './websocket.js'
export { websocketTransport } from './websocket.js'
export type { PostMessageTransportOptions } from './post-message.js'
export { postMessageTransport } from './post-message.js'
export type { InPageAgent } from './in-page.js'
export { createInPageChannel } from './in-page.js'
