import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { exampleOrigin } from './support/mcp-client.js'

// M4 exit 6: the real `toolmark lint` CLI (built by `e2e/global-setup.ts`) against the running
// example — the main page and both hash routes — exits 0.

const LINT_CLI = fileURLToPath(new URL('../../../packages/lint/dist/cli.js', import.meta.url))

function runLint(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [LINT_CLI, ...args], { stdio: 'pipe' })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()))
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()))
    child.once('error', reject)
    child.once('close', (code) => resolve({ code, stdout, stderr }))
  })
}

test('lint_clean', async () => {
  test.setTimeout(120_000)
  const origin = exampleOrigin()
  const urls = [`${origin}/`, `${origin}/#/routes/a`, `${origin}/#/routes/b`]
  const urlArgs = urls.flatMap((u) => ['--url', u])

  const clean = await runLint([...urlArgs, '--format', 'json'])
  expect(clean.code, `stdout:\n${clean.stdout}\nstderr:\n${clean.stderr}`).toBe(0)
  const report = JSON.parse(clean.stdout) as LintReport
  expect(report.summary.errors).toBe(0)
  expect(report.findings).toEqual([])

  // Not vacuous: with `--budget 1` every page reports its (non-empty) tool count, so lint really
  // collected each page's manifest. `tool-budget` is a warning: still exit 0.
  const counted = await runLint([...urlArgs, '--format', 'json', '--budget', '1'])
  expect(counted.code, counted.stderr).toBe(0)
  const budget = (JSON.parse(counted.stdout) as LintReport).findings.filter(
    (f) => f.rule === 'tool-budget',
  )
  expect(budget.map((f) => f.page).sort()).toEqual([...urls].sort())
})

interface LintReport {
  findings: { rule: string; severity: string; page: string; message: string }[]
  summary: { errors: number; warnings: number }
}
