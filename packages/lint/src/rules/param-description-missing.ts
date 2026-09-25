import { fillStartPoints, walkLeaves } from '../schema-walk.js'
import type { Finding } from '../types.js'
import type { Rule } from './rule.js'

function hasDescription(node: Record<string, unknown>): boolean {
  const description = node['description']
  return typeof description === 'string' && description.trim().length > 0
}

/**
 * `param-description-missing` (warn): a leaf property of `inputSchema` without a `description`.
 * For `.fill` tools the walk starts at `properties.values`, or per wizard step at
 * `properties.steps.properties.<step>` (Task 3 brief); `message` names the dot path.
 */
export const paramDescriptionMissing: Rule = {
  id: 'param-description-missing',
  check(file): Finding[] {
    const findings: Finding[] = []
    for (const tool of file.tools) {
      for (const { node, prefix } of fillStartPoints(tool)) {
        walkLeaves(node, prefix, (leaf) => {
          if (leaf.path === '') return // the start point itself carries no field path
          if (hasDescription(leaf.node)) return
          findings.push({
            rule: 'param-description-missing',
            severity: 'warn',
            tool: tool.name,
            page: file.page,
            message: `parameter "${leaf.path}" has no description`,
          })
        })
      }
    }
    return findings
  },
}
