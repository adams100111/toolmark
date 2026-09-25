/**
 * `@toolmark/core/protocol` — bridge protocol v1 message types, JSON Schemas and validator.
 * @packageDocumentation
 * @module @toolmark/core/protocol
 */
export type { AgentToPageMessage, PageToAgentMessage, ProtocolMessage } from './messages.js'
export { PROTOCOL_VERSION } from './messages.js'
export { protocolSchemas } from './schemas.js'
export { validateMessage } from './validate.js'
