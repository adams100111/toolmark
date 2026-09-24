import { expect as baseExpect } from '@playwright/test'
import type { FieldChange, ToolManifestSummary, ToolResult } from '@toolmark/core'
import type { ToolsFixture } from './fixture.js'

function fieldEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return false
  }
}

function changesOf(result: ToolResult<unknown>): FieldChange[] {
  if (result.status !== 'ok') return []
  const data = result.data as { changes?: unknown } | undefined
  return Array.isArray(data?.changes) ? (data.changes as FieldChange[]) : []
}

/**
 * `@toolmark/testing`'s matchers, merged onto `@playwright/test`'s `expect`: `toHaveTools`,
 * `toBeConsequential`, `toBeReadOnly`, `toHaveChanged`.
 */
export const expect = baseExpect.extend({
  /** Asserts the fixture's `test`-caller manifest includes every name in `names` (a subset check). */
  async toHaveTools(tools: ToolsFixture, names: string[]) {
    const list = await tools.list()
    const have = new Set(list.map((t) => t.name))
    const missing = names.filter((n) => !have.has(n))
    const pass = missing.length === 0
    return {
      pass,
      message: () =>
        pass
          ? `expected the manifest not to include ${this.utils.printExpected(names)}`
          : `expected the manifest to include ${this.utils.printExpected(names)}\n` +
            `missing: ${this.utils.printReceived(missing)}\n` +
            `has: ${this.utils.printReceived([...have])}`,
    }
  },

  /** Asserts a manifest entry has `hints.consequential === true`. */
  toBeConsequential(entry: ToolManifestSummary) {
    const pass = entry?.hints?.consequential === true
    return {
      pass,
      message: () =>
        `expected "${entry?.name}" ${pass ? 'not ' : ''}to be consequential ` +
        `(hints: ${this.utils.printReceived(entry?.hints)})`,
    }
  },

  /** Asserts a manifest entry has `hints.readOnly === true`. */
  toBeReadOnly(entry: ToolManifestSummary) {
    const pass = entry?.hints?.readOnly === true
    return {
      pass,
      message: () =>
        `expected "${entry?.name}" ${pass ? 'not ' : ''}to be readOnly ` +
        `(hints: ${this.utils.printReceived(entry?.hints)})`,
    }
  },

  /** Asserts an `ok` result's `data.changes` contains `{ path, after }`. */
  toHaveChanged(result: ToolResult<unknown>, path: string, after: unknown) {
    const changes = changesOf(result)
    const pass = changes.some((c) => c.path === path && fieldEqual(c.after, after))
    return {
      pass,
      message: () =>
        `expected changes ${pass ? 'not ' : ''}to include ` +
        `${this.utils.printExpected({ path, after })}\n` +
        `received: ${this.utils.printReceived(changes)}`,
    }
  },
})
