/**
 * `@toolmark/core` — tool model, registry, policy, confirmation, form tools and protocol v1.
 * @packageDocumentation
 */
export type { StandardJSONSchemaV1, StandardSchemaV1, StandardTypedV1 } from './standard-schema.js'
export type {
  AnchorSpec,
  Caller,
  ConfirmOutcome,
  FileRef,
  JsonSchema,
  ToolContext,
  ToolDefinition,
  ToolHints,
  ToolState,
} from './tool.js'
export { defineTool } from './tool.js'
export { isValidToolName, toLlmName } from './names.js'
export type { FieldChange, ToolIssue, ToolResult } from './result.js'
export { cancelled, invalid, ok, refuse } from './result.js'
export { ToolmarkError } from './errors.js'
