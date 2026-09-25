// Tests for scripts/render-round-budget.mjs. Run with `node --test "scripts/*.test.mjs"`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { scratch } from './fixtures/tgz.mjs'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'render-round-budget.mjs')

function row(task, rounds) {
  return { task, rounds, messages: rounds, manifestBytes: 600, describeBytes: 1000, wallMs: 50 }
}

/** Runs the renderer on `report` (written to a temp dir) and returns its status, output and file. */
async function render(report, flags = []) {
  const root = await scratch('toolmark-round-budget-', { 'report.json': report })
  const out = join(root, 'round-budget.md')
  try {
    const r = spawnSync(
      process.execPath,
      [SCRIPT, ...flags, join(root, 'report.json'), '--out', out],
      { encoding: 'utf8' },
    )
    return {
      status: r.status,
      output: `${r.stdout}${r.stderr}`,
      markdown: existsSync(out) ? readFileSync(out, 'utf8') : null,
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('render_round_budget_fails_over_budget', async () => {
  const over = await render([row('simple_form', 4), row('wizard', 4)], ['--check'])
  assert.equal(over.status, 1, over.output)
  assert.match(over.output, /simple_form: 4 rounds > budget 3/)
  assert.equal(over.markdown, null, 'nothing is written when the check fails')

  const within = await render([row('simple_form', 3), row('wizard', 5)], ['--check'])
  assert.equal(within.status, 0, within.output)
  assert.ok(within.markdown, 'the table is written')
  assert.match(within.markdown, /\| simple_form \| 3 +\| ≤ 3 +\|/)
  assert.match(within.markdown, /\| wizard +\| 5 +\| ≤ 5 +\|/)
  assert.match(within.markdown, /Version: `\d+\.\d+\.\d+[^`]*`/)
})

test('render_round_budget_check_fails_on_wizard_over_budget', async () => {
  const r = await render([row('simple_form', 2), row('wizard', 6)], ['--check'])
  assert.equal(r.status, 1, r.output)
  assert.match(r.output, /wizard: 6 rounds > budget 5/)
})

test('render_round_budget_check_fails_on_missing_entry', async () => {
  const r = await render([row('simple_form', 3)], ['--check'])
  assert.equal(r.status, 1, r.output)
  assert.match(r.output, /wizard: entry missing/)
  assert.equal(r.markdown, null)
})

test('render_round_budget_without_check_renders_over_budget_report', async () => {
  const r = await render([row('simple_form', 4)])
  assert.equal(r.status, 0, r.output)
  assert.ok(r.markdown)
})

test('render_round_budget_rejects_malformed_report', async () => {
  const r = await render([{ task: 'simple_form', rounds: 'three' }], ['--check'])
  assert.equal(r.status, 1, r.output)
  assert.match(r.output, /malformed report/)
})
