import { defineConfig, devices } from '@playwright/test'

// No `webServer`: `next dev` and `next start` need a `next build` between them (and their own
// ports, 3100/3101), so `global-setup.ts` / `global-teardown.ts` spawn and stop them directly
// (gracefully: SIGTERM, SIGKILL after a timeout) rather than through Playwright's single-server
// `webServer` option.
export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  use: {
    trace: 'on-first-retry',
  },
  // Next.js example runs Chromium only (overview CI matrix).
  projects: [{ name: 'chromium', use: devices['Desktop Chrome'] }],
})
