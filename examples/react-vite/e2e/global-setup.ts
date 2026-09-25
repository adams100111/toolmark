import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { startRelayServer } from './support/relay-server.js'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))

/**
 * Playwright global setup:
 * - builds `@toolmark/mcp` and `@toolmark/lint` (and every workspace package they depend on) once
 *   per run, so the MCP and lint specs never spawn a stale `dist/cli.js` (cross X-01). A failed
 *   build fails the run (`execFileSync` throws on a non-zero exit);
 * - starts the e2e relay (`e2e/support/relay-server.ts`) on port `0` and publishes it as
 *   `process.env.TOOLMARK_RELAY_PORT` (Playwright passes global-setup env to the workers).
 * @returns The global teardown: closes the relay.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  execFileSync('pnpm', ['--filter', '@toolmark/mcp...', '--filter', '@toolmark/lint...', 'build'], {
    cwd: repoRoot,
    stdio: 'inherit',
  })
  const relay = await startRelayServer()
  process.env.TOOLMARK_RELAY_PORT = String(relay.port)
  return () => relay.close()
}
