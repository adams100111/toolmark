// Tests for scripts/check-workflows.mjs. Run with `node --test "scripts/*.test.mjs"`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const SCRIPT = join(here, 'check-workflows.mjs')
const FIXTURES = join(here, 'fixtures', 'check-workflows')

function check(...files) {
  const r = spawnSync(process.execPath, [SCRIPT, ...files.map((f) => join(FIXTURES, f))], {
    encoding: 'utf8',
  })
  return { status: r.status, output: `${r.stdout}${r.stderr}` }
}

test('check_workflows_accepts_hardened_workflow', () => {
  const r = check('good.yml')
  assert.equal(r.status, 0, r.output)
  assert.match(r.output, /PASS .*good\.yml/)
})

test('check_workflows_rejects_unpinned_action', () => {
  const r = check('unpinned.yml')
  assert.equal(r.status, 1, r.output)
  assert.match(r.output, /FAIL .*unpinned\.yml.*actions\/checkout@v7.*40-char commit SHA/)
})

test('check_workflows_rejects_sha_without_version_comment', () => {
  const r = check('sha-without-version-comment.yml')
  assert.equal(r.status, 1, r.output)
  assert.match(r.output, /FAIL .*# vX\.Y\.Z/)
})

test('check_workflows_rejects_missing_top_level_permissions', () => {
  const r = check('missing-top-level-permissions.yml')
  assert.equal(r.status, 1, r.output)
  assert.match(r.output, /FAIL .*top-level `permissions: \{\}`/)
})

test('check_workflows_rejects_broad_top_level_permissions', () => {
  const r = check('broad-top-level-permissions.yml')
  assert.equal(r.status, 1, r.output)
  assert.match(r.output, /FAIL .*top-level `permissions: \{\}`/)
})

test('check_workflows_rejects_persisted_checkout_credentials', () => {
  const r = check('persisted-credentials.yml')
  assert.equal(r.status, 1, r.output)
  assert.match(r.output, /FAIL .*job "build".*persist-credentials: false/)
})

test('check_workflows_allows_named_push_job', () => {
  const r = check('push-job.yml')
  assert.equal(r.status, 0, r.output)
})

test('check_workflows_rejects_unexplained_persisted_credentials', () => {
  const r = check('push-job-unexplained.yml')
  assert.equal(r.status, 1, r.output)
  assert.match(r.output, /FAIL .*job "release".*push/)
})

test('check_workflows_rejects_pull_request_target', () => {
  const r = check('pull-request-target.yml')
  assert.equal(r.status, 1, r.output)
  assert.match(r.output, /FAIL .*pull_request_target/)
})

test('check_workflows_rejects_missing_concurrency', () => {
  const r = check('missing-concurrency.yml')
  assert.equal(r.status, 1, r.output)
  assert.match(r.output, /FAIL .*concurrency/)
})

test('check_workflows_reports_every_file_and_fails_if_any_fails', () => {
  const r = check('good.yml', 'unpinned.yml')
  assert.equal(r.status, 1, r.output)
  assert.match(r.output, /PASS .*good\.yml/)
  assert.match(r.output, /FAIL .*unpinned\.yml/)
})

test('check_workflows_defaults_to_repository_workflows', () => {
  const r = spawnSync(process.execPath, [SCRIPT, '--list'], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.match(r.stdout, /\.github\/workflows\/ci\.yml/)
})

test('check_workflows_accepts_read_only_pull_request_jobs', () => {
  const r = check('pr-read-only.yml')
  assert.equal(r.status, 0, r.output)
  assert.match(r.output, /PASS .*pr-read-only\.yml/)
})

test('check_workflows_rejects_write_permissions_on_pull_request_jobs', () => {
  const r = check('pr-write-permissions.yml')
  assert.equal(r.status, 1, r.output)
  assert.match(r.output, /FAIL .*job "label" can run on `pull_request`.*write permissions/)
  // `||` does not rule pull_request out.
  assert.match(r.output, /FAIL .*job "publish" can run on `pull_request`.*write permissions/)
})

test('check_workflows_rejects_secrets_in_pull_request_jobs', () => {
  const r = check('pr-secrets.yml')
  assert.equal(r.status, 1, r.output)
  assert.match(r.output, /FAIL .*job "test" can run on `pull_request` and must not use secrets/)
})

test('check_workflows_rejects_workflow_env_secrets_on_pull_request', () => {
  const r = check('pr-env-secrets.yml')
  assert.equal(r.status, 1, r.output)
  assert.match(r.output, /FAIL .*workflow-level `env` uses secrets/)
})

// Release pipeline review (SEC-14, SEC-19, SEC-21 in docs/security/review-2026.md).

test('check_workflows_rejects_workflow_run', () => {
  const r = check('workflow-run.yml')
  assert.equal(r.status, 1, r.output)
  assert.match(r.output, /FAIL .*must not trigger on `workflow_run`/)
})

test('check_workflows_rejects_untrusted_expressions_in_run', () => {
  const r = check('run-injection.yml')
  assert.equal(r.status, 1, r.output)
  for (const expr of [
    'github.head_ref',
    'inputs.name',
    'github.event.pull_request.title',
    'steps.meta.outputs.keys',
    'needs.greet.outputs.value',
  ]) {
    assert.match(
      r.output,
      new RegExp(`FAIL .*\\$\\{\\{ ${expr.replace(/\./g, '\\.')} \\}\\}.*run:.*env:`),
      expr,
    )
  }
})

test('check_workflows_accepts_env_passed_values_in_run', () => {
  const r = check('run-safe.yml')
  assert.equal(r.status, 0, r.output)
})

test('check_workflows_rejects_cache_in_privileged_jobs', () => {
  const r = check('privileged-cache.yml')
  assert.equal(r.status, 1, r.output)
  // id-token: write
  assert.match(r.output, /FAIL .*job "publish".*cache/)
  // feeds `publish` through `needs`
  assert.match(r.output, /FAIL .*job "build".*cache/)
  // uses secrets
  assert.match(r.output, /FAIL .*job "notify".*cache/)
  // write permission, setup-node without `package-manager-cache: false`
  assert.match(r.output, /FAIL .*job "label".*package-manager-cache: false/)
  // SEC-23: a `cache:` input on any action (pnpm/action-setup has one), quoted or not, and every
  // actions/cache sub-action.
  assert.match(r.output, /FAIL .*job "pnpm-cache".*pnpm\/action-setup.*cache: true/)
  assert.match(r.output, /FAIL .*job "quoted-cache".*pnpm\/action-setup.*cache: true/)
  assert.match(r.output, /FAIL .*job "cache-save".*actions\/cache\/save/)
  // Unprivileged jobs may cache; a privileged-feeding job that disables the cache passes.
  assert.doesNotMatch(r.output, /job "test"/)
  assert.doesNotMatch(r.output, /job "plan"/)
})

test('check_workflows_accepts_privileged_jobs_without_cache', () => {
  const r = check('privileged-no-cache.yml')
  assert.equal(r.status, 0, r.output)
})

test('check_workflows_rejects_unpinned_foreign_checkout', () => {
  const r = check('foreign-checkout.yml')
  assert.equal(r.status, 1, r.output)
  assert.match(r.output, /FAIL .*job "wpt".*web-platform-tests\/wpt.*40-char commit SHA/)
  assert.doesNotMatch(r.output, /job "pinned"/)
})

test('check_workflows_accepts_version_comment_without_v', () => {
  const r = check('pin-comment-no-v.yml')
  assert.equal(r.status, 0, r.output)
})

test('check_workflows_passes_repository_workflows', () => {
  // The real workflows: spec-watch's step output reaches `run:` through env (SEC-20), wpt is
  // pinned (SEC-14), no privileged job restores a cache (SEC-14) and every pin comment parses.
  const r = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.match(r.stdout, /check-workflows: \d+ passed, 0 failed/)
})
