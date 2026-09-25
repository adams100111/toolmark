#!/usr/bin/env node
// `@toolmark/core` has zero runtime dependencies (spec §21; M5 Task 2).
//
//   node scripts/check-zero-deps.mjs [<core-package-dir>]   (default: packages/core; run after build)
//
// Fails when:
//   - the package.json has any `dependencies` entry;
//   - the built root entry (`exports["."].import`), or any local chunk it loads, imports a bare
//     specifier (anything not relative; `node:` builtins included);
//   - any other built JS subpath (or its chunks) imports anything except a declared optional peer
//     (`peerDependencies` + `peerDependenciesMeta.<peer>.optional: true`) or one of its subpaths.
// Prints PASS/FAIL lines and exits 0 or 1.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dir = resolve(process.argv[2] ?? join(repoRoot, 'packages', 'core'))
const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))

// Static `import`/`export … from`, side-effect `import '…'` and dynamic `import('…')`.
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|(?:^|[;\n])\s*import\s*)(["'])([^"'\n]+)\1/g

const problems = []
let checked = 0

/** Every specifier imported by `file` and the local chunks it loads: `[{ file, specifier }]`. */
function importsOf(entry) {
  const seen = new Set()
  const out = []
  const visit = (file) => {
    if (seen.has(file)) return
    seen.add(file)
    if (!existsSync(file)) {
      problems.push(`${relative(dir, file)}: file not found (run the build first)`)
      return
    }
    // Comments are dropped first: emitted TSDoc `@example` blocks contain import statements.
    const code = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    for (const m of code.matchAll(SPECIFIER)) {
      const specifier = m[2]
      if (specifier.startsWith('./') || specifier.startsWith('../')) {
        if (/\.m?js$/.test(specifier)) visit(join(dirname(file), specifier))
      } else {
        out.push({ file, specifier })
      }
    }
  }
  visit(entry)
  return out
}

const packageOf = (specifier) =>
  specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]

const deps = Object.keys(pkg.dependencies ?? {})
if (deps.length > 0) problems.push(`package.json declares dependencies: ${deps.join(', ')}`)

const optionalPeers = new Set(
  Object.keys(pkg.peerDependencies ?? {}).filter(
    (p) => pkg.peerDependenciesMeta?.[p]?.optional === true,
  ),
)

for (const [subpath, value] of Object.entries(pkg.exports ?? {})) {
  const target = typeof value === 'string' ? value : (value?.import ?? value?.default)
  if (typeof target !== 'string' || !/\.m?js$/.test(target) || target.includes('*')) continue
  checked++
  for (const { file, specifier } of importsOf(join(dir, target))) {
    const where = `${subpath === '.' ? 'root entry' : subpath} (${relative(dir, file)})`
    if (subpath === '.') {
      problems.push(`${where} imports bare specifier "${specifier}"`)
    } else if (!optionalPeers.has(packageOf(specifier))) {
      problems.push(`${where} imports "${specifier}", which is not a declared optional peer`)
    }
  }
}

if (checked === 0) problems.push('no built JS entries found in "exports"')
for (const p of problems) console.log(`FAIL ${pkg.name}: ${p}`)
if (problems.length === 0) {
  console.log(`PASS ${pkg.name}: no dependencies; ${checked} entries import only optional peers`)
}
process.exit(problems.length === 0 ? 0 : 1)
