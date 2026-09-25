import type { FileRef } from './files.js'
import type { FieldChange, ToolResult } from './result.js'
import type { StandardSchemaV1 } from './standard-schema.js'

/** Who is calling a tool. `human` is the app's own UI (e.g. an approved confirmation). */
export type Caller = 'inapp' | 'webmcp' | 'mcp' | 'test' | 'tour' | 'human'

/**
 * Where a tool came from (spec §5): app code (`'code'`, the default), a native declarative
 * `toolname` form (`'native-form'`), the DOM scanner (`'dom'`) or a server declaration
 * (`'server'`). Read through `tm.info(name)`; never part of a manifest.
 */
export type ToolOrigin = 'code' | 'native-form' | 'dom' | 'server'

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

/**
 * Where a tool can be pointed at on the page (tour hooks, spec §13), read through `tm.anchor`.
 * With a param, `tm.anchor` tries a `tm.setAnchor` override, then `params[param]`, then
 * `resolve(param)`, then gives `null`; without one, an override, then `element()`, then `null`.
 * Any `Element` works, including SVG and custom elements.
 */
export interface AnchorSpec {
  /** The tool's element. */
  element?: () => Element | null
  /** Per-parameter elements, keyed by input path (own keys only). */
  params?: Record<string, () => Element | null>
  /**
   * Fallback for params not in `params` (or whose `params` entry returned `null`), e.g. dynamic
   * array paths such as `items.2.qty`.
   */
  resolve?: (param: string) => Element | null
}

/**
 * Side-effect-free snapshot of a tool's current state (spec §13), read through `tm.state`.
 *
 * Redaction is owned by the tool that produces the state: `values` must already have every
 * sensitive path (see {@link ToolDefinition.sensitivePaths}) replaced by `'[redacted]'`, and must
 * never contain fields the tool does not expose at all (e.g. excluded DOM controls). Form and wizard
 * tools do this for their own state; a custom `state()` is responsible for its own values.
 */
export interface ToolState<I> {
  /** Current values. */
  values: Partial<I>
  /** Current validation issues. */
  issues: { path: string; message: string }[]
  /** Current wizard step, if any. */
  step?: string
}

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
  /**
   * File resolution (D27, spec §8.4) under the registry's `files` options and limits. Rejects with
   * `ToolmarkError('file_rejected')` (a `{ ref }` without `files.resolve`, a URL that is not
   * allowed, a size/type violation, …); a tool that lets it propagate returns `refused`
   * `file_rejected` with the message.
   */
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
  /** Tour anchors, read through `tm.anchor`. */
  anchors?: AnchorSpec
  /** Synchronous, side-effect-free state snapshot, read through `tm.state`. */
  state?: () => ToolState<I>
  /**
   * Input paths whose values are sensitive (passwords, `cc-*` fields, app-declared ones), evaluated
   * on every read. Surfaced as `tm.info(name).sensitivePaths` so `state()` and telemetry share one
   * redaction rule (spec §14). Never part of a manifest. The registry does not redact `state()`
   * with it: the tool's own `state()` must (form and wizard tools do).
   */
  sensitivePaths?: () => string[]
  /** `'stepwise'` marks a stepwise wizard's tools; reported in manifest entries (spec §8.2). */
  mode?: 'stepwise'
  /** Where the tool came from (default `'code'`); read via `tm.info`, never in a manifest. */
  origin?: ToolOrigin
  /**
   * For `origin: 'native-form'`: the form's `toolname`, so consumers that the browser already
   * serves natively (WebMCP) can skip the tool. Read via `tm.info`, never in a manifest.
   */
  nativeName?: string
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
