# Toolmark M3 — Reach Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `sdd-lanes` to implement this plan lane by lane.
> Plan-lite format. Requires M1 and M2 merged.

**Goal:** The same tools reach browser agents (WebMCP, experimental), desktop MCP clients
(`@toolmark/mcp`), observability (OpenTelemetry), and tours (anchors, state, interaction events).

**Architecture:** Every new surface is a consumer over the registry; `@toolmark/mcp` is a separate
package with a Node CLI (MCP stdio server) and a browser entry (`/client`) that pairs the page over a
localhost WebSocket carrying bridge protocol v1.

**Tech Stack:** as overview, plus `@modelcontextprotocol/server` 2.1.0, `ws` 8.21.3,
`@opentelemetry/api` 1.9.1, `@mcp-b/webmcp-polyfill` 5.1.0, `webmcp-types` 0.1.9.

**Spec:** §11.2–§11.4, §13, §14 (pairing), §18, D28, D31.

## Global constraints (M3 additions)

- `@toolmark/mcp` CLI: binary `toolmark-mcp`; flags `--allow-origin <origin>` (required, repeatable),
  `--port <n>` (default `17840`); binds `127.0.0.1` only; stdout carries **only** MCP frames,
  diagnostics go to stderr.
- Pairing code: 8 characters from the Crockford base32 alphabet `0123456789ABCDEFGHJKMNPQRSTVWXYZ`,
  single use, expires after `300000` ms, rotates after `5` failed attempts; printed to stderr as
  `Toolmark pairing code: XXXX-XXXX (expires in 5 minutes)`.
- MCP protocol eras served: modern `2026-07-28`; legacy `2025-11-25`, `2025-06-18`, `2025-03-26`,
  `2024-11-05` (handshake-based).
- OTel names: tracer/meter name `@toolmark/core`; span `toolmark.call <tool>`; attributes
  `toolmark.tool`, `toolmark.caller`, `toolmark.status`, `toolmark.call_id`; counter
  `toolmark.calls`; histogram `toolmark.call.duration` (unit `ms`).
- The WebMCP subpath's docs, JSDoc and `package.json` description say **experimental** (D28).
- Node-project tests build registries with `createTestRegistry` (core) or `createTestToolmark`
  (`@toolmark/testing`, other packages), never a bare `createToolmark` (M1 constraints).
- Nothing is published to npm; the milestone ends with the `-next` tarball hand-off (Task 6).

## Rulings made while planning

- **MCP era routing is Toolmark's own front door:** the first JSON-RPC message on stdio decides the
  era — `initialize` → a small hand-written legacy handler (`initialize`, `notifications/initialized`,
  `ping`, `tools/list`, `tools/call`, `notifications/tools/list_changed`); anything else → the SDK's
  modern `2026-07-28` server. At Task 3 start, check the SDK docs (`ctx7` → `/modelcontextprotocol/typescript-sdk`
  and the v2 "support-2026-07-28" migration page); if the SDK already serves both eras correctly,
  use it for both and ledger the ruling.
- **WebMCP skips native-declarative duplicates:** tools with `origin: 'native-form'` are not
  registered when `modelContext.getTools()` already lists the same name.
- **Interaction events need adapter support:** `FormAdapter` gains optional
  `onUserInteraction(cb)`; RHF (via `watch` callbacks with `type === 'change'`) and DOM (trusted
  events) implement it; the Inertia `useForm` adapter cannot (no per-field events) — documented.

## Review focus

1. **Unpaired or wrong-origin connection to the CLI** → rejected, nothing executed (Task 4
   `rejects_bad_origin`, `rejects_wrong_code_and_rotates`).
2. **Legacy MCP client** (sends `initialize`) and **modern client** (sends `server/discover`) both
   list and call tools (Task 3 `legacy_era_handshake_and_call`, `modern_era_discover_and_call`).
3. **Page navigates while paired** → MCP clients get a list-changed notification and the new list
   (Task 4 `manifest_change_notifies_client`).
