# Getting started

Toolmark lets an AI agent operate your web app through **tools** you declare in your UI code.
This page wires a React app with a form tool and an in-app agent; the concepts behind each step
are in [Concepts](concepts/registry.md).

Requirements: Node ≥ 22.12 for tooling, React ≥ 18.3 for `@toolmark/react`, and a schema library
that implements Standard Schema v1 (zod 4 is used below).

```sh
pnpm add @toolmark/core @toolmark/react react-hook-form zod
```

| Package                    | Use it for                                                            |
| -------------------------- | --------------------------------------------------------------------- |
| `@toolmark/core`           | Registry, policy, confirmation, form tools, bridge, DOM, WebMCP, OTel |
| `@toolmark/react`          | Provider, scopes and hooks; `@toolmark/react/rhf` for react-hook-form |
| `@toolmark/inertia`        | Inertia `useForm`, `<Form>`, server-declared tools and navigation     |
| `@toolmark/tour`           | Guided tours, overlay and `useTour`                                   |
| `@toolmark/mcp`            | `toolmark-mcp`: pair the page with a desktop MCP client               |
| `@toolmark/testing`        | `createTestToolmark` (Vitest) and the Playwright fixture              |
| `@toolmark/lint`           | `toolmark lint` over page manifests (dev)                             |
| `@toolmark/judge-typesafe` | Optional lint judge (dev)                                             |

## 1. Create the registry

```tsx
// main.tsx
import { createRoot } from 'react-dom/client'
import { createToolmark } from '@toolmark/core'
import { ToolmarkProvider } from '@toolmark/react'
import { App } from './app'

const tm = createToolmark({ dev: import.meta.env.DEV })

createRoot(document.getElementById('root')!).render(
  <ToolmarkProvider toolmark={tm}>
    <App />
  </ToolmarkProvider>,
)
```

`dev: true` turns misconfiguration into thrown errors; production reports it as `error` events.

## 2. Declare a form tool

```tsx
// create-challenge.tsx
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { ToolScope, useFormTool } from '@toolmark/react'
import { rhfAdapter } from '@toolmark/react/rhf'

const schema = z.object({
  title: z.string().min(1).describe('Challenge title'),
  startsAt: z.iso.date().describe('Start date, YYYY-MM-DD'),
})
type Challenge = z.infer<typeof schema>

function CreateChallengeForm() {
  const form = useForm<Challenge>({ defaultValues: { title: '', startsAt: '' } })
  const save = async (values: Challenge) => {
    await fetch('/api/challenges', { method: 'POST', body: JSON.stringify(values) })
  }
  useFormTool(rhfAdapter(form, { onSubmit: save }), {
    name: 'create',
    description: 'The new-challenge form. Fill it, then submit to create the challenge.',
    input: schema,
    submitSummary: (v) => `Create challenge "${v.title}"`,
  })
  return (
    <form onSubmit={form.handleSubmit(save)}>
      <input {...form.register('title')} />
      <input type="date" {...form.register('startsAt')} />
      <button>Create</button>
    </form>
  )
}

export function App() {
  return (
    <ToolScope name="challenges">
      <CreateChallengeForm />
    </ToolScope>
  )
}
```

The page now offers `challenges.create.fill` (writes values, skipping fields the user already
typed) and `challenges.create.submit` (consequential: it needs the user's confirmation).

## 3. Connect an agent

The in-app agent talks to the page over [bridge protocol v1](protocol-v1.md). The transport
depends on your backend: Laravel Echo private channels (`@toolmark/core/bridge/echo`), a WebSocket
(`…/websocket`), `postMessage` (`…/post-message`) or an in-page channel for a client-side agent
(`…/in-page`):

```ts
import { bridge } from '@toolmark/core/bridge'
import { websocketTransport } from '@toolmark/core/bridge/websocket'

tm.use(bridge({ transport: websocketTransport({ url: 'wss://example.com/agent' }) }))
```

The bridge sends the page's manifest on attach and on every change, runs `call`/`describe`
messages as caller `inapp`, and returns results. On your server, expose two LLM tools,
`page_call(tool, input)` and `page_describe(tool)` (spec §12.3); the
[Laravel reference](guides/laravel-reference.md) is a complete server implementation to copy.

Consequential tools called by the in-app agent return `needs_confirmation`; render those with
`usePendingConfirmations()` (see [Confirmation modes](concepts/confirmation.md)).

## 4. Test it

```ts
import { createTestToolmark } from '@toolmark/testing/vitest'

const tm = createTestToolmark()
// register tools, then:
const r = await tm.call(
  'challenges.create.fill',
  { values: { title: 'Robotics' } },
  { caller: 'test' },
)
```

Playwright specs use the `@toolmark/testing` fixture against the page's test hook. Run
[`toolmark lint`](guides/lint.md) against your pages in CI.

## Next steps

- [React guide](guides/react.md) — every hook with a runnable snippet.
- [Forms](guides/forms.md), [Wizards](guides/wizards.md), [Files](guides/files.md),
  [DOM forms](guides/dom.md), [Inertia](guides/inertia.md), [Next.js](guides/nextjs.md).
- [WebMCP](guides/webmcp.md) and [desktop MCP](guides/mcp.md) for agents outside your app.
- [Tours](guides/tours.md) for guided walkthroughs over the same tools.
