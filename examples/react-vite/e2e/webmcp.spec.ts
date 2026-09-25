import { expect, test } from '@toolmark/testing'
import type { Page } from '@playwright/test'
import type { ToolResult } from '@toolmark/core'

const FILL = 'challenges.create.fill'

const input = {
  values: {
    title: { ar: 'تحدي الابتكار', en: 'Innovation challenge' },
    type: 'hackathon',
    startsAt: '2026-10-01',
  },
}

interface ModelContextShape {
  getTools?(): Promise<{ name: string }[]>
  executeTool?(entry: unknown, json: string): Promise<unknown>
}

/** Waits until the page's model context lists `name` (the webmcp consumer has registered it). */
async function waitForWebMcpTool(page: Page, name: string): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(async (n) => {
          const mc = (document as { modelContext?: ModelContextShape }).modelContext
          if (typeof mc?.getTools !== 'function') return false
          return (await mc.getTools()).some((t) => t.name === n)
        }, name),
      { timeout: 10_000 },
    )
    .toBe(true)
}

/** `document.modelContext.getTools()` → the entry → `executeTool(entry, JSON)` → `JSON.parse`. */
async function executeViaModelContext(page: Page, name: string): Promise<ToolResult<unknown>> {
  const raw = await page.evaluate(
    async ([n, json]) => {
      const mc = (document as { modelContext?: ModelContextShape }).modelContext!
      const entry = (await mc.getTools!()).find((t) => t.name === n)
      return mc.executeTool!(entry, json)
    },
    [name, JSON.stringify(input)] as const,
  )
  return (typeof raw === 'string' ? JSON.parse(raw) : raw) as ToolResult<unknown>
}

async function expectFormFilled(page: Page): Promise<void> {
  await expect(page.getByLabel('Title (English)')).toHaveValue('Innovation challenge')
  await expect(page.getByLabel('Title (Arabic)')).toHaveValue('تحدي الابتكار')
  await expect(page.getByLabel('Type')).toHaveValue('hackathon')
  await expect(page.getByLabel('Starts at')).toHaveValue('2026-10-01')
}

test('polyfill_exposes_tools_and_execute_fills_form', async ({ page }) => {
  await page.goto('/')
  await waitForWebMcpTool(page, FILL)
  const result = await executeViaModelContext(page, FILL)
  expect(result.status).toBe('ok')
  await expectFormFilled(page)
})

// Chrome's "WebMCP for testing" switch (chrome://flags/#enable-webmcp-testing); ledgered in the M3
// task 7 report. A launch option forces a new worker, so this test launches its own browser.
const NATIVE_WEBMCP_ARGS = ['--enable-features=WebMCPTesting']

test('native_webmcp_when_available', async ({ playwright, baseURL }) => {
  const browser = await playwright.chromium.launch({ args: NATIVE_WEBMCP_ARGS })
  try {
    const page = await browser.newPage(baseURL ? { baseURL } : {})
    await page.addInitScript(() => {
      ;(globalThis as { __nativeModelContext__?: boolean }).__nativeModelContext__ =
        'modelContext' in document
    })
    await page.goto('/')
    const native = await page.evaluate(
      () => (globalThis as { __nativeModelContext__?: boolean }).__nativeModelContext__ === true,
    )
    test.skip(!native, 'document.modelContext is absent before the polyfill loads')

    await waitForWebMcpTool(page, FILL)
    const result = await executeViaModelContext(page, FILL)
    expect(result.status).toBe('ok')
    await expectFormFilled(page)
  } finally {
    await browser.close()
  }
})