4. **WebMCP input arriving as a JSON string** (deprecated form) → parsed and validated (Task 2
   `execute_accepts_json_string_input`).
5. **OTel never leaks payloads by default** (Task 5 `no_payload_attributes_by_default`).

## File structure

```
packages/core/src/anchors.ts                  anchor store, tm.anchor/tm.state
packages/core/src/forms/form-tools.ts         (modify: interaction events, anchors from fields)
packages/core/src/forms/types.ts              (modify: onUserInteraction)
packages/core/src/dom/form-adapter.ts         (modify: onUserInteraction)
packages/react/src/rhf/index.ts               (modify: onUserInteraction)
packages/react/src/use-tool-anchor.ts
packages/core/src/webmcp/{index,model-context,sync}.ts
packages/core/src/otel/index.ts
packages/mcp/  package.json tsconfig.json tsdown.config.ts vitest.config.ts
  src/cli.ts  src/server/{era-router,legacy,modern,tool-mapping}.ts  src/pairing/{ws-server,code}.ts
  src/client/index.ts   (browser entry: mcpPairing)
  test/*.test.ts
core/test/bridge-caller.test.ts               bridge honours options.caller
vitest.config.ts                              (modify: append packages/mcp/vitest.config.ts)
examples/react-vite/src/{pair-mcp.tsx}  e2e/{webmcp,mcp}.spec.ts
docs/guides/{webmcp,mcp,otel,anchors}.md  docs/release/next-tarballs.md (append)  .changeset/m3-reach.md
```

## Lanes

| Wave | Lane | Tasks | Owns files | Consumes |
| --- | --- | --- | --- | --- |
| 0 | A (high) | 1 | `core/src/anchors.ts`, `core/src/forms/**`, `core/src/dom/form-adapter.ts`, `core/src/bridge/bridge.ts`, `core/src/registry.ts`, `core/src/index.ts`, `react/src/rhf/**`, `react/src/use-tool-anchor.ts`, `react/src/index.ts`, all `package.json` files incl. `examples/react-vite/package.json` (adds `packages/mcp` skeleton + deps, core `./webmcp` `./otel` exports, M3 devDeps), `pnpm-lock.yaml`, `tsdown.config.ts` files, root `vitest.config.ts`, Task 1 tests (incl. `core/test/bridge-caller.test.ts`) | M1–M2 |
| 1 | B (high) | 2 | `core/src/webmcp/**`, `core/test/webmcp*.test.ts` | A |
| 1 | C (high, security) | 3–4 | `packages/mcp/src/**`, `packages/mcp/test/**` | A |
| 1 | D (normal) | 5 | `core/src/otel/**`, `core/test/otel.test.ts` | A |
| 2 | E (normal) | 6 | `examples/**` except `package.json`, `docs/guides/**`, `docs/release/next-tarballs.md`, `.changeset/m3-reach.md` | A–D |

---

### Task 1: Tour hooks — anchors, state, interaction events; package skeleton for mcp   (Lane A, risk: normal)

**Files:** Create `core/src/anchors.ts`, `react/src/use-tool-anchor.ts`, `packages/mcp/package.json`,
`packages/mcp/tsconfig.json`, `packages/mcp/tsdown.config.ts`, `packages/mcp/vitest.config.ts`,
`packages/mcp/src/index.ts` (empty); Modify `core/src/forms/types.ts`, `core/src/forms/form-tools.ts`,
`core/src/dom/form-adapter.ts`, `core/src/registry.ts`, `core/src/index.ts`,
`core/src/bridge/bridge.ts` (widen `BridgeOptions.caller` to `'inapp' | 'mcp'`),
`react/src/rhf/index.ts`, `react/src/index.ts`, `core/package.json`, `core/tsdown.config.ts`,
`examples/react-vite/package.json`, `pnpm-lock.yaml`, root `vitest.config.ts` (append
`'packages/mcp/vitest.config.ts'`, project name `mcp`); Test `core/test/anchors.test.ts`,
`core/test/browser-interaction.test.ts`, `core/test/bridge-caller.test.ts`,
`react/test/use-tool-anchor.test.tsx`.

