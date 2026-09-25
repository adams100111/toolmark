import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))

/**
 * Playwright global setup: builds `@toolmark/mcp` and every workspace package it depends on once
 * per run, so the MCP specs never spawn a stale `packages/mcp/dist/cli.js` (cross X-01). A failed
 * build fails the run (`execFileSync` throws on a non-zero exit). M4 T8 extends this file.
 */
export default function globalSetup(): void {
  execFileSync('pnpm', ['--filter', '@toolmark/mcp...', 'build'], {
    cwd: repoRoot,
    stdio: 'inherit',
  })
}
