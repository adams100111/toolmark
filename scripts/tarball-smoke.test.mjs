// Tests for scripts/tarball-smoke.mjs and scripts/render-round-budget.mjs.
// Run with `node --test "scripts/*.test.mjs"` (Node >= 22.12; needs pnpm on PATH and registry access).
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
async function packFixture({ extraExports = {}, extraFiles = {}, bin } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'toolmark-smoke-fixture-'))
  const src = join(root, 'pkg')
  const out = join(root, 'tarballs')
  await mkdir(src)
  await mkdir(out)
  const pkg = {
    name: 'toolmark-smoke-fixture',
    version: '1.0.0',
    type: 'module',
    files: ['index.js', 'index.d.ts', ...Object.keys(extraFiles)],
    exports: {
      '.': { types: './index.d.ts', import: './index.js' },
      ...extraExports,
      './package.json': './package.json',
    },
    ...(bin ? { bin } : {}),
  }
  await writeFile(join(src, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`)
  await writeFile(join(src, 'index.js'), 'export function answer() {\n  return 42\n}\n')
  await writeFile(join(src, 'index.d.ts'), 'export declare function answer(): number\n')
  for (const [name, content] of Object.entries(extraFiles)) {
    await writeFile(join(src, name), content)
  }
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

test('smoke_fails_js_entry_without_types_condition', { timeout: 300000 }, async () => {
  const { root, out } = await packFixture({
    extraExports: { './untyped': { import: './index.js' } },
  })
  try {
    const run = runSmoke(out)
    const output = `${run.stdout}\n${run.stderr}`
    assert.equal(run.status, 1, output)
    assert.match(output, /FAIL types toolmark-smoke-fixture\/untyped/)
    assert.doesNotMatch(output, /FAIL types toolmark-smoke-fixture\b(?!\/)/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('smoke_checks_non_js_export_targets', { timeout: 300000 }, async () => {
  const { root, out } = await packFixture({
    extraExports: {
      './styles.css': './styles.css',
      './empty.css': './empty.css',
      './absent.css': './absent.css',
    },
    extraFiles: { 'styles.css': '.fixture { color: red; }\n', 'empty.css': '' },
  })
  try {
    const run = runSmoke(out)
    const output = `${run.stdout}\n${run.stderr}`
    assert.equal(run.status, 1, output)
    assert.match(output, /PASS asset toolmark-smoke-fixture\/styles\.css/)
    assert.match(output, /FAIL asset toolmark-smoke-fixture\/empty\.css: .*empty/)
    assert.match(output, /FAIL exports toolmark-smoke-fixture\/absent\.css: missing .*absent\.css/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('smoke_imports_node_condition_entries', { timeout: 300000 }, async () => {
  // `@toolmark/judge-typesafe` exports `{ types, node }` only (Node-only package).
  const { root, out } = await packFixture({
    extraExports: { './node-only': { types: './index.d.ts', node: './index.js' } },
  })
  try {
    const run = runSmoke(out)
    const output = `${run.stdout}\n${run.stderr}`
    assert.equal(run.status, 0, output)
    assert.match(output, /PASS import toolmark-smoke-fixture\/node-only/)
    assert.match(output, /PASS types toolmark-smoke-fixture\/node-only/)
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

/** A bin that prints usage on `--help` and exits 2 on anything else — but only when `isMain`. */
function binSource(guarded) {
  return [
    '#!/usr/bin/env node',
    "import { pathToFileURL } from 'node:url'",
    'function main() {',
    "  if (process.argv.includes('--help')) {",
    "    process.stdout.write('Usage: fixture-bin [options]\\n')",
    '    return',
    '  }',
    "  process.stderr.write('Usage: fixture-bin [options]\\nunknown option\\n')",
    '  process.exitCode = 2',
    '}',
    guarded
      ? 'if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()'
      : 'main()',
    '',
  ].join('\n')
}

test(
  'smoke_runs_bins_through_a_symlink (guarded bin is a no-op there)',
  { timeout: 300000 },
  async () => {
    const { root, out } = await packFixture({
      bin: { 'fixture-bin': './bin.js' },
      extraFiles: { 'bin.js': binSource(true) },
    })
    try {
      const run = runSmoke(out)
      const output = `${run.stdout}\n${run.stderr}`
      assert.equal(run.status, 1, output)
      assert.match(output, /PASS bin fixture-bin --help\b/)
      assert.match(output, /FAIL bin fixture-bin \(symlink\) --help/)
      assert.match(output, /FAIL bin fixture-bin \(symlink\) --toolmark-smoke-bad-flag/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  },
)

test('smoke_runs_bins_through_a_symlink (unguarded bin passes)', { timeout: 300000 }, async () => {
  const { root, out } = await packFixture({
    bin: { 'fixture-bin': './bin.js' },
    extraFiles: { 'bin.js': binSource(false) },
  })
  try {
    const run = runSmoke(out)
    const output = `${run.stdout}\n${run.stderr}`
    assert.equal(run.status, 0, output)
    assert.match(output, /PASS bin fixture-bin --help\b/)
    assert.match(output, /PASS bin fixture-bin \(symlink\) --help/)
    assert.match(output, /PASS bin fixture-bin \(symlink\) --toolmark-smoke-bad-flag/)
    assert.match(output, /PASS bin fixture-bin --toolmark-smoke-bad-flag/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('smoke_typechecks_bundler_and_nodenext', { timeout: 300000 }, async () => {
  // Extensionless relative re-export in the packed types: resolves under `bundler` only.
  const { root, out } = await packFixture({
    extraExports: { './loose': { types: './loose.d.ts', import: './index.js' } },
    extraFiles: {
      'loose.d.ts': "export * from './impl'\n",
      'impl.d.ts': 'export declare const x: 1\n',
    },
  })
  try {
    const run = runSmoke(out)
    const output = `${run.stdout}\n${run.stderr}`
    assert.equal(run.status, 1, output)
    assert.match(output, /FAIL tsc 6\.0\.3 nodenext/)
    assert.match(output, /FAIL tsc 7\.0\.2 nodenext/)
    assert.match(output, /PASS tsc 6\.0\.3 bundler/)
    assert.match(output, /PASS tsc 7\.0\.2 bundler/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('smoke_accepts_two_dirs', { timeout: 600000 }, async () => {
  const first = await packFixture()
  const second = await packFixture({
    extraExports: { './missing': { types: './missing.d.ts', import: './missing.js' } },
  })
  try {
    const run = spawnSync(process.execPath, [SMOKE, first.out, second.out], {
      encoding: 'utf8',
      timeout: 600000,
    })
    const output = `${run.stdout}\n${run.stderr}`
    assert.equal(run.status, 1, output)
    assert.ok(output.includes(`info: tarballs ${first.out}`), output)
    assert.ok(output.includes(`info: tarballs ${second.out}`), output)
    // Only the second set is broken: the first set's checks all pass.
    assert.match(output, /PASS exports toolmark-smoke-fixture\b/)
    assert.match(output, /FAIL .*toolmark-smoke-fixture\/missing/)
    assert.equal(output.match(/^tarball-smoke: /gm)?.length, 1, output)
  } finally {
    await rm(first.root, { recursive: true, force: true })
    await rm(second.root, { recursive: true, force: true })
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
    assert.match(text, /\| simple_form +\| 3 +\| ≤ 3 +\| 3 +\| 659 +\| 1089 +\| 57 +\|/)
    assert.match(text, /\| wizard +\| 4 +\| ≤ 5 +\| 6 +\| 900 +\| 2000 +\| 120 +\|/)
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

test('render_round_budget_accepts_input_as_first_or_last_argument', async () => {
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
          manifestBytes: 1,
          describeBytes: 2,
          wallMs: 3,
        },
      ]),
    )
    for (const argv of [
      [json, '--out', md],
      ['--out', md, json],
    ]) {
      const run = spawnSync(process.execPath, [RENDER, ...argv], { encoding: 'utf8' })
      assert.equal(run.status, 0, `${argv.join(' ')}: ${run.stdout}${run.stderr}`)
      assert.match(await readFile(md, 'utf8'), /\| simple_form +\| 3 +\|/)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('render_round_budget_defaults_to_docs_release', async () => {
  // A copy of the script in a scratch "repo" so the default output lands there, not in this repo.
  const root = await mkdtemp(join(tmpdir(), 'toolmark-round-budget-'))
  try {
    await mkdir(join(root, 'scripts'))
    const script = join(root, 'scripts', 'render-round-budget.mjs')
    await writeFile(script, await readFile(RENDER, 'utf8'))
    const json = join(root, 'round-budget.json')
    await writeFile(
      json,
      JSON.stringify([
        {
          task: 'simple_form',
          rounds: 2,
          messages: 2,
          manifestBytes: 1,
          describeBytes: 2,
          wallMs: 3,
        },
      ]),
    )
    const run = spawnSync(process.execPath, [script, json], { encoding: 'utf8', cwd: root })
    assert.equal(run.status, 0, run.stdout + run.stderr)
    const text = await readFile(join(root, 'docs', 'release', 'round-budget.md'), 'utf8')
    assert.match(text, /\| simple_form +\| 2 +\| ≤ 3 +\|/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
