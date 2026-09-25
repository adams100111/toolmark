import { defineConfig, devices } from '@playwright/test'

// Ruling (controller, Task 15): the port is overridable because 127.0.0.1:5173 may be held by an
// unrelated process on a developer machine; run with `TOOLMARK_EXAMPLE_PORT=5174` there.
const port = Number(process.env.TOOLMARK_EXAMPLE_PORT ?? 5173)

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.spec.ts',
  // Builds `@toolmark/mcp` (and its workspace dependencies) once: the MCP specs spawn its CLI.
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
  // Chromium only in M1; M5 adds firefox/webkit (round-budget stays Chromium-only).
  projects: [{ name: 'chromium', use: devices['Desktop Chrome'] }],
})
