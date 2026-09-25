import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const srcDir = resolve(here, '../src')

// Matches both `import … from '…'` and `export … from '…'` specifiers.
const IMPORT_RE = /(?:import|export)\s+(?:type\s+)?(?:[^'";]*?from\s+)?['"]([^'"]+)['"]/g

function importSpecifiers(file: string): string[] {
  const text = readFileSync(file, 'utf8')
  const specs: string[] = []
  for (const m of text.matchAll(IMPORT_RE)) {
    const spec = m[1]
    if (spec) specs.push(spec)
  }
  return specs
}

function toSourceFile(fromFile: string, spec: string): string {
  const raw = resolve(dirname(fromFile), spec)
  return raw.endsWith('.js') ? `${raw.slice(0, -3)}.ts` : raw
}

/** Transitive, relative-only import graph of `entry` (bare specifiers are recorded, not followed). */
function collectGraph(entry: string): { files: Set<string>; specifiers: Set<string> } {
  const files = new Set<string>()
  const specifiers = new Set<string>()
  const stack = [entry]
  while (stack.length > 0) {
    const file = stack.pop()
    if (!file || files.has(file)) continue
    files.add(file)
    for (const spec of importSpecifiers(file)) {
      specifiers.add(spec)
      if (spec.startsWith('.')) stack.push(toSourceFile(file, spec))
    }
  }
  return { files, specifiers }
}

describe('vitest entry', () => {
  it('vitest_entry_has_no_playwright_import', () => {
    const { specifiers } = collectGraph(resolve(srcDir, 'vitest.ts'))
    expect(specifiers).not.toContain('@playwright/test')
    for (const spec of specifiers) {
      expect(spec.startsWith('@playwright/')).toBe(false)
    }
  })
})
