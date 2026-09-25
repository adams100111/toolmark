import type { Finding } from './types.js'

/** Output formats accepted by `--format` (Task 3 brief; default `'pretty'`). */
export type LintFormat = 'pretty' | 'json'

function summaryOf(findings: readonly Finding[]): { errors: number; warnings: number } {
  let errors = 0
  let warnings = 0
  for (const f of findings) {
    if (f.severity === 'error') errors++
    else warnings++
  }
  return { errors, warnings }
}

function formatPretty(findings: readonly Finding[]): string {
  const byPage = new Map<string, Finding[]>()
  for (const f of findings) {
    const page = f.page ?? ''
    const group = byPage.get(page)
    if (group) group.push(f)
    else byPage.set(page, [f])
  }
  const lines: string[] = []
  for (const [page, group] of byPage) {
    for (const f of group) {
      lines.push(`${f.severity} ${f.rule} ${page} ${f.tool ?? ''}: ${f.message}`)
    }
  }
  const { errors, warnings } = summaryOf(findings)
  lines.push(`${errors} error(s), ${warnings} warning(s)`)
  return lines.join('\n')
}

function formatJson(findings: readonly Finding[]): string {
  return JSON.stringify({ findings, summary: summaryOf(findings) })
}

/**
 * Renders `findings` as `pretty` (one line per finding, grouped by page, then a summary line) or
 * `json` (`{ findings, summary: { errors, warnings } }`), per the Task 3 brief's exact shapes.
 */
export function formatFindings(findings: readonly Finding[], format: LintFormat): string {
  return format === 'json' ? formatJson(findings) : formatPretty(findings)
}
