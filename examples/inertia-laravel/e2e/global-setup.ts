import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { chromium, type FullConfig } from '@playwright/test'

export const ROOT = path.resolve(import.meta.dirname, '..')
export const BASE_URL = 'http://127.0.0.1:8010'
export const STORAGE_STATE = path.join(ROOT, 'test-results', 'alice.json')

/**
 * 1. Re-seeds the database, so reruns start from the same challenges (the archive test archives
 *    one).
 * 2. Builds the frontend in mode `e2e`: the gate's `pnpm build` is a production build, which by
 *    design omits the test hook (spec §11.6); these tests and `toolmark lint --url` need it.
 * 3. Logs in as Alice and saves `test-results/alice.json`.
 */
export default async function globalSetup(_config: FullConfig): Promise<void> {
  execFileSync('scripts/php.sh', ['php', 'artisan', 'migrate:fresh', '--seed', '--force'], {
    cwd: ROOT,
    stdio: 'inherit',
  })
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
