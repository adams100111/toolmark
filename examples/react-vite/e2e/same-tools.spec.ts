import { expect, test } from '@toolmark/testing'
import type { Page } from '@playwright/test'
import type { Caller, ToolResult } from '@toolmark/core'
import type { AgentToPageMessage } from '@toolmark/core/protocol'
import type { ExampleResult } from '../src/example-hook.js'
import { freePort, pairPage, startMcpClient, type McpClientHandle } from './support/mcp-client.js'

// M4 exit 2 (spec §1 SC2, §18): one `challenges.create.fill` declaration driven through five
// surfaces — the in-page bridge agent, WebMCP (polyfill), a desktop MCP client via `toolmark-mcp`
// pairing, a one-step `do` tour and the Playwright `tools` fixture — with a reload between
// surfaces. Every surface's registry `result` event is `ok` with the same `changes`.

const FILL = 'challenges.create.fill'
const LLM_FILL = 'challenges__create__fill'

const input = {
  values: {
    title: { ar: 'تحدي الابتكار', en: 'Innovation challenge' },
    type: 'hackathon',
    startsAt: '2026-10-01',
  },
}

let mcp: McpClientHandle | undefined
test.afterEach(async () => {
  await mcp?.close()
  mcp = undefined
})

/** The single `result` event of `FILL` by `caller` logged since the page loaded. */
async function fillResultOf(page: Page, caller: Caller): Promise<ToolResult<unknown>> {
  await expect
    .poll(() =>
      page.evaluate(
        ([tool, c]) =>
          (globalThis.__example?.results ?? []).filter((r) => r.tool === tool && r.caller === c)
            .length,
        [FILL, caller] as const,
      ),
    )
    .toBe(1)
  const logged = await page.evaluate(
    ([tool, c]) =>
      globalThis.__example!.results.filter((r) => r.tool === tool && r.caller === c) as unknown,
    [FILL, caller] as const,
  )
  return (logged as ExampleResult[])[0]!.result
}

async function expectFilled(page: Page): Promise<void> {
  await expect(page.getByLabel('Title (English)')).toHaveValue('Innovation challenge')
  await expect(page.getByLabel('Title (Arabic)')).toHaveValue('تحدي الابتكار')
  await expect(page.getByLabel('Type')).toHaveValue('hackathon')
  await expect(page.getByLabel('Starts at')).toHaveValue('2026-10-01')
}

async function reloadClean(page: Page): Promise<void> {
  await page.reload()
  await page.waitForFunction(() => globalThis.__example !== undefined)
  await expect(page.getByLabel('Title (English)')).toHaveValue('')
}

test('same_declaration_all_surfaces', async ({ page, tools }) => {
  test.setTimeout(90_000)
  const port = await freePort()
  mcp = await startMcpClient({ port, era: 'modern' })
  await page.goto(`/?mcpPort=${port}`)
  await expect(tools).toHaveTools([FILL])
  await pairPage(page, mcp.code)
  await mcp.waitForTool(LLM_FILL)

  // One registration: the summary manifest lists the fill tool exactly once.
  await page.waitForFunction(() => globalThis.__toolmark_agent__?.manifest !== undefined)
  const listed = await page.evaluate(
    (name) => globalThis.__toolmark_agent__!.manifest!.tools.filter((t) => t.name === name).length,
    FILL,
  )
  expect(listed).toBe(1)

  const results: Record<string, ToolResult<unknown>> = {}

  // (1) The in-page bridge agent (caller `inapp`).
  await page.evaluate(
    async ([fill, i]) => {
      const agent = globalThis.__toolmark_agent__!
      const clientId = agent.manifest!.clientId
      const call: AgentToPageMessage = {
        protocol: 1,
        type: 'call',
        clientId,
        id: 'same-1',
        tool: fill,
        input: i,
      }
      return agent.turn([call])
    },
    [FILL, input] as const,
  )
  results.inapp = await fillResultOf(page, 'inapp')
  await expectFilled(page)
  await reloadClean(page)

  // (2) WebMCP through the polyfill (caller `webmcp`).
  await expect
    .poll(
      () =>
        page.evaluate(async (name) => {
          const mc = (document as { modelContext?: { getTools(): Promise<{ name: string }[]> } })
            .modelContext
          return (await mc?.getTools())?.some((t) => t.name === name) ?? false
        }, FILL),
      { timeout: 10_000 },
    )
    .toBe(true)
  await page.evaluate(
    async ([name, json]) => {
      const mc = (
        document as unknown as {
          modelContext: {
            getTools(): Promise<{ name: string }[]>
            executeTool(entry: unknown, json: string): Promise<string>
          }
        }
      ).modelContext
      const entry = (await mc.getTools()).find((t) => t.name === name)
      return mc.executeTool(entry, json)
    },
    [FILL, JSON.stringify(input)] as const,
  )
  results.webmcp = await fillResultOf(page, 'webmcp')
  await expectFilled(page)
  await reloadClean(page)

  // (3) The desktop MCP client; the page resumes its pairing with the session token.
  await expect(page.getByTestId('mcp-status')).toHaveText('paired', { timeout: 10_000 })
  await mcp.waitForTool(LLM_FILL)
  const called = await mcp.callWhenConnected(LLM_FILL, input)
  expect((called.structuredContent as ToolResult<unknown>).status).toBe('ok')
  results.mcp = await fillResultOf(page, 'mcp')
  await expectFilled(page)
  await reloadClean(page)

  // (4) A one-step `do` tour (caller `tour`).
  await page.waitForFunction(() => globalThis.__example?.startTour !== undefined)
  await page.evaluate(
    ([tool, i]) =>
      globalThis.__example!.startTour!({
        mode: 'do',
        steps: [{ tool, text: 'Fill the challenge form.', input: i }],
      }),
    [FILL, input] as const,
  )
  results.tour = await fillResultOf(page, 'tour')
  await expectFilled(page)
  await expect(page.getByTestId('tour-status')).toHaveText('done', { timeout: 10_000 })
  await reloadClean(page)

  // (5) The Playwright `tools` fixture (caller `test`).
  await expect(tools).toHaveTools([FILL])
  await tools.call(FILL, input)
  results.test = await fillResultOf(page, 'test')
  await expectFilled(page)

  const changesOf = (r: ToolResult<unknown>): unknown => {
    expect(r.status).toBe('ok')
    return r.status === 'ok' ? (r.data as { changes: unknown }).changes : undefined
  }
  const reference = changesOf(results.test)
  expect(reference).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'title.en' })]))
  for (const caller of ['inapp', 'webmcp', 'mcp', 'tour'] as const) {
    expect(changesOf(results[caller]!), caller).toEqual(reference)
  }
})
