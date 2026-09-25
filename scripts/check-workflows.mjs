#!/usr/bin/env node
// Workflow hardening check (M5 Task 2, "Workflow hardening" in the M5 plan's global constraints).
//
//   node scripts/check-workflows.mjs [<workflow.yml> ...]   (default: .github/workflows/*.y{a,}ml)
//   node scripts/check-workflows.mjs --list                  (prints the default file list)
//
// Every workflow must:
//   - set top-level `permissions: {}` (jobs grant what they need);
//   - set top-level `concurrency`;
//   - never trigger on `pull_request_target`;
//   - pin every non-local action (`uses:`) to a full 40-char commit SHA with a trailing
//     `# vX.Y.Z` comment;
//   - run `actions/checkout` with `persist-credentials: false`, except in a job that must push:
//     that job sets `persist-credentials: true` explicitly and names the exception in a comment
//     inside the job that mentions "push" (for example `# Exception ...: this job pushes ...`).
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
  if (events(doc.on ?? doc[true]).includes('pull_request_target')) {
    problems.push('must not trigger on `pull_request_target`')
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
