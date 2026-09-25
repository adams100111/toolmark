import type { Finding } from '../types.js'
import type { Rule } from './rule.js'

/** `description-missing` (warn): a tool's `description` is empty or whitespace. */
export const descriptionMissing: Rule = {
  id: 'description-missing',
  check(file): Finding[] {
    const findings: Finding[] = []
    for (const tool of file.tools) {
      if (tool.description.trim().length === 0) {
        findings.push({
          rule: 'description-missing',
          severity: 'warn',
          tool: tool.name,
          page: file.page,
          message: `tool "${tool.name}" has no description`,
        })
      }
    }
    return findings
  },
}
