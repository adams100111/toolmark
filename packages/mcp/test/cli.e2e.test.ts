import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { ok } from '@toolmark/core'
import { createTestToolmark } from '@toolmark/testing/vitest'
import { mcpPairing, type McpPairingStatus } from '../src/client/index.js'
import { installOriginWebSocket, mapStorage, until } from './helpers/origin-websocket.js'

const cliPath = fileURLToPath(new URL('../dist/cli.js', import.meta.url))

const cleanups: (() => Promise<void> | void)[] = []
beforeEach(() => {
  cleanups.push(installOriginWebSocket())
  vi.stubGlobal('sessionStorage', mapStorage())
  cleanups.push(() => void vi.unstubAllGlobals())
})
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c()
})

type Mode = 'legacy' | { pin: '2026-07-28' }

async function session(mode: Mode) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cliPath, '--allow-origin', 'http://localhost:5173', '--port', '0'],
    stderr: 'pipe',
  })
  let stderr = ''
  transport.stderr?.on('data', (d: Buffer) => (stderr += d.toString()))
  const client = new Client({ name: 'e2e', version: '0' }, { versionNegotiation: { mode } })
  await client.connect(transport)
  cleanups.push(() => client.close())
  await until(() => /pairing server on ws:\/\/127\.0\.0\.1:\d+/.test(stderr), 10_000)
  const port = Number(/pairing server on ws:\/\/127\.0\.0\.1:(\d+)/.exec(stderr)![1])
  return { client, port, stderr: () => stderr }
}

async function drive(mode: Mode) {
  const { client, port } = await session(mode)
  const listed = await client.listTools()
  expect(listed.tools.map((t) => t.name)).toEqual(['toolmark_pairing'])
  const pairing = await client.callTool({ name: 'toolmark_pairing', arguments: {} })
  const text = (pairing.content as { text: string }[])[0]!.text
  const code = /enter code (\S{4}-\S{4})/.exec(text)![1]!

  const tm = createTestToolmark()
  tm.register({
    name: 'crm.contacts.search',
    description: 'Searches contacts.',
    hints: { readOnly: true },
    run: () => ok({ hits: ['ada'] }),
  })
  const statuses: McpPairingStatus[] = []
  cleanups.push(tm.use(mcpPairing({ code, port, onStatus: (s) => statuses.push(s) })))
  await until(() => statuses.includes('paired'), 10_000)

  await vi.waitFor(
    async () => {
      const { tools } = await client.listTools()
      expect(tools.map((t) => t.name)).toEqual(['crm__contacts__search'])
    },
    { timeout: 10_000, interval: 50 },
  )
  const r = await client.callTool({ name: 'crm__contacts__search', arguments: {} })
  expect(r.isError).toBe(false)
  expect(r.structuredContent).toEqual({ status: 'ok', data: { hits: ['ada'] } })
  expect(tm.calls.map((c) => c.caller)).toEqual(['mcp'])
  return client
}

describe('toolmark-mcp end to end', () => {
  it('cli_e2e_stdio_to_page', { timeout: 60_000 }, async () => {
    const legacy = await drive('legacy')
    expect(legacy.getNegotiatedProtocolVersion()).toBe('2025-11-25')
    const modern = await drive({ pin: '2026-07-28' })
    expect(modern.getNegotiatedProtocolVersion()).toBe('2026-07-28')
  })
})
