// Tests for scripts/check-release-versions.mjs. Run with `node --test "scripts/*.test.mjs"`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { scratch, writeTgz } from './fixtures/tgz.mjs'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'check-release-versions.mjs')

const NAMES = ['core', 'inertia', 'judge-typesafe', 'lint', 'mcp', 'react', 'testing', 'tour']

/** A workspace fixture: `packages/<name>/package.json` for all eight, plus a private example. */
function workspace(version, overrides = {}) {
  const files = {}
  for (const name of NAMES) {
    files[`packages/${name}/package.json`] = {
      name: `@toolmark/${name}`,
      version: overrides[name] ?? version,
    }
  }
  files['examples/demo/package.json'] = { name: 'demo', version: '0.0.0', private: true }
  return files
}

function runScript(args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' })
  return { status: r.status, output: `${r.stdout}${r.stderr}` }
}

async function runWorkspace(files, args) {
  const root = await scratch('toolmark-release-versions-', files)
  try {
    return runScript([...args, '--root', root])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

/** Writes one packed tarball per manifest into a temp dir and runs `--tarballs` on it. */
async function runTarballs(manifests) {
  const dir = await scratch('toolmark-release-tarballs-', {})
  try {
    for (const m of manifests) {
      const base = `${m.name.replace('@', '').replace('/', '-')}-${m.version}.tgz`
      await writeTgz(join(dir, 'nested', base), {
        'package/package.json': JSON.stringify(m),
        'package/README.md': '# x\n',
      })
    }
    return runScript(['--tarballs', dir])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('check_release_versions_accepts_stable', async () => {
  const r = await runWorkspace(workspace('1.0.0'), ['--stable'])
  assert.equal(r.status, 0, r.output)
  assert.match(r.output, /PASS .*1\.0\.0/)
})

test('check_release_versions_rejects_mixed_versions', async () => {
  const r = await runWorkspace(workspace('1.0.0', { react: '1.0.0-next.3' }), ['--stable'])
  assert.equal(r.status, 1, r.output)
  assert.match(r.output, /FAIL .*@toolmark\/react/)
})

test('check_release_versions_stable_rejects_prerelease', async () => {
  const r = await runWorkspace(workspace('1.0.0-next.4'), ['--stable'])
  assert.equal(r.status, 1, r.output)
  assert.match(r.output, /FAIL .*prerelease/)
})

test('check_release_versions_stable_rejects_missing_package', async () => {
  const files = workspace('1.0.0')
  delete files['packages/tour/package.json']
  const r = await runWorkspace(files, ['--stable'])
  assert.equal(r.status, 1, r.output)
  assert.match(r.output, /FAIL .*8/)
})

test('check_release_versions_pre_next', async () => {
  assert.equal((await runWorkspace(workspace('1.0.0-next.2'), ['--pre', 'next'])).status, 0)
  const bad = await runWorkspace(workspace('0.1.0-next.3'), ['--pre', 'next'])
  assert.equal(bad.status, 1, bad.output)
  const mixed = await runWorkspace(workspace('1.0.0-next.2', { lint: '1.0.0-next.1' }), [
    '--pre',
    'next',
  ])
  assert.equal(mixed.status, 1, mixed.output)
})

test('check_release_versions_exact', async () => {
  assert.equal((await runWorkspace(workspace('1.0.0'), ['--exact', '1.0.0'])).status, 0)
  const r = await runWorkspace(workspace('1.0.1'), ['--exact', '1.0.0'])
  assert.equal(r.status, 1, r.output)
})

test('check_release_versions_accepts_concrete_tarball_ranges', async () => {
  const r = await runTarballs([
    { name: '@toolmark/core', version: '1.0.0' },
    {
      name: '@toolmark/react',
      version: '1.0.0',
      dependencies: { '@toolmark/core': '1.0.0' },
      peerDependencies: { react: '^18.3.0 || ^19.0.0' },
    },
    {
      name: '@toolmark/judge-typesafe',
      version: '1.0.0',
      dependencies: { '@toolmark/lint': '^1.0.0' },
    },
  ])
  assert.equal(r.status, 0, r.output)
})

test('check_release_versions_rejects_workspace_ranges', async () => {
  const r = await runTarballs([
    { name: '@toolmark/core', version: '1.0.0' },
    {
      name: '@toolmark/judge-typesafe',
      version: '1.0.0',
      dependencies: { '@toolmark/lint': 'workspace:^' },
    },
  ])
  assert.equal(r.status, 1, r.output)
  assert.match(r.output, /FAIL .*judge-typesafe.*workspace:\^/)
})

test('check_release_versions_rejects_foreign_internal_version', async () => {
  const r = await runTarballs([
    {
      name: '@toolmark/react',
      version: '1.0.0',
      peerDependencies: { '@toolmark/core': '^0.1.0-next.3' },
    },
  ])
  assert.equal(r.status, 1, r.output)
  assert.match(r.output, /FAIL .*@toolmark\/core/)
})

test('check_release_versions_rejects_empty_tarball_dir', async () => {
  const r = await runTarballs([])
  assert.equal(r.status, 1, r.output)
})

test('check_release_versions_usage_error', () => {
  const r = runScript([])
  assert.equal(r.status, 2, r.output)
  assert.match(r.output, /usage/i)
})

/** The tarball file name changesets `pack` gives a release (`@toolmark/core` → `toolmark-core-1.0.0.tgz`). */
function tgzName(name, version) {
  return `${name.replace('@', '').replace('/', '-')}-${version}.tgz`
}

/**
 * A packed release dir like `changesets/action/pack` uploads: `packages/*.tgz` plus
 * `publish-plan.json`. `entries` are `{ manifest, plan?: {...overrides}, integrity? }`; each
 * tarball holds `manifest`, and each plan entry defaults to the manifest's name/version.
 */
async function runPlan(entries, { planDoc } = {}) {
  const dir = await scratch('toolmark-release-plan-', {})
  try {
    const plan = []
    for (const e of entries) {
      const path = `packages/${tgzName(e.manifest.name, e.manifest.version)}`
      await writeTgz(join(dir, path), {
        'package/package.json': JSON.stringify(e.manifest),
        'package/README.md': '# x\n',
      })
      const integrity = `sha256-${createHash('sha256')
        .update(await readFile(join(dir, path)))
        .digest('base64')}`
      plan.push({
        kind: 'publish',
        name: e.manifest.name,
        version: e.manifest.version,
        tag: 'latest',
        ...e.plan,
        tarball: { path, integrity, ...e.plan?.tarball },
      })
    }
    const doc = planDoc ?? { version: 1, plan: [plan] }
    await writeFile(join(dir, 'publish-plan.json'), JSON.stringify(doc))
    return runScript(['--plan', dir])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const core = { name: '@toolmark/core', version: '1.0.0' }
const react = {
  name: '@toolmark/react',
  version: '1.0.0',
  dependencies: { '@toolmark/core': '1.0.0' },
}

test('check_release_versions_plan_accepts_matching_tarballs', async () => {
  const r = await runPlan([{ manifest: core }, { manifest: react }])
  assert.equal(r.status, 0, r.output)
  assert.match(r.output, /PASS .*@toolmark\/core@1\.0\.0/)
  assert.match(r.output, /PASS .*@toolmark\/react@1\.0\.0/)
})

test('check_release_versions_plan_rejects_manifest_version_mismatch', async () => {
  // The tarball says 1.0.1, the plan (and so every version check upstream) says 1.0.0.
  const r = await runPlan([{ manifest: { ...core, version: '1.0.1' }, plan: { version: '1.0.0' } }])
  assert.equal(r.status, 1, r.output)
  assert.match(r.output, /FAIL .*@toolmark\/core.*version "1\.0\.1".*plan.*1\.0\.0/)
})

test('check_release_versions_plan_rejects_manifest_name_mismatch', async () => {
  const r = await runPlan([
    { manifest: { name: '@toolmark/evil', version: '1.0.0' }, plan: { name: '@toolmark/core' } },
  ])
  assert.equal(r.status, 1, r.output)
  assert.match(r.output, /FAIL .*name "@toolmark\/evil".*plan.*@toolmark\/core/)
})

test('check_release_versions_plan_rejects_install_scripts', async () => {
  const r = await runPlan([{ manifest: { ...core, scripts: { postinstall: 'node x.js' } } }])
  assert.equal(r.status, 1, r.output)
  assert.match(r.output, /FAIL .*install lifecycle script.*postinstall/)
})

test('check_release_versions_plan_rejects_unsafe_paths', async () => {
  for (const path of ['../evil.tgz', '/etc/passwd', 'packages/../../x.tgz', 'other/core.tgz']) {
    const r = await runPlan([{ manifest: core, plan: { tarball: { path } } }])
    assert.equal(r.status, 1, `${path}: ${r.output}`)
    assert.match(r.output, /FAIL .*tarball path/, path)
  }
})

test('check_release_versions_plan_rejects_integrity_mismatch', async () => {
  const r = await runPlan([{ manifest: core, plan: { tarball: { integrity: 'sha256-AAAA' } } }])
  assert.equal(r.status, 1, r.output)
  assert.match(r.output, /FAIL .*integrity/)
})

test('check_release_versions_plan_rejects_bad_entries', async () => {
  const kind = await runPlan([{ manifest: core, plan: { kind: 'skip' } }])
  assert.equal(kind.status, 1, kind.output)
  assert.match(kind.output, /FAIL .*kind/)
  const name = await runPlan([{ manifest: { name: 'left-pad', version: '1.0.0' } }])
  assert.equal(name.status, 1, name.output)
  assert.match(name.output, /FAIL .*package name/)
  const shape = await runPlan([], { planDoc: { version: 2, plan: {} } })
  assert.equal(shape.status, 1, shape.output)
  assert.match(shape.output, /FAIL .*publish-plan/)
  const empty = await runPlan([])
  assert.equal(empty.status, 1, empty.output)
})
