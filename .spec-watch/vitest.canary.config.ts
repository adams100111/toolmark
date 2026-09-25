import { playwright } from '@vitest/browser-playwright'
import { defineProject } from 'vitest/config'
import base from '../packages/core/vitest.browser.config.ts'

// M5 Task 6 `canary` job — the M3 WebMCP suite that needs a real browser, against a bleeding-edge
// Chrome. `packages/core/test/webmcp.test.ts` and `webmcp-types.test.ts` already run under the
// Node `core-node` project in the regular CI matrix (no DOM, so no browser channel to canary-test);
// only `browser-webmcp-polyfill.test.ts` runs in `core-browser` and is scoped to here. Channel and
// command-line flag verified 2026-09-25 — see .spec-watch/playwright.canary.config.ts for the
// citations (Chrome Canary ships for Windows/macOS only; `chrome-dev` is the Linux substitute;
// `--enable-blink-features=WebMCPTesting` is chrome://flags/#enable-webmcp-testing's CLI form).
//
// The channel/args go on the *provider* (`playwright({ launchOptions })`), not on the `instances[]`
// entry: `@vitest/browser-playwright`'s per-instance clone only recognises a handful of named keys
// (`browser`, `name`, `provider`, `headless`, …) and silently drops any other property into a
// generic Vite config merge, so an `instances[0].launchOptions` (tried first; verified by mutating
// the channel to a bogus string and finding the run still passed against the bundled Chromium) is
// never read.
//
// A plain object spread, not `mergeConfig` (vite/vitest's `mergeConfig` concatenates array fields,
// which would add a second `chromium` browser instance alongside the base config's default one and
// fail to start ("core-browser (chromium)" defined twice) instead of replacing it).
export default defineProject({
  ...base,
  test: {
    ...base.test,
    include: ['test/browser-webmcp-polyfill.test.ts'],
    browser: {
      ...base.test.browser,
      provider: playwright({
        launchOptions: {
          channel: 'chrome-dev',
          args: ['--enable-blink-features=WebMCPTesting'],
        },
      }),
      instances: [{ browser: 'chromium' }],
    },
  },
})
