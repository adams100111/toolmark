---
'@toolmark/core': minor
'@toolmark/react': minor
'@toolmark/inertia': minor
'@toolmark/mcp': minor
---

Second preview (M3, reach): the same tool declarations now reach browser agents through the
experimental WebMCP consumer (`@toolmark/core/webmcp`, app-supplied polyfill loader), desktop MCP
clients through the new `@toolmark/mcp` package (the dual-era `toolmark-mcp` stdio server with
localhost pairing, and `mcpPairing` in `@toolmark/mcp/client`), and OpenTelemetry
(`@toolmark/core/otel`, no payloads by default). Tour hooks land in core: `tm.anchor`,
`tm.setAnchor`, `tm.state`, `tm.info(...).sensitivePaths` and user interaction events from the DOM,
react-hook-form (`rhfAdapter` `root`) and Inertia `<Form>` adapters, plus `useToolAnchor` in
`@toolmark/react`. Distributed as `-next` tarballs only; nothing is published to npm before 1.0.
