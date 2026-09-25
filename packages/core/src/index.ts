/**
 * `@toolmark/core` — tool model, registry, policy, confirmation, form tools and protocol v1.
 * @packageDocumentation
 */
export type { StandardJSONSchemaV1, StandardSchemaV1, StandardTypedV1 } from './standard-schema.js'
export type {
  AnchorSpec,
  Caller,
  ConfirmOutcome,
  JsonSchema,
  ToolContext,
  ToolDefinition,
  ToolHints,
  ToolOrigin,
  ToolState,
} from './tool.js'
export { defineTool } from './tool.js'
export type { FileFieldSpec, FileRef, FilesOptions } from './files.js'
export {
  DEFAULT_MAX_FILES,
  fileFieldSchema,
  MAX_FILE_REF_LENGTH,
  MAX_FILE_URL_LENGTH,
} from './files.js'
export { isValidToolName, toLlmName } from './names.js'
export type { FieldChange, ToolIssue, ToolResult } from './result.js'
export { cancelled, invalid, ok, refuse } from './result.js'
export { ToolmarkError } from './errors.js'
export type { JsonSchemaConverter } from './schema.js'
export type { ToolmarkErrorEvent, ToolmarkEventMap } from './events.js'
export type { Scope, ScopeOptions } from './scope.js'
export type { ToolManifest, ToolManifestSummary } from './manifest.js'
export type { CallerPolicy, HintClass } from './policy.js'
export type {
  ConfirmRequest,
  Registration,
  Toolmark,
  ToolInfo,
  ToolmarkOptions,
} from './registry.js'
export { createToolmark, emitEvent, onPendingConsumed } from './registry.js'
export type { PendingConfirmation } from './confirm.js'
export type { ConfirmQueue } from './confirm-queue.js'
export { createConfirmQueue } from './confirm-queue.js'
export type { FieldInfo, FormAdapter, FormToolOptions, OptionsProvider } from './forms/types.js'
export { createFormTools } from './forms/form-tools.js'
export type { ArrayOp, FlattenOptions } from './forms/paths.js'
export { flatten, getPath, setPath } from './forms/paths.js'
export { fromJsonSchema } from './json-schema/from-json-schema.js'
