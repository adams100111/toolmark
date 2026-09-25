#!/usr/bin/env node
// Workflow hardening check (M5 Task 2, "Workflow hardening" in the M5 plan's global constraints).
//
//   node scripts/check-workflows.mjs [<workflow.yml> ...]   (default: .github/workflows/*.y{a,}ml)
//   node scripts/check-workflows.mjs --list                  (prints the default file list)
//
// Every workflow must:
//   - set top-level `permissions: {}` (jobs grant what they need);
//   - set top-level `concurrency`;
//   - never trigger on `pull_request_target` or `workflow_run`;
//   - pin every non-local action (`uses:`) to a full 40-char commit SHA with a trailing
//     `# vX.Y.Z` (or `# X.Y.Z`, for tags without a `v`) comment;
//   - check out another repository (`actions/checkout` with `repository:`) only at a `ref:` that
//     is a full 40-char commit SHA;
//   - never interpolate `${{ ... }}` over an untrusted or step-derived context (`github.head_ref`,
//     `github.event.*`, `inputs.*`, `steps.<id>.outputs.*`, `needs.<id>.outputs.*`) inside a
//     `run:` script; pass it through the step's `env:` and use "$VAR" instead;
//   - restore no cache in a privileged job — one with any `write` permission (including
//     `id-token: write`) or that uses `secrets.*` / `github.token` — or in any job it `needs`,
//     directly or transitively: no `actions/cache` (or `cache/restore`), no `cache:` input on an
//     `actions/setup-*` step, and `actions/setup-node` sets `package-manager-cache: false`
//     (a cache entry written by any other default-branch job could plant code in the build);
//   - run `actions/checkout` with `persist-credentials: false`, except in a job that must push:
//     that job sets `persist-credentials: true` explicitly and names the exception in a comment
//     inside the job that mentions "push" (for example `# Exception ...: this job pushes ...`);
//   - in a workflow triggered by `pull_request` (or `pull_request_review[_comment]`), give every
//     job that can run on such an event (one whose `if:` does not rule the event out) no write
//     permission and no secrets: its `permissions` are `{}` or `contents: read` only, and neither
//     the job nor the workflow-level `env` uses `secrets.*` (or `secrets: inherit`). A job is ruled
//     out only by an `if:` without `||` that contains `github.event_name != 'pull_request'` or
//     `github.event_name == '<a non-PR event>'`.
//
// Prints one PASS/FAIL line per file (a FAIL line per problem) and exits 0 or 1.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isMap, parseDocument } from 'yaml'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const SHA_PIN = /^[\w.-]+\/[\w.-]+(\/[^@\s]+)?@[0-9a-f]{40}$/
const VERSION_COMMENT = /^v?\d+\.\d+\.\d+\b/

function defaultFiles() {
  const dir = join(repoRoot, '.github', 'workflows')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f))
    .sort()
    .map((f) => join(dir, f))
}

/** `on:` may be a string, a list or a map; returns the event names. */
function events(on) {
  if (typeof on === 'string') return [on]
  if (Array.isArray(on)) return on
  if (on && typeof on === 'object') return Object.keys(on)
  return []
}

/** Events whose runs execute pull-request code and must stay read-only and secret-free. */
const PR_EVENTS = new Set(['pull_request', 'pull_request_review', 'pull_request_review_comment'])

/**
 * Whether a job-level `if:` provably keeps the job off the PR events `triggers` (conservative):
 * an expression without `||` that tests `github.event_name != '<event>'` for each of them, or
 * `github.event_name == '<a non-PR event>'`.
 */
