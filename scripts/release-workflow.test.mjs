// Release pipeline review regression tests (SEC-14..SEC-18, docs/security/review-2026.md):
// `.github/workflows/release.yml` keeps the publish-path guards the review asked for, and
// docs/release/release-workflow.md lists the environment's deployment-branch policy as a gate.
// Run with `node --test "scripts/*.test.mjs"`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const workflow = parse(readFileSync(join(root, '.github', 'workflows', 'release.yml'), 'utf8'))
const doc = readFileSync(join(root, 'docs', 'release', 'release-workflow.md'), 'utf8')

/** Index of the first step of `job` whose `name`/`uses`/`run` matches `re`, or -1. */
function stepIndex(job, re) {
  return workflow.jobs[job].steps.findIndex((s) =>
    re.test(`${s.name ?? ''} ${s.uses ?? ''} ${s.run ?? ''}`),
  )
}

test('sec_14_jobs_feeding_publish_restore_no_cache', () => {
  for (const job of ['select-mode', 'pack', 'version', 'publish']) {
    for (const step of workflow.jobs[job].steps) {
      if (!/^actions\/setup-node@/.test(step.uses ?? '')) continue
      assert.equal(step.with?.cache, undefined, `${job}: setup-node has no cache input`)
      assert.equal(
        step.with?.['package-manager-cache'],
        false,
        `${job}: package-manager-cache false`,
      )
    }
    assert.equal(stepIndex(job, /actions\/cache/), -1, `${job}: no actions/cache step`)
  }
})

test('sec_15_release_step_runs_the_tag_guard_before_and_after_each_release', () => {
  // The guard's behaviour is tested by running it (scripts/require-tag-at-sha.test.mjs); this
  // pins where the workflow calls it.
  const step = workflow.jobs.publish.steps.find((s) => s.name === 'Git tags and GitHub releases')
  assert.ok(step, 'the tags-and-releases step exists')
  const loop = step.run.slice(step.run.indexOf('while IFS'))
  const guard = /scripts\/require-tag-at-sha\.sh "\$remote" "\$tag" "\$GITHUB_SHA"/
  const after = /scripts\/require-tag-at-sha\.sh --must-exist "\$remote" "\$tag" "\$GITHUB_SHA"/
  const view = loop.indexOf('gh release view')
  const create = loop.indexOf('gh release create')
  assert.ok(view >= 0 && create > view, 'views, then creates the release')
  const before = loop.search(guard)
  assert.ok(before >= 0 && before < view, 'checked before gh release view')
  assert.ok(loop.search(after) > create, 'checked again (tag must exist) after gh release create')
  assert.match(step.run, /remote="\$GITHUB_SERVER_URL\/\$GITHUB_REPOSITORY\.git"/)
})

test('sec_16_publish_checks_plan_against_packed_manifests_first', () => {
  const plan = stepIndex('publish', /check-release-versions\.mjs --plan dist-pack/)
  const publish = stepIndex('publish', /publish-tarballs\.mjs dist-pack/)
  assert.ok(plan >= 0, 'publish runs check-release-versions --plan')
  assert.ok(plan < publish, 'before any npm publish')
  // The loop's own re-checks (path, name, tag, workspace version, integrity) are tested by
  // running scripts/publish-tarballs.mjs (publish-tarballs.test.mjs).
  assert.doesNotMatch(workflow.jobs.publish.steps[publish].run, /--dry-run/)
})

test('sec_22_publish_asks_npm_what_each_tarball_is_before_publishing', () => {
  const plan = stepIndex('publish', /check-release-versions\.mjs --plan dist-pack/)
  const npm = stepIndex('publish', /check-release-versions\.mjs --npm-dry-run dist-pack/)
  const publish = stepIndex('publish', /publish-tarballs\.mjs dist-pack/)
  assert.ok(npm > plan, 'after the packed-manifest check')
  assert.ok(npm < publish, 'before any npm publish')
  // No token reaches the dry-run step (the script also strips the environment it gives npm).
  assert.equal(workflow.jobs.publish.steps[npm].env, undefined)
})

test('i3_release_dry_run_checks_a_synthetic_plan_when_the_publish_plan_is_empty', () => {
  const plan = stepIndex('release-dry-run', /changeset publish-plan --output/)
  const check = stepIndex('release-dry-run', /release-dry-run-plan\.mjs/)
  const pack = stepIndex('release-dry-run', /changeset pack --from-publish-plan/)
  assert.ok(plan >= 0 && check > plan && pack > check, 'plan → dry-run plan → pack')
  assert.match(workflow.jobs['release-dry-run'].steps[pack].run, /check-plan\.json/)
  // Every later step runs unconditionally (no step is skipped for an empty plan).
  for (const step of workflow.jobs['release-dry-run'].steps) assert.equal(step.if, undefined)
})

test('i4_release_dry_run_runs_the_publish_checks_and_loop_in_order', () => {
  const job = 'release-dry-run'
  const order = [
    /changeset pack --from-publish-plan/,
    /\.changeset\/pre\.json[\s\S]*check-release-versions\.mjs --stable/,
    /check-release-versions\.mjs --tarballs dist-pack/,
    /check-release-versions\.mjs --plan dist-pack/,
    /check-release-versions\.mjs --npm-dry-run dist-pack/,
    /publish-tarballs\.mjs --dry-run dist-pack/,
  ].map((re) => stepIndex(job, re))
  assert.ok(
    order.every((i) => i >= 0),
    `every step exists: ${order}`,
  )
  assert.deepEqual(
    [...order].sort((a, b) => a - b),
    order,
    'in the publish job order',
  )
  for (const step of workflow.jobs[job].steps) {
    assert.doesNotMatch(step.run ?? '', /npm publish/, 'release-dry-run never runs npm publish')
    assert.equal(step.env?.NPM_BOOTSTRAP_TOKEN, undefined)
  }
})

test('m9_dist_e2e_runs_assert_the_dist_build', () => {
  const ci = parse(readFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'utf8'))
  const steps = [
    ...workflow.jobs['release-dry-run'].steps,
    ...Object.values(ci.jobs).flatMap((j) => j.steps ?? []),
  ].filter((s) => s.env?.TOOLMARK_DIST === '1')
  assert.ok(steps.length >= 2)
  for (const s of steps) assert.match(s.run, /e2e\/dist-resolution\.spec\.ts/)
})

test('sec_17_doc_lists_main_only_deployment_branches_as_a_gate', () => {
  const gates = doc.slice(doc.indexOf('## What stops a publish'), doc.indexOf('## Publish path'))
  assert.match(gates, /Required owner gate/)
  assert.match(gates, /deployment branch policy/)
  assert.match(gates, /\*\*`main` only\*\*/)
  assert.match(gates, /environments\/npm-release/)
})

test('sec_18_publish_refuses_private_repositories', () => {
  assert.match(workflow.jobs.publish.if, /!github\.event\.repository\.private/)
  assert.doesNotMatch(workflow.jobs.publish.if, /\|\|/)
})
