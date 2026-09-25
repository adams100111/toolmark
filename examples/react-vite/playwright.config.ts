import { defineConfig, devices } from '@playwright/test'

// Ruling (controller, Task 15): the port is overridable because 127.0.0.1:5173 may be held by an
// unrelated process on a developer machine; run with `TOOLMARK_EXAMPLE_PORT=5174` there.
const port = Number(process.env.TOOLMARK_EXAMPLE_PORT ?? 5173)

// Specs that run on every browser (spec §18: tours, multi-tab and navigation on Chromium, Firefox
// and WebKit; dist-resolution proves which build the dist e2e runs load). Everything else — webmcp, mcp, reach, same-tools, lint-clean and round-budget —
// runs on Chromium only (round-budget stays single-browser so its report has one row per task).
const EVERY_BROWSER = /\/(tour|navigation|multi-client|form|wizard|dom|dist-resolution)\.spec\.ts$/

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.spec.ts',
  // Builds `@toolmark/mcp` and `@toolmark/lint` (with their workspace dependencies) once, and
  // starts the e2e relay (`TOOLMARK_RELAY_PORT`).
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'on-first-retry',
  },
  webServer: {
    command: `pnpm dev --port ${port} --strictPort`,
    port,
    reuseExistingServer: !process.env.CI,
    // pnpm runs the script in its own process group, so Playwright's default SIGKILL of the group
    // orphans vite (and teardown hangs on its open stdio); SIGTERM lets pnpm forward the signal.
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
  },
  projects: [
    { name: 'chromium', use: devices['Desktop Chrome'] },
    { name: 'firefox', use: devices['Desktop Firefox'], testMatch: EVERY_BROWSER },
    { name: 'webkit', use: devices['Desktop Safari'], testMatch: EVERY_BROWSER },
  ],
})
