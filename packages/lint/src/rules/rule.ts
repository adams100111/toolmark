import type { Finding, ManifestFile } from '../types.js'

/** Context shared by every built-in rule. */
export interface RuleContext {
  /** Maximum tools per page before `tool-budget` warns (`--budget`, default 40). */
  budget: number
}

/** A built-in lint rule: inspects one page's manifest and returns its findings. */
export interface Rule {
  /** The rule id used in {@link Finding.rule}. */
  id: string
  /** Returns every finding this rule raises for `file`. Never mutates `file`. */
  check(file: ManifestFile, ctx: RuleContext): Finding[]
}
