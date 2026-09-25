import { defineConfig, devices } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import base from '../examples/react-vite/playwright.config.ts'

// M5 Task 6 `canary` job (spec §21 post-release weekly spec-watch; D28 keeps WebMCP experimental).
// Runs only `examples/react-vite/e2e/webmcp.spec.ts` against a bleeding-edge Chrome, so a spec/API
// drift shows up before it reaches Toolmark's own Chromium-only WebMCP gate. `continue-on-error:
// true`, never required (spec §21: "WebMCP WPT suites are informational... the adapter's own
// WebMCP suites on Chromium gate").
//
// Two facts verified 2026-09-25, both recorded here because the exact channel/switch matter:
//
// 1. Google does not ship a "Canary" channel for Linux (only Windows/macOS), so the `ubuntu-latest`
//    runner this job requires (brief) cannot install literal Chrome Canary. The closest
//    continuously-updated Linux channel is Chrome **Dev**, installed via
//    `playwright install chrome-dev` and selected here with `channel: 'chrome-dev'`. If Chrome ever
//    ships a Linux Canary channel, swap the channel string; nothing else here depends on "Canary"
//    specifically.
// 2. `chrome://flags/#enable-webmcp-testing` is Chromium's auto-generated flags entry for the Blink
//    runtime-enabled feature `WebMCPTesting` (status "experimental", `implied_by` the parent
//    `WebMCP` origin-trial feature) — see
//    https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/platform/runtime_enabled_features.json5.
//    Its command-line equivalent (what a headless CI launch needs, since there is no UI to click the
//    flag) is `--enable-blink-features=WebMCPTesting`. A stable switch exists, so this is the
//    brief's primary path, not the "no switch" fallback.
const CHROME_DEV_CHANNEL = 'chrome-dev'
const WEBMCP_TESTING_ARGS = ['--enable-blink-features=WebMCPTesting']

const exampleDir = fileURLToPath(new URL('../examples/react-vite', import.meta.url))

// `defineConfig(base, override)` does not narrow `base`'s `testMatch: '**/*.spec.ts'` (Playwright's
// merge does not intersect string/array patterns), so scoping to just this suite is the caller's
// job: run with a file-path CLI argument, e.g.
// `playwright test --config .spec-watch/playwright.canary.config.ts webmcp.spec.ts` (spec-watch.yml
// does this).
export default defineConfig(base, {
  // `testDir`/`globalSetup` in the inherited config are relative to *this* file's directory
  // (.spec-watch/), not examples/react-vite/, so both are re-pointed at absolute paths.
  testDir: fileURLToPath(new URL('../examples/react-vite/e2e', import.meta.url)),
  globalSetup: fileURLToPath(
    new URL('../examples/react-vite/e2e/global-setup.ts', import.meta.url),
  ),
  webServer: { ...base.webServer, cwd: exampleDir },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        channel: CHROME_DEV_CHANNEL,
        launchOptions: { args: WEBMCP_TESTING_ARGS },
      },
    },
  ],
})
