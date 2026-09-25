#!/usr/bin/env node
// Checks the structure and resolution state of the release security review (spec §21, M5 Task 4).
//
// The review document (default docs/security/review-2026.md) must contain:
//   - a `## Checklist` section with one `### <n>. <title>` heading for every item 1–14, each with
//     exactly one `**Verdict:** pass` or `**Verdict:** finding (SEC-<n>, …)` line; a `finding`
//     verdict names at least one finding id and every id it names exists in the findings table;
//   - a `## Findings` section whose first table has the header
//     `id | severity | item | summary | evidence | resolution | commit | regression test`, with
//     unique ids `SEC-<n>`, severity `Critical` / `Important` / `Minor`, an item number 1–14 (or
//     several, comma-separated) whose verdict is `finding`, non-empty summary and evidence, and a
//     resolution of `open`, `fixed` or `accepted`. Every finding is referenced by an item verdict.
//
// Default mode checks the structure only (open findings are allowed: the review lists them for
// Task 5). `--resolved` additionally fails while any finding is unresolved: its resolution must be
// `fixed` (with a commit SHA and a regression test) or `accepted` (with a commit SHA recording the
// acceptance; the regression-test cell may then hold the rationale or `—`).
//
// Exit codes: 0 valid (and, with --resolved, every finding resolved); 1 a problem (each printed
// on stderr); 2 usage error or unreadable file.
//
// Usage: node scripts/check-security-review.mjs [--resolved] [docs/security/review-2026.md]
import { readFileSync } from 'node:fs'
import process from 'node:process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_DOC = 'docs/security/review-2026.md'
export const ITEM_COUNT = 14
export const COLUMNS = [
  'id',
  'severity',
  'item',
  'summary',
  'evidence',
  'resolution',
  'commit',
  'regression test',
]
const SEVERITIES = new Set(['Critical', 'Important', 'Minor'])
const RESOLUTIONS = new Set(['open', 'fixed', 'accepted'])
const ID = /^SEC-[1-9]\d*$/
const SHA = /^[0-9a-f]{7,40}$/
const EMPTY = new Set(['', '—', '-', 'n/a'])

/** Splits LF/CRLF text into lines. */
function lines(text) {
  return text.replace(/\r\n?/g, '\n').split('\n')
}

/** Lines of the `## <title>` section (up to the next `## ` heading), or null when absent. */
function section(src, title) {
  const start = src.findIndex((l) => l.trim().toLowerCase() === `## ${title.toLowerCase()}`)
  if (start < 0) return null
  const end = src.findIndex((l, i) => i > start && /^## /.test(l))
  return src.slice(start + 1, end < 0 ? src.length : end)
}

/** Cells of a markdown table row (`| a | b |`), trimmed; `\|` stays a literal pipe. */
function cells(row) {
  const inner = row.trim().replace(/^\|/, '').replace(/\|$/, '')
  return inner.split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').trim())
}

/** Strips markdown code/emphasis around a cell value (`` `open` `` → `open`). */
function plain(cell) {
  return cell.replace(/^[`*_]+|[`*_]+$/g, '').trim()
}

/** Parses the checklist: `Map<item number, { title, verdict, ids }>` plus problems. */
export function parseChecklist(src, problems) {
  const body = section(src, 'Checklist')
  const items = new Map()
  if (body === null) {
    problems.push('missing "## Checklist" section')
    return items
  }
  let current = null
  for (const line of body) {
    const heading = /^### (\d+)\.\s+(.+?)\s*$/.exec(line)
    if (heading) {
      const n = Number(heading[1])
      if (items.has(n)) problems.push(`checklist item ${n} appears twice`)
      current = { n, title: heading[2], verdicts: [] }
      items.set(n, current)
      continue
    }
    const verdict = /^\*\*Verdict:\*\*\s*(.*?)\s*$/.exec(line)
    if (verdict && current) current.verdicts.push(verdict[1])
  }
  const out = new Map()
  for (const [n, item] of items) {
    if (!Number.isInteger(n) || n < 1 || n > ITEM_COUNT) {
      problems.push(`checklist item ${n} is not one of 1–${ITEM_COUNT}`)
      continue
    }
    if (item.verdicts.length !== 1) {
      problems.push(
        `checklist item ${n} needs exactly one "**Verdict:**" line (found ${item.verdicts.length})`,
      )
      continue
    }
    const text = item.verdicts[0]
    const m = /^(pass|finding)\b\s*(?:\(([^)]*)\))?\s*$/.exec(text)
    if (!m) {
      problems.push(
        `checklist item ${n}: verdict must be "pass" or "finding (SEC-<n>, …)": ${text}`,
      )
      continue
    }
    const ids = (m[2] ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s !== '')
    if (m[1] === 'pass' && ids.length > 0) {
      problems.push(`checklist item ${n}: a "pass" verdict names no findings`)
    }
    if (m[1] === 'finding' && ids.length === 0) {
      problems.push(`checklist item ${n}: a "finding" verdict must name at least one SEC id`)
    }
    for (const id of ids) {
      if (!ID.test(id)) problems.push(`checklist item ${n}: "${id}" is not a SEC-<n> id`)
    }
    out.set(n, { title: item.title, verdict: m[1], ids })
  }
  for (let n = 1; n <= ITEM_COUNT; n++) {
    if (!items.has(n)) problems.push(`checklist item ${n} is missing`)
  }
  return out
}

