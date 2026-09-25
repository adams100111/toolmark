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

/** Runs `CLI args…`, resolving with its exit code (never rejecting on a non-zero exit). */
function run(args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(CLI, args, { cwd: ROOT, stdio: 'inherit' })
    child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 1)))
    child.once('error', reject)
  })
}

test('lint_clean', async () => {
  // The running `next dev` page (spec §20 "toolmark lint exits 0 on every example's manifests"):
  // the CLI loads the URL through Playwright and reads `__toolmark_test__`.
  const exitCode = await run(['--url', DEV_URL])
  expect(exitCode).toBe(0)
})
