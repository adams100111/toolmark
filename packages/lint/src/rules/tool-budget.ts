import type { Finding } from '../types.js'
import type { Rule } from './rule.js'

/** `tool-budget` (warn): a page's tool count exceeds `ctx.budget` (`--budget`, default 40). */
export const toolBudget: Rule = {
  id: 'tool-budget',
  check(file, ctx): Finding[] {
    if (file.tools.length <= ctx.budget) return []
    return [
      {
        rule: 'tool-budget',
        severity: 'warn',
        page: file.page,
        message: `page has ${file.tools.length} tools, budget is ${ctx.budget}`,
      },
    ]
  },
}
