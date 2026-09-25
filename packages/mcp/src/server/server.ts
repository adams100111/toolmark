import { Server, type McpServerFactory, type Transport } from '@modelcontextprotocol/server'
import { serveStdio, StdioServerTransport } from '@modelcontextprotocol/server/stdio'
import { refuse, type ToolManifest, type ToolResult } from '@toolmark/core'
import { PAIRING_TOOL_NAME, pairingResultText, pairingTool } from './pairing-tool.js'
import { isPlainObject, toMcpResult, toMcpTool, utf8Length, type McpTool } from './tool-mapping.js'

/**
 * The server's view of the paired page (implemented by the pairing server, Task 5). Every method
 * must be safe to call at any time; the server never trusts it to be paired.
 */
export interface PageLink {
  /** `paired` while a page serves tools (including the short unpaired grace), else `unpaired`. */
  state(): 'unpaired' | 'paired'
  /** Full manifest entries of the paired page; `[]` while unpaired. */
  manifest(): Promise<ToolManifest[]>
  /**
   * Calls a page tool by its full name. Resolves (never rejects) with the tool result; aborting
   * `signal` must cancel the call on the page and resolve `cancelled`.
   */
  call(name: string, input: unknown, opts: { signal: AbortSignal }): Promise<ToolResult<unknown>>
  /** The current one-time pairing code in display form `XXXX-XXXX`, and its remaining lifetime. */
  pairingCode(): { code: string; expiresInMs: number }
  /** Subscribes to pairing-state and manifest-revision changes; returns the unsubscriber. */
  onChange(cb: () => void): () => void
}

/** Options of {@link createServerFactory}. */
export interface ServerFactoryOptions {
  /** Server version reported to clients (default `0.0.0`; the CLI passes the package version). */
  version?: string
  /** Out-of-band errors (link failures, notification failures). Never alters the wire. */
  onerror?: (error: Error) => void
}

/** Options of {@link startMcpServer}. */
export interface StartMcpServerOptions {
  /** The paired-page link. */
  link: PageLink
  /** Transport (default: stdio over `process.stdin` / `process.stdout`). */
  transport?: Transport
  /** Out-of-band errors; the CLI writes them to stderr. */
  onerror?: (error: Error) => void
  /** Server version reported to clients. */
  version?: string
}

/** Text of a page-tool call while no page is paired. */
export const UNPAIRED_CALL_TEXT =
  'No page is paired. Call toolmark_pairing and ask the user to enter the code in the app.'

/** Text of the generic `error` result for a failed or malformed page call. */
const CALL_FAILED_TEXT = 'The call to the page failed.'

/** Maximum number of page tools listed by `tools/list`; entries beyond it are neither listed nor callable. */
export const MAX_LISTED_TOOLS = 200

/**
 * Maximum UTF-8 size of the serialized page-tool list; listing stops before the tool that would
 * exceed it, and the tools beyond it are not callable.
 */
export const MAX_TOOL_LIST_BYTES = 256 * 1024

const MCP_TOOL_NAME = /^[a-zA-Z0-9_-]{1,64}$/

const RESULT_STATUSES: ReadonlySet<unknown> = new Set([
  'ok',
  'invalid',
  'refused',
  'needs_confirmation',
  'cancelled',
  'error',
])

interface ToolIndex {
  tools: McpTool[]
  byName: Map<string, { full: string; untrusted: boolean }>
  /** Entries left out because a list cap was reached. */
  truncated: number
}

const EMPTY_INDEX = (): ToolIndex => ({ tools: [], byName: new Map(), truncated: 0 })

/**
 * Indexes the manifest by MCP name. Entries that are not plain objects are skipped. Entries whose
 * `llmName` is not a valid MCP name, equals the reserved pairing tool name, or is shared by more
 * than one entry are left out entirely (listed nowhere, callable by no name), so a call can never
 * be routed to an ambiguous tool. Listing stops at {@link MAX_LISTED_TOOLS} tools or
 * {@link MAX_TOOL_LIST_BYTES} serialized bytes.
 */
function indexManifest(manifest: unknown): ToolIndex {
  if (!Array.isArray(manifest)) return EMPTY_INDEX()
  const entries = manifest.filter(isPlainObject) as unknown as ToolManifest[]
  const counts = new Map<unknown, number>()
  for (const t of entries) counts.set(t.llmName, (counts.get(t.llmName) ?? 0) + 1)
  const index = EMPTY_INDEX()
  let bytes = 2 // `[` and `]`
  for (const t of entries) {
    const llm = t.llmName
    if (typeof llm !== 'string' || typeof t.name !== 'string') continue
    if (!MCP_TOOL_NAME.test(llm) || llm === PAIRING_TOOL_NAME || counts.get(llm) !== 1) continue
    if (index.truncated > 0 || index.tools.length >= MAX_LISTED_TOOLS) {
      index.truncated++
      continue
    }
    const tool = toMcpTool(t)
    const size = utf8Length(JSON.stringify(tool)) + (index.tools.length > 0 ? 1 : 0)
    if (bytes + size > MAX_TOOL_LIST_BYTES) {
      index.truncated++
      continue
    }
    bytes += size
    index.tools.push(tool)
    index.byName.set(llm, { full: t.name, untrusted: tool._meta !== undefined })
  }
  return index
}

