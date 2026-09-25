import type { McpTool } from './tool-mapping.js'

/** Name of the built-in pairing tool, listed only while no page is paired (spec §11.3). */
export const PAIRING_TOOL_NAME = 'toolmark_pairing'

/** The built-in pairing tool as listed by `tools/list` while unpaired. */
export const pairingTool: McpTool = Object.freeze({
  name: PAIRING_TOOL_NAME,
  title: 'Pair with a Toolmark page',
  description:
    'Shows the one-time code that connects this MCP server to the user\'s open app. Ask the user to enter it in the app\'s "Pair with desktop MCP" panel.',
  inputSchema: Object.freeze({
    type: 'object' as const,
    properties: Object.freeze({}),
    additionalProperties: false,
  }),
  annotations: Object.freeze({
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: false as const,
    openWorldHint: false as const,
  }),
})

/**
 * Remaining whole minutes of a pairing code, rounded up (at least `1`).
 * @param expiresInMs - Milliseconds until the code expires.
 */
export function expiresInMinutes(expiresInMs: number): number {
  if (!Number.isFinite(expiresInMs) || expiresInMs <= 0) return 1
  return Math.max(1, Math.ceil(expiresInMs / 60_000))
}

/**
 * The text of a `toolmark_pairing` result.
 * @param code - The display form of the code, `XXXX-XXXX`.
 * @param expiresInMs - Milliseconds until the code expires.
 */
export function pairingResultText(code: string, expiresInMs: number): string {
  return `Open the app, choose "Pair with desktop MCP", and enter code ${code} (expires in ${expiresInMinutes(expiresInMs)} minutes).`
}
