// Tests for scripts/check-release-versions.mjs. Run with `node --test "scripts/*.test.mjs"`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { paxRecord, scratch, writeTarEntries, writeTgz } from './fixtures/tgz.mjs'

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

function runScript(args, env) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    env: env ? { ...process.env, ...env } : process.env,
  })
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
 * `publish-plan.json`. `entries` are `{ manifest, plan?: {...overrides}, tar? }`; each tarball
 * holds `manifest` (or, with `tar`, exactly those raw tar entries), and each plan entry defaults to
 * the manifest's name/version. `args` replaces the mode flag (default `--plan`).
 */
async function runPlan(entries, { planDoc, args = ['--plan'], env } = {}) {
  const dir = await scratch('toolmark-release-plan-', {})
  try {
    const plan = []
    for (const e of entries) {
      const path = `packages/${tgzName(e.manifest.name, e.manifest.version)}`
      if (e.tar) await writeTarEntries(join(dir, path), e.tar)
      else {
        await writeTgz(join(dir, path), {
          'package/package.json': JSON.stringify(e.manifest),
          'package/README.md': '# x\n',
        })
      }
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
    return runScript([...args, dir], env)
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

// SEC-22: the packed manifest is read with a strict tar parser that refuses anything npm's own
// parser (node-tar, through pacote) could read differently: a second `package/package.json`
// (node-tar keeps the last one), PAX or GNU headers that rename an entry, entries outside
// `package/`, bad header checksums, or entries hidden behind a lone null block.
const benign = JSON.stringify(core)
const evil = JSON.stringify({ ...core, version: '1.0.1', scripts: { postinstall: 'node x.js' } })

/** Runs `--plan` and `--tarballs` over one core tarball made of raw `tar` entries. */
async function runRawTarball(tar) {
  return {
    plan: await runPlan([{ manifest: core, tar }]),
    tarballs: await runPlan([{ manifest: core, tar }], { args: ['--tarballs'] }),
  }
}

function assertRejected(r, pattern, label) {
  for (const [mode, out] of Object.entries(r)) {
    assert.equal(out.status, 1, `${label} (${mode}): ${out.output}`)
    assert.match(out.output, pattern, `${label} (${mode})`)
  }
}

test('check_release_versions_plan_rejects_duplicate_manifests', async () => {
  const names = [
    'package/package.json',
    './package/package.json',
    'package//package.json',
    'package/./package.json',
    'package/lib/../package.json',
  ]
  for (const second of names) {
    const r = await runRawTarball([
      { name: 'package/package.json', content: benign },
      { name: second, content: evil },
    ])
    assertRejected(r, /more than one package\/package\.json/, second)
  }
  // A ustar `prefix` that joins to the manifest path is a duplicate too.
  const prefixed = await runRawTarball([
    { name: 'package/package.json', content: benign },
    { name: 'package.json', prefix: 'package', content: evil },
  ])
  assertRejected(prefixed, /more than one package\/package\.json/, 'prefix')
})

test('check_release_versions_plan_rejects_entries_after_a_null_block', async () => {
  // node-tar skips a lone null block and keeps reading; so does the check.
  const r = await runRawTarball([
    { name: 'package/package.json', content: benign },
    { zeroBlock: true },
    { name: 'package/package.json', content: evil },
  ])
  assertRejected(r, /more than one package\/package\.json/, 'null block')
})

test('check_release_versions_plan_rejects_pax_and_gnu_headers', async () => {
  const cases = {
    x: [
      { name: 'PaxHeader/x', type: 'x', content: paxRecord('path', 'package/package.json') },
      { name: 'package/README.md', content: evil },
      { name: 'package/package.json', content: benign },
    ],
    g: [
      { name: 'pax_global_header', type: 'g', content: paxRecord('comment', 'x') },
      { name: 'package/package.json', content: benign },
    ],
    L: [
      { name: '././@LongLink', type: 'L', content: 'package/package.json\0' },
      { name: 'package/README.md', content: evil },
      { name: 'package/package.json', content: benign },
    ],
    K: [
      { name: '././@LongLink', type: 'K', content: 'package/package.json\0' },
      { name: 'package/package.json', content: benign },
    ],
  }
  for (const [type, tar] of Object.entries(cases)) {
    const r = await runRawTarball(tar)
    assertRejected(r, new RegExp(`typeflag "${type}"`), type)
  }
})

test('check_release_versions_plan_rejects_links_and_special_entries', async () => {
  for (const type of ['1', '2', '3', '4', '6']) {
    const r = await runRawTarball([
      { name: 'package/package.json', content: benign },
      { name: 'package/link', type },
    ])
    assertRejected(r, new RegExp(`typeflag "${type}"`), type)
  }
})

test('check_release_versions_plan_rejects_entries_outside_package', async () => {
  for (const name of [
    'evil.js',
    'package',
    'pkg/package.json',
    '../package/package.json',
    '/package/package.json',
    'package/../../etc/x',
    'package/..',
    'package\\..\\x',
  ]) {
    const r = await runRawTarball([
      { name: 'package/package.json', content: benign },
      { name, content: 'x' },
    ])
    assertRejected(r, /outside package\//, name)
  }
})

test('check_release_versions_plan_rejects_bad_header_checksum', async () => {
  const r = await runRawTarball([
    { name: 'package/package.json', content: benign },
    { name: 'package/README.md', content: 'x', badChecksum: true },
  ])
  assertRejected(r, /checksum/, 'checksum')
})

test('check_release_versions_plan_accepts_directory_entries', async () => {
  const r = await runRawTarball([
    { name: 'package/', type: '5' },
    { name: 'package/package.json', content: benign },
    { name: 'package/dist/index.js', content: 'export {}\n' },
  ])
  assert.equal(r.plan.status, 0, r.plan.output)
  assert.equal(r.tarballs.status, 0, r.tarballs.output)
})

// SEC-22 (second half): `--npm-dry-run` asks npm itself (`npm publish <tgz> --dry-run --json`)
// what it would publish, offline and with no credentials, and compares that with the plan.
async function fakeNpm(dir, output) {
  const file = join(dir, 'fake-npm.mjs')
  await writeFile(
    file,
    `#!${process.execPath}\n` +
      "import { appendFileSync } from 'node:fs'\n" +
      `appendFileSync(${JSON.stringify(join(dir, 'calls.jsonl'))}, JSON.stringify({ argv: process.argv.slice(2), env: process.env }) + '\\n')\n` +
      `process.stdout.write(${JSON.stringify(output)})\n`,
    { mode: 0o755 },
  )
  return file
}

test('check_release_versions_npm_dry_run_accepts_matching_tarballs', async () => {
  // Real npm, offline: `--force` skips the registry version lookup and no credentials exist.
  const r = await runPlan([{ manifest: core }, { manifest: react }], { args: ['--npm-dry-run'] })
  assert.equal(r.status, 0, r.output)
  assert.match(r.output, /PASS .*@toolmark\/core@1\.0\.0/)
  assert.match(r.output, /PASS .*@toolmark\/react@1\.0\.0/)
})

test('check_release_versions_npm_dry_run_rejects_what_npm_reads_differently', async () => {
  const dir = await scratch('toolmark-fake-npm-', {})
  try {
    const cases = [
      [
        { id: '@toolmark/core@1.0.1', name: '@toolmark/core', version: '1.0.1' },
        /version "1\.0\.1"/,
      ],
      [
        { '@toolmark/core': { name: '@toolmark/evil', version: '1.0.0' } },
        /name "@toolmark\/evil"/,
      ],
      [{ a: { name: '@toolmark/core', version: '1.0.0' }, b: {} }, /unexpected npm --json output/],
      ['not json', /unexpected npm --json output/],
    ]
    for (const [output, pattern] of cases) {
      const npm = await fakeNpm(dir, typeof output === 'string' ? output : JSON.stringify(output))
      const r = await runPlan([{ manifest: core }], {
        args: ['--npm-dry-run'],
        env: { TOOLMARK_NPM: npm },
      })
      assert.equal(r.status, 1, r.output)
      assert.match(r.output, pattern)
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('check_release_versions_npm_dry_run_runs_npm_offline_without_credentials', async () => {
  const dir = await scratch('toolmark-fake-npm-', {})
  try {
    const npm = await fakeNpm(dir, JSON.stringify({ '@toolmark/core': core }))
    const r = await runPlan([{ manifest: core }], {
      args: ['--npm-dry-run'],
      env: {
        TOOLMARK_NPM: npm,
        GITHUB_ACTIONS: 'true',
        ACTIONS_ID_TOKEN_REQUEST_URL: 'https://token.invalid/',
        ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'secret-request-token',
        NPM_ID_TOKEN: 'secret-id-token',
        NODE_AUTH_TOKEN: 'secret-auth-token',
        NPM_BOOTSTRAP_TOKEN: 'secret-bootstrap',
        NPM_CONFIG_USERCONFIG: '/tmp/npmrc',
        npm_config__authToken: 'secret-config-token',
      },
    })
    assert.equal(r.status, 0, r.output)
    const [call] = (await readFile(join(dir, 'calls.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l))
    for (const flag of ['publish', '--dry-run', '--json', '--force', '--ignore-scripts']) {
      assert.ok(call.argv.includes(flag), `npm gets ${flag}`)
    }
    assert.ok(call.argv.includes('--provenance=false'), 'no provenance on the dry run')
    assert.ok(
      call.argv.some((a) => /^--registry=http:\/\/127\.0\.0\.1:9\/$/.test(a)),
      'an unreachable registry',
    )
    const leaked = Object.keys(call.env).filter((k) =>
      /TOKEN|AUTH|GITHUB|ACTIONS|USERCONFIG|^npm_config_/i.test(k),
    )
    assert.deepEqual(leaked, [], 'no credential, CI or npm config variables reach npm')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
