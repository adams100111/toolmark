import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createConfirmQueue, createToolmark } from '@toolmark/core'
import { bridge } from '@toolmark/core/bridge'
import { createInPageChannel } from '@toolmark/core/bridge/in-page'
import { websocketTransport } from '@toolmark/core/bridge/websocket'
import { otel } from '@toolmark/core/otel'
import { webmcp } from '@toolmark/core/webmcp'
import { ToolmarkProvider } from '@toolmark/react'
import { App } from './app.js'
import type { ExampleHook } from './example-hook.js'
import { createScriptedAgent } from './in-page-agent.js'
import { relayPlanner } from './relay-planner.js'
import { installDevTelemetry } from './telemetry.js'

/**
 * The e2e relay room URL when the page opts in with `?relay=<port>&room=<room>`
 * (`ws://127.0.0.1:<port>/<room>`), else `null` (the in-page agent is used). Test-only, like the
 * test hook: a production build never lets a link point its bridge at a local socket.
 */
function relayUrl(): string | null {
  if (import.meta.env.MODE === 'production') return null
  const params = new URLSearchParams(window.location.search)
  const port = Number(params.get('relay'))
  const room = params.get('room') ?? ''
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null
  if (!/^[A-Za-z0-9-]{0,64}$/.test(room)) return null
  return `ws://127.0.0.1:${port}/${room}`
}

// Inline confirmations (WebMCP, desktop MCP and tours are inline callers) go through this queue,
// rendered by the app's inline confirm dialog.
const confirmQueue = createConfirmQueue()
const tm = createToolmark({ dev: import.meta.env.DEV, confirm: confirmQueue.handler })

// Bridge (caller `inapp`): an agent on the e2e relay when the page opts in, else the in-page
// scripted agent, which subscribes before the bridge attaches so it receives the attach manifest.
const relay = relayUrl()
const channel = relay === null ? createInPageChannel() : null
const agent = channel ? createScriptedAgent(channel.agent) : undefined
tm.use(bridge({ transport: channel ? channel.transport : websocketTransport({ url: relay! }) }))
// Planned tours ask the agent on the relay (an app-level side channel, not protocol v1).
const planner =
  import.meta.env.MODE !== 'production' && relay !== null
    ? relayPlanner({ url: relay, clientId: tm.clientId })
    : undefined

// WebMCP (experimental): native `document.modelContext` when the browser has it, else the
// app-supplied polyfill loader (loaded only when needed).
tm.use(webmcp({ polyfill: () => import('@mcp-b/webmcp-polyfill') }))

// OpenTelemetry: spans and metrics for every call; dev prints spans to the console.
if (import.meta.env.DEV) installDevTelemetry()
tm.use(otel())

// Desktop MCP pairing lives in the "Pair with desktop MCP" panel (`pair-mcp.tsx`).

// Test-only globals: production builds drop this branch and the `@toolmark/testing/page` chunk.
if (import.meta.env.MODE !== 'production') {
  globalThis.__toolmark_agent__ = agent
  const hook: ExampleHook = { clientId: tm.clientId, results: [] }
  tm.events.on('result', (e) => {
    hook.results.push({ caller: e.caller, tool: e.tool, result: e.result })
  })
  globalThis.__example = hook
  void import('@toolmark/testing/page').then(({ installTestHook }) => {
    installTestHook(tm)
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToolmarkProvider toolmark={tm}>
      <App confirmQueue={confirmQueue} {...(planner ? { planner } : {})} />
    </ToolmarkProvider>
  </StrictMode>,
)
