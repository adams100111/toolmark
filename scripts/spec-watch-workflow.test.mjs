// SEC-9 regression test (docs/security/review-2026.md): `.github/workflows/spec-watch.yml` runs on
// `pull_request`, so every job that can run for a pull request must be read-only — no write
// permission, no secret, no persisted checkout credential. Write permissions belong only to the
// `schedule` / `workflow_dispatch` jobs, which run the default branch's code.
// Run with `node --test "scripts/*.test.mjs"` (Node >= 22.12). No YAML dependency: the workflow is
// read line by line (two-space indentation, as written).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const WORKFLOW = join(here, '..', '.github', 'workflows', 'spec-watch.yml')

/** The `jobs:` map as `{ name, lines }` blocks (each job's own lines, comments dropped). */
export function jobsOf(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const start = lines.findIndex((l) => l === 'jobs:')
  if (start < 0) return []
  const jobs = []
  let current
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break
    const head = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line)
    if (head) {
      current = { name: head[1], lines: [] }
      jobs.push(current)
      continue
    }
    if (current && !/^\s*#/.test(line)) current.lines.push(line)
  }
  return jobs
}

/** The job's `if:` expression, or `''`. */
function condition(job) {
  const line = job.lines.find((l) => /^ {4}if:/.test(l))
  return line ? line.replace(/^ {4}if:\s*/, '').trim() : ''
}

/** Whether the job can run for a `pull_request` event. */
export function runsOnPullRequest(job) {
  const cond = condition(job).replace(/\s+/g, ' ')
  return !/github\.event_name != '?"?pull_request'?"?/.test(cond)
}

/** The job's `permissions:` entries (`{ scope: level }`); `'{}'` → `{}`. */
export function permissionsOf(job) {
  const i = job.lines.findIndex((l) => /^ {4}permissions:/.test(l))
  if (i < 0) return undefined
  const inline = job.lines[i].replace(/^ {4}permissions:\s*/, '').trim()
  if (inline === '{}') return {}
  if (inline !== '') return { all: inline }
  const out = {}
  for (const l of job.lines.slice(i + 1)) {
    const m = /^ {6}([a-z-]+):\s*(\S+)/.exec(l)
    if (!m) break
    out[m[1]] = m[2]
  }
  return out
}

const workflow = readFileSync(WORKFLOW, 'utf8')
const jobs = jobsOf(workflow)

test('sec_9_spec_watch_triggers_on_pull_request', () => {
  // The rest of this test only matters while the workflow has a pull_request trigger.
  assert.match(workflow, /^ {2}pull_request:/m)
  assert.ok(jobs.length >= 2, 'expected the spec-watch jobs to be parsed')
})

test('sec_9_spec_watch_pr_jobs_are_read_only', () => {
  const prJobs = jobs.filter(runsOnPullRequest)
  assert.ok(prJobs.length >= 1, 'a read-only validation job runs on pull requests')
  for (const job of prJobs) {
    const perms = permissionsOf(job)
    assert.ok(perms !== undefined, `${job.name}: a PR job declares its permissions explicitly`)
    for (const [scope, level] of Object.entries(perms)) {
      assert.ok(
        level === 'read' || level === 'none',
        `${job.name}: permission ${scope}: ${level} on a pull_request job`,
      )
    }
    const body = job.lines.join('\n')
    assert.doesNotMatch(body, /secrets\./, `${job.name}: a PR job uses no secrets`)
    assert.doesNotMatch(body, /GH_TOKEN|GITHUB_TOKEN/, `${job.name}: a PR job gets no token`)
    assert.doesNotMatch(
      body,
      /persist-credentials:\s*true/,
      `${job.name}: a PR job persists no checkout credential`,
    )
  }
})

test('sec_9_spec_watch_write_jobs_skip_pull_requests', () => {
  for (const job of jobs) {
    const perms = permissionsOf(job) ?? {}
    const writes = Object.values(perms).some((level) => level === 'write' || level === 'write-all')
    const usesSecrets = /secrets\./.test(job.lines.join('\n'))
    if (writes || usesSecrets) {
      assert.equal(runsOnPullRequest(job), false, `${job.name} must not run on pull_request`)
    }
  }
})