/** Parses the findings table: an array of row objects keyed by {@link COLUMNS}, plus problems. */
export function parseFindings(src, problems) {
  const body = section(src, 'Findings')
  if (body === null) {
    problems.push('missing "## Findings" section')
    return []
  }
  const start = body.findIndex((l) => /^\s*\|/.test(l))
  if (start < 0) {
    problems.push('the "## Findings" section has no table')
    return []
  }
  const header = cells(body[start]).map((c) => c.toLowerCase())
  if (header.join('|') !== COLUMNS.join('|')) {
    problems.push(
      `findings table header must be "${COLUMNS.join(' | ')}" (got "${header.join(' | ')}")`,
    )
    return []
  }
  const rows = []
  for (let i = start + 2; i < body.length && /^\s*\|/.test(body[i]); i++) {
    const c = cells(body[i])
    if (c.length !== COLUMNS.length) {
      problems.push(
        `findings row ${i - start - 1} has ${c.length} cells, expected ${COLUMNS.length}`,
      )
      continue
    }
    rows.push(Object.fromEntries(COLUMNS.map((k, j) => [k, c[j]])))
  }
  return rows
}

/**
 * Validates a review document. Returns the list of problems (empty = valid).
 * @param text - The markdown source.
 * @param opts - `resolved: true` also requires every finding to be resolved.
 */
export function checkReview(text, opts = {}) {
  const problems = []
  const src = lines(text)
  const items = parseChecklist(src, problems)
  const rows = parseFindings(src, problems)

  const ids = new Set()
  for (const row of rows) {
    const id = plain(row.id)
    const where = ID.test(id) ? id : `finding "${row.id}"`
    if (!ID.test(id)) problems.push(`${where}: id must be SEC-<n>`)
    else if (ids.has(id)) problems.push(`${id} appears twice`)
    ids.add(id)

    const severity = plain(row.severity)
    if (!SEVERITIES.has(severity)) {
      problems.push(
        `${where}: severity must be Critical, Important or Minor (got "${row.severity}")`,
      )
    }
    const itemNums = row.item.split(',').map((s) => Number(plain(s)))
    if (
      itemNums.length === 0 ||
      itemNums.some((n) => !Number.isInteger(n) || n < 1 || n > ITEM_COUNT)
    ) {
      problems.push(
        `${where}: item must be checklist item numbers 1–${ITEM_COUNT} (got "${row.item}")`,
      )
    } else {
      for (const n of itemNums) {
        const item = items.get(n)
        if (item && !item.ids.includes(id)) {
          problems.push(`${where}: checklist item ${n} verdict does not name it`)
        }
      }
    }
    if (EMPTY.has(plain(row.summary))) problems.push(`${where}: summary is empty`)
    if (EMPTY.has(plain(row.evidence))) problems.push(`${where}: evidence is empty`)

    const resolution = plain(row.resolution).toLowerCase()
    if (!RESOLUTIONS.has(resolution)) {
      problems.push(
        `${where}: resolution must be open, fixed or accepted (got "${row.resolution}")`,
      )
      continue
    }
    if (!opts.resolved) continue
    const commit = plain(row.commit)
    const test = plain(row['regression test'])
    if (resolution === 'open') {
      problems.push(`${where} (${severity}) is unresolved`)
    } else if (!SHA.test(commit)) {
      problems.push(`${where}: a ${resolution} finding needs the commit SHA that resolved it`)
    } else if (resolution === 'fixed' && EMPTY.has(test)) {
      problems.push(`${where}: a fixed finding needs its regression test`)
    }
  }
  for (const [n, item] of items) {
    for (const id of item.ids) {
      if (!ids.has(id))
        problems.push(`checklist item ${n} names ${id}, which is not in the findings table`)
    }
  }
  return problems
}

function main(argv) {
  let resolved = false
  let doc = DEFAULT_DOC
  let docSet = false
  for (const arg of argv) {
    if (arg === '--resolved') resolved = true
    else if (arg.startsWith('-') || docSet) {
      process.stderr.write(
        'usage: node scripts/check-security-review.mjs [--resolved] [docs/security/review-2026.md]\n',
      )
      return 2
    } else {
      doc = arg
      docSet = true
    }
  }
  let text
  try {
    text = readFileSync(resolve(repoRoot, doc), 'utf8')
  } catch (e) {
    process.stderr.write(`check-security-review: cannot read ${doc}: ${e.message}\n`)
    return 2
  }
  const problems = checkReview(text, { resolved })
  if (problems.length > 0) {
    for (const p of problems) process.stderr.write(`check-security-review: ${p}\n`)
    return 1
  }
  process.stdout.write(
    `check-security-review: ${doc} OK (${ITEM_COUNT} items${resolved ? ', every finding resolved' : ''})\n`,
  )
  return 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2))
}
