import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createToolmark } from '@toolmark/core'
import { bridge } from '@toolmark/core/bridge'
import { createInPageChannel } from '@toolmark/core/bridge/in-page'
import { ToolmarkProvider } from '@toolmark/react'
import { App } from './app.js'
import { createScriptedAgent } from './in-page-agent.js'

const tm = createToolmark({ dev: import.meta.env.DEV })

// In-page bridge (caller `inapp`): the scripted agent subscribes before the bridge attaches, so it
// receives the attach manifest.
const channel = createInPageChannel()
const agent = createScriptedAgent(channel.agent)
tm.use(bridge({ transport: channel.transport }))

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
