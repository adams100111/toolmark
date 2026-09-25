import { test as base, type Page } from '@playwright/test'
import type { ConfirmOutcome, ToolManifest, ToolManifestSummary, ToolResult } from '@toolmark/core'
import type { TestHookCaller } from './page/install-test-hook.js'

/** How long {@link ToolsFixture} waits for `installTestHook` to run on the page, in ms. */
export const HOOK_WAIT_MS = 5000

/** Thrown (as a rejection) when the page never installs the test hook within {@link HOOK_WAIT_MS}. */
export const MISSING_HOOK_MESSAGE =
  "Toolmark test hook not found: call installTestHook(toolmark) in your app's test build"

const CALLER: TestHookCaller = 'test'

/** Drives page tools through `globalThis.__toolmark_test__` (an in-page test consumer). */
export interface ToolsFixture {
  /** Summary manifest visible to caller `test`. */
  list(): Promise<ToolManifestSummary[]>
  /**
   * Full manifest entry of one tool, as caller `test` sees it.
   * @param name - Full tool name.
   * @returns The entry, or `undefined` when no such tool is registered or it is hidden from
   * caller `test` (`when: false`, policy).
   */
  get(name: string): Promise<ToolManifest | undefined>
  /**
   * Calls a tool as caller `test`. When {@link ToolsFixture.autoConfirm} is on and the result is
   * `needs_confirmation`, approves it and returns the final result instead.
   */
  call(name: string, input?: unknown): Promise<ToolResult<unknown>>
  /** Completes a pending deferred confirmation. */
  confirm(confirmId: string, outcome: ConfirmOutcome): Promise<ToolResult<unknown>>
  /** When `on`, {@link ToolsFixture.call} auto-approves any `needs_confirmation` outcome. */
  autoConfirm(on: boolean): void
}

/** Waits for the page's test hook, rejecting with {@link MISSING_HOOK_MESSAGE} if it never shows. */
async function waitForHook(page: Page): Promise<void> {
  try {
    await page.waitForFunction(() => Boolean(globalThis.__toolmark_test__), undefined, {
      timeout: HOOK_WAIT_MS,
    })
  } catch {
    throw new Error(MISSING_HOOK_MESSAGE)
  }
}

function createToolsFixture(page: Page): ToolsFixture {
  let auto = false

  const confirm = async (
    confirmId: string,
    outcome: ConfirmOutcome,
  ): Promise<ToolResult<unknown>> => {
    await waitForHook(page)
    return page.evaluate(([id, o]) => globalThis.__toolmark_test__!.confirmPending(id, o), [
      confirmId,
      outcome,
    ] as const)
  }

  const call = async (name: string, input: unknown = {}): Promise<ToolResult<unknown>> => {
    await waitForHook(page)
    const result = await page.evaluate(
      ([n, i, c]) => globalThis.__toolmark_test__!.call(n, i, { caller: c }),
      [name, input, CALLER] as const,
    )
    if (auto && result.status === 'needs_confirmation') {
      return confirm(result.confirmId, { approved: true })
    }
    return result
  }

  return {
    list: async () => {
      await waitForHook(page)
      return page.evaluate(
        (c) => globalThis.__toolmark_test__!.manifest({ caller: c }).tools as ToolManifestSummary[],
        CALLER,
      )
    },
    get: async (name) => {
      await waitForHook(page)
      return page.evaluate(([n, c]) => globalThis.__toolmark_test__!.describe(n, { caller: c }), [
        name,
        CALLER,
      ] as const)
    },
    call,
    confirm,
    autoConfirm: (on) => {
      auto = on
    },
  }
}

/** Extends `@playwright/test` with a `tools` fixture backed by the page's test hook. */
export const test = base.extend<{ tools: ToolsFixture }>({
  tools: async ({ page }, use) => {
    await use(createToolsFixture(page))
  },
})
