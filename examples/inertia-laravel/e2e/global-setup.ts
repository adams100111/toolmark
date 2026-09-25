import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { chromium, type FullConfig } from '@playwright/test'

export const ROOT = path.resolve(import.meta.dirname, '..')
export const BASE_URL = 'http://127.0.0.1:8010'
export const STORAGE_STATE = path.join(ROOT, 'test-results', 'alice.json')

/**
 * 1. Builds the frontend in mode `e2e` into public/build-e2e: the gate's `pnpm build` is a
 *    production build in public/build, which by design omits the test hook (spec §11.6); these
 *    tests and `toolmark lint --url` need it. The server serves build-e2e because Playwright
 *    starts it with TOOLMARK_E2E_BUILD=true (honoured in `local`/`testing` only), so
 *    public/build never contains the hook.
 * 2. Logs in as Alice and saves `test-results/alice.json`.
 *
 * The database is seeded by `composer run toolmark:setup` before the servers start (never while
 * they run: `migrate:fresh` truncates the SQLite file under them). Tests create what they change.
 */
export default async function globalSetup(_config: FullConfig): Promise<void> {
  execFileSync('pnpm', ['exec', 'vite', 'build', '--mode', 'e2e'], { cwd: ROOT, stdio: 'inherit' })

  mkdirSync(path.dirname(STORAGE_STATE), { recursive: true })
  const browser = await chromium.launch()
  try {
    const context = await browser.newContext({ baseURL: BASE_URL })
    const page = await context.newPage()
    await page.goto('/testing/login/alice@example.test?next=/challenges')
    await page.getByRole('heading', { name: 'Challenges' }).waitFor()
    await context.storageState({ path: STORAGE_STATE })
  } finally {
    await browser.close()
  }
}
