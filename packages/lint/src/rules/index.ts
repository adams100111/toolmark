import { consequentialHintMissing } from './consequential-hint-missing.js'
import { descriptionMissing } from './description-missing.js'
import { descriptionShort } from './description-short.js'
import { llmNameCollision } from './llm-name-collision.js'
import { nameFormat } from './name-format.js'
import { optionsWithoutHint } from './options-without-hint.js'
import { paramDescriptionMissing } from './param-description-missing.js'
import type { Rule } from './rule.js'
import { schemaInvalid } from './schema-invalid.js'
import { toolBudget } from './tool-budget.js'

export type { Rule, RuleContext } from './rule.js'

/** Every built-in rule (Task 3 brief, exact ids), run in this order by `lint()`. */
export const rules: Rule[] = [
  nameFormat,
  descriptionMissing,
  descriptionShort,
  paramDescriptionMissing,
  schemaInvalid,
  llmNameCollision,
  toolBudget,
  consequentialHintMissing,
  optionsWithoutHint,
]
