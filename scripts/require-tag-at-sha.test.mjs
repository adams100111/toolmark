// Tests for scripts/require-tag-at-sha.sh (SEC-15): the release job's "an existing tag must point
// at this run's commit" check, run for real against temporary git repositories.
// Run with `node --test "scripts/*.test.mjs"`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'require-tag-at-sha.sh')
const TAG = '@toolmark/core@1.0.0'

// Isolated from the user's git config (signing, hooks, default branch).
const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@example.invalid',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@example.invalid',
}

/** A throwaway repository with two commits; returns `{ dir, git, a, b, cleanup }`. */
function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'toolmark-tag-check-'))
  const git = (...args) =>
    execFileSync('git', ['-C', dir, ...args], { env: GIT_ENV, encoding: 'utf8' }).trim()
  git('init', '-q', '-b', 'main')
  git('commit', '-q', '--allow-empty', '-m', 'a')
  const a = git('rev-parse', 'HEAD')
  git('commit', '-q', '--allow-empty', '-m', 'b')
  const b = git('rev-parse', 'HEAD')
  return { dir, git, a, b, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

function check(args, env = {}) {
  const r = spawnSync('bash', [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...GIT_ENV, REQUIRE_TAG_ATTEMPTS: '1', ...env },
  })
  return { status: r.status, output: `${r.stdout}${r.stderr}` }
}

test('require_tag_at_sha_accepts_an_absent_tag', () => {
  const r0 = repo()
  try {
    const r = check([r0.dir, TAG, r0.b])
    assert.equal(r.status, 0, r.output)
    const must = check(['--must-exist', r0.dir, TAG, r0.b])
    assert.equal(must.status, 1, must.output)
    assert.match(must.output, /::error::.*does not exist/)
  } finally {
    r0.cleanup()
  }
})

test('require_tag_at_sha_checks_lightweight_tags', () => {
  const r0 = repo()
  try {
    r0.git('tag', TAG, r0.b)
    assert.equal(check([r0.dir, TAG, r0.b]).status, 0)
    assert.equal(check(['--must-exist', r0.dir, TAG, r0.b]).status, 0)
    const r = check([r0.dir, TAG, r0.a])
    assert.equal(r.status, 1, r.output)
    assert.match(r.output, new RegExp(`::error::tag ${TAG} points at ${r0.b}, not ${r0.a}`))
  } finally {
    r0.cleanup()
  }
})

test('require_tag_at_sha_dereferences_annotated_tags', () => {
  const r0 = repo()
  try {
    r0.git('tag', '-a', '-m', 'release', TAG, r0.a)
    assert.equal(check([r0.dir, TAG, r0.a]).status, 0)
    const tagObject = r0.git('rev-parse', TAG)
    assert.notEqual(tagObject, r0.a)
    // The tag object's own id is not the commit.
    assert.equal(check([r0.dir, TAG, tagObject]).status, 1)
    assert.equal(check([r0.dir, TAG, r0.b]).status, 1)
    // A tag of a tag peels to the commit too.
    r0.git('tag', '-a', '-m', 'outer', 'outer', TAG)
    assert.equal(check([r0.dir, 'outer', r0.a]).status, 0)
    assert.equal(check([r0.dir, 'outer', r0.b]).status, 1)
  } finally {
    r0.cleanup()
  }
})

test('require_tag_at_sha_refuses_a_tag_at_a_non_commit', () => {
  const r0 = repo()
  try {
    const tree = r0.git('rev-parse', `${r0.b}^{tree}`)
    r0.git('tag', TAG, tree)
    const r = check([r0.dir, TAG, r0.b])
    assert.equal(r.status, 1, r.output)
  } finally {
    r0.cleanup()
  }
})

test('require_tag_at_sha_matches_the_ref_name_exactly', () => {
  // `git ls-remote` patterns match the tail of a ref name; the script must not.
  const r0 = repo()
  try {
    r0.git('tag', `evil/${TAG}`, r0.a)
    r0.git('branch', `x/refs/tags/${TAG}`, r0.a)
    assert.equal(check([r0.dir, TAG, r0.b]).status, 0)
    assert.equal(check(['--must-exist', r0.dir, TAG, r0.b]).status, 1)
  } finally {
    r0.cleanup()
  }
})

test('require_tag_at_sha_fails_closed_on_remote_errors', () => {
  const missing = join(tmpdir(), 'toolmark-no-such-repo-', String(process.pid))
  const r = check([missing, TAG, 'a'.repeat(40)])
  assert.notEqual(r.status, 0, r.output)
})

test('require_tag_at_sha_usage_errors', () => {
  const r0 = repo()
  try {
    assert.equal(check([]).status, 2)
    assert.equal(check([r0.dir, TAG]).status, 2)
    assert.equal(check([r0.dir, TAG, 'not-a-sha']).status, 2)
    assert.equal(check([r0.dir, '@toolmark/*', r0.b]).status, 2)
    assert.equal(check([r0.dir, '', r0.b]).status, 2)
  } finally {
    r0.cleanup()
  }
})