**Interfaces — Produces:**
```ts
interface AnchorSpec { element?: () => Element | null; params?: Record<string, () => Element | null> }
interface ToolState<I> { values: Partial<I>; issues: { path: string; message: string }[]; step?: string }
interface Toolmark {
  anchor(tool: string, param?: string): Element | null
  setAnchor(tool: string, param: string | undefined, el: Element | null): void
  state(tool: string): ToolState<unknown> | undefined
}
interface FormAdapter { onUserInteraction?(cb: (e: { path: string; kind: 'input' | 'focus' | 'submit' }) => void): () => void }
function useToolAnchor(tool: string, param?: string): (el: Element | null) => void
```
`packages/mcp/package.json`: name `@toolmark/mcp`, `bin: { "toolmark-mcp": "./dist/cli.js" }`,
exports `"."` (node) and `"./client"` (browser), deps `@modelcontextprotocol/server` 2.1.0, `ws`
8.21.3, `@toolmark/core` `workspace:*`; dev `@types/ws`, `@toolmark/testing` `workspace:*`, and the
MCP SDK client package `@modelcontextprotocol/client` (verify the v2 client package name with
`npm view` at execution; ledger any change). Core `package.json` adds exports `./webmcp`, `./otel`
(each with the `source` condition), optional peers `@opentelemetry/api ^1.9.0`,
`@mcp-b/webmcp-polyfill ^5.0.0`, and devDeps `@opentelemetry/api` 1.9.1,
`@opentelemetry/sdk-trace-base` 2.11.0, `@mcp-b/webmcp-polyfill` 5.1.0, `webmcp-types` 0.1.9.
`examples/react-vite/package.json` adds dev `@modelcontextprotocol/client` (same verification note).

**Behaviour:**
- `tm.anchor` precedence: `setAnchor` override → tool `anchors` spec → form field `element` from `adapter.fields()` → `null`.
- `tm.state` calls the tool's `state()`; form tools implement it (`values` from adapter, `issues` from a full validation, `step` for wizards); tools without `state` → `undefined`.
- `state().values` omits paths whose field element is `type="password"` or has `autocomplete` starting with `cc-` (spec §14 privacy); test `state_omits_password_and_cc`.
- Form tools subscribe to `adapter.onUserInteraction` and emit `interaction` events `{ tool: '<name>.fill', param: path, kind, caller: 'human' }`; agent-originated `setValues` never emits them.
- RHF: `form.watch((values, { name, type }) => …)` → `type === 'change'` → `input`; DOM: trusted `input`/`focusin`/`submit`.
- Bridge: `options.caller` (default `'inapp'`) is used for **every** registry access — `manifest({ caller })` on attach and on each revision, `describe(tool, { caller })` and `call(…, { caller })` — so an `mcp` bridge never lists, describes or runs a tool the `mcp` caller may not use.

**Tests (write first):** `anchor_precedence` · `state_for_form_and_wizard` · `state_omits_password_and_cc` · `interaction_only_for_user_changes` (DOM + RHF variants) · `use_tool_anchor_sets_and_clears` · `mcp_caller_does_not_see_destructive_tools` (`bridge-caller.test.ts`: bridge with `caller: 'mcp'` → the destructive tool is absent from the `manifest` message, `describe` → `refused` `unknown_tool`, `call` → `refused` `not_allowed`).

**Task gate:** `pnpm install && pnpm exec vitest run --project core-node test/anchors.test.ts test/bridge-caller.test.ts && pnpm exec vitest run --project core-browser test/browser-interaction.test.ts && pnpm -F @toolmark/react exec vitest run test/use-tool-anchor.test.tsx`

---

### Task 2: WebMCP consumer (experimental)   (Lane B, risk: high)

