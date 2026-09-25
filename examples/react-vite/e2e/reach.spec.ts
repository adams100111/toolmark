import { expect, test } from '@toolmark/testing'
import type { ToolResult } from '@toolmark/core'
import { freePort, pairPage, startMcpClient, type McpClientHandle } from './support/mcp-client.js'

// The M3 exit (spec §20): one tool declaration, three surfaces — the Playwright fixture, WebMCP
// through the polyfill, and a desktop MCP client through `toolmark-mcp`.

const FILL = 'challenges.create.fill'
const LLM_FILL = 'challenges__create__fill'

// The fill input of `form.spec.ts` › `agent_fill_updates_visible_fields`.
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

test('same_declaration_webmcp_mcp_fixture', async ({ page, tools }) => {
  test.setTimeout(60_000)
  const port = await freePort()
  mcp = await startMcpClient({ port, era: 'modern' })

  await page.goto(`/?mcpPort=${port}`)
  await expect(tools).toHaveTools([FILL])
  await pairPage(page, mcp.code)
  await mcp.waitForTool(LLM_FILL)
  const status = page.getByTestId('mcp-status')

  // (a) The Playwright fixture.
  const viaFixture = await tools.call(FILL, input)
  await page.reload()
  await expect(tools).toHaveTools([FILL])

  // (b) WebMCP through the polyfill: getTools() → the entry → executeTool(entry, JSON) → JSON.parse.
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
  const viaWebMcp = JSON.parse(
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
    ),
  ) as ToolResult<unknown>
  await page.reload()
  // The page resumes with its session token: no new code is typed.
  await expect(status).toHaveText('paired', { timeout: 10_000 })
  await expect(page.getByLabel('Pairing code')).toHaveValue('')

  // (c) The desktop MCP client.
  await mcp.waitForTool(LLM_FILL)
  const called = await mcp.callWhenConnected(LLM_FILL, input)
  const viaMcp = called.structuredContent as ToolResult<unknown>

  expect(viaFixture.status).toBe('ok')
  expect(viaWebMcp.status).toBe('ok')
  expect(viaMcp.status).toBe('ok')
  if (viaFixture.status !== 'ok' || viaWebMcp.status !== 'ok' || viaMcp.status !== 'ok') return
  expect(viaWebMcp.data).toEqual(viaFixture.data)
  expect(viaMcp.data).toEqual(viaFixture.data)

  await expect(page.getByLabel('Title (English)')).toHaveValue('Innovation challenge')
  await expect(page.getByLabel('Title (Arabic)')).toHaveValue('تحدي الابتكار')
  await expect(page.getByLabel('Type')).toHaveValue('hackathon')
  await expect(page.getByLabel('Starts at')).toHaveValue('2026-10-01')

  const listed = (await tools.list()).filter((t) => t.name === FILL)
  expect(listed).toHaveLength(1)
})
