/**
 * `@toolmark/lint` — Programmatic API of the `toolmark lint` manifest linter.
 * @packageDocumentation
 * @module @toolmark/lint
 */
export { formatFindings, type LintFormat } from './format.js'
export { lint, type LintOptions } from './run.js'
export type { Finding, Judge, ManifestFile } from './types.js'
