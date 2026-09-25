import { createToolmark } from '@toolmark/core'
import { bridge } from '@toolmark/core/bridge'
import { createInPageChannel } from '@toolmark/core/bridge/in-page'
import { scanDom } from '@toolmark/core/dom'

// `plain-form.html`: a plain HTML form + a data-tool table/button, scanned declaratively (no
// React) via `scanDom()` (spec §10.2). Mirrors `main.tsx`'s bridge/test-hook wiring.
const tm = createToolmark({ dev: import.meta.env.DEV })
tm.use(scanDom())

const channel = createInPageChannel()
tm.use(bridge({ transport: channel.transport }))

// Test-only globals: production builds drop this branch and the `@toolmark/testing/page` chunk.
if (import.meta.env.MODE !== 'production') {
  void import('@toolmark/testing/page').then(({ installTestHook }) => {
    installTestHook(tm)
  })
}