**Files:** Create `core/src/webmcp/index.ts`, `model-context.ts`, `sync.ts`; Test
`core/test/webmcp.test.ts`, `core/test/browser-webmcp-polyfill.test.ts` (browser mode).

**Interfaces — Produces:**
```ts
function webmcp(o?: { polyfill?: 'auto' | 'none'; filter?: (t: ToolManifest) => boolean; exposedTo?: string[] }): (tm: Toolmark) => () => void
```

**Behaviour:**
- Resolve the model context: `document.modelContext` → legacy `navigator.modelContext` → (when `polyfill: 'auto'`) dynamic `import('@mcp-b/webmcp-polyfill')` + `initializeWebMCPPolyfill()` → otherwise inactive (emit `error` code `webmcp_unavailable` once, informational).
- For each visible tool for caller `webmcp` (full manifest, `filter` applied): `registerTool({ name, title, description, inputSchema, annotations: { readOnlyHint, consequentialHint: consequential || destructive, untrustedContentHint }, execute }, { signal, exposedTo })`, awaiting it if it returns a promise.
- `execute(input, { signal })`: string input → `JSON.parse` (invalid → returns a serialized `invalid` result); calls `tm.call(name, input, { caller: 'webmcp', signal })`; returns `JSON.stringify(result)`.
- Re-sync on `subscribe`: abort registrations for removed or changed tools (changed = description, title, hints or schema JSON differs), register new ones.
- Skip `origin: 'native-form'` tools when `getTools?.()` already lists the name.
- Disposer aborts every registration.

**Tests (write first):** (fake `ModelContext` class recording calls; separate polyfill test in browser mode)
- `registers_visible_tools_with_hints` · `destructive_not_exposed_by_default` · `execute_routes_through_call_with_caller_webmcp` · `execute_accepts_json_string_input` (review focus 4) · `resync_on_change_aborts_old` · `skips_native_form_duplicates` · `legacy_navigator_getter_supported` · `polyfill_auto_initializes` · `inactive_emits_unavailable_once`.

**Task gate:** `pnpm exec vitest run --project core-node test/webmcp.test.ts && pnpm exec vitest run --project core-browser test/browser-webmcp-polyfill.test.ts`

---

### Task 3: `toolmark-mcp` CLI — dual-era MCP server   (Lane C, risk: high)

**Files:** Create `packages/mcp/src/cli.ts`, `src/server/era-router.ts`, `src/server/legacy.ts`,
`src/server/modern.ts`, `src/server/tool-mapping.ts`, `src/index.ts`; Test
`packages/mcp/test/era-router.test.ts`, `test/legacy.test.ts`, `test/modern.test.ts`,
`test/tool-mapping.test.ts`.

**Interfaces — Produces:**
```ts
interface PageLink { manifest(): Promise<ToolManifest[]>; call(name: string, input: unknown): Promise<ToolResult<unknown>>; onChange(cb: () => void): () => void; paired(): boolean }
function startMcpServer(o: { stdin: Readable; stdout: Writable; stderr: Writable; link: PageLink }): { close(): Promise<void> }
function toMcpTool(t: ToolManifest): { name: string; title?: string; description: string; inputSchema: JsonSchema; annotations: { readOnlyHint?: boolean; destructiveHint?: boolean } }
function toMcpResult(r: ToolResult<unknown>): { content: [{ type: 'text'; text: string }]; structuredContent: ToolResult<unknown>; isError: boolean }
```

