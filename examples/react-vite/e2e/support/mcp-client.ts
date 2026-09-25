import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { expect, type Page } from '@playwright/test'
import { Client, type Tool } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'

/** The built CLI (`toolmark-mcp`); `e2e/global-setup.ts` builds it before any spec runs. */
export const CLI_PATH = fileURLToPath(
  new URL('../../../../packages/mcp/dist/cli.js', import.meta.url),
)

/** The MCP era the client speaks: `initialize` (legacy) or `server/discover` pinned to 2026-07-28. */
export type McpEra = 'legacy' | 'modern'

/** Options of {@link startMcpClient}. */
export interface StartMcpClientOptions {
  /** The pairing port passed to `toolmark-mcp --port` (and to the page as `?mcpPort=`). */
  port: number
  era: McpEra
  /**
   * The page origin allowed to pair (`--allow-origin`). Defaults to the example's Playwright
   * `baseURL` origin (`http://localhost:<TOOLMARK_EXAMPLE_PORT ?? 5173>`).
   */
  allowOrigin?: string
}

/** A connected MCP SDK client talking to a spawned `toolmark-mcp`. */
export interface McpClientHandle {
  client: Client
  /** The current pairing code (`XXXX-XXXX`), from `toolmark_pairing` or the stderr line. */
  code: string
  /** Everything the CLI wrote to stderr so far. */
  stderr(): string
  /**
   * Resolves once `tools/list` contains `llmName` (on a `list_changed` notification or by polling
   * `listTools`); rejects after `timeoutMs` (default `10000`).
   */
  waitForTool(llmName: string, timeoutMs?: number): Promise<Tool>
  /**
   * `tools/call` that retries (for up to `timeoutMs`, default `10000`) while the CLI answers
   * `No page is connected.`: right after a page (re)pairs, the CLI adopts it only once its manifest
   * arrives. Such a call never reaches the page, so retrying it has no side effect.
   */
  callWhenConnected(
    name: string,
    args: Record<string, unknown>,
    timeoutMs?: number,
  ): ReturnType<Client['callTool']>
  /** Closes the client, which ends the CLI (stdin EOF). */
  close(): Promise<void>
}

const NOT_CONNECTED_TEXT = 'No page is connected.'
const CODE_IN_TEXT = /enter code (\S{4}-\S{4})/
const CODE_ON_STDERR = /Toolmark pairing code: ([0-9A-Z]{4}-[0-9A-Z]{4})/

/** The example's Playwright `baseURL` origin. */
export function exampleOrigin(): string {
  return `http://localhost:${Number(process.env.TOOLMARK_EXAMPLE_PORT ?? 5173)}`
}

/** Returns a port that was free on 127.0.0.1 a moment ago (bind `0`, read it, close). */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => resolve(port))
    })
  })
}

/**
 * Spawns `packages/mcp/dist/cli.js` over stdio (`--allow-origin <origin> --port <port>`), connects an
 * SDK `Client` in the requested era and reads the pairing code. Always `close()` the handle.
 */
export async function startMcpClient(o: StartMcpClientOptions): Promise<McpClientHandle> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [CLI_PATH, '--allow-origin', o.allowOrigin ?? exampleOrigin(), '--port', String(o.port)],
    stderr: 'pipe',
  })
  let stderr = ''
  transport.stderr?.on('data', (d: Buffer) => (stderr += d.toString()))

  const waiters = new Set<() => void>()
  const client = new Client(
    { name: 'toolmark-e2e', version: '0' },
    {
      versionNegotiation: { mode: o.era === 'legacy' ? 'legacy' : { pin: '2026-07-28' } },
      listChanged: {
        tools: {
          debounceMs: 0,
          onChanged: () => {
            for (const wake of waiters) wake()
          },
        },
      },
    },
  )
  await client.connect(transport)

  let code: string | undefined
  try {
    const pairing = await client.callTool({ name: 'toolmark_pairing', arguments: {} })
    const content = pairing.content as { type: string; text?: string }[] | undefined
    code = CODE_IN_TEXT.exec(content?.[0]?.text ?? '')?.[1]
  } catch {
    code = undefined
  }
  if (code === undefined) {
    const deadline = Date.now() + 10_000
    while (code === undefined && Date.now() < deadline) {
      code = CODE_ON_STDERR.exec(stderr)?.[1]
      if (code === undefined) await new Promise((r) => setTimeout(r, 50))
    }
  }
  if (code === undefined) {
    await client.close()
    throw new Error(`toolmark-mcp printed no pairing code; stderr:\n${stderr}`)
  }

  const waitForTool = async (llmName: string, timeoutMs = 10_000): Promise<Tool> => {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const { tools } = await client.listTools()
      const found = tools.find((t) => t.name === llmName)
      if (found) return found
      const left = deadline - Date.now()
      if (left <= 0) {
        throw new Error(
          `tool ${llmName} not listed within ${timeoutMs} ms; listed: ${tools.map((t) => t.name).join(', ')}`,
        )
      }
      // Wake on a list_changed notification, or poll again after 200 ms.
      await new Promise<void>((resolve) => {
        const wake = (): void => {
          clearTimeout(timer)
          waiters.delete(wake)
          resolve()
        }
        const timer = setTimeout(wake, Math.min(200, left))
        waiters.add(wake)
      })
    }
  }

  const callWhenConnected = async (
    name: string,
    args: Record<string, unknown>,
    timeoutMs = 10_000,
  ): ReturnType<Client['callTool']> => {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const result = await client.callTool({ name, arguments: args })
      const sc = result.structuredContent as { status?: unknown; message?: unknown } | undefined
      const notConnected = sc?.status === 'error' && sc.message === NOT_CONNECTED_TEXT
      if (!notConnected || Date.now() >= deadline) return result
      await new Promise((r) => setTimeout(r, 100))
    }
  }

  return {
    client,
    code,
    callWhenConnected,
    stderr: () => stderr,
    waitForTool,
    close: () => client.close(),
  }
}

/**
 * Types `code` into the example's "Pair with desktop MCP" panel, presses Pair and waits for the
 * panel to report `paired`.
 */
export async function pairPage(page: Page, code: string): Promise<void> {
  const panel = page.getByRole('region', { name: 'Pair with desktop MCP' })
  await panel.getByLabel('Pairing code').fill(code)
  await panel.getByRole('button', { name: 'Pair' }).click()
  await expect(panel.getByTestId('mcp-status')).toHaveText('paired', { timeout: 10_000 })
}
