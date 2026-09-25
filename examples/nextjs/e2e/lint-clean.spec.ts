import { spawn } from 'node:child_process'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { DEV_URL } from './global-setup.js'

const ROOT = path.resolve(import.meta.dirname, '..')
const CLI = path.join(
  ROOT,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'toolmark.cmd' : 'toolmark',
)

/** Runs `CLI args…`, resolving with its exit code and output (never rejecting on a non-zero exit). */
function run(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(CLI, args, { cwd: ROOT, stdio: 'pipe' })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()))
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()))
    child.once('close', (code) => resolve({ code: code ?? 1, stdout, stderr }))
    child.once('error', reject)
  })
}

test('lint_clean', async () => {
  // The running `next dev` page (spec §20 "toolmark lint exits 0 on every example's manifests"):
  // the CLI loads the URL through Playwright and reads `__toolmark_test__`. Runs through the
  // `node_modules/.bin` shim; asserting the summary line (not only exit 0) keeps a CLI that
  // silently does nothing from passing.
  const { code, stdout, stderr } = await run(['lint', '--url', DEV_URL])
  expect(code, `stdout:\n${stdout}\nstderr:\n${stderr}`).toBe(0)
  expect(stdout).toMatch(/^0 error\(s\), \d+ warning\(s\)$/m)
})
