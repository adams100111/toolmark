// Tests for scripts/check-no-app-code.mjs. Run with `node --test "scripts/*.test.mjs"`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const SCRIPT = join(here, 'check-no-app-code.mjs')
const FIXTURES = join(here, 'fixtures', 'check-no-app-code')

function run(fixture) {
  const r = spawnSync(process.execPath, [SCRIPT, '--root', join(FIXTURES, fixture)], {
    encoding: 'utf8',
  })
  return { status: r.status, output: `${r.stdout}${r.stderr}` }
}

test('check_no_app_code_passes_generic_sources', () => {
  const r = run('clean')
  assert.equal(r.status, 0, r.output)
})

test('check_no_app_code_flags_innovation', () => {
  const r = run('flagged')
  assert.equal(r.status, 1, r.output)
  assert.match(r.output, /FAIL packages\/widget\/src\/index\.ts:1: .*Innovation/)
})

test('check_no_app_code_flags_readme_terms', () => {
  const r = run('flagged-readme')
  assert.equal(r.status, 1, r.output)
  assert.match(r.output, /FAIL packages\/widget\/README\.md:3: .*ChallengeForm/)
})
