// Tests for scripts/release-dry-run-plan.mjs (M5 final review I-3): the release-dry-run job keeps
// working once every workspace version is on npm (empty publish plan), and still checks a
// non-empty plan as is. Run with `node --test "scripts/*.test.mjs"`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dryRunPlan, workspaceEntries } from './release-dry-run-plan.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = join(root, 'scripts', 'release-dry-run-plan.mjs')

function workspace() {
  const dir = mkdtempSync(join(tmpdir(), 'toolmark-dry-plan-'))
  const pkg = (name, body) => {
    mkdirSync(join(dir, 'packages', name), { recursive: true })
    writeFileSync(join(dir, 'packages', name, 'package.json'), JSON.stringify(body))
  }
  pkg('react', { name: '@toolmark/react', version: '1.0.0' })
  pkg('core', { name: '@toolmark/core', version: '1.0.0' })
  pkg('internal', { name: '@toolmark/internal', version: '1.0.0', private: true })
  pkg('other', { name: 'other', version: '1.0.0' })
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

function run(dir, plan) {
  writeFileSync(join(dir, 'in.json'), typeof plan === 'string' ? plan : JSON.stringify(plan))
  const output = join(dir, 'gh-output')
  writeFileSync(output, '')
  const r = spawnSync(
    process.execPath,
    [SCRIPT, join(dir, 'in.json'), join(dir, 'out.json'), '--root', dir],
    { encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: output } },
  )
  let out
  try {
    out = JSON.parse(readFileSync(join(dir, 'out.json'), 'utf8'))
  } catch {
    out = undefined
  }
  return { status: r.status, log: `${r.stdout}${r.stderr}`, out, gh: readFileSync(output, 'utf8') }
}

const entry = (name) => ({
  kind: 'publish',
  name: `@toolmark/${name}`,
  version: '1.0.0',
  access: 'public',
  tag: 'latest',
})

test('dry_run_plan_keeps_a_non_empty_plan', () => {
  const w = workspace()
  try {
    const plan = { version: 1, plan: [[entry('core')]] }
    const r = run(w.dir, plan)
    assert.equal(r.status, 0, r.log)
    assert.deepEqual(r.out, plan)
    assert.equal(r.gh, 'synthetic=false\n')
    assert.doesNotMatch(r.log, /::notice::/)
  } finally {
    w.cleanup()
  }
})

test('dry_run_plan_synthesizes_every_public_package_when_the_plan_is_empty', () => {
  const w = workspace()
  try {
    const r = run(w.dir, { version: 1, plan: [] })
    assert.equal(r.status, 0, r.log)
    assert.deepEqual(r.out, { version: 1, plan: [[entry('core'), entry('react')]] })
    assert.equal(r.gh, 'synthetic=true\n')
    assert.match(r.log, /::notice::The publish plan is empty/)
    assert.deepEqual(dryRunPlan({ version: 1, plan: [[]] }, w.dir).synthetic, true)
  } finally {
    w.cleanup()
  }
})

test('dry_run_plan_fails_on_a_malformed_plan', () => {
  const w = workspace()
  try {
    for (const bad of ['not json', { version: 2, plan: [] }, { version: 1, plan: [{}] }]) {
      const r = run(w.dir, bad)
      assert.notEqual(r.status, 0, JSON.stringify(bad))
    }
  } finally {
    w.cleanup()
  }
})

test('dry_run_plan_synthesizes_all_eight_repository_packages', () => {
  const entries = workspaceEntries(root)
  assert.equal(entries.length, 8)
  for (const e of entries) {
    const pkg = JSON.parse(
      readFileSync(
        join(root, 'packages', e.name.slice('@toolmark/'.length), 'package.json'),
        'utf8',
      ),
    )
    assert.equal(e.version, pkg.version)
  }
})
