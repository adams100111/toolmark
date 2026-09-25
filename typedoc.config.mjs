// TypeDoc options for the generated API reference (docs/api, git-ignored).
// Entry points come from every package's `exports` map (`@toolmark/source` targets), so a new
// subpath can never be missed. Validation is non-strict through M4 (R5); `pnpm docs:api:strict`
// (TYPEDOC_STRICT=1) turns `notExported`/`notDocumented` on and becomes the default in M5.
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const strict = process.env.TYPEDOC_STRICT === '1'

/** Every `@toolmark/source` target in `packages/<name>/package.json` `exports`. */
function entryPointsFrom(packagesDir) {
  const entries = []
  for (const dir of readdirSync(packagesDir).sort()) {
    const manifestPath = join(packagesDir, dir, 'package.json')
    if (!existsSync(manifestPath)) continue
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const found = Object.values(manifest.exports ?? {})
      .filter((target) => target !== null && typeof target === 'object')
      .map((target) => target['@toolmark/source'])
      .filter((source) => typeof source === 'string')
      .map((source) => join(packagesDir, dir, source))
    if (found.length === 0) {
      throw new Error(`typedoc: ${manifest.name ?? dir} has no "@toolmark/source" export target`)
    }
    entries.push(...found)
  }
  return entries
}

/** @type {Partial<import('typedoc').TypeDocOptions> & Record<string, unknown>} */
export default {
  entryPointStrategy: 'resolve',
  entryPoints: entryPointsFrom('packages'),
  tsconfig: 'tsconfig.docs.json',
  plugin: ['typedoc-plugin-markdown', 'typedoc-vitepress-theme'],
  out: 'docs/api',
  readme: 'none',
  docsRoot: 'docs',
  sidebar: { autoConfiguration: true, format: 'vitepress', collapsed: true },
  excludePrivate: true,
  excludeInternal: true,
  treatWarningsAsErrors: true,
  // Packages type-check separately (`pnpm typecheck`); compiled together here, lint's private
  // `__toolmark_test__` global declaration conflicts with @toolmark/testing's (ruling, M4 T7).
  skipErrorChecking: false,
  validation: { invalidLink: true, notExported: strict, notDocumented: strict },
}
