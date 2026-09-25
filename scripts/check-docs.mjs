#!/usr/bin/env node
// Checks the docs-completeness gate (spec §21: "guides for React, Inertia, Next.js, Laravel
// reference, WebMCP, MCP, tours"; §17 versioning/deprecation docs; D28 the word "experimental"
// stays attached to the WebMCP entry everywhere it's mentioned).
//
// Fails unless all of these hold, under `--root` (default: the repo root):
//   1. docs/guides/{react,inertia,nextjs,webmcp,mcp,tours}.md and
//      docs/guides/laravel-reference.md exist and are reachable from the VitePress sidebar
//      (docs/.vitepress/config.ts).
//   2. docs/policies/{versioning,deprecation,tool-names}.md exist and are sidebar-reachable.
//   3. docs/reference/codes.md exists and is sidebar-reachable.
//   4. Every packages/*/README.md exists and links the docs site.
//   5. The word "experimental" appears in: the core `./webmcp` entry's TSDoc (an `@experimental`
//      tag in packages/core/src/webmcp/index.ts), the docs/guides/webmcp.md banner, and
//      packages/core/package.json's `description`.
//   6. docs/guides/inertia.md states "Inertia 3 requires React 19".
//
// Exit codes: 0 all checks pass; 1 at least one failed; 2 usage error.
// Usage: node scripts/check-docs.mjs [--root .] [--docs-base https://adams100111.github.io/toolmark]
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const REQUIRED_SIDEBAR_DOCS = [
  'guides/react.md',
  'guides/inertia.md',
  'guides/nextjs.md',
  'guides/webmcp.md',
  'guides/mcp.md',
  'guides/tours.md',
  'guides/laravel-reference.md',
  'policies/versioning.md',
  'policies/deprecation.md',
  'policies/tool-names.md',
  'reference/codes.md',
]

/** `docs/<path>.md` -> the VitePress sidebar `link` it should carry, e.g. `/guides/react`. */
function sidebarLinkFor(docPath) {
  return '/' + docPath.replace(/\.md$/, '')
}

/** Every `link: '...'`/`link: "..."` value in a VitePress config source (nav + sidebar alike). */
function sidebarLinks(configSource) {
  const links = new Set()
  const re = /link:\s*(['"])([^'"]+)\1/g
  let m
  while ((m = re.exec(configSource))) links.add(m[2])
  return links
}

function packageDirs(root) {
  const packagesDir = join(root, 'packages')
  if (!existsSync(packagesDir)) return []
  return readdirSync(packagesDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
    .map((name) => join(packagesDir, name))
}

/** Runs every check under `root`; returns `{ errors }` (empty = pass). */
export function checkDocs({ root, docsBase = 'https://adams100111.github.io/toolmark' }) {
  const errors = []
  const docsDir = join(root, 'docs')

  // 1–3: required docs exist and are sidebar-reachable.
  const configPath = join(docsDir, '.vitepress', 'config.ts')
  let links = new Set()
  if (!existsSync(configPath)) {
    errors.push(`missing ${relOf(root, configPath)}`)
  } else {
    links = sidebarLinks(readFileSync(configPath, 'utf8'))
  }
  for (const docPath of REQUIRED_SIDEBAR_DOCS) {
    const full = join(docsDir, docPath)
    if (!existsSync(full)) {
      errors.push(`missing docs/${docPath}`)
      continue
    }
    const link = sidebarLinkFor(docPath)
    if (!links.has(link)) {
      errors.push(
        `docs/${docPath} exists but is not reachable from the sidebar (no "${link}" link in docs/.vitepress/config.ts)`,
      )
    }
  }

  // 4: every packages/*/README.md exists and links the docs site.
  for (const pkgDir of packageDirs(root)) {
    const readme = join(pkgDir, 'README.md')
    const name = pkgDir.split('/').pop()
    if (!existsSync(readme)) {
      errors.push(`missing packages/${name}/README.md`)
      continue
    }
    const text = readFileSync(readme, 'utf8')
    if (!text.includes(docsBase)) {
      errors.push(`packages/${name}/README.md does not link the docs site (${docsBase})`)
    }
  }

  // 5: "experimental" everywhere D28 requires it.
  const webmcpEntry = join(root, 'packages/core/src/webmcp/index.ts')
  if (!existsSync(webmcpEntry)) {
    errors.push('missing packages/core/src/webmcp/index.ts')
  } else if (!/@experimental/.test(readFileSync(webmcpEntry, 'utf8'))) {
    errors.push('packages/core/src/webmcp/index.ts has no @experimental TSDoc tag')
  }
  const webmcpGuide = join(docsDir, 'guides/webmcp.md')
  if (!existsSync(webmcpGuide)) {
    errors.push('missing docs/guides/webmcp.md')
  } else if (!/experimental/i.test(readFileSync(webmcpGuide, 'utf8'))) {
    errors.push('docs/guides/webmcp.md has no "experimental" banner')
  }
  const corePkgJson = join(root, 'packages/core/package.json')
  if (!existsSync(corePkgJson)) {
    errors.push('missing packages/core/package.json')
  } else {
    const manifest = JSON.parse(readFileSync(corePkgJson, 'utf8'))
    if (!/experimental/i.test(manifest.description ?? '')) {
      errors.push('packages/core/package.json "description" does not mention "experimental"')
    }
  }

  // 6: the Inertia 3 / React 19 statement.
  const inertiaGuide = join(docsDir, 'guides/inertia.md')
  if (!existsSync(inertiaGuide)) {
    errors.push('missing docs/guides/inertia.md')
  } else if (!readFileSync(inertiaGuide, 'utf8').includes('Inertia 3 requires React 19')) {
    errors.push('docs/guides/inertia.md does not state "Inertia 3 requires React 19"')
  }

  return { errors }
}

function relOf(root, p) {
  return p.startsWith(root) ? p.slice(root.length + 1) : p
}

function parseArgs(argv) {
  const opts = { root: repoRoot, docsBase: 'https://adams100111.github.io/toolmark' }
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    const value = argv[i + 1]
    if (flag === '--root' && value !== undefined) {
      opts.root = resolve(value)
      i++
    } else if (flag === '--docs-base' && value !== undefined) {
      opts.docsBase = value
      i++
    } else {
      throw new Error(`unknown or incomplete argument: ${flag}`)
    }
  }
  return opts
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let opts
  try {
    opts = parseArgs(process.argv.slice(2))
  } catch (err) {
    console.error(`check-docs: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(2)
  }
  const { errors } = checkDocs(opts)
  if (errors.length > 0) {
    for (const e of errors) console.error(e)
    process.exit(1)
  }
  console.log('check-docs: ok')
}
