import type { ToolManifest } from '@toolmark/core'
import type { ManifestFile } from './types.js'

/** Time {@link collectFromUrl} waits for the page's test hook (matches `@toolmark/testing`). */
const HOOK_WAIT_MS = 5000

/**
 * Message used when `--url`'s page never installs the test hook (Task 3 brief: "the M1 hook error
 * message"; verbatim copy of `@toolmark/testing`'s `MISSING_HOOK_MESSAGE`, kept local so
 * `@toolmark/lint` does not depend on `@toolmark/testing`).
 */
export const MISSING_HOOK_MESSAGE =
  "Toolmark test hook not found: call installTestHook(toolmark) in your app's test build"

/** Thrown for `--url`/`--judge` usage failures; the CLI reports these as exit code 2. */
export class LintUsageError extends Error {}

/** The minimal in-page test-hook surface `collectFromUrl` calls. */
interface PageTestHook {
  manifest(o: { detail: 'full'; caller: 'inapp' }): { rev: number; tools: ToolManifest[] }
}

declare global {
  var __toolmark_test__: PageTestHook | undefined
}

/** Options for {@link collectFromUrl}. */
export interface CollectFromUrlOptions {
  /** Passed as Playwright's `storageState` when opening the browser context. */
  storageStatePath?: string
}

/**
 * Loads `url` in a fresh headless Chromium context (dynamically imports the optional
 * `@playwright/test` peer), waits for `__toolmark_test__`, and collects its full manifest as
 * caller `'inapp'`.
 * @throws {LintUsageError} `@playwright/test` is not installed (`--url requires
 * @playwright/test`), or the page never installs the hook within {@link HOOK_WAIT_MS}
 * ({@link MISSING_HOOK_MESSAGE}).
 */
export async function collectFromUrl(
  url: string,
  o: CollectFromUrlOptions = {},
): Promise<ManifestFile> {
  let chromium: (typeof import('@playwright/test'))['chromium']
  try {
    ;({ chromium } = await import('@playwright/test'))
  } catch {
    throw new LintUsageError('--url requires @playwright/test')
  }

  const browser = await chromium.launch()
  try {
    const context = await browser.newContext(
      o.storageStatePath !== undefined ? { storageState: o.storageStatePath } : {},
    )
    try {
      const page = await context.newPage()
      await page.goto(url)
      try {
        await page.waitForFunction(() => Boolean(globalThis.__toolmark_test__), undefined, {
          timeout: HOOK_WAIT_MS,
        })
      } catch {
        throw new LintUsageError(MISSING_HOOK_MESSAGE)
      }
      const manifest = await page.evaluate(() =>
        globalThis.__toolmark_test__!.manifest({ detail: 'full', caller: 'inapp' }),
      )
      return { page: url, tools: manifest.tools }
    } finally {
      await context.close()
    }
  } finally {
    await browser.close()
  }
}
