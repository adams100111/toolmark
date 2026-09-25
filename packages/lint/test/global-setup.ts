import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))

/**
 * Vitest global setup: builds `@toolmark/lint` and every workspace package it depends on once per
 * run, so tests that spawn `dist/cli.js` never run stale output. A failed build fails the run
 * (`execFileSync` throws on a non-zero exit).
 */
export default function setup(): void {
  execFileSync('pnpm', ['--filter', '@toolmark/lint...', 'build'], {
    cwd: repoRoot,
    stdio: 'inherit',
  })
}
