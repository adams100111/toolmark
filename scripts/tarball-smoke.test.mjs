// Tests for scripts/tarball-smoke.mjs and scripts/render-round-budget.mjs.
// Run with `node --test scripts/` (Node >= 22.12; needs pnpm on PATH and registry access).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const SMOKE = join(here, 'tarball-smoke.mjs')
const RENDER = join(here, 'render-round-budget.mjs')

/** Packs a one-entry fixture package into a fresh directory and returns that directory. */
async function packFixture({ extraExports = {} } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'toolmark-smoke-fixture-'))
  const src = join(root, 'pkg')
  const out = join(root, 'tarballs')
  await mkdir(src)
  await mkdir(out)
  const pkg = {
    name: 'toolmark-smoke-fixture',
    version: '1.0.0',
    type: 'module',
    files: ['index.js', 'index.d.ts'],
    exports: {
      '.': { types: './index.d.ts', import: './index.js' },
      ...extraExports,
      './package.json': './package.json',
    },
  }
  await writeFile(join(src, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`)
  await writeFile(join(src, 'index.js'), 'export function answer() {\n  return 42\n}\n')
  await writeFile(join(src, 'index.d.ts'), 'export declare function answer(): number\n')
  const packed = spawnSync('pnpm', ['pack', '--pack-destination', out], {
    cwd: src,
    encoding: 'utf8',
  })
  assert.equal(packed.status, 0, `pnpm pack failed:\n${packed.stdout}\n${packed.stderr}`)
  return { root, out }
}

function runSmoke(dir) {
  return spawnSync(process.execPath, [SMOKE, dir], { encoding: 'utf8', timeout: 300000 })
}

test('smoke_detects_missing_export_file', { timeout: 300000 }, async () => {
  const { root, out } = await packFixture({
    extraExports: { './missing': { types: './missing.d.ts', import: './missing.js' } },
  })
  try {
    const run = runSmoke(out)
    const output = `${run.stdout}\n${run.stderr}`
    assert.equal(run.status, 1, output)
    assert.match(output, /FAIL .*toolmark-smoke-fixture\/missing/)
    assert.match(output, /missing\.js/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('smoke_passes_minimal_valid_package', { timeout: 300000 }, async () => {
  const { root, out } = await packFixture()
  try {
    const run = runSmoke(out)
    const output = `${run.stdout}\n${run.stderr}`
    assert.equal(run.status, 0, output)
    assert.match(output, /PASS import toolmark-smoke-fixture\b/)
    assert.match(output, /PASS tsc 6\.0\.3 nodenext/)
    assert.match(output, /PASS tsc 7\.0\.2 bundler/)
    assert.doesNotMatch(output, /FAIL/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('smoke_rejects_empty_directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'toolmark-smoke-empty-'))
  try {
    const run = runSmoke(root)
    assert.equal(run.status, 1, run.stdout + run.stderr)
    assert.match(run.stdout + run.stderr, /no \.tgz files/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('render_round_budget_writes_one_row_per_entry', async () => {
  const root = await mkdtemp(join(tmpdir(), 'toolmark-round-budget-'))
  try {
    const json = join(root, 'round-budget.json')
    const md = join(root, 'round-budget.md')
    await writeFile(
      json,
      JSON.stringify([
        {
          task: 'simple_form',
          rounds: 3,
          messages: 3,
          manifestBytes: 659,
          describeBytes: 1089,
          wallMs: 57,
        },
        {
          task: 'wizard',
          rounds: 4,
          messages: 6,
          manifestBytes: 900,
          describeBytes: 2000,
          wallMs: 120,
        },
      ]),
    )
    const run = spawnSync(process.execPath, [RENDER, json, '--out', md], { encoding: 'utf8' })
    assert.equal(run.status, 0, run.stdout + run.stderr)
    const text = await readFile(md, 'utf8')
    assert.match(text, /\| simple_form \| 3 \| ≤ 3 \| 3 \| 659 \| 1089 \| 57 \|/)
    assert.match(text, /\| wizard \| 4 \| ≤ 5 \| 6 \| 900 \| 2000 \| 120 \|/)
    assert.match(text, /Commit: `[0-9a-f]{40}`/)
    assert.match(text, /a \*\*round\*\* is one agent turn/i)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('render_round_budget_rejects_malformed_report', async () => {
  const root = await mkdtemp(join(tmpdir(), 'toolmark-round-budget-'))
  try {
    const json = join(root, 'bad.json')
    await writeFile(json, JSON.stringify([{ task: 'simple_form', rounds: 'three' }]))
    const run = spawnSync(process.execPath, [RENDER, json, '--out', join(root, 'x.md')], {
      encoding: 'utf8',
    })
    assert.equal(run.status, 1, run.stdout + run.stderr)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
