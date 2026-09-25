import type { Finding } from '../types.js'
import type { Rule } from './rule.js'

/** Minimum trimmed `description` length before `description-short` warns. */
const MIN_LENGTH = 20

/**
 * `description-short` (warn): a nonempty, trimmed `description` shorter than {@link MIN_LENGTH}
 * characters. Never fires alongside `description-missing` (that covers the empty case).
 */
export const descriptionShort: Rule = {
  id: 'description-short',
  check(file): Finding[] {
    const findings: Finding[] = []
    for (const tool of file.tools) {
      const trimmed = tool.description.trim()
      if (trimmed.length > 0 && trimmed.length < MIN_LENGTH) {
        findings.push({
          rule: 'description-short',
          severity: 'warn',
          tool: tool.name,
          page: file.page,
          message: `tool "${tool.name}" description is shorter than ${MIN_LENGTH} characters`,
        })
      }
    }
    return findings
  },
}
