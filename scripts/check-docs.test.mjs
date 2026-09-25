// Tests for scripts/check-docs.mjs.
// Run with `node --test "scripts/*.test.mjs"` (Node >= 22.12). Fixtures are written to a temp dir.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const CHECK = join(here, 'check-docs.mjs')
const DOCS_BASE = 'https://example-owner.github.io/toolmark'

const REQUIRED_GUIDE_LINKS = [
  ['guides/react.md', '/guides/react'],
  ['guides/inertia.md', '/guides/inertia'],
  ['guides/nextjs.md', '/guides/nextjs'],
  ['guides/webmcp.md', '/guides/webmcp'],
  ['guides/mcp.md', '/guides/mcp'],
  ['guides/tours.md', '/guides/tours'],
  ['guides/laravel-reference.md', '/guides/laravel-reference'],
  ['policies/versioning.md', '/policies/versioning'],
  ['policies/deprecation.md', '/policies/deprecation'],
  ['policies/tool-names.md', '/policies/tool-names'],
  ['reference/codes.md', '/reference/codes'],
]

const INERTIA_GUIDE = '# Inertia\n\nInertia 3 requires React 19.\n'
const WEBMCP_GUIDE = '# WebMCP\n\n> **Experimental.** Outside semver until origin trial ends.\n'
const WEBMCP_ENTRY =
  '/**\n * @experimental WebMCP is an origin-trial API.\n */\nexport function webmcp() {}\n'

/** Writes a complete, passing fixture repo under a fresh temp dir; returns its root. */
async function fullFixture() {
  const root = await mkdtemp(join(tmpdir(), 'toolmark-check-docs-'))

  await mkdir(join(root, 'docs/.vitepress'), { recursive: true })
  const sidebarLinks = REQUIRED_GUIDE_LINKS.map(([, link]) => `{ link: '${link}' }`).join(',\n')
  await writeFile(
    join(root, 'docs/.vitepress/config.ts'),
    `export default { sidebar: [${sidebarLinks}] }\n`,
  )
  for (const [rel] of REQUIRED_GUIDE_LINKS) {
    await mkdir(join(root, 'docs', dirname(rel)), { recursive: true })
    if (rel === 'guides/inertia.md') {
      await writeFile(join(root, 'docs', rel), INERTIA_GUIDE)
    } else if (rel === 'guides/webmcp.md') {
      await writeFile(join(root, 'docs', rel), WEBMCP_GUIDE)
    } else {
      await writeFile(join(root, 'docs', rel), `# ${rel}\n`)
    }
  }

  for (const name of ['core', 'react']) {
    await mkdir(join(root, 'packages', name), { recursive: true })
    await writeFile(
      join(root, `packages/${name}/README.md`),
      `# @toolmark/${name}\n\nDocs: [guide](${DOCS_BASE}/guides/${name}).\n`,
    )
  }
  await mkdir(join(root, 'packages/core/src/webmcp'), { recursive: true })
  await writeFile(join(root, 'packages/core/src/webmcp/index.ts'), WEBMCP_ENTRY)
  await writeFile(
    join(root, 'packages/core/package.json'),
    JSON.stringify({ name: '@toolmark/core', description: 'Core (WebMCP adapter experimental)' }),
  )

  return root
}

function run(root) {
  return spawnSync(process.execPath, [CHECK, '--root', root, '--docs-base', DOCS_BASE], {
    encoding: 'utf8',
  })
}

test('a complete fixture exits 0', async () => {
  const root = await fullFixture()
  try {
    const r = run(root)
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`)
    assert.match(r.stdout, /ok/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('check_docs_fails_on_missing_guide', async () => {
  const root = await fullFixture()
  try {
    await rm(join(root, 'docs/guides/webmcp.md'))
    const r = run(root)
    assert.equal(r.status, 1, `${r.stdout}\n${r.stderr}`)
    assert.match(r.stderr, /missing docs\/guides\/webmcp\.md/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a required doc that exists but has no sidebar link fails', async () => {
  const root = await fullFixture()
  try {
    // Drop it from the sidebar config, but leave the file itself in place.
    await writeFile(join(root, 'docs/.vitepress/config.ts'), `export default { sidebar: [] }\n`)
    const r = run(root)
    assert.equal(r.status, 1)
    assert.match(r.stderr, /guides\/tours\.md exists but is not reachable from the sidebar/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('check_docs_fails_without_experimental_label', async () => {
  const root = await fullFixture()
  try {
    await writeFile(
      join(root, 'packages/core/src/webmcp/index.ts'),
      'export function webmcp() {}\n',
    )
    const r = run(root)
    assert.equal(r.status, 1, `${r.stdout}\n${r.stderr}`)
    assert.match(r.stderr, /webmcp\/index\.ts has no @experimental/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('missing "experimental" in the webmcp guide banner fails', async () => {
  const root = await fullFixture()
  try {
    await writeFile(join(root, 'docs/guides/webmcp.md'), '# WebMCP\n\nJust a normal adapter.\n')
    const r = run(root)
    assert.equal(r.status, 1)
    assert.match(r.stderr, /guides\/webmcp\.md has no "experimental" banner/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('missing "experimental" in packages/core/package.json description fails', async () => {
  const root = await fullFixture()
  try {
    await writeFile(
      join(root, 'packages/core/package.json'),
      JSON.stringify({ name: '@toolmark/core', description: 'Core registry.' }),
    )
    const r = run(root)
    assert.equal(r.status, 1)
    assert.match(r.stderr, /package\.json "description" does not mention "experimental"/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a package README without a docs-site link fails', async () => {
  const root = await fullFixture()
  try {
    await writeFile(join(root, 'packages/react/README.md'), '# @toolmark/react\n\nNo docs link.\n')
    const r = run(root)
    assert.equal(r.status, 1)
    assert.match(r.stderr, /packages\/react\/README\.md does not link the docs site/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a missing package README fails', async () => {
  const root = await fullFixture()
  try {
    await rm(join(root, 'packages/react/README.md'))
    const r = run(root)
    assert.equal(r.status, 1)
    assert.match(r.stderr, /missing packages\/react\/README\.md/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('inertia guide missing the React 19 statement fails', async () => {
  const root = await fullFixture()
  try {
    await writeFile(join(root, 'docs/guides/inertia.md'), '# Inertia\n\nWorks with React 18+.\n')
    const r = run(root)
    assert.equal(r.status, 1)
    assert.match(r.stderr, /does not state "Inertia 3 requires React 19"/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
