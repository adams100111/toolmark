import './echo'
import '@toolmark/tour/styles.css'
import { createInertiaApp, router } from '@inertiajs/react'
import { createRoot } from 'react-dom/client'
import type { ComponentType } from 'react'
import { inertiaPages, navigationTool } from '@toolmark/inertia'
import { ToolmarkProvider } from '@toolmark/react'
import { routes } from './navigation-routes'
import { connectAgent, toolmark, type AgentProp } from './toolmark'

const pages = import.meta.glob<{ default: ComponentType }>('./pages/**/*.tsx', { eager: true })

void createInertiaApp({
  resolve: (name) => {
    const page = pages[`./pages/${name}.tsx`]
    if (!page) throw new Error(`Unknown page ${name}`)
    return page
  },
  setup({ el, App, props }) {
    // Server-declared tools of the current page (spec §12.4) and GET-only navigation (root scope).
    toolmark.use(inertiaPages({ router, initialPage: props.initialPage }))
    toolmark.register(navigationTool({ routes, visit: (url, opts) => router.visit(url, opts) }))
    connectAgent(props.initialPage.props.agent as AgentProp | null)
    if (import.meta.env.MODE !== 'production') {
      void import('@toolmark/testing/page').then(({ installTestHook }) => installTestHook(toolmark))
    }
    createRoot(el).render(
      <ToolmarkProvider toolmark={toolmark}>
        <App {...props} />
      </ToolmarkProvider>,
    )
  },
})
