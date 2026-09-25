# Toolmark

**One declaration, every agent.** Declare a tool once in your UI code — a plain function, a form,
a wizard, a navigation route — and Toolmark exposes it, with policy, human confirmation and schema
validation already applied, to every surface an agent might use: your own in-app agent (bridge
protocol v1), a browser agent over WebMCP, a desktop MCP client, guided tours, and your Playwright
tests. No second manifest to keep in sync, no duplicated validation logic, no bespoke integration
per agent surface.

Status: pre-1.0, under active development. See [`docs/ROADMAP.md`](docs/ROADMAP.md) for where the
release stands.

```ts
import { createToolmark, ok } from '@toolmark/core'
import { z } from 'zod'

const tm = createToolmark()

tm.register({
  name: 'cart.add',
  description: 'Add a product to the cart by SKU.',
  input: z.object({ sku: z.string(), quantity: z.number().int().min(1) }),
  hints: { consequential: true }, // an in-app agent gets needs_confirmation; the user approves
  run: ({ sku, quantity }) => ok(addToCart(sku, quantity)),
})
```

That single declaration is now callable from the in-app bridge, from a WebMCP-capable browser
agent, from a paired desktop MCP client, from an authored or agent-planned tour, and from a
`@toolmark/testing` Playwright test — through the same policy and confirmation rules every time.

## Packages

| Package                                               | Purpose                                                                                                        |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| [`@toolmark/core`](packages/core)                     | Tool model, registry, policy, confirmation, form tools, bridge protocol v1, WebMCP (experimental), OTel        |
| [`@toolmark/react`](packages/react)                   | React bindings (`useTool`, `useFormTool`, `useWizardTool`, confirmation hooks) and the react-hook-form adapter |
| [`@toolmark/inertia`](packages/inertia)               | Inertia.js adapters: `useForm`, `<Form>`, props-declared tools, navigation                                     |
| [`@toolmark/testing`](packages/testing)               | Vitest helpers (`createTestToolmark`) and the `@toolmark/testing` Playwright fixture                           |
| [`@toolmark/tour`](packages/tour)                     | Guided tours over your registered tools: `show`, `guide` and `do` modes, authored or agent-planned             |
| [`@toolmark/mcp`](packages/mcp)                       | Desktop MCP: the `toolmark-mcp` CLI and the browser-side pairing client                                        |
| [`@toolmark/lint`](packages/lint)                     | `toolmark lint` — static checks over a page's tool manifest                                                    |
| [`@toolmark/judge-typesafe`](packages/judge-typesafe) | Optional TypeSafe-backed judge for `toolmark lint --judge`                                                     |

Every package ships ESM only, requires Node `>= 22.12`, and (where relevant) React `>= 18.3`
(Inertia 3 requires React 19).

## Docs

- **Guides and concepts:** <https://adams100111.github.io/toolmark/> — getting started, the
  registry/scopes/policy/confirmation concepts, and per-framework guides (React, Inertia, Next.js,
  DOM forms, tours, WebMCP, desktop MCP, OpenTelemetry, lint).
- **API reference:** <https://adams100111.github.io/toolmark/api/> — generated from every
  package's TSDoc.
- **Protocol v1:** [`docs/protocol-v1.md`](docs/protocol-v1.md) — the bridge message contract, for
  writing a server-side (or alternate client) implementation.
- **Policies:** [versioning](docs/policies/versioning.md) (what's covered by semver, and the
  `@toolmark/core/webmcp` experimental carve-out), [deprecation](docs/policies/deprecation.md), and
  [tool name stability](docs/policies/tool-names.md).

## Development

Requires Node `>=22.12` and pnpm 12 (via corepack: `corepack enable`).

```sh
pnpm install
pnpm exec playwright install chromium   # once, for browser-mode tests and e2e
pnpm build
pnpm typecheck
pnpm lint
pnpm test
```

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the full contribution process (changesets, TSDoc,
commit conventions) and [`SECURITY.md`](SECURITY.md) to report a vulnerability privately.

## License

MIT
