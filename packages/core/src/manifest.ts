import type { JsonSchema, ToolHints } from './tool.js'

/** Summary manifest entry (what an agent sees up front; D21). */
export interface ToolManifestSummary {
  /** Full tool name. */
  name: string
  /** LLM-safe name (`.` → `__`, hashed when longer than 64). */
  llmName: string
  /** User-facing title. */
  title?: string
  /** LLM-facing description. */
  description: string
  /** Behaviour hints. */
  hints: ToolHints
  /** `stepwise` for stepwise wizards (M2). */
  mode?: 'stepwise'
}

/** Full manifest entry, as returned by `describe` (D21). */
export interface ToolManifest extends ToolManifestSummary {
  /** Input JSON Schema (`{}` when conversion failed in production). */
  inputSchema: JsonSchema
  /** Output JSON Schema, when the output schema provides one. */
  outputSchema?: JsonSchema
}

/** @internal Data the registry keeps per tool for manifests. */
export interface ManifestSource {
  name: string
  llmName: string
  title: string | undefined
  description: string
  hints: ToolHints | undefined
  mode?: 'stepwise'
  inputSchema: JsonSchema
  outputSchema: JsonSchema | undefined
}

function copyHints(hints: ToolHints | undefined): ToolHints {
  const out: ToolHints = {}
  if (!hints) return out
  for (const key of ['readOnly', 'consequential', 'destructive', 'untrustedContent'] as const) {
    const v = hints[key]
    if (typeof v === 'boolean') out[key] = v
  }
  return out
}

/** @internal Builds a JSON-safe summary entry (no `undefined` fields). */
export function buildSummaryEntry(src: ManifestSource): ToolManifestSummary {
  const entry: ToolManifestSummary = {
    name: src.name,
    llmName: src.llmName,
    description: src.description,
    hints: copyHints(src.hints),
  }
  if (src.title !== undefined) entry.title = src.title
  if (src.mode !== undefined) entry.mode = src.mode
  return entry
}

/** @internal Builds a JSON-safe full entry. */
export function buildManifestEntry(src: ManifestSource): ToolManifest {
  const entry: ToolManifest = {
    ...buildSummaryEntry(src),
    inputSchema: structuredClone(src.inputSchema),
  }
  if (src.outputSchema !== undefined) entry.outputSchema = structuredClone(src.outputSchema)
  return entry
}