/** `true` for a plain object whose `status` is one of the known `ToolResult` statuses. */
function isToolResult(r: unknown): r is ToolResult<unknown> {
  return isPlainObject(r) && RESULT_STATUSES.has(r.status)
}

function toError(e: unknown): Error {
  return e instanceof Error ? e : new Error(String(e))
}

function textResult(text: string, isError: boolean) {
  return { content: [{ type: 'text' as const, text }], isError }
}

/**
 * Builds the MCP server factory for `serveStdio` (spec §11.3, D31). Each instance is a low-level
 * `Server` advertising `tools.listChanged`, whose `tools/list` and `tools/call` handlers read the
 * shared `link`; link changes send `notifications/tools/list_changed` (routed per era by the SDK)
 * until the instance closes.
 * @param link - The paired-page link.
 * @param o - Server version and error sink.
 * @returns A factory usable with `serveStdio` for both protocol eras.
 */
export function createServerFactory(
  link: PageLink,
  o: ServerFactoryOptions = {},
): McpServerFactory {
  const report = (e: unknown) => {
    try {
      o.onerror?.(toError(e))
    } catch {
      // Error sinks must never break serving.
    }
  }

  // Reports list truncation once per truncated stretch (reset by an untruncated listing).
  let truncationReported = false
  const readIndex = async (): Promise<ToolIndex> => {
    if (link.state() !== 'paired') return EMPTY_INDEX()
    let index: ToolIndex
    try {
      index = indexManifest(await link.manifest())
    } catch (e) {
      report(e)
      return EMPTY_INDEX()
    }
    if (index.truncated === 0) {
      truncationReported = false
    } else if (!truncationReported) {
      truncationReported = true
      report(
        new Error(
          `The page offers more tools than MCP lists (at most ${MAX_LISTED_TOOLS} tools and ${MAX_TOOL_LIST_BYTES} bytes); ${index.truncated} tools are not listed.`,
        ),
      )
    }
    return index
  }

  return () => {
    const server = new Server(
      { name: '@toolmark/mcp', version: o.version ?? '0.0.0' },
      { capabilities: { tools: { listChanged: true } } },
    )

    server.setRequestHandler('tools/list', async () => {
      if (link.state() !== 'paired') return { tools: [structuredClone(pairingTool)] }
      return { tools: (await readIndex()).tools }
    })

    server.setRequestHandler('tools/call', async (request, ctx) => {
      const { name, arguments: args } = request.params
      const project = (r: ReturnType<typeof textResult>) =>
        server.projectCallToolResult(r, undefined)

      if (name === PAIRING_TOOL_NAME) {
        const { code, expiresInMs } = link.pairingCode()
        return project(textResult(pairingResultText(code, expiresInMs), false))
      }
      if (link.state() !== 'paired') return project(textResult(UNPAIRED_CALL_TEXT, true))

      const target = (await readIndex()).byName.get(name)
      if (!target) {
        return project(
          toMcpResult(refuse('unknown_tool', 'The paired page has no tool with that name.')),
        )
      }
      const failed = () => toMcpResult({ status: 'error', message: CALL_FAILED_TEXT })
      let mapped: ReturnType<typeof toMcpResult>
      try {
        const result: unknown = await link.call(target.full, args ?? {}, {
          signal: ctx.mcpReq.signal,
        })
        if (isToolResult(result)) {
          mapped = toMcpResult(result, { untrusted: target.untrusted })
        } else {
          report(new Error('The page returned a malformed tool result.'))
          mapped = failed()
        }
      } catch (e) {
        report(e)
        mapped = failed()
      }
      return project(mapped)
    })

    const unsubscribe = link.onChange(() => {
      server.sendToolListChanged().catch(report)
    })
    const previousOnclose = server.onclose
    server.onclose = () => {
      unsubscribe()
      previousOnclose?.()
    }
    return server
  }
}

/**
 * Serves MCP over stdio for both protocol eras through the SDK's `serveStdio` (legacy clients via
 * `initialize`, modern clients via `server/discover`); Toolmark writes no era router.
 * @param o - The link, optional transport (tests), error sink and version.
 * @returns A handle whose `close()` tears the connection down.
 */
export function startMcpServer(o: StartMcpServerOptions): { close(): Promise<void> } {
  const factoryOptions: ServerFactoryOptions = {}
  if (o.version !== undefined) factoryOptions.version = o.version
  if (o.onerror !== undefined) factoryOptions.onerror = o.onerror
  const handle = serveStdio(createServerFactory(o.link, factoryOptions), {
    legacy: 'serve',
    transport: o.transport ?? new StdioServerTransport(process.stdin, process.stdout),
    ...(o.onerror ? { onerror: o.onerror } : {}),
  })
  return { close: () => handle.close() }
}
