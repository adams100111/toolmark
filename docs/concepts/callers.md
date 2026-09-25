# Callers

Every call names its **caller**. The caller decides which tools are visible ([policy](policy.md)),
how confirmation works ([confirmation modes](confirmation.md)) and is reported to the tool as
`ctx.caller`.

| Caller   | Who                                                                      | Consumer / entry point                                    |
| -------- | ------------------------------------------------------------------------ | --------------------------------------------------------- |
| `inapp`  | The app's own agent, through the bridge to its server (protocol v1)      | `tm.use(bridge({ transport }))` — `@toolmark/core/bridge` |
| `webmcp` | The browser's WebMCP agent (experimental origin-trial API)               | `tm.use(webmcp())` — `@toolmark/core/webmcp`              |
| `mcp`    | A desktop MCP client paired with the page through `toolmark-mcp`         | `tm.use(mcpPairing({ code }))` — `@toolmark/mcp/client`   |
| `tour`   | A guided tour in `do` mode                                               | `startTour(tm, { mode: 'do', … })` — `@toolmark/tour`     |
| `test`   | Tests: Vitest (`createTestToolmark`) and Playwright (the page test hook) | `@toolmark/testing`                                       |
| `human`  | The user, e.g. an approved deferred confirmation runs as `human`         | the app (`tm.call(…, { caller: 'human' })`)               |

- **`human` is fixed.** It sees every tool and never needs confirmation; it cannot be configured
  in policy, and the test hook and the bridge reject it (a remote party can never claim to be the
  user).
- **The bridge caller** is `inapp` by default; `bridge({ caller: 'mcp' })` is used by the MCP
  pairing client. It is validated at runtime.
- **Manifests are per caller.** `tm.manifest({ caller })` and `tm.describe(name, { caller })`
  apply that caller's policy; without a caller they are an unfiltered debug view.
- **Client policy is not an authorization boundary.** The server must authorize every mutation
  the page's tools trigger.

API: [`Caller`](../api/@toolmark/core/type-aliases/Caller.md).
