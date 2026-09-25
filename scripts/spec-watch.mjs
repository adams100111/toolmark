#!/usr/bin/env node
// Weekly WebMCP spec-watch (M5 Task 6; spec §21 "post-release weekly spec-watch", D28).
//
// Fetches the watched WebMCP sources, compares each one's SHA-256 against `.spec-watch/state.json`
// and, on a change, opens or updates a GitHub issue titled "WebMCP spec changed: <key>" with a
// unified-diff excerpt (via `gh issue create`/`gh issue edit`). State (including each source's last
// fetched text, so the *next* change has something to diff against) is only written when a change
// was handled and `SPEC_WATCH_DRY_RUN` is not set. In dry-run mode the script only prints what it
// would do: no `gh` calls, no state write.
//
// Usage: node scripts/spec-watch.mjs [--state .spec-watch/state.json] [--sources <file.json>]
//   --state    Path to the state file (default: .spec-watch/state.json under the repo root).
//   --sources  Path to a JSON file `[{ "key": "...", "url": "..." }, ...]` overriding the built-in
//              watched sources. Used by scripts/spec-watch.test.mjs to point at local fixtures
//              (a `file://` URL is read from disk, never fetched) so tests need no network access.
//
// Env: SPEC_WATCH_DRY_RUN=1 skips every `gh` call and every write (issue-only run). GITHUB_OUTPUT,
// when set, receives `changed` (true/false) and `changed-keys` (comma-separated) for the workflow's
// follow-up git-commit-and-PR step.
//
// Exit codes: 0 ok (with or without changes); 1 a source could not be fetched; 2 usage error.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// Verified 2026-09-25 (raw.githubusercontent.com, 200 OK; repo default branch `main`; the repo
// carries exactly these three files at its root: index.bs, implementation-status.md,
// declarative-api-explainer.md).
export const DEFAULT_SOURCES = [
  {
    key: 'index.bs',
    url: 'https://raw.githubusercontent.com/webmachinelearning/webmcp/main/index.bs',
  },
  {
    key: 'implementation-status.md',
    url: 'https://raw.githubusercontent.com/webmachinelearning/webmcp/main/implementation-status.md',
  },
  {
    key: 'declarative-api-explainer.md',
    url: 'https://raw.githubusercontent.com/webmachinelearning/webmcp/main/declarative-api-explainer.md',
  },
]

export function sha256Hex(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/** Reads `url`: a `file://` URL is read from disk (tests point here, never over the network);
 * anything else is fetched with the global `fetch`. Throws on a non-2xx response. */
export async function fetchText(url) {
  if (url.startsWith('file://')) {
    return readFileSync(fileURLToPath(url), 'utf8')
  }
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  return res.text()
}

export function loadState(path) {
  if (!existsSync(path)) return { sources: {} }
  const parsed = JSON.parse(readFileSync(path, 'utf8'))
  return { sources: {}, ...parsed }
}

export function saveState(path, state) {
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`)
}

function splitLines(text) {
  return text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n')
}

/**
 * A minimal LCS-based line diff, returned as `{ type: 'equal' | 'add' | 'del', line }[]`.
 * `type` reads from `a`'s perspective: `del` = only in `a` (old), `add` = only in `b` (new).
 */
export function diffLines(a, b) {
  const n = a.length
  const m = b.length
  // dp[i][j] = LCS length of a[i:] and b[j:]
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const ops = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: 'equal', line: a[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: 'del', line: a[i] })
      i++
    } else {
      ops.push({ type: 'add', line: b[j] })
      j++
    }
  }
  while (i < n) ops.push({ type: 'del', line: a[i++] })
  while (j < m) ops.push({ type: 'add', line: b[j++] })
  return ops
}

/**
 * Renders a unified-diff-style excerpt from `oldText` to `newText`: `-`/`+`/` ` prefixed lines,
 * grouped into hunks with `contextLines` of unchanged context, capped at `maxLines` printed lines
 * (a trailing `… (N more changed lines)` note is added when truncated). No `@@` position header
 * (this is an excerpt for a GitHub issue body, not a patch meant to be applied).
 */
export function unifiedDiffExcerpt(oldText, newText, { contextLines = 3, maxLines = 60 } = {}) {
  const ops = diffLines(splitLines(oldText), splitLines(newText))
  const changedTotal = ops.filter((o) => o.type !== 'equal').length
  if (changedTotal === 0) return ''

  const out = []
  let sinceChangePrinted = Infinity // how many equal lines printed since the last change
  let pendingEqual = [] // buffered equal lines, flushed as trailing context after a change

  const flushPendingEqual = () => {
    const take = pendingEqual.slice(0, contextLines)
    for (const line of take) out.push({ type: 'equal', line })
    pendingEqual = []
  }

  for (const op of ops) {
    if (out.length >= maxLines) break
    if (op.type === 'equal') {
      if (sinceChangePrinted < contextLines) {
        out.push(op)
        sinceChangePrinted++
      } else {
        pendingEqual.push(op.line)
      }
    } else {
      // leading context before this change, then the change itself
      const lead = pendingEqual.slice(-contextLines)
      for (const line of lead) out.push({ type: 'equal', line })
      pendingEqual = []
      out.push(op)
      sinceChangePrinted = 0
    }
  }

  let printedChanged = 0
  const lines = []
  for (const o of out.slice(0, maxLines)) {
    if (o.type === 'add') {
      lines.push(`+${o.line}`)
      printedChanged++
    } else if (o.type === 'del') {
      lines.push(`-${o.line}`)
      printedChanged++
    } else {
      lines.push(` ${o.line}`)
    }
  }
  if (printedChanged < changedTotal) {
    lines.push(`… (${changedTotal - printedChanged} more changed lines)`)
  }
  return lines.join('\n')
}

export function issueTitle(key) {
  return `WebMCP spec changed: ${key}`
}

export function formatIssueBody({ key, url, oldSha, newSha, diff }) {
  return [
    `The watched WebMCP source \`${key}\` changed.`,
    '',
    `- Source: <${url}>`,
    `- Previous SHA-256: \`${oldSha.slice(0, 12)}…\``,
    `- New SHA-256: \`${newSha.slice(0, 12)}…\``,
    '',
    '```diff',
    diff,
    '```',
    '',
    '_Opened by the weekly spec-watch workflow (spec §21, D28). WPT results, when informative, land',
    'in a separate `WebMCP adapter failing on Chrome Canary` issue — this one is about the spec text',
    'itself._',
  ].join('\n')
}

