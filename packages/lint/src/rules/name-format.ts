import type { Finding } from '../types.js'
import type { Rule } from './rule.js'

/** `ToolManifestSummary.name` grammar (Task 3 brief). */
const NAME_RE = /^[A-Za-z0-9_.-]{1,128}$/
/** `ToolManifestSummary.llmName` grammar (Task 3 brief). */
const LLM_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/

function hasEmptySegment(name: string): boolean {
  return name.split('.').some((segment) => segment.length === 0)
}

/**
 * `name-format` (error): a tool's `name` fails {@link NAME_RE}, has an empty segment (`..`, a
 * leading `.` or a trailing `.`), or its `llmName` fails {@link LLM_NAME_RE}.
 */
export const nameFormat: Rule = {
  id: 'name-format',
  check(file): Finding[] {
    const findings: Finding[] = []
    for (const tool of file.tools) {
      const validName = NAME_RE.test(tool.name) && !hasEmptySegment(tool.name)
      const validLlmName = LLM_NAME_RE.test(tool.llmName)
      if (validName && validLlmName) continue
      findings.push({
        rule: 'name-format',
        severity: 'error',
        tool: tool.name,
        page: file.page,
        message: validName
          ? `llmName "${tool.llmName}" must match ${LLM_NAME_RE}`
          : `name "${tool.name}" must match ${NAME_RE} with no empty segment`,
      })
    }
    return findings
  },
}
