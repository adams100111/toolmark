# @toolmark/mcp

Desktop MCP for Toolmark: lets a desktop MCP client (Claude Desktop, an IDE, any MCP SDK client)
call the tools of an app page open in the user's browser. The `toolmark-mcp` CLI serves MCP over
stdio and runs a pairing WebSocket server on `127.0.0.1`; `@toolmark/mcp/client` provides
`mcpPairing()`, which pairs the page with a short code and serves its registry as caller `mcp`
(policy applies and consequential tools confirm through the app's inline `confirm` handler).

```sh
pnpm add @toolmark/core @toolmark/mcp
```

ESM only; Node ≥ 22.12 for the CLI. The client entry runs in the browser and never imports
`ws` or `node:*`.

```json
{
  "command": "npx",
  "args": ["-y", "@toolmark/mcp", "--allow-origin", "http://localhost:5173"]
}
```

```text
Usage: toolmark-mcp --allow-origin <origin> [--allow-origin <origin> …] [--port <n>] [--call-timeout <ms>]
```

The CLI prints a pairing code on stderr; the user enters it in the app:

```ts
import { mcpPairing } from '@toolmark/mcp/client'

// Resumes from the session token after a reload (inert without one).
let detach = tm.use(mcpPairing({ port: 17840, onStatus: console.log }))

function pair(code: string) {
  detach()
  detach = tm.use(mcpPairing({ code, port: 17840, onStatus: console.log }))
}
```

Guide (flags, pairing flow, security model): [docs/guides/mcp.md](https://github.com/adams100111/toolmark/blob/main/docs/guides/mcp.md).

Docs: [MCP guide](https://adams100111.github.io/toolmark/guides/mcp) ·
[API reference](https://adams100111.github.io/toolmark/api/@toolmark/mcp/).

## License

MIT
