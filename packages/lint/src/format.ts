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

// C0 controls (incl. ESC, CR, LF), DEL, C1 controls, and the Unicode bidi embedding/override/
// isolate marks: none belongs in a lint line, and page-supplied tool names/titles/descriptions
// (from `--url`, or a `--manifest` file) must never drive the reader's terminal.
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g

/** Removes {@link UNSAFE_CHARS} from `s`. */
export function stripControlChars(s: string): string {
  return s.replace(UNSAFE_CHARS, '')
}

function sanitize(f: Finding): Finding {
  const out: Finding = {
    rule: stripControlChars(f.rule),
    severity: f.severity,
    message: stripControlChars(f.message),
  }
  if (f.tool !== undefined) out.tool = stripControlChars(f.tool)
  if (f.page !== undefined) out.page = stripControlChars(f.page)
  if (f.score !== undefined) out.score = f.score
  return out
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
      const toolPart = f.tool !== undefined ? ` ${f.tool}` : ''
      lines.push(`${f.severity} ${f.rule} ${page}${toolPart}: ${f.message}`)
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
 * Every printed string field is first stripped of control characters ({@link stripControlChars}).
 */
export function formatFindings(findings: readonly Finding[], format: LintFormat): string {
  const safe = findings.map(sanitize)
  return format === 'json' ? formatJson(safe) : formatPretty(safe)
}
