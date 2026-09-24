import type { ToolResult } from '../result.js'
import type { StandardSchemaV1 } from '../standard-schema.js'
import type { JsonSchema } from '../tool.js'

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
  /** Dot paths the user (or the agent) has changed since load. */
  dirtyPaths(): string[]
  /** Submits the form. */
  submit(): Promise<ToolResult<unknown>>
  /** Known fields. */
  fields(): FieldInfo[]
}

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
  /** Dot paths whose values are always redacted (spec §14). */
  sensitive?: string[]
}
