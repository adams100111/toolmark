/**
 * `@toolmark/mcp` server API: serves a paired Toolmark page's tools over MCP (stdio, both
 * protocol eras through the SDK's `serveStdio`). The pairing server lands in M3 Task 5.
 * @packageDocumentation
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
