'use client'

import { useEffect, useState, type JSX, type ReactNode } from 'react'
import { createToolmark, type Toolmark } from '@toolmark/core'
import { bridge } from '@toolmark/core/bridge'
import { createInPageChannel } from '@toolmark/core/bridge/in-page'
import { ToolmarkProvider } from '@toolmark/react'
import { createScriptedAgent } from './in-page-agent'

/**
 * Wires the example's registry and provides it to the tree.
 *
 * `createToolmark()` runs during render (both the server's and the client's), which is safe: spec
 * D24 makes the registry SSR-inert (no `document`, so registration/consumers are no-ops) — it is
 * how `useFormTool`'s unconditional `useToolmark()` call can render on a server-rendered page
 * without a provider-less throw. What only ever runs client-side, inside `useEffect` (never during
 * SSR, never in a production build), is the *live* wiring: the in-page bridge, the scripted test
 * agent (`globalThis.__toolmark_agent__`) and the `@toolmark/testing` page hook
 * (`globalThis.__toolmark_test__`).
 */
export function Providers(props: { children: ReactNode }): JSX.Element {
  const [tm] = useState<Toolmark>(() =>
    createToolmark({ dev: process.env.NODE_ENV !== 'production' }),
  )

  useEffect(() => {
    const channel = createInPageChannel()
    const agent = createScriptedAgent(channel.agent)
    // Subscribe the scripted agent before the bridge attaches, so it receives the attach manifest.
    const unsubscribeBridge = tm.use(bridge({ transport: channel.transport }))

    let disposeTestHook: (() => void) | undefined
    if (process.env.NODE_ENV !== 'production') {
      globalThis.__toolmark_agent__ = agent
      void import('@toolmark/testing/page').then(({ installTestHook }) => {
        disposeTestHook = installTestHook(tm)
      })
    }

    return () => {
      disposeTestHook?.()
      unsubscribeBridge()
      channel.transport.close?.()
      if (process.env.NODE_ENV !== 'production') {
        globalThis.__toolmark_agent__ = undefined
      }
    }
  }, [tm])

  return <ToolmarkProvider toolmark={tm}>{props.children}</ToolmarkProvider>
}
