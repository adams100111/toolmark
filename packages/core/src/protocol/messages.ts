import type { ToolManifestSummary } from '../manifest.js'
import type { ToolResult } from '../result.js'

/** Bridge protocol version (spec §12). */
export const PROTOCOL_VERSION = 1

/** Messages the page sends to the agent (spec §12.1). */
export type PageToAgentMessage =
  | { protocol: 1; type: 'manifest'; clientId: string; rev: number; tools: ToolManifestSummary[] }
  | { protocol: 1; type: 'changed'; clientId: string; rev: number }
  | { protocol: 1; type: 'result'; clientId: string; id: string; result: ToolResult<unknown> }
  | {
      protocol: 1
      type: 'confirmed'
      clientId: string
      confirmId: string
      result: ToolResult<unknown>
    }

/** Messages the agent sends to the page (spec §12.1). */
export type AgentToPageMessage =
  | {
      protocol: 1
      type: 'call'
      clientId: string
      id: string
      rev?: number
      tool: string
      input: unknown
    }
  | { protocol: 1; type: 'describe'; clientId: string; id: string; tool: string }
  | { protocol: 1; type: 'cancel'; clientId: string; id: string }

/** Any bridge protocol v1 message. */
export type ProtocolMessage = PageToAgentMessage | AgentToPageMessage
