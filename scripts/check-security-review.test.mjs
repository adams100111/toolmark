// Tests for scripts/check-security-review.mjs.
// Run with `node --test "scripts/*.test.mjs"` (Node >= 22.12). Fixtures are written to a temp dir.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import process from 'node:process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const CHECK = join(here, 'check-security-review.mjs')
const HEADER =
  '| id | severity | item | summary | evidence | resolution | commit | regression test |\n' +
  '| --- | --- | --- | --- | --- | --- | --- | --- |'

/**
 * Renders a review. `verdicts` maps item number → verdict text (default `pass`); `omit` lists item
 * numbers left out; `rows` are findings table rows (arrays of the 8 cells).
 */
function review({ verdicts = {}, omit = [], rows = [] } = {}) {
  const items = []
  for (let n = 1; n <= 14; n++) {
    if (omit.includes(n)) continue
    items.push(`### ${n}. Item ${n}\n\n**Verdict:** ${verdicts[n] ?? 'pass'}\n\nEvidence text.\n`)
  }
  const table = [HEADER, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n')
  return `# Review\n\n## Checklist\n\n${items.join('\n')}\n## Findings\n\n${table}\n\n## Notes\n`
}

async function run(markdown, ...args) {
  const dir = await mkdtemp(join(tmpdir(), 'check-security-review-'))
  try {
    const file = join(dir, 'review.md')
    await writeFile(file, markdown)
    return spawnSync(process.execPath, [CHECK, ...args, file], { encoding: 'utf8' })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const openCritical = ['SEC-1', 'Critical', '8', 'A hang', '`call.ts:1`', 'open', '—', '—']

test('check_security_review_accepts_complete_review', async () => {
  const r = await run(review())
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /OK/)
})

test('check_security_review_requires_all_items', async () => {
  const r = await run(review({ omit: [8] }))
  assert.equal(r.status, 1)
  assert.match(r.stderr, /checklist item 8 is missing/)
})

test('check_security_review_requires_one_verdict_per_item', async () => {
  const r = await run(review({ verdicts: { 3: 'maybe' } }))
  assert.equal(r.status, 1)
  assert.match(r.stderr, /checklist item 3: verdict must be/)
})

test('check_security_review_rejects_open_finding', async () => {
  const md = review({ verdicts: { 8: 'finding (SEC-1)' }, rows: [openCritical] })
  const lenient = await run(md)
  assert.equal(lenient.status, 0, lenient.stderr)
  const strict = await run(md, '--resolved')
  assert.equal(strict.status, 1)
  assert.match(strict.stderr, /SEC-1 \(Critical\) is unresolved/)
})

test('check_security_review_fixed_needs_commit_and_test', async () => {
  const noTest = ['SEC-1', 'Minor', '8', 'A hang', '`call.ts:1`', 'fixed', 'abc1234', '—']
  const md = review({ verdicts: { 8: 'finding (SEC-1)' }, rows: [noTest] })
  const r = await run(md, '--resolved')
  assert.equal(r.status, 1)
  assert.match(r.stderr, /needs its regression test/)
  const done = ['SEC-1', 'Minor', '8', 'A hang', '`call.ts:1`', 'fixed', 'abc1234', '`hang_test`']
  const ok = await run(review({ verdicts: { 8: 'finding (SEC-1)' }, rows: [done] }), '--resolved')
  assert.equal(ok.status, 0, ok.stderr)
})

test('check_security_review_cross_references_findings', async () => {
  // A finding verdict naming an id that is not in the table, and a row no verdict names.
  const r = await run(
    review({
      verdicts: { 2: 'finding (SEC-9)' },
      rows: [['SEC-1', 'Minor', '5', 'x', 'y', 'open', '—', '—']],
    }),
  )
  assert.equal(r.status, 1)
  assert.match(r.stderr, /names SEC-9, which is not in the findings table/)
  assert.match(r.stderr, /SEC-1: checklist item 5 verdict does not name it/)
})

test('check_security_review_rejects_bad_severity_and_resolution', async () => {
  const row = ['SEC-1', 'High', '1', 'x', 'y', 'later', '—', '—']
  const r = await run(review({ verdicts: { 1: 'finding (SEC-1)' }, rows: [row] }))
  assert.equal(r.status, 1)
  assert.match(r.stderr, /severity must be Critical, Important or Minor/)
  assert.match(r.stderr, /resolution must be open, fixed or accepted/)
})

test('check_security_review_repo_report_is_well_formed', () => {
  const r = spawnSync(process.execPath, [CHECK], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
})
