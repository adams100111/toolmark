import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WebMCP } from 'webmcp-types'
import { cleanupWebMCPPolyfill } from '@mcp-b/webmcp-polyfill'
import { createToolmark, fromJsonSchema, ok, type ToolResult } from '@toolmark/core'
import { webmcp, type ModelContextLike, type WebMcpToolDescriptor } from '@toolmark/core/webmcp'

type Doc = Document & { readonly modelContext?: WebMCP.ModelContext }
const doc = document as Doc

function registry() {
  const tm = createToolmark({ confirm: () => Promise.resolve({ approved: true }) })
  tm.register({
    name: 'orders.list',
    title: 'List orders',
    description: 'Lists orders.',
    hints: { readOnly: true, untrustedContent: true },
    input: fromJsonSchema({ type: 'object', properties: { q: { type: 'string' } } }),
    run: (input) => ok({ echo: input }),
  })
  tm.register({
    name: 'orders.cancel',
    description: 'Cancels an order.',
    hints: { consequential: true },
    run: () => ok('cancelled'),
  })
  return tm
}

async function listedTools(): Promise<WebMCP.RegisteredTool[]> {
  const mc = doc.modelContext
  if (!mc) throw new Error('no document.modelContext')
  return mc.getTools()
}

const disposers: (() => void)[] = []
afterEach(() => {
  for (const d of disposers.splice(0)) d()
  cleanupWebMCPPolyfill()
  Reflect.deleteProperty(navigator, 'modelContext')
})

describe('webmcp with @mcp-b/webmcp-polyfill (Chromium)', () => {
  it('no_polyfill_no_global_pollution', async () => {
    const tm = registry()
    const errors: string[] = []
    tm.events.on('error', (e) => errors.push(e.code))
    disposers.push(tm.use(webmcp()))
    await vi.waitFor(() => expect(errors).toEqual(['webmcp_unavailable']))
    expect(doc.modelContext).toBeUndefined()
    expect('modelContext' in navigator).toBe(false)
    expect('ModelContext' in window).toBe(false)
  })

  it('polyfill_loader_initializes', async () => {
    const tm = registry()
    disposers.push(tm.use(webmcp({ polyfill: () => import('@mcp-b/webmcp-polyfill') })))
    await vi.waitFor(async () => {
      expect((await listedTools()).map((t) => t.name)).toEqual(['orders.cancel', 'orders.list'])
    })
    const tools = await listedTools()
    const list = tools.find((t) => t.name === 'orders.list')
    expect(list?.title).toBe('List orders')
    // The polyfill keeps only readOnlyHint / untrustedContentHint (it drops consequentialHint).
    expect(list?.annotations).toEqual(
      expect.objectContaining({ readOnlyHint: true, untrustedContentHint: true }),
    )
    const cancel = tools.find((t) => t.name === 'orders.cancel')
    expect(cancel?.annotations).toEqual(
      expect.objectContaining({ readOnlyHint: false, untrustedContentHint: false }),
    )
  })

  it('polyfill_execute_round_trip', async () => {
    const tm = registry()
    const callers: string[] = []
    tm.events.on('call', (e) => callers.push(e.caller))
    disposers.push(tm.use(webmcp({ polyfill: () => import('@mcp-b/webmcp-polyfill') })))
    await vi.waitFor(async () => expect(await listedTools()).toHaveLength(2))
    const entry = (await listedTools()).find((t) => t.name === 'orders.list')
    if (!entry || !doc.modelContext) throw new Error('not registered')
    // The polyfill's executeTool takes the input as a JSON string (Chrome's shape).
    const executeTool = doc.modelContext.executeTool.bind(doc.modelContext) as unknown as (
      tool: WebMCP.RegisteredTool,
      input: string,
    ) => Promise<string>
    const raw = await executeTool(entry, JSON.stringify({ q: 'open' }))
    const result = JSON.parse(raw) as ToolResult<unknown>
    expect(result).toEqual({ status: 'ok', data: { echo: { q: 'open' } } })
    expect(callers).toEqual(['webmcp'])
  })

  it('polyfill_unregisters_on_dispose', async () => {
    const tm = registry()
    const dispose = tm.use(webmcp({ polyfill: () => import('@mcp-b/webmcp-polyfill') }))
    await vi.waitFor(async () => expect(await listedTools()).toHaveLength(2))
    dispose()
    await vi.waitFor(async () => expect(await listedTools()).toEqual([]))
  })

  it('legacy_navigator_getter_supported', async () => {
    const registered: WebMcpToolDescriptor[] = []
    const fake: ModelContextLike = {
      registerTool(t) {
        registered.push(t)
        return Promise.resolve()
      },
    }
    Object.defineProperty(navigator, 'modelContext', { configurable: true, value: fake })
    expect(doc.modelContext).toBeUndefined()
    const tm = registry()
    disposers.push(tm.use(webmcp()))
    await vi.waitFor(() =>
      expect(registered.map((t) => t.name).sort()).toEqual(['orders.cancel', 'orders.list']),
    )
  })
})
