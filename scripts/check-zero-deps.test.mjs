// Tests for scripts/check-zero-deps.mjs. Run with `node --test "scripts/*.test.mjs"`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { scratch } from './fixtures/tgz.mjs'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'check-zero-deps.mjs')

/** A fixture core package: root entry + a chunk, an `./otel` subpath and a `./extra` subpath. */
function core({ dependencies, rootImport = '', otelImport = "import { trace } from 'x'" } = {}) {
  return {
    'package.json': {
      name: '@toolmark/core',
      version: '1.0.0',
      type: 'module',
      exports: {
        '.': { types: './dist/index.d.ts', import: './dist/index.js' },
        './otel': { types: './dist/otel.d.ts', import: './dist/otel.js' },
        './protocol/v1/*.json': './dist/protocol/v1/*.json',
        './package.json': './package.json',
      },
      ...(dependencies ? { dependencies } : {}),
      peerDependencies: { '@opentelemetry/api': '^1.9.0', 'some-required-peer': '^1.0.0' },
      peerDependenciesMeta: { '@opentelemetry/api': { optional: true } },
    },
    'dist/index.js': `${rootImport}\nimport { r } from './registry-AbCdEf12.js'\nexport { r }\n`,
    'dist/registry-AbCdEf12.js': 'export const r = 1\n',
    'dist/otel.js': `${otelImport}\nimport { r } from './registry-AbCdEf12.js'\nexport { r }\n`,
    'dist/protocol/v1/call.json': '{}\n',
  }
}

async function run(files) {
  const root = await scratch('toolmark-zero-deps-', files)
  try {
    const r = spawnSync(process.execPath, [SCRIPT, root], { encoding: 'utf8' })
    return { status: r.status, output: `${r.stdout}${r.stderr}` }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('check_zero_deps_passes_clean_core', async () => {
  const r = await run(core({ otelImport: "import { trace } from '@opentelemetry/api'" }))
  assert.equal(r.status, 0, r.output)
})

test('check_zero_deps_fails_on_added_dependency', async () => {
  const r = await run(core({ dependencies: { x: '1' } }))
  assert.equal(r.status, 1, r.output)
  assert.match(r.output, /FAIL .*dependencies.*x/)
})

test('check_zero_deps_fails_on_bare_import_in_root_entry', async () => {
  const r = await run(core({ rootImport: "import 'left-pad'" }))
  assert.equal(r.status, 1, r.output)
  assert.match(r.output, /FAIL .*root entry.*left-pad/)
})

test('check_zero_deps_follows_root_chunks', async () => {
  const files = core()
  files['dist/registry-AbCdEf12.js'] = "export { default as r } from '@opentelemetry/api'\n"
  const r = await run(files)
  assert.equal(r.status, 1, r.output)
  assert.match(r.output, /FAIL .*registry-AbCdEf12\.js.*@opentelemetry\/api/)
})

test('check_zero_deps_allows_optional_peer_in_subpath', async () => {
  const ok = await run(
    core({
      otelImport: "import { trace } from '@opentelemetry/api'\nimport('@opentelemetry/api')",
    }),
  )
  assert.equal(ok.status, 0, ok.output)
  const bad = await run(core({ otelImport: "import { x } from 'some-required-peer'" }))
  assert.equal(bad.status, 1, bad.output)
  assert.match(bad.output, /FAIL .*\.\/otel.*some-required-peer/)
})
