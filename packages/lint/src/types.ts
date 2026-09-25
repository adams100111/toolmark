import type { ToolManifest } from '@toolmark/core'

/**
 * One lint finding: a rule violation, or an informational note from a {@link Judge}. `tool` and
 * `page` are omitted when a finding is not scoped to one (e.g. `judge-failed`).
 */
export interface Finding {
  /** Rule id, e.g. `"name-format"`, or `"judge/description-quality"` for judge findings. */
  rule: string
  /** `"error"` fails the CLI (exit 1); `"warn"` never does. */
  severity: 'error' | 'warn'
  /** Full name of the offending tool, when the finding is scoped to one. */
  tool?: string
  /** The page the finding was found on. */
  page?: string
  /** Human-readable explanation. */
  message: string
  /** A judge's numeric score backing the finding (e.g. `judge/description-quality`). */
  score?: number
}

/** One page's tool manifest, as read from a `--manifest` file or collected via `--url`. */
export interface ManifestFile {
  /** The page's identity: the collected URL, the file's declared `page`, or its basename. */
  page: string
  /** The page's tools, in full-manifest detail. */
  tools: ToolManifest[]
}

/** A lint plugin that inspects a page's tools and returns findings (e.g. the TypeSafe judge). */
export interface Judge {
  /** Identifies the judge in `judge-failed` findings. */
  name: string
  /** Inspects one page's tools and returns its findings. Never mutates `input`. */
  judge(input: { page: string; tools: ToolManifest[] }): Promise<Finding[]>
}
