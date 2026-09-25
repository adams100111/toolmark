/**
 * `@toolmark/mcp` server API: serves a paired Toolmark page's tools over MCP (stdio, both
 * protocol eras through the SDK's `serveStdio`), and the localhost pairing server that links the
 * page. The browser side is `@toolmark/mcp/client`.
 * @packageDocumentation
 * @module @toolmark/mcp
 */
export {
  createServerFactory,
  MAX_LISTED_TOOLS,
  MAX_TOOL_LIST_BYTES,
  startMcpServer,
  UNPAIRED_CALL_TEXT,
  type PageLink,
  type ServerFactoryOptions,
  type StartMcpServerOptions,
} from './server/server.js'
export {
  MAX_DESCRIPTION_LENGTH,
  MAX_INPUT_SCHEMA_BYTES,
  MAX_INPUT_SCHEMA_DEPTH,
  MAX_TITLE_LENGTH,
  toMcpResult,
  toMcpTool,
  UNTRUSTED_DESCRIPTION_SUFFIX,
  UNTRUSTED_META_KEY,
  UNTRUSTED_RESULT_PREFIX,
  type McpInputSchema,
  type McpTool,
  type McpToolAnnotations,
  type McpToolResult,
} from './server/tool-mapping.js'
export {
  expiresInMinutes,
  PAIRING_TOOL_NAME,
  pairingResultText,
  pairingTool,
} from './server/pairing-tool.js'
export {
  createPairingServer,
  DEFAULT_CALL_TIMEOUT_MS,
  MAX_FRAME_BYTES,
  type PairingServer,
  type PairingServerOptions,
} from './pairing/ws-server.js'
export { isAllowedUpgrade } from './pairing/upgrade.js'
export {
  DEFAULT_PAIRING_PORT,
  HANDSHAKE_TIMEOUT_MS,
  PAIRING_CLOSE_CODES,
  TERMINAL_CLOSE_CODES,
} from './pairing/constants.js'
export {
  DESCRIBE_TIMEOUT_MS,
  DISCONNECTED_TEXT,
  MAX_CALL_FRAME_BYTES,
  MAX_PENDING_REQUESTS,
  RELOAD_TEXT,
  UNPAIRED_GRACE_MS,
} from './pairing/page-link.js'
export { CODE_ALPHABET, CODE_LENGTH, CODE_TTL_MS, MAX_FAILED_ATTEMPTS } from './pairing/code.js'
