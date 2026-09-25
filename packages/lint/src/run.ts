import { rules } from './rules/index.js'
import type { Finding, Judge, ManifestFile } from './types.js'

/** Default `--budget` / `tool-budget` threshold (Task 3 brief, M1 constraints). */
const DEFAULT_BUDGET = 40

/** Options for {@link lint}. */
export interface LintOptions {
  /** The pages to lint (from `--manifest` files and/or `--url` collection). */
  manifests: ManifestFile[]
  /** Optional lint plugins (e.g. the TypeSafe judge) run after the built-in rules. */
  judges?: Judge[]
  /** Maximum tools per page before `tool-budget` warns. Default `40`. */
  budget?: number
}

/**
 * Runs every built-in rule, then every judge, over `manifests` and returns all findings. A judge
 * that throws never fails the run: its error becomes one `warn` finding with rule `judge-failed`
 * naming the judge and the error.
 */
export async function lint(o: LintOptions): Promise<Finding[]> {
  const ctx = { budget: o.budget ?? DEFAULT_BUDGET }
  const findings: Finding[] = []

  for (const file of o.manifests) {
    for (const rule of rules) {
      findings.push(...rule.check(file, ctx))
    }
  }

  for (const judge of o.judges ?? []) {
    for (const file of o.manifests) {
      try {
        findings.push(...(await judge.judge({ page: file.page, tools: file.tools })))
      } catch (e) {
        findings.push({
          rule: 'judge-failed',
          severity: 'warn',
          page: file.page,
          message: `judge "${judge.name}" failed: ${e instanceof Error ? e.message : String(e)}`,
        })
      }
    }
  }

  return findings
}
