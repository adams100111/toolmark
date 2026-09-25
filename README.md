# Toolmark

Registry-first tools for AI agents that operate a web app's UI: declare tools once, expose them to
an in-app agent bridge, WebMCP, desktop MCP, tours and tests.

Status: pre-1.0, under active development. See `docs/ROADMAP.md`.

## Packages

| Package             | Purpose                                                                    |
| ------------------- | -------------------------------------------------------------------------- |
| `@toolmark/core`    | Tool model, registry, policy, confirmation, form tools, bridge protocol v1 |
| `@toolmark/react`   | React bindings and the react-hook-form adapter                             |
| `@toolmark/inertia` | Inertia `useForm` adapter                                                  |
| `@toolmark/testing` | Vitest helpers and the Playwright fixture                                  |

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

## License

MIT
