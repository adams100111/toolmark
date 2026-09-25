import type { Finding } from '../types.js'
import type { Rule } from './rule.js'

/** `llm-name-collision` (error): two tools on the same page share an `llmName`. */
export const llmNameCollision: Rule = {
  id: 'llm-name-collision',
  check(file): Finding[] {
    const byLlmName = new Map<string, string[]>()
    for (const tool of file.tools) {
      const names = byLlmName.get(tool.llmName) ?? []
      names.push(tool.name)
      byLlmName.set(tool.llmName, names)
    }
    const findings: Finding[] = []
    for (const [llmName, names] of byLlmName) {
      if (names.length < 2) continue
      for (const name of names) {
        const others = names.filter((n) => n !== name)
        findings.push({
          rule: 'llm-name-collision',
          severity: 'error',
          tool: name,
          page: file.page,
          message: `llmName "${llmName}" is also used by ${others.join(', ')}`,
        })
      }
    }
    return findings
  },
}
