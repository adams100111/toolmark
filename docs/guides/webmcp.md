# WebMCP (`@toolmark/core/webmcp`)

> **Experimental.** WebMCP is an origin-trial browser API whose shape still changes between Chrome
> releases. Every export of `@toolmark/core/webmcp` is `@experimental` and outside the semver
> promise until the spec leaves origin trial (D28).

`webmcp()` registers the registry's tools with the browser's model context
(`document.modelContext.registerTool`), so browser agents can discover and call them. It is a
consumer like the bridge: every call goes through `tm.call(name, input, { caller: 'webmcp' })`.

```ts
import { webmcp } from '@toolmark/core/webmcp'

// Native WebMCP only (default: polyfill 'none'):
tm.use(webmcp())

// Native when present, else the app-supplied polyfill:
tm.use(webmcp({ polyfill: () => import('@mcp-b/webmcp-polyfill') }))
```

## Options

| Option         | Default  | Meaning                                                                                                                        |
| -------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `polyfill`     | `'none'` | A loader for a polyfill module exposing `initializeWebMCPPolyfill()`, used only when the browser has no model context.         |
| `filter`       | —        | Narrows the registered tools (applied after the `webmcp` caller policy).                                                       |
| `exposedTo`    | —        | Origins allowed to call the tools. Native WebMCP only; must be potentially trustworthy origins.                                |
| `modelContext` | —        | Advanced: supplies the model context (tests, embedders). Falls back to `document.modelContext`, then `navigator.modelContext`. |

## What gets registered

- Tools visible to caller `webmcp`: read-only, default and consequential tools; destructive tools
  only when `policy.webmcp` allows them. Consequential and destructive tools also need an inline
  `confirm` handler (`createToolmark({ confirm })`), because WebMCP confirms inline in the page;
  without one they are not registered.
- Each tool is registered under its **full name** (`challenges.create.fill`) with its title,
  description, input JSON Schema and `readOnlyHint` / `consequentialHint` / `untrustedContentHint`.
- `execute` resolves the `ToolResult` object; the browser serializes it. Through the polyfill,
  `document.modelContext.executeTool(entry, JSON.stringify(input))` returns a JSON string, so one
  `JSON.parse` gives the `ToolResult`.
- The adapter re-syncs on every registry revision and on the model context's `toolchange` event.
  Native declarative forms the browser already exposes (`tm.info(name).nativeName`) are skipped.
- Disposing (`tm.use`'s return value) unregisters every tool. A stale handle an agent keeps after
  unregistration is refused with `unknown_tool` and never runs.

## Polyfill (opt-in)

The adapter never imports a polyfill itself; the app passes a loader, so bundlers only include
`@mcp-b/webmcp-polyfill` when the app opts in. The loader runs only when neither
`document.modelContext` nor `navigator.modelContext` exists. The polyfill installs nothing in an
insecure context. The polyfill does not support `exposedTo` (the registration fails with
`webmcp_register_failed`) and drops `consequentialHint`; in-page confirmation is the real gate either
way.

## Native WebMCP in Chrome

- For local testing, enable `chrome://flags/#enable-webmcp-testing` and relaunch Chrome (command-line
  equivalent: `--enable-features=WebMCPTesting`). The Playwright Chromium 153 used by the example's
  `native_webmcp_when_available` test exposes `document.modelContext` with this switch.
- In production, WebMCP is available through the Chrome origin trial (Chrome 149+).
- **Secure context:** the API exists only on secure origins (`https`, or `http://localhost`).
- **Origin isolation:** WebMCP is available only in origin-keyed documents. Do not opt out with
  `Origin-Agent-Cluster: ?0`; sending `Origin-Agent-Cluster: ?1` makes the isolation explicit.
- **Iframes:** access is gated by the `tools` Permissions Policy (default `self`); a cross-origin
  iframe needs `allow="tools"`.
- **`exposedTo`** takes potentially trustworthy origins only.

## Error events

Listen with `tm.events.on('error', …)`:

| Code                     | When                                                                                                                                                                  |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `webmcp_unavailable`     | Informational, once per consumer: no model context (and no polyfill, or the polyfill installed none, e.g. insecure context). `cause` is set when the loader rejected. |
| `webmcp_register_failed` | `{ tool, cause }`: `registerTool` rejected (or a `filter` threw). Reported once per tool version; retried when the tool changes.                                      |

The consumer never throws; without a model context it stays inactive.
