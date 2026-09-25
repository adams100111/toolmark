import { fillStartPoints, walkLeaves } from '../schema-walk.js'
import type { Finding } from '../types.js'
import type { Rule } from './rule.js'

const OPTIONS_SUFFIX = '.options'
const FILL_SUFFIX = '.fill'

function hintSuffix(form: string): string {
  return `(use ${form}.options to find valid values)`
}

/**
 * `options-without-hint` (warn): a `<form>.options` tool exists on the page and either (a) a
 * field in its `field` enum lacks the description suffix `(use <form>.options to find valid
 * values)` in `<form>.fill`'s schema, or (b) the `.options` tool itself lacks `readOnly: true`.
 */
export const optionsWithoutHint: Rule = {
  id: 'options-without-hint',
  check(file): Finding[] {
    const findings: Finding[] = []
    for (const optionsTool of file.tools) {
      if (!optionsTool.name.endsWith(OPTIONS_SUFFIX)) continue
      const form = optionsTool.name.slice(0, -OPTIONS_SUFFIX.length)

      if (optionsTool.hints.readOnly !== true) {
        findings.push({
          rule: 'options-without-hint',
          severity: 'warn',
          tool: optionsTool.name,
          page: file.page,
          message: `tool "${optionsTool.name}" should be readOnly`,
        })
      }

      const fillTool = file.tools.find((t) => t.name === `${form}${FILL_SUFFIX}`)
      if (!fillTool) continue
      const suffix = hintSuffix(form)
      for (const { node, prefix } of fillStartPoints(fillTool)) {
        walkLeaves(node, prefix, (leaf) => {
          if (!Array.isArray(leaf.node['enum'])) return
          const description = leaf.node['description']
          if (typeof description === 'string' && description.includes(suffix)) return
          findings.push({
            rule: 'options-without-hint',
            severity: 'warn',
            tool: fillTool.name,
            page: file.page,
            message:
              leaf.path === ''
                ? `"${fillTool.name}" should mention "${suffix}" in its description`
                : `field "${leaf.path}" should mention "${suffix}" in its description`,
          })
        })
      }
    }
    return findings
  },
}
