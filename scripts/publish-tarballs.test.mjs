// Tests for scripts/publish-tarballs.mjs (M5 final review I-4, m-8): the release workflow's
// publish loop, run for real against a temporary workspace and a fake `npm` on PATH.
// Run with `node --test "scripts/*.test.mjs"`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { atLeast } from './publish-tarballs.mjs'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'publish-tarballs.mjs')

// Logs every call (`<args> token=<set|unset>`) and answers `--version`, `view` and `publish`.
const FAKE_NPM = `#!/bin/sh
echo "$* token=\${NODE_AUTH_TOKEN:+set}" >> "$FAKE_NPM_LOG"
case "$1" in
  --version) echo "\${FAKE_NPM_VERSION:-11.19.0}" ;;
  view) case " $FAKE_NPM_PUBLISHED " in *" $2 "*) echo "\${2##*@}" ;; *) exit 1 ;; esac ;;
  publish) exit "\${FAKE_NPM_PUBLISH_RC:-0}" ;;
esac
`

const sri = (buf) => `sha256-${createHash('sha256').update(buf).digest('base64')}`

/** A workspace (core, react at 1.0.0), a pack dir and a fake npm; `edit` adjusts the plan. */
function fixture(edit = (plan) => plan) {
  const dir = mkdtempSync(join(tmpdir(), 'toolmark-publish-'))
  const bin = join(dir, 'bin')
  mkdirSync(bin)
  writeFileSync(join(bin, 'npm'), FAKE_NPM)
  chmodSync(join(bin, 'npm'), 0o755)
  const entries = []
  for (const name of ['core', 'react']) {
    mkdirSync(join(dir, 'packages', name), { recursive: true })
    writeFileSync(
      join(dir, 'packages', name, 'package.json'),
      JSON.stringify({ name: `@toolmark/${name}`, version: '1.0.0' }),
    )
    const tgz = Buffer.from(`tarball of ${name}`)
    const path = `packages/toolmark-${name}-1.0.0.tgz`
    mkdirSync(join(dir, 'dist-pack', 'packages'), { recursive: true })
    writeFileSync(join(dir, 'dist-pack', path), tgz)
    entries.push({
      kind: 'publish',
      name: `@toolmark/${name}`,
      version: '1.0.0',
      access: 'public',
      tag: 'latest',
      tarball: { path, integrity: sri(tgz) },
    })
  }
  const plan = edit({ version: 1, plan: [[entries[0]], [entries[1]]] })
  writeFileSync(join(dir, 'dist-pack', 'publish-plan.json'), JSON.stringify(plan))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

function run(dir, args, env = {}) {
  const log = join(dir, 'npm.log')
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${join(dir, 'bin')}:${process.env.PATH}`,
      FAKE_NPM_LOG: log,
      NPM_BOOTSTRAP_TOKEN: '',
      ...env,
    },
  })
  const calls = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : []
  const released = join(dir, 'released.tsv')
  return {
    status: r.status,
    out: `${r.stdout}${r.stderr}`,
    calls,
    publishes: calls.filter((c) => c.startsWith('publish ')),
    released: existsSync(released) ? readFileSync(released, 'utf8') : undefined,
  }
}

const RELEASED = '@toolmark/core\t1.0.0\tpackages/core\n@toolmark/react\t1.0.0\tpackages/react\n'

test('publish_tarballs_dry_run_checks_everything_and_never_publishes', () => {
  const f = fixture()
  try {
    const r = run(f.dir, ['--dry-run', 'dist-pack', '--released', 'released.tsv'], {
      FAKE_NPM_PUBLISHED: '@toolmark/core@1.0.0',
    })
    assert.equal(r.status, 0, r.out)
    assert.deepEqual(r.publishes, [])
    assert.match(r.out, /@toolmark\/core@1\.0\.0 is already on the registry; skipping/)
    assert.match(r.out, /would publish @toolmark\/react@1\.0\.0/)
    assert.equal(r.released, RELEASED)
  } finally {
    f.cleanup()
  }
})

test('publish_tarballs_publishes_with_provenance_and_skips_published_versions', () => {
  const f = fixture()
  try {
    const r = run(f.dir, ['dist-pack', '--released', 'released.tsv'], {
      FAKE_NPM_PUBLISHED: '@toolmark/core@1.0.0',
      NPM_BOOTSTRAP_TOKEN: 'tok',
    })
    assert.equal(r.status, 0, r.out)
    assert.deepEqual(r.publishes, [
      'publish dist-pack/packages/toolmark-react-1.0.0.tgz --access public --tag latest --provenance --ignore-scripts token=set',
    ])
    assert.ok(
      r.calls.filter((c) => !c.startsWith('publish ')).every((c) => c.endsWith('token=')),
      'the token reaches npm publish only',
    )
    assert.match(r.out, /auth: bootstrap token/)
    assert.equal(r.released, RELEASED)
  } finally {
    f.cleanup()
  }
})

test('publish_tarballs_uses_oidc_without_a_bootstrap_token', () => {
  const f = fixture()
  try {
    const r = run(f.dir, ['dist-pack'])
    assert.equal(r.status, 0, r.out)
    assert.equal(r.publishes.length, 2)
    assert.ok(r.publishes.every((c) => c.endsWith('token=')))
    assert.match(r.out, /auth: OIDC trusted publishing/)
  } finally {
    f.cleanup()
  }
})

test('publish_tarballs_checks_the_whole_plan_before_publishing', () => {
  const f = fixture((plan) => {
    plan.plan[1][0].tarball.integrity = 'sha256-AAAA'
    return plan
  })
  try {
    const r = run(f.dir, ['dist-pack'])
    assert.equal(r.status, 1)
    assert.match(r.out, /@toolmark\/react: tarball integrity mismatch/)
    assert.deepEqual(r.publishes, [], 'core is not published before react fails its check')
  } finally {
    f.cleanup()
  }
})

const refusals = [
  ['kind', (e) => (e.kind = 'unpublish'), /unexpected plan entry kind 'unpublish'/],
  ['name', (e) => (e.name = '@evil/core'), /unexpected package name '@evil\/core'/],
  ['tag', (e) => (e.tag = 'next'), /dist-tag 'next' is not latest/],
  ['path', (e) => (e.tarball.path = 'packages/../../x.tgz'), /unexpected tarball path/],
  ['version', (e) => (e.version = '1.0.1'), /plan 1\.0\.1 != workspace 1\.0\.0/],
]
for (const [what, mutate, message] of refusals) {
  test(`publish_tarballs_refuses_a_bad_${what}`, () => {
    const f = fixture((plan) => {
      mutate(plan.plan[0][0])
      return plan
    })
    try {
      const r = run(f.dir, ['--dry-run', 'dist-pack'])
      assert.equal(r.status, 1, r.out)
      assert.match(r.out, message)
      assert.deepEqual(r.publishes, [])
    } finally {
      f.cleanup()
    }
  })
}

test('publish_tarballs_refuses_a_malformed_plan', () => {
  const f = fixture(() => ({ version: 2, plan: [] }))
  try {
    const r = run(f.dir, ['--dry-run', 'dist-pack'])
    assert.equal(r.status, 1)
    assert.match(r.out, /not a version 1 plan/)
  } finally {
    f.cleanup()
  }
})

test('publish_tarballs_requires_npm_11_5_1', () => {
  const f = fixture()
  try {
    const r = run(f.dir, ['--dry-run', 'dist-pack'], { FAKE_NPM_VERSION: '11.5.0' })
    assert.equal(r.status, 1)
    assert.match(r.out, /npm 11\.5\.0 is older than 11\.5\.1/)
  } finally {
    f.cleanup()
  }
})

test('publish_tarballs_stops_at_a_failed_publish', () => {
  const f = fixture()
  try {
    const r = run(f.dir, ['dist-pack', '--released', 'released.tsv'], { FAKE_NPM_PUBLISH_RC: '1' })
    assert.equal(r.status, 1)
    assert.equal(r.publishes.length, 1)
    assert.equal(r.released, '')
  } finally {
    f.cleanup()
  }
})

test('publish_tarballs_usage_errors_exit_2', () => {
  const f = fixture()
  try {
    assert.equal(run(f.dir, []).status, 2)
    assert.equal(run(f.dir, ['--bogus', 'dist-pack']).status, 2)
  } finally {
    f.cleanup()
  }
})

test('publish_tarballs_version_comparison', () => {
  assert.equal(atLeast('11.5.1', [11, 5, 1]), true)
  assert.equal(atLeast('11.19.0', [11, 5, 1]), true)
  assert.equal(atLeast('12.0.0', [11, 5, 1]), true)
  assert.equal(atLeast('11.5.0', [11, 5, 1]), false)
  assert.equal(atLeast('10.9.9', [11, 5, 1]), false)
  assert.equal(atLeast('x', [11, 5, 1]), false)
})
