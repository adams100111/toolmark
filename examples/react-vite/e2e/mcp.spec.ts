import { expect, test } from '@toolmark/testing'
import type { ToolResult } from '@toolmark/core'
import {
  freePort,
  pairPage,
  startMcpClient,
  type McpClientHandle,
  type McpEra,
} from './support/mcp-client.js'

const FILL = 'challenges.create.fill'
const LLM_FILL = 'challenges__create__fill'

const values = {
  title: { ar: 'تحدي الابتكار', en: 'Innovation challenge' },
  type: 'hackathon',
  startsAt: '2026-10-01',
}

let mcp: McpClientHandle | undefined
test.afterEach(async () => {
  await mcp?.close()
  mcp = undefined
})

for (const era of ['legacy', 'modern'] as const satisfies readonly McpEra[]) {
  test(`${era}_client_lists_and_calls_after_pairing`, async ({ page, tools }) => {
    test.setTimeout(60_000)
    const port = await freePort()
    mcp = await startMcpClient({ port, era })
    expect(mcp.client.getNegotiatedProtocolVersion()).toBe(
      era === 'legacy' ? '2025-11-25' : '2026-07-28',
    )
    const before = await mcp.client.listTools()
    expect(before.tools.map((t) => t.name)).toEqual(['toolmark_pairing'])

    await page.goto(`/?mcpPort=${port}`)
    await expect(tools).toHaveTools([FILL])
    await pairPage(page, mcp.code)

    const tool = await mcp.waitForTool(LLM_FILL)
    expect(tool.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false })
    const after = await mcp.client.listTools()
    expect(after.tools.map((t) => t.name)).not.toContain('toolmark_pairing')

    const r = await mcp.callWhenConnected(LLM_FILL, { values })
    expect(r.isError).toBe(false)
    const result = r.structuredContent as ToolResult<unknown>
    expect(result.status).toBe('ok')
    await expect(page.getByLabel('Title (English)')).toHaveValue('Innovation challenge')
    await expect(page.getByLabel('Starts at')).toHaveValue('2026-10-01')
  })
}

test('reload_resumes_without_new_code', async ({ page, tools }) => {
  test.setTimeout(60_000)
  const port = await freePort()
  mcp = await startMcpClient({ port, era: 'modern' })
  await page.goto(`/?mcpPort=${port}`)
  await expect(tools).toHaveTools([FILL])
  await pairPage(page, mcp.code)
  await mcp.waitForTool(LLM_FILL)
  const token = await page.evaluate((p) => sessionStorage.getItem(`toolmark:mcp:${p}`), port)
  expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)

  await page.reload()
  const status = page.getByTestId('mcp-status')
  await expect(status).toHaveText('paired', { timeout: 10_000 })
  await expect(page.getByLabel('Pairing code')).toHaveValue('')
  // The resumed page keeps the same token (a new pairing would mint a new one).
  expect(await page.evaluate((p) => sessionStorage.getItem(`toolmark:mcp:${p}`), port)).toBe(token)

  const r = await mcp.callWhenConnected(LLM_FILL, { values })
  expect((r.structuredContent as ToolResult<unknown>).status).toBe('ok')
  await expect(page.getByLabel('Title (English)')).toHaveValue('Innovation challenge')
})
