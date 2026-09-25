import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import type { AgentToPageMessage } from '@toolmark/core/protocol'
import { DEV_URL, RESULTS_DIR, START_URL } from './global-setup.js'

declare global {
  // The test hook's real type lives in `@toolmark/testing/page` (a devDependency); these tests only
  // need presence/absence, so a loose ambient type avoids coupling to its resolution condition.
  // eslint-disable-next-line no-var
  var __toolmark_test__: unknown
}

const HYDRATION_ISSUE = /hydrat|did not match|server rendered HTML|Minified React error #4(18|23|25)/i
const SERVER_LOG_ISSUE = /(^|\s)(⨯|Error\b)|toolmark/i

/** Fails if any line of `test-results/<logName>` matches the brief's server-log issue pattern. */
async function assertCleanServerLog(logName: string): Promise<void> {
  const contents = await readFile(path.join(RESULTS_DIR, logName), 'utf8').catch(() => '')
  const offending = contents.split('\n').filter((line) => SERVER_LOG_ISSUE.test(line))
  expect(offending, `unexpected line(s) in test-results/${logName}`).toEqual([])
}

/** Starts collecting console messages that match the brief's hydration-issue pattern. */
function collectHydrationIssues(page: Page): string[] {
  const issues: string[] = []
  page.on('console', (msg) => {
    if (HYDRATION_ISSUE.test(msg.text())) issues.push(msg.text())
  })
  return issues
}

for (const target of [
  { label: 'dev', url: DEV_URL, logName: 'next-dev.log' },
  { label: 'start', url: START_URL, logName: 'next-start.log' },
] as const) {
  test(`ssr_renders_without_registry_errors (${target.label})`, async ({ page }) => {
    const issues = collectHydrationIssues(page)
    await page.goto(target.url)
    await expect(page.getByRole('heading', { name: 'Challenges' })).toBeVisible()
    expect(issues, 'browser console reported a hydration/SSR mismatch').toEqual([])
    await assertCleanServerLog(target.logName)
  })
}

test('client_tools_after_hydration', async ({ page }) => {
  // `waitUntil: 'commit'` returns right after navigation commits, before the page's scripts have
  // necessarily run — the hook must not exist yet at that point.
  await page.goto(DEV_URL, { waitUntil: 'commit' })
  const beforeHydration = await page.evaluate(() => Boolean(globalThis.__toolmark_test__))
  expect(beforeHydration).toBe(false)

  await page.waitForFunction(() => Boolean(globalThis.__toolmark_test__))
  const afterHydration = await page.evaluate(() => Boolean(globalThis.__toolmark_test__))
  expect(afterHydration).toBe(true)
})

test('fill_via_in_page_agent', async ({ page }) => {
  await page.goto(DEV_URL)
  await page.waitForFunction(() => globalThis.__toolmark_agent__?.manifest !== undefined)

  const values = {
    title: { ar: 'تحدي الابتكار', en: 'Innovation challenge' },
    type: 'hackathon',
    startsAt: '2026-10-01',
  }
  const replies = await page.evaluate(async (v) => {
    const agent = globalThis.__toolmark_agent__!
    const clientId = agent.manifest!.clientId
    const messages: AgentToPageMessage[] = [
      {
        protocol: 1,
        type: 'call',
        clientId,
        id: 'fill-1',
        tool: 'challenges.create.fill',
        input: { values: v },
      },
    ]
    return agent.turn(messages)
  }, values)

  expect(replies).toHaveLength(1)
  expect(replies[0]).toMatchObject({ type: 'result', id: 'fill-1', result: { status: 'ok' } })
  await expect(page.getByLabel('Title (English)')).toHaveValue('Innovation challenge')
  await expect(page.getByLabel('Title (Arabic)')).toHaveValue('تحدي الابتكار')
  await expect(page.getByLabel('Type')).toHaveValue('hackathon')
  await expect(page.getByLabel('Starts at')).toHaveValue('2026-10-01')
})

test('production_build_omits_test_hook', async ({ page }) => {
  await page.goto(START_URL)
  await page.waitForLoadState('networkidle')
  // Give a hydrated production page a moment to prove a negative before asserting absence.
  await page.waitForTimeout(500)
  expect(await page.evaluate(() => globalThis.__toolmark_test__)).toBeUndefined()
  expect(await page.evaluate(() => globalThis.__toolmark_agent__)).toBeUndefined()
})
