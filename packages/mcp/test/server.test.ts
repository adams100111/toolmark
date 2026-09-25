import { afterEach, describe, expect, it, vi } from 'vitest'
import { Client, InMemoryTransport, type Tool } from '@modelcontextprotocol/client'
import {
  MAX_LISTED_TOOLS,
  MAX_TOOL_LIST_BYTES,
  PAIRING_TOOL_NAME,
  startMcpServer,
  UNTRUSTED_DESCRIPTION_SUFFIX,
} from '../src/index.js'
import { createFakeLink, entry, type FakeLink } from './helpers/fake-link.js'

type Era = 'legacy' | 'modern'

const PAIRING_TEXT =
  'Open the app, choose "Pair with desktop MCP", and enter code ABCD-EFGH (expires in 5 minutes).'
const UNPAIRED_TEXT =
  'No page is paired. Call toolmark_pairing and ask the user to enter the code in the app.'

const open: { close(): Promise<void> }[] = []

afterEach(async () => {
  for (const c of open.splice(0).reverse()) await c.close()
})

async function connect(
  era: Era,
  o: { link?: FakeLink; onToolsChanged?: (tools: Tool[] | null) => void } = {},
) {
  const link = o.link ?? createFakeLink()
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  const errors: Error[] = []
  const handle = startMcpServer({ link, transport: serverSide, onerror: (e) => errors.push(e) })
  const client = new Client(
    { name: 'test', version: '0' },
    {
      versionNegotiation: { mode: era === 'legacy' ? 'legacy' : { pin: '2026-07-28' } },
      ...(o.onToolsChanged
        ? {
            listChanged: {
              tools: {
                debounceMs: 0,
                onChanged: (error: Error | null, tools: Tool[] | null) => {
                  if (!error) o.onToolsChanged?.(tools)
                },
              },
            },
          }
        : {}),
    },
  )
  await client.connect(clientSide)
  open.push(handle, client)
  return { client, link, handle, errors }
}

function text(result: { content?: unknown }): string {
  const content = result.content as { type: string; text: string }[]
  expect(content[0]?.type).toBe('text')
  return content[0]!.text
}

describe('eras', () => {
  it('legacy_client_initialize_negotiates_2025_11_25', async () => {
    const { client, link } = await connect('legacy')
    expect(client.getNegotiatedProtocolVersion()).toBe('2025-11-25')
    link.pair([entry('crm.search')])
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name)).toEqual(['crm__search'])
    const r = await client.callTool({ name: 'crm__search', arguments: { q: 'ada' } })
    expect(r.isError).toBe(false)
    expect(r.structuredContent).toEqual({
      status: 'ok',
      data: { tool: 'crm.search', input: { q: 'ada' } },
    })
  })

  it('modern_client_discover_lists_only_2026_07_28', async () => {
    const { client, link } = await connect('modern')
    expect(client.getNegotiatedProtocolVersion()).toBe('2026-07-28')
    const discovered = await client.discover()
    expect(discovered.supportedVersions).toEqual(['2026-07-28'])
    link.pair([entry('crm.search')])
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name)).toEqual(['crm__search'])
    const r = await client.callTool({ name: 'crm__search', arguments: { q: 'ada' } })
    expect(r.isError).toBe(false)
    expect(r.structuredContent).toEqual({
      status: 'ok',
      data: { tool: 'crm.search', input: { q: 'ada' } },
    })
  })
})

