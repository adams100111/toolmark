import { expect, test } from '@playwright/test'
import type { AgentToPageMessage, PageToAgentMessage } from '@toolmark/core/protocol'

// Spec §18: navigation mid-conversation. The agent calls a route-A tool; the page navigates to
// route B → a new `manifest` with route B's tools arrives; calling the old tool with the old `rev`
// is refused `stale`, carrying the current `rev`.

const ROUTE_A_TOOL = 'notes.search'
const ROUTE_B_TOOL = 'reminders.list'

type Result = Extract<PageToAgentMessage, { type: 'result' }>

test('navigation_mid_conversation_new_manifest', async ({ page }) => {
  await page.goto('/#/routes/a')
  await page.waitForFunction(
    (tool) => globalThis.__toolmark_agent__?.manifest?.tools.some((t) => t.name === tool) ?? false,
    ROUTE_A_TOOL,
  )
  const before = await page.evaluate(() => {
    const m = globalThis.__toolmark_agent__!.manifest!
    return { rev: m.rev, clientId: m.clientId, tools: m.tools.map((t) => t.name) }
  })
  expect(before.tools).toContain(ROUTE_A_TOOL)
  expect(before.tools).not.toContain(ROUTE_B_TOOL)

  const turn = (message: AgentToPageMessage): Promise<Result> =>
    page.evaluate(
      async (m) => (await globalThis.__toolmark_agent__!.turn([m]))[0] as Result,
      message,
    )

  const first = await turn({
    protocol: 1,
    type: 'call',
    clientId: before.clientId,
    id: 'nav-1',
    rev: before.rev,
    tool: ROUTE_A_TOOL,
    input: { query: 'roadmap' },
  })
  expect(first.result.status).toBe('ok')

  // The page navigates (hash route) while the conversation goes on.
  await page.getByRole('link', { name: 'Route B' }).click()
  await page.waitForFunction(
    (tool) => globalThis.__toolmark_agent__?.manifest?.tools.some((t) => t.name === tool) ?? false,
    ROUTE_B_TOOL,
  )
  const after = await page.evaluate(() => {
    const m = globalThis.__toolmark_agent__!.manifest!
    return { rev: m.rev, tools: m.tools.map((t) => t.name) }
  })
  expect(after.rev).toBeGreaterThan(before.rev)
  expect(after.tools).toContain(ROUTE_B_TOOL)
  expect(after.tools).not.toContain(ROUTE_A_TOOL)

  const stale = await turn({
    protocol: 1,
    type: 'call',
    clientId: before.clientId,
    id: 'nav-2',
    rev: before.rev,
    tool: ROUTE_A_TOOL,
    input: { query: 'roadmap' },
  })
  expect(stale.result).toMatchObject({ status: 'refused', code: 'stale', rev: after.rev })
})