**Behaviour:**
- Era router: buffers the first newline-delimited JSON-RPC message; `method === 'initialize'` → legacy handler for the process lifetime; otherwise → modern server (SDK). Neither → JSON-RPC error `-32600`.
- Legacy handler negotiates the client's version if in the legacy list, else answers with `2025-11-25`; serves `tools/list` (from `link.manifest()`), `tools/call`, `ping`; sends `notifications/tools/list_changed` on `link.onChange`.
- Modern server: `server/discover` lists `2026-07-28` **and** the legacy versions it supports; tools per request `_meta`; `resultType: 'complete'`; list results carry `ttlMs: 0` and `cacheScope: 'private'` (the page changes often); list-change notifications via `subscriptions/listen`.
- Unpaired: `tools/list` returns an empty list; `tools/call` returns `isError: true` with text `"No page is paired. Run the app and enter the pairing code."`.
- `toMcpResult`: `isError` for `invalid`, `refused`, `cancelled`, `error`; text = `JSON.stringify(result)`.
- Nothing but MCP frames is ever written to `stdout`.

**Tests (write first):** (in-process streams + fake `PageLink`; use the SDK's client package for the modern era if available, otherwise raw JSON-RPC)
- `era_router_picks_legacy_on_initialize` · `era_router_picks_modern_otherwise` · `legacy_era_handshake_and_call` · `modern_era_discover_and_call` (review focus 2) · `unpaired_list_empty_call_error` · `list_changed_notification_both_eras` · `stdout_only_frames` · `tool_mapping_hints_and_results`.

**Task gate:** `pnpm -F @toolmark/mcp exec vitest run test/era-router.test.ts test/legacy.test.ts test/modern.test.ts test/tool-mapping.test.ts`

---

### Task 4: Pairing — localhost WebSocket and the page client   (Lane C, risk: high, security)

**Files:** Create `packages/mcp/src/pairing/ws-server.ts`, `src/pairing/code.ts`,
`src/client/index.ts`; Modify `src/cli.ts` (wires pairing → `PageLink`); Test
`packages/mcp/test/pairing.test.ts`, `test/client.test.ts`, `test/cli.e2e.test.ts`.

**Interfaces — Produces:**
```ts
// browser entry "@toolmark/mcp/client"
function mcpPairing(o: { code: string; port?: number }): (tm: Toolmark) => () => void
// node
function createPairingServer(o: { port: number; allowOrigins: string[]; stderr: Writable }): { link: PageLink; close(): Promise<void>; code(): string }
```

**Behaviour:**
- Server binds `127.0.0.1:<port>`; rejects upgrades whose `Origin` is not in `allowOrigins` (HTTP 403), and whose remote address is not loopback.
- First client message must be `{ "type": "pair", "code": "<code>" }` within 10 s; wrong code → close `4401`, attempt counted; 5 failures → code rotates and the new code is printed; correct → code consumed; a newer successful pairing replaces the previous connection (old closed `4409`).
- After pairing the socket carries bridge protocol v1: the page side is `bridge({ transport: websocket })` with caller `mcp`; the CLI is the agent side implementing `PageLink` (manifest from `manifest` messages + `describe` for schemas, cached per `rev`; calls with 60 s deadline → timeout returns `error` "timed out").
- `mcpPairing` builds `websocketTransport({ url: 'ws://127.0.0.1:<port>', onOpen })` (M1 Task 9) and attaches `bridge` with it and `caller: 'mcp'` (the option widened in Task 1). `onOpen` sends `{ type: 'pair', code }` and waits for `{ type: 'paired' }` before the transport flushes buffered bridge messages. On reconnect it re-pairs only if the code is still valid (unexpired, unused by another pairing); otherwise `onOpen` rejects, the transport stops and `transport_failed` is reported.
- The server replies `{ type: 'paired' }` on a correct code.

**Tests (write first):**
- `rejects_bad_origin` · `rejects_non_loopback` · `rejects_wrong_code_and_rotates` (review focus 1) · `pair_timeout_closes` · `newer_pairing_replaces_old` · `manifest_change_notifies_client` (review focus 3) · `client_pairs_and_serves_calls` · `client_waits_for_paired_before_flush` · `reconnect_with_expired_code_stops_transport` · `cli_e2e_stdio_to_page` (spawn the built CLI; a Node-side registry created with `createTestToolmark()` from `@toolmark/testing` plays the page and pairs over Node's global `WebSocket`; call a tool over the legacy and modern eras).

**Task gate:** `pnpm -F @toolmark/mcp build && pnpm -F @toolmark/mcp exec vitest run test/pairing.test.ts test/client.test.ts test/cli.e2e.test.ts` (`test/cli.e2e.test.ts` matches the `test/**/*.test.ts` include)

---

### Task 5: OpenTelemetry consumer   (Lane D, risk: normal)

**Files:** Create `core/src/otel/index.ts`; Test `core/test/otel.test.ts`.

**Interfaces — Produces:**
```ts
function otel(o?: { tracer?: Tracer; meter?: Meter; recordPayloads?: boolean }): (tm: Toolmark) => () => void
```

**Behaviour:** span per call from `call` to `result` event, attributes per constraints, span status
`ERROR` for `error` results; counter + histogram recorded with `tool`, `caller`, `status`;
`recordPayloads: true` adds `toolmark.input` / `toolmark.result` (JSON, truncated to 4096 chars).

**Tests (write first):** (in-memory exporter from `@opentelemetry/sdk-trace-base`)
`span_per_call_with_attributes` · `error_status_on_error_result` · `metrics_recorded` · `no_payload_attributes_by_default` (review focus 5) · `payloads_when_enabled_truncated`.

**Task gate:** `pnpm exec vitest run --project core-node test/otel.test.ts`

---

### Task 6: Examples, guides, changeset   (Lane E, risk: normal)

**Files:** Create `examples/react-vite/src/pair-mcp.tsx`, `e2e/webmcp.spec.ts`, `e2e/mcp.spec.ts`;
`docs/guides/webmcp.md`, `mcp.md`, `otel.md`, `anchors.md`; `.changeset/m3-reach.md`; Modify
`docs/release/next-tarballs.md` (append the M3 entry).

**Behaviour:** the example adds `webmcp({ polyfill: 'auto' })`, `otel()` (console exporter in dev),
and a "Pair with desktop MCP" panel that takes the code and calls `mcpPairing`. `mcp.md` shows the
Claude Desktop / Claude Code config snippet
(`{ "command": "npx", "args": ["-y", "@toolmark/mcp", "--allow-origin", "http://localhost:5173"] }`)
and the security model. `webmcp.md` states the experimental status and the Chrome flag
`chrome://flags/#enable-webmcp-testing` for local testing.
- **Tarball hand-off (last step):** `pnpm changeset version` (pre mode `next`, versions only — no
  publish), commit, `pnpm -r --filter "./packages/*" pack --pack-destination "$PWD/dist-tarballs"`
  (now including `@toolmark/mcp`), and append the M3 entry to `docs/release/next-tarballs.md`.

**Tests (write first):** `e2e/webmcp.spec.ts`: `polyfill_exposes_tools_and_execute_fills_form`;
`e2e/mcp.spec.ts`: `desktop_client_lists_and_calls_after_pairing` (spawn CLI, drive pairing in the
page, call via an MCP SDK client).

**Task gate:** `pnpm -F @toolmark-examples/react-vite exec playwright test` then lane gate, then the M3 tarballs exist and are listed in `docs/release/next-tarballs.md`.

---

## Self-review

- **Spec coverage:** §11.2 → T2; §11.3 → T3/T4; §11.4 → T5; §13 → T1; §14 pairing → T4; D28 labels →
  constraints + T6 docs; §18 contract (MCP both eras) → T3/T4.
- **Names:** `webmcp`, `otel`, `useToolAnchor`, `mcpPairing` match the overview registry;
  `tm.anchor`/`tm.setAnchor`/`tm.state`, `startMcpServer`, `createPairingServer` added to it.
- **Ownership:** the bridge `caller` widening (`core/src/bridge/bridge.ts`) belongs to Lane A's Task 1.
- **Error codes added:** `webmcp_unavailable` (T2), recorded in `docs/guides/webmcp.md`.
- **Placeholders:** the only execution-time check is the MCP SDK era support, with a defined fallback.