describe.each(['legacy', 'modern'] as const)('%s era', (era) => {
  it('unpaired_lists_only_pairing_tool', async () => {
    const { client } = await connect(era)
    const { tools } = await client.listTools()
    expect(tools).toEqual([
      {
        name: PAIRING_TOOL_NAME,
        title: 'Pair with a Toolmark page',
        description:
          'Shows the one-time code that connects this MCP server to the user\'s open app. Ask the user to enter it in the app\'s "Pair with desktop MCP" panel.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
    ])
  })

  it('pairing_tool_result_shows_code', async () => {
    const { client, link } = await connect(era)
    const r = await client.callTool({ name: PAIRING_TOOL_NAME, arguments: {} })
    expect(r.isError).toBe(false)
    expect(text(r)).toBe(PAIRING_TEXT)
    // Callable any time, also while paired.
    link.pair([entry('crm.search')])
    const again = await client.callTool({ name: PAIRING_TOOL_NAME })
    expect(again.isError).toBe(false)
    expect(text(again)).toBe(PAIRING_TEXT)
    expect(link.calls).toEqual([])
  })

  it('paired_lists_page_tools_and_removes_pairing_tool', async () => {
    const link = createFakeLink()
    link.pair([
      entry('crm.search', { hints: { readOnly: true } }),
      entry('crm.page', { hints: { readOnly: true, untrustedContent: true } }),
    ])
    const { client } = await connect(era, { link })
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name)).toEqual(['crm__search', 'crm__page'])
    expect(tools[1]?._meta).toEqual({ 'toolmark/untrustedContent': true })
  })

  it('list_changed_notification_both_eras', async () => {
    const seen: string[][] = []
    const { link } = await connect(era, {
      onToolsChanged: (tools) => seen.push((tools ?? []).map((t) => t.name)),
    })
    link.pair([entry('crm.search')])
    await vi.waitFor(() => expect(seen).toContainEqual(['crm__search']), { timeout: 2000 })
    link.unpair()
    await vi.waitFor(() => expect(seen.at(-1)).toEqual([PAIRING_TOOL_NAME]), { timeout: 2000 })
  })

  it('call_maps_llm_name_to_full_name', async () => {
    const link = createFakeLink()
    link.pair([
      entry('crm.contacts.search'),
      entry('crm.page', { hints: { untrustedContent: true } }),
    ])
    const { client } = await connect(era, { link })
    const r = await client.callTool({ name: 'crm__contacts__search', arguments: { q: 'x' } })
    expect(link.calls.map((c) => [c.name, c.input])).toEqual([['crm.contacts.search', { q: 'x' }]])
    expect(r.isError).toBe(false)
    // Missing arguments are forwarded as `{}`; untrusted results are marked.
    const u = await client.callTool({ name: 'crm__page' })
    expect(link.calls[1]?.input).toEqual({})
    expect(text(u).startsWith('[untrusted page content]\n')).toBe(true)
    expect(u._meta).toMatchObject({ 'toolmark/untrustedContent': true })
    // A full name is not an MCP name.
    const full = await client.callTool({ name: 'crm.contacts.search', arguments: {} })
    expect(full.isError).toBe(true)
    expect(link.calls).toHaveLength(2)
  })

  it('unknown_tool_name_returns_refused', async () => {
    const link = createFakeLink()
    link.pair([entry('crm.search')])
    const { client } = await connect(era, { link })
    const r = await client.callTool({ name: 'nope', arguments: {} })
    expect(r.isError).toBe(true)
    expect(r.structuredContent).toMatchObject({ status: 'refused', code: 'unknown_tool' })
    // The unknown name is not echoed back.
    expect(text(r)).not.toContain('nope')
    expect(link.calls).toEqual([])
  })

  it('unpaired_call_returns_error_text', async () => {
    const { client, link } = await connect(era)
    const r = await client.callTool({ name: 'crm__search', arguments: {} })
    expect(r.isError).toBe(true)
    expect(text(r)).toBe(UNPAIRED_TEXT)
    expect(link.calls).toEqual([])
  })

  it('caps_two_million_char_description_and_title', async () => {
    const link = createFakeLink()
    const huge = 'd'.repeat(2_000_000)
    link.pair([
      entry('crm.big', { description: huge, title: huge }),
      entry('crm.bigu', { description: huge, hints: { untrustedContent: true } }),
    ])
    const { client } = await connect(era, { link })
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name)).toEqual(['crm__big', 'crm__bigu'])
    expect(tools[0]?.description).toBe('d'.repeat(2048))
    expect(tools[0]?.title).toBe('d'.repeat(256))
    expect(tools[1]?.description).toBe('d'.repeat(2048) + UNTRUSTED_DESCRIPTION_SUFFIX)
  })

  it('invalid_page_result_becomes_generic_error', async () => {
    const link = createFakeLink()
    link.pair([entry('crm.odd')])
    const garbage: unknown[] = [
      null,
      undefined,
      'ok',
      42,
      [],
      { status: 'weird' },
      { status: 'ok', data: 1n },
      Object.assign(Object.create({ status: 'ok' }) as object, {}),
    ]
    let i = 0
    link.respond(() => garbage[i++] as never)
    const { client, errors } = await connect(era, { link })
    for (let n = 0; n < garbage.length; n++) {
      const r = await client.callTool({ name: 'crm__odd', arguments: {} })
      expect(r.isError).toBe(true)
      expect(r.structuredContent).toEqual({
        status: 'error',
        message: 'The call to the page failed.',
      })
    }
    expect(errors).toHaveLength(garbage.length)
  })

  it('mcp_cancel_aborts_link_call', async () => {
    const link = createFakeLink()
    link.pair([entry('crm.slow')])
    let started!: () => void
    const running = new Promise<void>((resolve) => (started = resolve))
    link.respond(
      ({ signal }) =>
        new Promise((resolve) => {
          started()
          signal.addEventListener('abort', () => resolve({ status: 'cancelled', by: 'signal' }))
        }),
    )
    const { client } = await connect(era, { link })
    const controller = new AbortController()
    const pending = client.callTool(
      { name: 'crm__slow', arguments: {} },
      { signal: controller.signal },
    )
    await running
    expect(link.calls[0]?.signal.aborted).toBe(false)
    controller.abort()
    await expect(pending).rejects.toThrow()
    await vi.waitFor(() => expect(link.calls[0]?.signal.aborted).toBe(true), { timeout: 2000 })
  })
})

