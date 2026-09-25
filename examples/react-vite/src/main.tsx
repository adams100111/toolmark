import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createToolmark } from '@toolmark/core'
import { bridge } from '@toolmark/core/bridge'
import { createInPageChannel } from '@toolmark/core/bridge/in-page'
import { otel } from '@toolmark/core/otel'
import { webmcp } from '@toolmark/core/webmcp'
import { ToolmarkProvider } from '@toolmark/react'
import { App } from './app.js'
import { createScriptedAgent } from './in-page-agent.js'
import { installDevTelemetry } from './telemetry.js'

const tm = createToolmark({ dev: import.meta.env.DEV })

// In-page bridge (caller `inapp`): the scripted agent subscribes before the bridge attaches, so it
// receives the attach manifest.
const channel = createInPageChannel()
const agent = createScriptedAgent(channel.agent)
tm.use(bridge({ transport: channel.transport }))

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
  void import('@toolmark/testing/page').then(({ installTestHook }) => {
    installTestHook(tm)
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToolmarkProvider toolmark={tm}>
      <App />
    </ToolmarkProvider>
  </StrictMode>,
)
