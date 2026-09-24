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
export type { JsonSchemaConverter } from './schema.js'
export type { ToolmarkErrorEvent, ToolmarkEventMap } from './events.js'
export type { Scope } from './scope.js'
export type { ToolManifest, ToolManifestSummary } from './manifest.js'
export type { CallerPolicy, HintClass } from './policy.js'
export type { ConfirmRequest, Registration, Toolmark, ToolmarkOptions } from './registry.js'
export { createToolmark } from './registry.js'
export type { PendingConfirmation } from './confirm.js'
export type { ConfirmQueue } from './confirm-queue.js'
export { createConfirmQueue } from './confirm-queue.js'
