# Next.js (App Router)

Toolmark runs in the browser. In the App Router, server components render the page and the
registry lives behind a **client boundary**; on the server every Toolmark call is an inert no-op
(D24), so the same components server-render without errors or hydration mismatches. The runnable
example is [`examples/nextjs`](https://github.com/adams100111/toolmark/tree/main/examples/nextjs)
(Next 16). Codes: [`reference/codes.md`](../reference/codes.md).

## The client boundary

Create the registry in a `'use client'` provider and wrap the app in the root layout:

```tsx
// app/providers.tsx
'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { createToolmark, type Toolmark } from '@toolmark/core'
import { bridge } from '@toolmark/core/bridge'
import { ToolmarkProvider } from '@toolmark/react'
import { createAgentTransport } from './agent-transport'

export function Providers({ children }: { children: ReactNode }) {
  const [tm] = useState<Toolmark>(() =>
    createToolmark({ dev: process.env.NODE_ENV !== 'production' }),
  )

  useEffect(() => {
    // Live wiring runs only in the browser, after hydration.
    const transport = createAgentTransport()
    const detach = tm.use(bridge({ transport }))

    let disposeTestHook: (() => void) | undefined
    if (process.env.NODE_ENV !== 'production') {
      void import('@toolmark/testing/page').then(({ installTestHook }) => {
        disposeTestHook = installTestHook(tm)
      })
    }
    return () => {
      disposeTestHook?.()
      detach()
    }
  }, [tm])

  return <ToolmarkProvider toolmark={tm}>{children}</ToolmarkProvider>
}
```

```tsx
// app/layout.tsx (a server component)
import type { ReactNode } from 'react'
import { Providers } from './providers'
import '@toolmark/tour/styles.css' // only if you use the tour overlay

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
```

Pages stay server components; the forms that register tools are client components
(`'use client'`) using `useFormTool`, `useTool` and the other [React hooks](react.md).

## SSR is a no-op

- `createToolmark()` during a server render is safe: without `document`, registration, consumers
  and `tm.call` are inert (calls answer `refused` `unknown_tool`), and nothing is retained between
  requests.
- React hooks register in effects, which never run on the server; `ToolScope` creates no scope
  server-side; the confirmation and activity hooks return frozen empty server snapshots.
- Never start consumers (bridge, WebMCP, MCP pairing) during render: do it in `useEffect`, as
  above.

## The test hook only in development

`installTestHook(tm)` (`@toolmark/testing/page`) exposes `window.__toolmark_test__` for Playwright
and `toolmark lint --url`. Load it with a dynamic `import()` behind
`process.env.NODE_ENV !== 'production'` inside `useEffect`: Next inlines `NODE_ENV`, so production
builds drop the branch and the chunk. Verify it in CI by grepping the build output (or by checking
that `next start` never exposes `__toolmark_test__`).

## Monorepos: build packages before `next build`

Turbopack has no custom resolve conditions, so it resolves `@toolmark/*` through their published
`import` entry (`dist/`), not the workspace sources. In a monorepo that consumes Toolmark from
source (`workspace:*`), build the packages first and let Next transpile them:

```ts
// next.config.ts
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  transpilePackages: ['@toolmark/core', '@toolmark/react'],
}
export default nextConfig
```

```sh
pnpm -r --filter "./packages/*" build
pnpm -F my-next-app build
```

Apps that install Toolmark from npm need neither step. Set `NEXT_TELEMETRY_DISABLED=1` in CI if
you prefer.

## Testing

Run Playwright against both `next dev` (the test hook is installed) and `next start` (production:
the hook must be absent). The example's suite checks that the server log and browser console have
no hydration or Toolmark errors, that tools appear only after hydration, that an in-page agent can
fill the form, that production omits the test hook, and that `toolmark lint --url` exits `0`.
