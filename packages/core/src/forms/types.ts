import type { FileFieldSpec } from '../files.js'
import type { ToolResult } from '../result.js'
import type { StandardSchemaV1 } from '../standard-schema.js'
import type { JsonSchema, ToolHints, ToolOrigin } from '../tool.js'

/** A form field as the adapter knows it (labels and elements drive anchors and redaction). */
export interface FieldInfo {
  /** Dot path of the field. */
  path: string
  /** User-facing label. */
  label?: string
  /** The field's element, if mounted (password / `cc-*` elements are redacted). */
  element?: Element | null
  /** Always redact this field's values. */
  sensitive?: boolean
}

/**
 * Bridges a form library to form tools (spec §8.1). Overwrite decisions, validation and undo live in
 * the form-tool core, not the adapter.
 */
export interface FormAdapter<V extends Record<string, unknown> = Record<string, unknown>> {
  /** Current values. */
  getValues(): V
  /**
   * Writes values by flat dot path; `null` clears a field.
   * @param values - Flat `{ path: value }` map.
   * @param opts - Who writes: the agent (`fill`) or an undo.
   */
  setValues(values: Record<string, unknown>, opts: { source: 'agent' | 'undo' }): void
  /**
   * Dot paths the user (or the agent) has changed since load. Returns LEAF paths only (never a
   * parent object path): adapters must flatten nested dirty state.
   */
  dirtyPaths(): string[]
  /** Submits the form. */
  submit(): Promise<ToolResult<unknown>>
  /** Known fields. */
  fields(): FieldInfo[]
  /**
   * Subscribes to user-originated interactions with the form (tour hooks, spec §13). Adapters call
   * `cb` only for trusted user events (`isTrusted`, or the form library's own user-change signal),
   * never for their own `setValues`/`submit`, and pass the field's dot path only, never its value.
   * `kind: 'submit'` uses `path: ''`. Form tools subscribe once while registered and turn each call
   * into an `interaction` event.
   * @param cb - Receives `{ path, kind }` per interaction: `path` is the field's dot path (`''` for
   * a whole-form `submit`); `kind` is `input` (the user changed a value), `focus` or `submit`.
   * @returns An unsubscribe function.
   */
  onUserInteraction?(
    cb: (e: { path: string; kind: 'input' | 'focus' | 'submit' }) => void,
  ): () => void
}

/**
 * Looks up candidate values for a form field (spec §8.3). Receives the agent's search `query`
 * (`''` when none) and a `signal` that aborts on call cancellation or after 10 seconds. Items that
 * are not `{ value: string | number | boolean, title: string }` are dropped; at most 50 are
 * returned to the agent.
 */
export type OptionsProvider = (args: {
  query: string
  signal: AbortSignal
}) => Promise<Array<{ value: string | number | boolean; title: string }>>

/** Options for {@link createFormTools}. */
export interface FormToolOptions<V> {
  /** Tool name prefix: registers `<name>.fill` and `<name>.submit`. */
  name: string
  /** LLM-facing description of the form. */
  description: string
  /** User-facing title (used in the submit confirmation summary). */
  title?: string
  /** Schema of the full form values. */
  input: StandardSchemaV1<unknown, V>
  /** JSON Schema override for the form values. */
  jsonSchema?: JsonSchema
  /** User-facing submit confirmation summary. */
  submitSummary?: (values: V) => string
  /**
   * Dot paths whose values are always redacted (spec §14): in fill `changes`, confirmation
   * payloads and `state()`. Together with `FieldInfo.sensitive` and password / `cc-*` elements it
   * forms the tools' `sensitivePaths` (`tm.info(name).sensitivePaths`). `[]` stands for any array
   * index (`cards[].cvc`); such a pattern is published as given plus its current concrete paths
   * (`cards.0.cvc`, …). A field seen sensitive by its element stays sensitive for the tools'
   * lifetime (a "show password" toggle never exposes it), but a field is only known to be
   * sensitive once an element has reported it: adapters without elements (e.g. `rhfAdapter`
   * without `root`/`elementFor`) need their secret paths declared here.
   *
   * Issue messages in `state()` are not redacted: schemas must not echo sensitive values in
   * their messages.
   */
  sensitive?: string[]
  /**
   * Async option lookups by field (spec §8.3). Keys are dot paths; `[]` stands for any array
   * index (`sponsors[].memberId`). When non-empty, `<name>.options({ field, query? })` is
   * registered (`readOnly`, `untrustedContent`) and the `fill` schema tells the agent to use it.
   */
  options?: Record<string, OptionsProvider>
  /**
   * File fields (spec §8.4, D27). Keys are dot paths; `[]` stands for any array index
   * (`attachments[].file`). The agent fills them with a `FileRef` (`{ ref }` / `{ url }`, an array
   * of them when `multiple`); each is resolved through the registry's `files` options, checked
   * against the field limits (narrowed by `files.maxBytes`), and the resolved `File` (`File[]`) is
   * written through `adapter.setValues`. Any failure refuses the whole fill `file_rejected` with
   * nothing set. `changes` report files as `{ file: { name, size, type } }`. The form's JSON Schema
   * is derived with `unrepresentable: 'any'` (so `z.instanceof(File)` converts) and each file path
   * is advertised as `fileFieldSchema(spec)`. An invalid spec is `files_misconfigured` (dev throw;
   * production: event, no tools registered).
   */
  files?: Record<string, FileFieldSpec>
  /**
   * @internal Origin of every registered tool (`.fill`, `.submit`, `.options`); unset = `code`.
   * Set by the DOM scanner (`dom` / `native-form`).
   */
  origin?: ToolOrigin
  /**
   * @internal `nativeName` of `.fill` / `.submit` (a `native-form` form's `toolname`, so WebMCP
   * can skip tools the browser already serves). `.options` never gets one.
   */
  nativeName?: { fill?: string; submit?: string }
  /**
   * @internal Hint overrides: `fill` is merged into the fill tool's hints; `submit` REPLACES the
   * submit tool's default `{ consequential: true }` (the scanner uses it for `toolautosubmit`,
   * `data-tool-destructive` and `untrustedContent`).
   */
  hints?: { fill?: ToolHints; submit?: ToolHints }
}