function excludesPullRequests(cond, triggers) {
  if (typeof cond !== 'string') return false
  // `||` or a negated group could let a PR event through; do not try to reason about them.
  if (cond.includes('||') || /!\s*\(/.test(cond)) return false
  const names = (op) =>
    [...cond.matchAll(new RegExp(`github\\.event_name\\s*${op}\\s*['"]([\\w-]+)['"]`, 'g'))].map(
      (m) => m[1],
    )
  const ne = names('!=')
  if (triggers.every((e) => ne.includes(e))) return true
  return names('==').some((e) => !PR_EVENTS.has(e))
}

/** Text without YAML comments (whole-line and trailing ` # ...`), for secret scanning. */
function stripComments(text) {
  return text
    .split('\n')
    .map((line) => (/^\s*#/.test(line) ? '' : line.replace(/\s+#.*$/, '')))
    .join('\n')
}

const USES_SECRETS = /\bsecrets\s*(?:\.|\[|:\s*inherit\b)/

/** Whether job permissions are `{}` or `contents: read` only. */
function readOnlyPermissions(perms) {
  if (perms === undefined || perms === null) return true
  if (typeof perms !== 'object' || Array.isArray(perms)) return false
  return Object.entries(perms).every(([k, v]) => k === 'contents' && v === 'read')
}

/** `${{ }}` contexts that must reach a `run:` script through `env:` (attacker- or step-derived). */
const UNTRUSTED_EXPR =
  /\b(?:github\.head_ref|github\.event\.|inputs\.|steps\.[\w-]+\.outputs|needs\.[\w-]+\.outputs)/

/** Whether job permissions grant any `write` (including `id-token: write`, `write-all`). */
function hasWritePermission(perms) {
  if (typeof perms === 'string') return /write/.test(perms)
  if (!perms || typeof perms !== 'object') return false
  return Object.values(perms).some((v) => v === 'write')
}

/** Whether a job's source (comments stripped) uses a secret or the `GITHUB_TOKEN`. */
function usesToken(source) {
  const text = stripComments(source ?? '')
  return USES_SECRETS.test(text) || /\bgithub\.token\b/.test(text)
}

/** `uses:` lines with their trailing comment, from the raw text (the parser drops comments). */
function usesLines(text) {
  const out = []
  text.split('\n').forEach((line, i) => {
    const m = /^\s*(?:-\s+)?uses:\s*(['"]?)([^'"\s#]+)\1\s*(?:#\s*(.*))?$/.exec(line)
    if (m) out.push({ line: i + 1, ref: m[2], comment: (m[3] ?? '').trim() })
  })
  return out
}

function checkFile(file) {
  const problems = []
  const text = readFileSync(file, 'utf8')
  const parsed = parseDocument(text)
  if (parsed.errors.length > 0) return [`invalid YAML: ${parsed.errors[0].message}`]
  const doc = parsed.toJS()
  if (!doc || typeof doc !== 'object') return ['not a workflow (empty or not a map)']

  const perms = doc.permissions
  if (
    !perms ||
    typeof perms !== 'object' ||
    Array.isArray(perms) ||
    Object.keys(perms).length !== 0
  ) {
    problems.push('needs top-level `permissions: {}` (grant permissions per job)')
  }
  if (doc.concurrency === undefined || doc.concurrency === null) {
    problems.push('needs top-level `concurrency`')
  }
  for (const banned of ['pull_request_target', 'workflow_run']) {
    if (events(doc.on ?? doc[true]).includes(banned)) {
      problems.push(`must not trigger on \`${banned}\``)
    }
  }

  for (const { line, ref, comment } of usesLines(text)) {
    if (ref.startsWith('./') || ref.startsWith('docker://')) continue
    if (!SHA_PIN.test(ref)) {
      problems.push(`line ${line}: \`${ref}\` is not pinned to a full 40-char commit SHA`)
    } else if (!VERSION_COMMENT.test(comment)) {
      problems.push(`line ${line}: \`${ref}\` needs a trailing \`# vX.Y.Z\` version comment`)
    }
  }

  // The raw source of each job (key through value), to find its explanatory comments.
  const jobsNode = parsed.get('jobs', true)
  const jobSource = new Map()
  if (isMap(jobsNode)) {
    for (const pair of jobsNode.items) {
      const start = pair.key?.range?.[0] ?? 0
      const end = pair.value?.range?.[2] ?? start
      jobSource.set(String(pair.key?.value ?? pair.key), text.slice(start, end))
    }
  }
  for (const [jobId, job] of Object.entries(doc.jobs ?? {})) {
    for (const step of job?.steps ?? []) {
      if (typeof step?.uses !== 'string' || !/^actions\/checkout@/.test(step.uses)) continue
      const persist = step.with?.['persist-credentials']
      if (persist === false || persist === 'false') continue
      const explained = /^\s*#.*\bpush/im.test(jobSource.get(jobId) ?? '')
      if ((persist === true || persist === 'true') && explained) continue
      problems.push(
        `job "${jobId}": actions/checkout needs \`persist-credentials: false\`; a job that must ` +
          'push sets `persist-credentials: true` and says so in a comment inside the job',
      )
    }
  }

  const jobs = Object.entries(doc.jobs ?? {})
  for (const [jobId, job] of jobs) {
    for (const step of job?.steps ?? []) {
      if (typeof step?.uses === 'string' && /^actions\/checkout@/.test(step.uses)) {
        const repo = step.with?.repository
        if (
          typeof repo === 'string' &&
          repo !== '' &&
          !/^[0-9a-f]{40}$/.test(String(step.with?.ref ?? ''))
        ) {
          problems.push(
            `job "${jobId}": checkout of ${repo} needs \`ref:\` pinned to a full 40-char commit SHA`,
          )
        }
      }
      if (typeof step?.run !== 'string') continue
      for (const m of step.run.matchAll(/\$\{\{\s*([\s\S]*?)\s*\}\}/g)) {
        if (UNTRUSTED_EXPR.test(m[1])) {
          problems.push(
            `job "${jobId}": \`\${{ ${m[1]} }}\` inside \`run:\`; pass it through the step's ` +
              '`env:` and use "$VAR"',
          )
        }
      }
    }
  }

  // Privileged jobs and every job they need (transitively) restore no cache.
  const privileged = jobs
    .filter(
      ([jobId, job]) => hasWritePermission(job?.permissions) || usesToken(jobSource.get(jobId)),
    )
    .map(([jobId]) => jobId)
  const guarded = new Set()
  const visit = (jobId) => {
    if (guarded.has(jobId)) return
    guarded.add(jobId)
    const needs = doc.jobs?.[jobId]?.needs
    for (const dep of Array.isArray(needs) ? needs : needs ? [needs] : []) visit(String(dep))
  }
  privileged.forEach(visit)
  for (const jobId of guarded) {
    const why = privileged.includes(jobId) ? 'is privileged' : 'feeds a privileged job'
    for (const step of doc.jobs?.[jobId]?.steps ?? []) {
      const uses = typeof step?.uses === 'string' ? step.uses : ''
      if (/^actions\/cache(\/restore)?@/.test(uses)) {
        problems.push(
          `job "${jobId}" ${why} (write permission, id-token or secrets) and must not restore a cache (${uses.split('@')[0]})`,
        )
      } else if (/^actions\/setup-[\w-]+@/.test(uses) && step.with?.cache) {
        problems.push(
          `job "${jobId}" ${why} (write permission, id-token or secrets) and must not restore a cache (\`cache: ${step.with.cache}\`)`,
        )
      } else if (/^actions\/setup-node@/.test(uses)) {
        const pmc = step.with?.['package-manager-cache']
        if (pmc !== false && pmc !== 'false') {
          problems.push(
            `job "${jobId}" ${why} (write permission, id-token or secrets): actions/setup-node needs \`package-manager-cache: false\``,
          )
        }
      }
    }
  }

  const prTriggers = events(doc.on ?? doc[true]).filter((e) => PR_EVENTS.has(e))
  if (prTriggers.length > 0) {
    if (doc.env !== undefined && USES_SECRETS.test(JSON.stringify(doc.env))) {
      problems.push(
        `workflow-level \`env\` uses secrets, which jobs on \`${prTriggers[0]}\` would receive`,
      )
    }
    for (const [jobId, job] of jobs) {
      if (excludesPullRequests(job?.if, prTriggers)) continue
      if (!readOnlyPermissions(job?.permissions)) {
        problems.push(
          `job "${jobId}" can run on \`${prTriggers[0]}\` and must not have write permissions ` +
            '(allowed: `permissions: {}` or `contents: read` only)',
        )
      }
      if (USES_SECRETS.test(stripComments(jobSource.get(jobId) ?? ''))) {
        problems.push(`job "${jobId}" can run on \`${prTriggers[0]}\` and must not use secrets`)
      }
    }
  }
  return problems
}

const args = process.argv.slice(2)
if (args.includes('--list')) {
  for (const f of defaultFiles()) console.log(relative(repoRoot, f))
  process.exit(0)
}
const files = args.length > 0 ? args.map((f) => resolve(f)) : defaultFiles()
if (files.length === 0) {
  console.log('FAIL check-workflows: no workflow files')
  process.exit(1)
}
let failed = 0
for (const file of files) {
  const label = relative(process.cwd(), file) || file
  const problems = existsSync(file) ? checkFile(file) : ['file not found']
  if (problems.length === 0) console.log(`PASS ${label}`)
  for (const p of problems) console.log(`FAIL ${label}: ${p}`)
  if (problems.length > 0) failed++
}
console.log(`check-workflows: ${files.length - failed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
