import type { Finding } from '../types.js'
import type { Rule } from './rule.js'

/** Words that suggest a tool has effects the user should approve (Task 3 brief, exact list). */
const CONSEQUENTIAL_RE =
  /\b(delete|remove|archive|destroy|drop|cancel|refund|pay|charge|submit|send|publish|approve|reject)\b/i

/** The first sentence of `description` (up to and including the first `.`/`!`/`?`, or all of it). */
function firstSentence(description: string): string {
  const match = /^[^.!?]*[.!?]?/.exec(description.trim())
  return match ? match[0] : description
}

/**
 * `consequential-hint-missing` (error): {@link CONSEQUENTIAL_RE} matches a `name` segment (split
 * on `.`, `_`, `-`) or the first sentence of `description`, and the tool has neither
 * `consequential` nor `destructive`. Tools with `readOnly: true` are exempt.
 */
export const consequentialHintMissing: Rule = {
  id: 'consequential-hint-missing',
  check(file): Finding[] {
    const findings: Finding[] = []
    for (const tool of file.tools) {
      if (tool.hints.readOnly === true) continue
      if (tool.hints.consequential === true || tool.hints.destructive === true) continue
      const segments = tool.name.split(/[._-]/)
      const matches =
        segments.some((segment) => CONSEQUENTIAL_RE.test(segment)) ||
        CONSEQUENTIAL_RE.test(firstSentence(tool.description))
      if (!matches) continue
      findings.push({
        rule: 'consequential-hint-missing',
        severity: 'error',
        tool: tool.name,
        page: file.page,
        message: `tool "${tool.name}" looks consequential but has neither "consequential" nor "destructive" set`,
      })
    }
    return findings
  },
}