describe('server hygiene', () => {
  it('unsubscribes_on_close', async () => {
    const { handle, link } = await connect('legacy')
    expect(link.listenerCount()).toBeGreaterThan(0)
    await handle.close()
    expect(link.listenerCount()).toBe(0)
  })

  it('omits_colliding_and_reserved_names', async () => {
    const link = createFakeLink()
    link.pair([
      entry('a.b'),
      entry('a__b', { llmName: 'a__b' }),
      entry('toolmark_pairing', { llmName: 'toolmark_pairing' }),
      entry('bad', { llmName: 'has space' }),
      entry('ok.one'),
    ])
    const { client } = await connect('legacy', { link })
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name)).toEqual(['ok__one'])
    const r = await client.callTool({ name: 'a__b', arguments: {} })
    expect(r.structuredContent).toMatchObject({ status: 'refused', code: 'unknown_tool' })
    expect(link.calls).toEqual([])
  })

  it('caps_tool_count_and_reports_once', async () => {
    expect(MAX_LISTED_TOOLS).toBe(200)
    const link = createFakeLink()
    link.pair(Array.from({ length: 250 }, (_, n) => entry(`t.n${n}`)))
    const { client, errors } = await connect('legacy', { link })
    const first = await client.listTools()
    expect(first.tools).toHaveLength(200)
    expect(first.tools.at(-1)?.name).toBe('t__n199')
    await client.listTools()
    expect(errors).toHaveLength(1)
    // Tools beyond the cap are not callable either.
    const r = await client.callTool({ name: 't__n220', arguments: {} })
    expect(r.structuredContent).toMatchObject({ status: 'refused', code: 'unknown_tool' })
    expect(link.calls).toEqual([])
  })

  it('caps_total_list_bytes', async () => {
    expect(MAX_TOOL_LIST_BYTES).toBe(256 * 1024)
    const link = createFakeLink()
    // Each tool serializes to roughly 30 KiB (a 2 KiB description plus a ~28 KiB schema).
    const schema = {
      type: 'object',
      properties: { s: { type: 'string', description: 'x'.repeat(28_000) } },
    }
    link.pair(
      Array.from({ length: 20 }, (_, n) =>
        entry(`t.n${n}`, { description: 'd'.repeat(3000), inputSchema: schema }),
      ),
    )
    const { client, errors } = await connect('legacy', { link })
    const { tools } = await client.listTools()
    expect(tools.length).toBeGreaterThan(0)
    expect(tools.length).toBeLessThan(20)
    expect(new TextEncoder().encode(JSON.stringify(tools)).length).toBeLessThanOrEqual(
      MAX_TOOL_LIST_BYTES,
    )
    expect(errors).toHaveLength(1)
  })

  it('skips_non_object_manifest_entries', async () => {
    const link = createFakeLink()
    link.pair([null, 'crm.x', 7, [entry('crm.arr')], entry('crm.good')] as unknown as Parameters<
      FakeLink['pair']
    >[0])
    const { client } = await connect('legacy', { link })
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name)).toEqual(['crm__good'])
    const r = await client.callTool({ name: 'crm__good', arguments: {} })
    expect(r.isError).toBe(false)
  })

  it('link_failures_do_not_leak', async () => {
    const link = createFakeLink()
    link.pair([entry('crm.boom')])
    link.respond(() => {
      throw new Error('secret internal detail')
    })
    const { client, errors } = await connect('legacy', { link })
    const r = await client.callTool({ name: 'crm__boom', arguments: {} })
    expect(r.isError).toBe(true)
    expect(r.structuredContent).toMatchObject({ status: 'error' })
    expect(text(r)).not.toContain('secret')
    expect(errors.map((e) => e.message).join()).toContain('secret internal detail')
  })
})