function ghSpawn(args) {
  const result = spawnSync('gh', args, { encoding: 'utf8' })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`gh ${args[0]} ${args[1] ?? ''} exited ${result.status}: ${result.stderr}`)
  }
  return result.stdout
}

/** The open issue titled exactly `title`, or undefined. */
function findOpenIssue(title) {
  const stdout = ghSpawn([
    'issue',
    'list',
    '--state',
    'open',
    '--search',
    `"${title}" in:title`,
    '--json',
    'number,title',
    '--limit',
    '10',
  ])
  const issues = JSON.parse(stdout || '[]')
  return issues.find((issue) => issue.title === title)
}

function openOrUpdateIssue(title, body) {
  const existing = findOpenIssue(title)
  if (existing) {
    ghSpawn(['issue', 'edit', String(existing.number), '--body', body])
    return { action: 'updated', number: existing.number }
  }
  ghSpawn(['issue', 'create', '--title', title, '--body', body])
  return { action: 'created' }
}

/**
 * Checks one source against `state` (mutated in place on a handled, non-dry-run change or a new
 * baseline). Returns `{ key, changed, baseline?, error? }`.
 */
export async function checkSource({ key, url }, state, { dryRun, now, log }) {
  let text
  try {
    text = await fetchText(url)
  } catch (err) {
    log(`error: ${key}: ${err instanceof Error ? err.message : String(err)}`)
    return { key, changed: false, error: true }
  }
  const sha256 = sha256Hex(text)
  const prev = state.sources[key]

  if (!prev) {
    log(`baseline recorded for ${key} (no prior state to compare against)`)
    if (!dryRun) state.sources[key] = { url, sha256, checkedAt: now, content: text }
    return { key, changed: false, baseline: true }
  }

  if (prev.sha256 === sha256) {
    log(`unchanged: ${key}`)
    return { key, changed: false }
  }

  const diff = unifiedDiffExcerpt(prev.content ?? '', text)
  const title = issueTitle(key)
  const body = formatIssueBody({ key, url, oldSha: prev.sha256, newSha: sha256, diff })

  if (dryRun) {
    log(`[dry run] would open/update issue: ${title}`)
    log(body)
    return { key, changed: true }
  }

  const outcome = openOrUpdateIssue(title, body)
  log(`${outcome.action} issue: ${title}`)
  state.sources[key] = { url, sha256, checkedAt: now, content: text }
  return { key, changed: true }
}

export async function runSpecWatch({ sources, statePath, dryRun, log = console.log }) {
  const state = loadState(statePath)
  const results = []
  for (const source of sources) {
    // eslint-disable-next-line no-await-in-loop -- sources are few; sequential keeps gh calls ordered
    results.push(await checkSource(source, state, { dryRun, now: new Date().toISOString(), log }))
  }
  if (!dryRun) saveState(statePath, state)

  const changed = results.filter((r) => r.changed)
  const failed = results.filter((r) => r.error)
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `changed=${changed.length > 0}\nchanged-keys=${changed.map((r) => r.key).join(',')}\n`,
    )
  }
  return { results, changed, failed }
}

function parseArgs(argv) {
  const opts = { state: resolve(repoRoot, '.spec-watch/state.json'), sources: null }
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    const value = argv[i + 1]
    if (flag === '--state' && value !== undefined) {
      opts.state = resolve(value)
      i++
    } else if (flag === '--sources' && value !== undefined) {
      opts.sources = resolve(value)
      i++
    } else {
      console.error(`unknown argument: ${flag}`)
      process.exit(2)
    }
  }
  return opts
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const sources = opts.sources ? JSON.parse(readFileSync(opts.sources, 'utf8')) : DEFAULT_SOURCES
  const dryRun = process.env.SPEC_WATCH_DRY_RUN === '1'

  const { results, changed, failed } = await runSpecWatch({
    sources,
    statePath: opts.state,
    dryRun,
  })

  console.log(
    `spec-watch: ${results.length} source(s) checked, ${changed.length} changed, ${failed.length} failed${dryRun ? ' (dry run)' : ''}`,
  )
  process.exit(failed.length > 0 ? 1 : 0)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
