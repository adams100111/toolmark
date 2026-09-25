import { execSync } from 'node:child_process'
import { defineConfig, devices } from '@playwright/test'

/** Host PHP (CI) binds loopback; Docker PHP (scripts/php.sh) binds inside the container. */
function hostHasPhp(): boolean {
  try {
    execSync('command -v php', { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

const bind = hostHasPhp() ? '127.0.0.1' : '0.0.0.0'

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.spec.ts',
  // One seeded user and one conversation: the latest page wins the conversation (D23), so tests
  // run one at a time.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  timeout: 60_000,
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: 'http://127.0.0.1:8010',
    storageState: 'test-results/alice.json',
    trace: 'on-first-retry',
  },
  webServer: [
    {
      command: 'scripts/php.sh php artisan serve --host=' + bind + ' --port=8010',
      env: { PHP_CLI_SERVER_WORKERS: '4', PHP_PORTS: '8010' },
      url: 'http://127.0.0.1:8010/up',
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
    {
      command: 'scripts/php.sh php artisan reverb:start --host=' + bind + ' --port=8081',
      env: { PHP_PORTS: '8081' },
      port: 8081,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
  // Laravel example: Chromium only (overview CI matrix).
  projects: [{ name: 'chromium', use: devices['Desktop Chrome'] }],
})
