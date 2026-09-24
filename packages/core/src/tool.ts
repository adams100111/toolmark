import type { FieldChange, ToolResult } from './result.js'
import type { StandardSchemaV1 } from './standard-schema.js'

/** Who is calling a tool. `human` is the app's own UI (e.g. an approved confirmation). */
export type Caller = 'inapp' | 'webmcp' | 'mcp' | 'test' | 'tour' | 'human'

/** A JSON Schema document (draft 2020-12) as a plain object. */
export type JsonSchema = Record<string, unknown>

/**
 * Behaviour hints. They drive default exposure and confirmation (spec §7):
 * `readOnly` never confirms; `consequential` and `destructive` require confirmation unless the
 * caller is `human`; `untrustedContent` marks results that carry page/user content.
 */
export interface ToolHints {
  /** The tool does not change state. */
  readOnly?: boolean
  /** The tool changes state in a way the user should confirm. */
  consequential?: boolean
  /** The tool deletes or irreversibly changes data. */
  destructive?: boolean
  /** Results contain page or user content (prompt-injection surface). */
  untrustedContent?: boolean
}

/** Where a tool can be pointed at on the page (tour hooks, spec §13). Behaviour lands in M3. */
export interface AnchorSpec {
  /** The tool's element. */
  element?: () => Element | null
  /** Per-parameter elements. */
  params?: Record<string, () => Element | null>
}

/** Side-effect-free snapshot of a tool's current state (spec §13). Behaviour lands in M3. */
export interface ToolState<I> {
  /** Current values. */
  values: Partial<I>
  /** Current validation issues. */
  issues: { path: string; message: string }[]
  /** Current wizard step, if any. */
  step?: string
}

/** A reference to a file an agent wants to hand to a tool (D27). Implemented in M2. */
export type FileRef = { ref: string } | { url: string }

/** Outcome of a confirmation: approved (optionally with edited input) or rejected. */
export type ConfirmOutcome =
  { approved: true; input?: unknown } | { approved: false; reason?: string }

/** Per-call context passed to {@link ToolDefinition.run}. */
export interface ToolContext {
  /** Aborted when the caller cancels or the registry abandons the call. */
  signal: AbortSignal
  /** Unique id of this call (also the undo key). */
  callId: string
  /** Who is calling. */
  caller: Caller
  /**
   * Ask for confirmation from inside `run`. `human` → approved; inline-mode caller → awaits the
   * inline handler; otherwise `{ approved: false, reason: 'confirmation_unavailable' }`. Never throws.
   */
  confirm(req: { summary: string; changes?: FieldChange[] }): Promise<ConfirmOutcome>
  /** Store a restorer for `tm.undo(callId)`. */
  registerUndo(restore: () => ToolResult<unknown> | Promise<ToolResult<unknown>>): void
  /** File resolution (D27). In M1 it rejects with `ToolmarkError('files_not_configured')`. */
  files: { resolve(ref: FileRef): Promise<File> }
}

/**
 * A tool declaration (spec §5). `name` is the local name; the full name is the scope path + `.` +
 * `name`.
 */
export interface ToolDefinition<I = unknown, O = unknown> {
  /** Local name (`A–Z a–z 0–9 _ - .`). */
  name: string
  /** User-facing, app-localized title. */
  title?: string
  /** For the LLM: what the tool does and when to use it. */
  description: string
  /** Input schema (Standard Schema v1). Input is validated before `run`. */
  input?: StandardSchemaV1<unknown, I>
  /** Output schema; validated in development only. */
  output?: StandardSchemaV1<unknown, O>
  /** Per-tool JSON Schema override for the input (D14). */
  jsonSchema?: JsonSchema
  /** Behaviour hints. */
  hints?: ToolHints
  /** User-facing one-liner for confirmation cards. */
  summary?: (input: I) => string
  /** Tour anchors (behaviour in M3). */
  anchors?: AnchorSpec
  /** State snapshot (behaviour in M3). */
  state?: () => ToolState<I>
  /** Runs the tool with validated input. Never needs to throw: return a {@link ToolResult}. */
  run(input: I, ctx: ToolContext): ToolResult<O> | Promise<ToolResult<O>>
}

/**
 * Identity helper that infers `I`/`O` from the schemas.
 * @param def - The tool declaration.
 * @returns `def` unchanged.
 */
export function defineTool<I, O>(def: ToolDefinition<I, O>): ToolDefinition<I, O> {
  return def
}
