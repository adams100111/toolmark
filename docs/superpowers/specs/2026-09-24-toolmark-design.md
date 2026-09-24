# Toolmark — design spec

- **Date:** 2026-09-24 (revised after the grilling session, same day)
- **Status:** agreed design (D1–D32), pending final written-spec review
- **Owner:** adams100111
- **First consumer:** Innovation (`dits-sa/innovation`), its AI assistant's form-filling "Entry Mode"
- **Release model:** one complete, production-ready `1.0`. No MVP. Internal milestones ship as
  `-next` versioned tarballs consumed by Innovation (packed with `pnpm pack`, vendored in Innovation;
  nothing is published to npm before M5); nothing is public until every release gate (§21) passes.

## 1. Purpose

Toolmark is a registry-first TypeScript toolkit that lets a web app **declare typed, safe actions
once** and serve them to every kind of agent:

- the app's **own in-app assistant** (server-side or in-page LLM),
- **browser agents** over WebMCP (`document.modelContext`),
- **desktop MCP clients** (Claude Desktop, Claude Code) through a local bridge,
- **guided tours** (agent-planned or authored),
- **test harnesses** (Playwright, Vitest).

It replaces scrape-the-DOM-and-run-generated-script automation with named tools, validated inputs
and typed results. Its promise is **stability**: apps code against Toolmark's API while the WebMCP
spec (a Community Group draft in origin trial) keeps changing underneath.

### Success criteria

1. Innovation's `SimpleChallengeForm` is filled by its assistant in **≤ 3 LLM rounds**, and the
   advanced six-step challenge wizard in **≤ 5 rounds**, both measured against the current
   snapshot-and-script flow (rounds, wall time, input tokens, success rate).
2. The same tool declarations work unchanged for the in-app agent, a WebMCP browser agent, a desktop
   MCP client, a tour and Playwright tests.
3. Every release gate in §21 passes.
4. No Innovation-specific code exists in any Toolmark package.

### Non-goals

- A WebMCP polyfill (use native, or MCP-B's `@mcp-b/webmcp-polyfill` as an optional peer).
- Any UI in `core`, `react` or `inertia` (confirmation is headless). The tour overlay is the one
  shipped UI (D30).
- Any AI model in a runtime package (the TypeSafe judge is lint-time only).
- A server/PHP package (the server side is a documented protocol, §12).
- Vue, Svelte or other framework adapters; React Native or other non-browser platforms.

## 2. Decisions

| ID  | Decision | Rationale |
| --- | --- | --- |
| D1  | **Registry-first core.** Tools live in Toolmark's registry; every agent surface is a consumer. | Gains don't depend on browser support; spec churn stays in one adapter. |
| D2  | pnpm monorepo, **JS/TS only**. | Reuse, one release train. Packagist can't publish from a subfolder. |
| D3  | Innovation is the first consumer. No Innovation-specific code in packages. | General-purpose, proven on real use. |
| D4  | No custom polyfill; native WebMCP or MCP-B's polyfill as optional peer. | MCP-B tracks the spec and its WPT suite. |
| D5  | Types via **Standard Schema v1**; manifest JSON Schema via **Standard JSON Schema**, with fallbacks (D14). | Library-agnostic. |
| D6  | Every call returns a typed `ToolResult`; expected outcomes never throw. | Structured outcomes for agents. |
| D7  | Policy lives in the registry; consequential/destructive tools require confirmation. Registration fails only when such a tool has no confirmation path for any allowed caller; inline-mode callers without a handler just don't see it (§7). | Safety in code, not prompt text. |
| D8  | Tour hooks (anchors, state, interaction events) in core. | Tours consume the registry. |
| D9  | No AI model in runtime packages. | Stability, no lock-in, no keys in the browser. |
| D10 | Name **Toolmark**, npm scope `@toolmark/*`. | Free on npm as of 2026-09-24. |
| D11 | Form adapters: react-hook-form (primary), Inertia `useForm`; Inertia `<Form>` through the DOM path. | Innovation: 43 RHF files, 51 `zodResolver`, 0 Inertia `<Form>`; `<Form>` is uncontrolled. |
| D12 | LLM exposure default: `page_call(tool, input)` (+ `page_describe`, D21); per-tool mode optional. | Stable cached tool prefix. |
| D13 | Confirmation is headless in core/react (`useConfirmQueue`). | Apps own their design systems. |
| D14 | Global `jsonSchema` converter option; per-tool override. | zod 3 apps plug in `zod-to-json-schema`. |
| D15 | Hosted at `github.com/adams100111/toolmark`, private until `1.0`, then public under MIT. | Scope independent of GitHub owner. |
| D16 | In-app consequential calls return **`needs_confirmation`**; the user's Confirm runs the tool as caller `human`. WebMCP/MCP callers wait on the in-page confirm. | Turn-based chat never blocks a worker on a human. |
| D17 | Every page registry has a **`clientId`**; every bridge call targets one client. | Multiple tabs never double-execute. |
| D18 | Calls carry the manifest `rev` they saw; reserved `refused` codes `unknown_tool` and `stale` return the current `rev`. | Recoverable staleness. |
| D19 | `fill` returns `changes` (before/after), skips user-edited fields unless `overwrite`, `null` clears, `undefined` leaves, `undo(callId)` restores. | Trust and reversibility. |
| D20 | Protocol security MUSTs: authorized private channels; results bound to user, conversation, client and call id; deadline enforced. | No forged results or eavesdropping. |
| D21 | **Summary manifest** + `page_describe(tool)` for full schemas; per-page tool budget. | Token cost stays flat. |
| D22 | Calls are serialized per scope and parallel across scopes. | No interleaved fills or fill/submit races. |
| D23 | Navigation returns `ok` before disposing its scope, then `changed`; a full reload yields server `timeout` and a fresh `manifest`. | Defined behaviour across page swaps. |
| D24 | No-op under SSR; `description` is for LLMs, `title`/`summary` are app-localized; tool names are a public contract. | Portability, i18n, compatibility. |
| D25 | **Wizard primitive** (`useWizardTool`) writing into parent state; per-step fallback. | Innovation's wizard: one `useForm` per step, parent `useState`. |
| D26 | Async **`options`** fields with a companion `<form>.options` tool; field arrays map to arrays. | Lookups, member pickers, repeatable rows. |
| D27 | **File fields** via app-resolved references, plus URLs from allow-listed origins (off by default). | Agents can't type bytes; URL fetching is an exfiltration risk. |
| D28 | Single **`1.0`**; the WebMCP adapter is labelled **experimental** (outside semver) until the spec leaves origin trial. | Honest stability promise. |
| D29 | Package set in §4. Includes MCP bridge, OpenTelemetry exporter, Next.js docs; no Vue/Svelte. | Complete for the React ecosystem. |
| D30 | Tours ship a styled, themeable overlay (CSS variables, RTL, accessible, reduced-motion) **and** a headless mode; agent-planned **and** authored tours. | UI is the product for tours. |
| D31 | `@toolmark/mcp`: CLI MCP server over stdio, **dual-era** (`2026-07-28` stateless and legacy `initialize` revisions ≤ `2025-11-25`), paired localhost WebSocket to the page. | Clients are mid-migration; pairing prevents drive-by control. |
| D32 | Release gates (§21); `-next` versioned tarballs consumed by Innovation before `1.0` (no npm publish before M5); post-release spec-watch CI. | Production readiness is verified, not asserted. |

## 3. Architecture

```
producers (declare tools)                      consumers (use tools)
useTool / useFormTool / useWizardTool ─┐   ┌─►  bridge()      in-app agent (server or page)
inertia forms, pages & routes         ─┼─► ├─►  webmcp()      document.modelContext  [experimental]
data-tool-* DOM scanner               ─┤ R ├─►  mcp           desktop MCP clients (via @toolmark/mcp)
server-declared tools (props)         ─┘ E ├─►  tour          show / guide / do
                                         G ├─►  testing       Playwright / Vitest
                                         I └─►  otel          OpenTelemetry events
                                         S
                                         T  scopes · policy · confirm · events · manifest() · call()
                                         R
                                         Y
```

Producers add tools to scopes. The registry validates, applies policy and emits events. Consumers
read `manifest()`, invoke `call()` and subscribe to changes. Consumers never know about each other.

## 4. Packages

| Package | Contents |
| --- | --- |
| `@toolmark/core` | registry, tool model, validation, results, policy, confirmation, scopes, events, `manifest()`/`call()`, files; subpaths `/bridge` (+ `/bridge/echo`, `/bridge/websocket`, `/bridge/post-message`, `/bridge/in-page`), `/protocol`, `/dom`, `/webmcp` (experimental), `/otel` |
| `@toolmark/react` | provider, `useTool`, `useFormTool`, `useWizardTool`, `<ToolScope>`, `useConfirmQueue`, `useAgentActivity`, `useToolAnchor`; subpath `/rhf` |
| `@toolmark/inertia` | `inertiaAdapter`, `inertiaPages`, `navigationTool`, props-declared tools, `<Form>` support via `/dom` |
| `@toolmark/testing` | Playwright fixtures and matchers; `createTestToolmark()` for Vitest |
| `@toolmark/tour` | tour engine, styled overlay, headless mode, authored and agent-planned tours |
| `@toolmark/mcp` | `toolmark-mcp` CLI: dual-era MCP stdio server + paired localhost WebSocket |
| `@toolmark/lint` | `toolmark lint` CLI; rule checks; judge interface |
| `@toolmark/judge-typesafe` | optional TypeSafe (Jev) judge for lint, dev/CI only |

Next.js is supported through `@toolmark/react` plus a documentation guide (App Router client
boundaries, SSR no-op). A helper package is added only if the guide cannot cover a real need.

## 5. Tool model and registry (`@toolmark/core`)

```ts
interface ToolDefinition<I = unknown, O = unknown> {
  name: string                 // local name; full name = scope path + "." + name
  title?: string               // user-facing, app-localized
  description: string          // for the LLM; says when to use the tool
  input?: StandardSchemaV1<I>
  output?: StandardSchemaV1<O>
  jsonSchema?: JsonSchema      // per-tool override (D14)
  hints?: { readOnly?: boolean; consequential?: boolean; destructive?: boolean; untrustedContent?: boolean }
  summary?: (input: I) => string   // user-facing one-liner for confirm cards (app-localized)
  anchors?: AnchorSpec
  state?: () => ToolState<I>
  run(input: I, ctx: ToolContext): ToolResult<O> | Promise<ToolResult<O>>
}

interface ToolContext {
  signal: AbortSignal
  callId: string
  caller: 'inapp' | 'webmcp' | 'mcp' | 'test' | 'tour' | 'human'
  confirm(req: ConfirmRequest): Promise<ConfirmOutcome>
  files: { resolve(ref: FileRef): Promise<File> }   // D27
}
```

Registry API:

```ts
const tm = createToolmark({ confirm, policy, jsonSchema, files, onError })
tm.clientId                                   // random per page load (D17)
tm.register(tool, { scope?, signal? })        // → { name, dispose() }
tm.scope(name, { when? })                     // root-level; nest with scope.scope(name, { when? })
tm.manifest({ caller?, detail: 'summary' | 'full' })          // sorted by name; carries rev
tm.describe(name)                             // full manifest entry (D21)
tm.call(name, input, { caller, rev?, signal? })               // Promise<ToolResult>, never throws
tm.confirmPending(confirmId, outcome)         // completes a needs_confirmation call (D16)
tm.undo(callId)                               // D19
tm.subscribe(listener)                        // debounced; carries rev
tm.events.on('call' | 'result' | 'confirm' | 'interaction' | 'change' | 'error', fn)
tm.use(consumer)                              // → dispose()
tm.anchor(name, param?) · tm.state(name)
```

Rules:

- **Names** use `A–Z a–z 0–9 _ - .` (MCP tool-name rules), scopes joined with `.`. Manifests also carry
  `llmName` (`.` → `__`). Tool names are a **public contract**: renaming one is a breaking change.
- **Collisions** throw in development and are rejected with an `error` event in production.
- **Removal** only via scope disposal, `signal` abort or the registration handle.
- `scope.when` hides a scope's tools from `manifest()` and `call()` while false.
- **Concurrency (D22):** calls are queued per scope in arrival order; scopes run in parallel.
- **SSR (D24):** without `document`, registration and consumers are inert no-ops.

## 6. Schemas, validation and results

- Input/output types are **Standard Schema v1** (`@standard-schema/spec` ≥ 1.1).
- JSON Schema resolves: `tool.jsonSchema` → Standard JSON Schema on the schema
  (`target: 'draft-2020-12'`) → global `jsonSchema` converter → development error / production:
  registered without schema plus an `error` event.
- Input is validated **before** `run`; output validation runs in development only.

```ts
type ToolResult<T> =
  | { status: 'ok'; data: T }
  | { status: 'invalid'; issues: { path: string; message: string }[] }
  | { status: 'refused'; code: string; message: string; rev?: number }
  | { status: 'needs_confirmation'; confirmId: string; summary: string; changes?: FieldChange[] }
  | { status: 'cancelled'; by: 'operator' | 'signal' | 'policy' }
  | { status: 'error'; message: string }
```

- Reserved `refused` codes: `unknown_tool`, `stale` (both with `rev`), `not_allowed` (policy),
  `busy` (scope queue full).
- Helpers: `ok`, `invalid`, `refuse`, `cancelled`.
- A thrown exception becomes `{ status: 'error' }` with a generic message; details go to events only.

## 7. Policy and confirmation

| Hint | Confirmation | Default exposure |
| --- | --- | --- |
| readOnly | never | all callers |
| (none) | no | all callers |
| consequential | required unless caller is `human` | inapp, webmcp, mcp, tour (`do` mode) |
| destructive | required; never auto-submitted | inapp only |

- Per-caller policy (`policy: { webmcp: { allow: [...] } }`) filters `manifest()` and `call()`.
- **Two confirmation modes (D16):**
  - **Deferred** (default for `inapp`): the call returns `needs_confirmation` immediately with a
    `confirmId`, `summary` and `changes`. The app renders it (e.g. a chat card). On approval the app
    calls `tm.confirmPending(confirmId, { approved: true })`; the tool runs as caller `human`, and the
    result is delivered to the agent as a new bridge message (`confirmed`, §12).
  - **Inline** (default for `webmcp`, `mcp`, `tour`): `ctx.confirm()` awaits the app's handler in the
    page, since those callers wait on their own.
- Pending confirmations expire (default 10 minutes) and are dropped on scope disposal.
- Registering a consequential or destructive tool fails (`missing_confirm_handler`) **only** when no
  caller allowed to use it has a confirmation path (deferred mode, or inline mode with a `confirm`
  handler configured). A caller whose mode is `inline` while no inline `confirm` handler is configured
  does not see the tool (filtered from `manifest()`/`describe()` for that caller), and a call from it
  returns `refused` `not_allowed`; a single dev-only `error` event `missing_confirm_handler` (warning
  semantics) is emitted per such tool. Toolmark core ships no confirm UI (D13).
- **Client policy is not an authorization boundary.** The server authorizes every mutation.

## 8. Forms

### 8.1 Form adapters and `useFormTool`

`FormAdapter<V>`: `getValues()`, `setValues(values, { source })` (`source: 'agent' | 'undo'`; flat
dot paths; `null` clears), `dirtyPaths()`, `submit()`, `fields()`, optional `onUserInteraction(cb)`
(tour interaction events, §13). Overwrite decisions, validation and undo live in the form-tool core,
not the adapter.

`useFormTool(adapter, { name, description, input, options?, files? })` registers:

- `<name>.fill`: partial input. Returns `ok({ changes, skipped })` (D19). Skips fields the user has
  edited (per `dirtyPaths`) unless `overwrite: true`. `null` clears; `undefined` leaves unchanged.
- `<name>.submit`: consequential.
- `<name>.options`: present when any field declares async `options` (§8.3).
- `tm.undo(callId)` restores the `before` values of a `fill` while the form is mounted.

Adapters: `rhfAdapter(form)` (`@toolmark/react/rhf`, react-hook-form ≥ 7, field arrays via array
paths), `inertiaAdapter(form)` (`@toolmark/inertia`, server errors → `invalid`), and the DOM adapter
(§10) for uncontrolled forms including Inertia `<Form>`.

### 8.2 Wizards (`useWizardTool`, D25)

```ts
useWizardTool({
  name: 'create',
  description: 'The advanced new-challenge wizard.',
  steps: [{ name: 'basicInfo', input: basicInfoSchema }, { name: 'innovationType', input: … }, …],
  data, setData,                 // the parent's source of truth (e.g. useState slices)
  current, goTo,                 // step navigation
  submit: () => handleFinalSubmit(),
})
```

- `create.fill` accepts any subset of step slices, validates each against its step schema, writes to
  parent state, and resets the mounted step form from the new data. Returns per-step `changes` and
  per-step issues.
- `create.goTo(step)`, `create.submit` (consequential).
- **Fallback:** a wizard that cannot expose parent state registers per-step `useFormTool` tools plus
  `next`/`previous`, and the manifest reports `mode: 'stepwise'`.

### 8.3 Async options and arrays (D26)

- A field may declare `options: async ({ query, signal }) => [{ value, title }]`. The fill schema
  types it as its value type; `<name>.options({ field, query })` (read-only) returns candidates so
  agents select real IDs.
- Field arrays are JSON `array`s of objects; `fill` replaces an array unless given
  `{ $append: [...] }` or `{ $remove: [indexes] }`.

### 8.4 Files (D27)

- File fields accept `FileRef = { ref: string } | { url: string }`.
- `{ ref }` resolves through the app's `files.resolve` hook (e.g. an attachment uploaded in chat or the
  tour UI).
- `{ url }` is **disabled by default**; enabling requires `files.allowOrigins`. Fetches use
  `credentials: 'omit'`, enforce size/type limits, and never follow redirects off the allow-list.
- The manifest describes file fields as `{ type: 'object', properties: { ref, url } }` with the
  accepted MIME types and size limit.

## 9. React (`@toolmark/react`, React ≥ 18.3)

- `<ToolmarkProvider toolmark>`, `<ToolScope name when>`.
- `useTool(def)`: registered while mounted; latest closure; StrictMode-safe.
- `useFormTool`, `useWizardTool` (§8).
- `useConfirmQueue()` → `{ confirm, pending, approve(input?), reject(reason?) }` for inline mode, and
  `usePendingConfirmations()` for deferred mode.
- `useAgentActivity()`, `useToolAnchor(tool, param?)`.

## 10. Inertia and DOM

### 10.1 Inertia (`@toolmark/inertia`, `@inertiajs/react` 2–3)

- `inertiaAdapter(form)` wraps `useForm`.
- `inertiaPages({ router })`: a page scope per visit, disposed on navigation (D23); registers
  server-declared tools from the `toolmark` props key (§12.4).
- `navigationTool({ routes, visit })`: routes are `(params) => { url, method }` functions (Wayfinder
  or Ziggy). Returns `ok` before the page scope is disposed; a `changed` message follows.
- Inertia `<Form>` (uncontrolled) is covered by the DOM adapter.

### 10.2 Declarative HTML (`@toolmark/core/dom`)

- Honours native WebMCP attributes (`toolname`, `tooldescription`, `toolautosubmit`,
  `toolparamdescription`); Toolmark additions use `data-tool-*` (`data-tool`, `-description`,
  `-group`, `-readonly`, `-consequential`, `-destructive`, `-confirm`, `-column`, `-type`, `-param-*`,
  `-options-url`).
- `scanDom({ root, observe: true })` keeps tools in sync via `MutationObserver`.
- Schema synthesis: text/email/url/tel (format, length, pattern), number/range (type from `step`,
  min/max/multipleOf), date/time/datetime-local (format, min/max), checkbox (boolean / array enum),
  radio/select (enum with titles), `select[multiple]` (array, uniqueItems), `fieldset[name]` (nested
  object), file (FileRef, accept, size), `required`, `value` (default).
- DOM filling sets values through native setters and dispatches `input`/`change`, with the same
  `changes`/`skipped`/undo semantics (dirty = changed since load or by the user).
- Buttons become action tools; tables with `data-tool-column` become read-only query tools
  (`where`, `limit`) with `untrustedContent`.
- Includes shadow DOM (open roots) and form-associated custom elements.

## 11. Consumers

### 11.1 In-app bridge (`@toolmark/core/bridge`)

- `tm.use(bridge({ transport }))` speaks protocol v1 (§12).
- Transports: `echoTransport` (Laravel Echo in, HTTP POST out), `websocketTransport`,
  `postMessageTransport` (iframes, extensions; origin-checked), and `createInPageChannel()` (returns a
  page-side transport plus an agent handle, for a client-side LLM and tests).
- Sends `manifest` on attach and a full summary `manifest` on each revision by default
  (`bridge({ onChange: 'manifest' | 'changed' })`; `'changed'` sends the bare `changed` message);
  answers each addressed `call` exactly once; honours `cancel`; forwards deferred confirmations as
  `confirmed` messages.

### 11.2 WebMCP (`@toolmark/core/webmcp`, **experimental**, D28)

- `tm.use(webmcp({ polyfill: 'auto' | 'none', filter? }))`.
- Registers visible tools via `document.modelContext.registerTool()` (one `AbortSignal` each), maps
  hints to `readOnlyHint` / `consequentialHint` / `untrustedContentHint`, routes `execute` through
  `tm.call(..., { caller: 'webmcp' })` with inline confirmation.
- Absorbs spec drift (getter location, promise-returning `registerTool`, event naming). Covered by
  the WebMCP WPT suites and the spec-watch job (§21).

### 11.3 Desktop MCP (`@toolmark/mcp`, D31)

- `toolmark-mcp` is launched by the MCP client (stdio). It is a **dual-era** server: serves stateless
  `2026-07-28` requests (`server/discover`, per-request `_meta`, `resultType`, cacheable lists) and
  answers `initialize` for legacy revisions up to `2025-11-25`.
- It exposes the paired page's tools as MCP tools (inline confirmation in the page), and emits
  list-changed notifications per era when the manifest changes.
- The page side: `tm.use(mcpPairing({ port }))` connects to `ws://127.0.0.1:<port>` only after the user
  enters a one-time **pairing code** shown by the CLI; the CLI checks `Origin` against an allow-list
  and binds to localhost only.
- Built on the official MCP TypeScript SDK (server package); SDK version and dual-era support are
  verified at plan time.

### 11.4 OpenTelemetry (`@toolmark/core/otel`)

- `tm.use(otel({ tracer?, meter? }))` records one span per call (tool, caller, status, duration) and
  counters per status. `@opentelemetry/api` is an optional peer. Inputs and results are never
  recorded by default.

### 11.5 Tours (`@toolmark/tour`, D30)

- One engine, three modes: **show** (highlight + explain; the user acts), **guide** (wait for the
  user's interaction events, validate each step via `state()`), **do** (run tools as caller `tour`,
  highlighting each change; consequential steps confirm inline).
- **Authored tours:** steps as data referencing tools and params, never CSS selectors:
  `{ tool: 'challenges.create.fill', param: 'type', text: 'Pick the challenge type' }`.
- **Agent-planned tours:** `startTour(tm, { goal, mode, planner })`, where `planner` is app-supplied
  (e.g. the server agent over the bridge).
- Overlay: CSS variables for theming, no global CSS, RTL, keyboard and screen-reader accessible,
  `prefers-reduced-motion` respected. Headless mode exposes the same engine via hooks.

### 11.6 Testing (`@toolmark/testing`)

- Extends `@playwright/test`: fixture `tools` (`call`, `get`, `list`, `confirm(confirmId, outcome)`,
  `autoConfirm`); matchers `toHaveTools`, `toBeConsequential`, `toBeReadOnly`, `toHaveChanged`.
- Uses an in-page test consumer (no WebMCP dependency).
- `createTestToolmark()` for Vitest: scripted confirmations, call recorder.

## 12. Bridge protocol v1

Toolmark ships **no server package**. Any backend implements this protocol.

### 12.1 Messages

```jsonc
// page → agent
{ "protocol": 1, "type": "manifest", "clientId": "k7…", "rev": 7, "tools": [ToolManifestSummary] }
{ "protocol": 1, "type": "changed",  "clientId": "k7…", "rev": 8 }
{ "protocol": 1, "type": "result",   "clientId": "k7…", "id": "c1", "result": ToolResult }
{ "protocol": 1, "type": "confirmed","clientId": "k7…", "confirmId": "f3", "result": ToolResult }
// agent → page
{ "protocol": 1, "type": "call",     "clientId": "k7…", "id": "c1", "rev": 7, "tool": "…", "input": {} }
{ "protocol": 1, "type": "describe", "clientId": "k7…", "id": "c2", "tool": "…" }
{ "protocol": 1, "type": "cancel",   "clientId": "k7…", "id": "c1" }
```

- `ToolManifestSummary = { name, llmName, title?, description, hints, mode? }`; `describe` returns the
  full entry including `inputSchema` (D21).
- JSON Schemas for every message ship in `@toolmark/core/protocol`.

### 12.2 Rules

- A page ignores messages addressed to another `clientId`.
- `id` is unique per conversation; the page answers each `call`/`describe` exactly once.
- The server maps a missing result after its deadline to `timeout` (server-side only).
- Unknown `protocol` → `{ status: 'error', message: 'unsupported protocol' }`.
- **Security MUSTs (D20):** transports use authorized private channels per user and conversation;
  the server binds each `id`/`confirmId` to user, conversation and `clientId`, rejects mismatched,
  unknown or duplicate results, and rejects results after the deadline. Ids are unguessable.

### 12.3 LLM exposure

- Default: `page_call(tool, input)` whose description renders the **summary** manifest, plus
  `page_describe(tool)`; both stay stable across pages so provider prompt caching holds.
- Alternative: one LLM tool per manifest entry via `llmName`.
- Deferred confirmations: the agent tells the user a confirmation is pending. When the `confirmed`
  message arrives, the server appends the outcome to the conversation as a tool-result message and
  starts **one** follow-up agent turn limited to acknowledging that outcome. The follow-up turn gets
  no page tools (`page_call`/`page_describe` are withheld), so it cannot start new actions.

### 12.4 Server-declared tools

The `toolmark` Inertia props key carries manifest-shaped entries with an execution descriptor
(`{ visit: { url, method } }`). The server filters them with its own authorization before rendering.

### 12.5 Laravel reference

The docs ship a Laravel reference to copy into apps: `PageCallTool`/`PageDescribeTool`, a
protocol-v1 `BrowserBridge` (Broadcasting on private channels out, authenticated HTTP POST back,
cache hand-off with a blocking Redis pop where available), the `confirmed` handler, and a props
builder. Reusable extraction, if ever needed, goes to its **own** repo (`toolmark-laravel`).

## 13. Tour hooks in core

- `anchors`: supplied automatically by form adapters; `useToolAnchor` for custom widgets;
  `tm.anchor(tool, param?)` → `HTMLElement | null`.
- `state`: `tm.state(tool)` → `{ values, issues, step? }` without side effects.
- Interaction events `{ tool, param?, kind: 'input' | 'focus' | 'submit', caller: 'human' }` are
  emitted only for user-originated changes.

## 14. Errors and security

- **No code execution**: only registered tools with validated input run. No `eval`/`new Function` in
  any package (lint-enforced in CI).
- **Server is the authority**: client tools and policy are agent UX and safety only.
- **Prompt injection**: page/user content in results is marked `untrustedContent`; descriptions come
  only from code or server props.
- **Bridge and MCP pairing security**: §12.2 MUSTs; MCP pairing code, origin allow-list, localhost
  binding.
- **Files**: URL fetching off by default, allow-listed origins, `credentials: 'omit'`, size/type
  limits.
- **Timeouts and cancellation**: every call has a signal; no hanging promises.
- **Development vs production**: misconfiguration throws in development, is rejected with an event in
  production.
- **Privacy**: `state()`, manifests and telemetry exclude password and `autocomplete="cc-*"` fields;
  OTel never records inputs/results by default.

## 15. Internationalization

- `description` targets LLMs (English recommended); `title`, `summary` and change labels are
  user-facing and localized by the app (Arabic/English in Innovation).
- The tour overlay supports RTL layout and app-supplied strings.

## 16. Repository

```
toolmark/
├─ packages/{core,react,inertia,testing,tour,mcp,lint,judge-typesafe}/
├─ examples/{react-vite,inertia-laravel,nextjs}/     # runnable, exercised in CI
├─ docs/                                             # docs site + generated API reference
└─ pnpm-workspace.yaml
```

Latest stable versions checked on npm, 2026-09-24 (re-verify when the plan executes):

| Tool | Version | Note |
| --- | --- | --- |
| pnpm | 12.6.0 | workspace + catalogs |
| TypeScript | 7.0.2 | workspace pins 6.0.3; 7.0.2 checked in CI (§23) |
| tsdown | 0.23.0 | ESM + `.d.ts` |
| Vitest | 5.0.1 | unit + browser mode |
| @playwright/test | 1.63.0 | e2e + testing package |
| @changesets/cli | 3.0.3 | versioning + provenance |
| typedoc | 0.28.20 | API reference |
| @standard-schema/spec | 1.1.0 | types + Standard JSON Schema |
| zod | 4.6.5 | dev/test |
| react · @inertiajs/react · next | 19.3.0 · 3.7.1 · 16.3.6 | peers: React ≥ 18.3; Inertia 2–3; Next example |
| react-hook-form | 7.88.0 | optional peer |
| @modelcontextprotocol/server | 2.1.0 | `@toolmark/mcp` (dual-era support to verify) |
| ws | 8.21.3 | `@toolmark/mcp` WebSocket server |
| @opentelemetry/api | 1.9.1 | optional peer |
| @mcp-b/webmcp-polyfill · webmcp-types | 5.1.0 · 0.1.9 | optional peer · dev types |
| zod-to-json-schema | 3.25.2 | documented converter for zod 3 apps |

## 17. Stability and versioning

- `1.0` covers everything except the WebMCP adapter, which is **experimental** until WebMCP ships
  outside origin trial (D28).
- Public API: exported types and functions, hooks, `data-tool-*` attributes, bridge protocol v1, the
  `toolmark` props shape, CLI flags.
- Deprecations warn at least one minor version before removal; changelog via changesets.

## 18. Testing strategy

- **Unit (Vitest):** registry (scopes, collisions, policy, deferred/inline confirmation, results,
  events, revisions, concurrency, undo), schema resolution, protocol validation, files policy.
- **DOM (Vitest browser mode):** React hooks (StrictMode, disposal, latest closure), RHF, Inertia,
  wizard and DOM adapters setting values, dirty-field skipping, anchors and interaction events.
- **Contract:** protocol v1 schemas against recorded fixtures; MCP conformance for both eras; the
  Laravel reference in the `inertia-laravel` example.
- **E2E (Playwright, Chromium/Firefox/WebKit):** examples via `@toolmark/testing`, tours in all three
  modes, deferred confirmation, multi-tab targeting, navigation mid-conversation. WebMCP on Chromium
  plus the WPT suites.
- **Consumer:** Innovation's measured before/after run (success criterion 1).

## 19. Innovation adoption (app-side work, consumes `-next` tarballs)

The adoption plan is written in the Innovation repo with its own Spec Kit flow before M1 starts.

0. **Baseline first:** record the current snapshot-and-script flow — 10 runs each of the simple-form
   task and the wizard task, recording rounds, wall time, input tokens and success rate — saved to
   `docs/release/innovation-baseline.md` in the Toolmark repo. It is a prerequisite for the M1 exit
   check.
1. Put `browser_script` behind a config flag defaulting to off (independent security fix).
2. Depend on `@toolmark/*` `-next` versioned tarballs: each milestone's `pnpm pack` output is
   committed under `innovation/resources/js/vendor-packages/toolmark/` and referenced as `file:resources/js/vendor-packages/toolmark/<tgz>`
   (`link:` for local development). Nothing is published to npm before M5.
3. `SimpleChallengeForm`: `useFormTool(rhfAdapter(form), …)` with a global `zod-to-json-schema`
   converter; localized fields via an app-side adapter; lookups via async `options`.
4. Advanced wizard: `useWizardTool` over `ChallengeForm`'s `formData`/`setFormData`.
5. Chat popup: `bridge(echoTransport(…))`, manifest with entry-mode messages, deferred confirmation
   card (existing options-bubble pattern).
6. `AiAssistant` module: `PageCallTool`/`PageDescribeTool`, protocol-v1 `BrowserBridge` with the
   §12.2 security rules (adapted from §12.5). Snapshot stays as fallback for pages without tools.
7. Measure after on the same tasks as the baseline; results go to
   `docs/release/innovation-results.md` in the Toolmark repo.
8. Idea and project create/edit forms; then delete the snapshot scraper and the prompt's filling
   recipes. Other pages migrate after `1.0` (Innovation's scope).

## 20. Build milestones (internal, all ship in `1.0`)

Each milestone ends with `-next` versioned tarballs consumed by Innovation (no npm publish before
M5). The M1 exit check requires the Innovation baseline (`docs/release/innovation-baseline.md`, §19
step 0) to exist first.

| Milestone | Scope | Exit check |
| --- | --- | --- |
| M1 · Core | §5–§7, protocol v1, bridge + all transports, React (`useTool`, `useFormTool`, confirm hooks), RHF + Inertia adapters, testing basics | Innovation simple form ≤ 3 rounds, measured |
| M2 · Forms complete | wizard, async options, arrays, files, undo, DOM adapter incl. Inertia `<Form>`, navigation, props-declared tools | Innovation wizard ≤ 5 rounds, measured |
| M3 · Reach | WebMCP (experimental), `@toolmark/mcp`, OTel, tour hooks | Same tools used by a WebMCP agent, a desktop MCP client and Playwright |
| M4 · Tours & tooling | `@toolmark/tour`, lint + TypeSafe judge, docs site, examples incl. Next.js | Authored and planned tours run in Innovation |
| M5 · Release | §21 gates, security review, publish `1.0` | All gates green |

## 21. Release gates (definition of done for `1.0`)

- All unit, DOM, contract and E2E suites green on the CI matrix: React 18.3/19, Inertia 2/3, zod 3
  (converter)/zod 4, Chromium/Firefox/WebKit (WebMCP on Chromium).
- Per-package bundle budgets enforced in CI; `@toolmark/core` has zero runtime dependencies (budgets
  set from the first measured build).
- Every public export documented; API reference generated; guides for React, Inertia, Next.js,
  Laravel reference, WebMCP, MCP, tours.
- Security review against §14 completed and findings resolved.
- Releases via changesets with npm provenance; changelog and deprecation policy published.
- Innovation running on the release candidate with measured results meeting success criterion 1.
- Post-release: a weekly **spec-watch** CI job runs the WebMCP WPT suites and checks Chrome's
  implementation status; drift ships as patch/minor releases of the experimental adapter.

## 22. Owner actions outside the design

- Reserve the `toolmark` npm org.
- Confirm code ownership (employment IP terms) before the first public commit.

## 23. Implementation rulings

Rulings made while writing the milestone plans (`docs/superpowers/plans/2026-09-24-toolmark-*.md`).
Where one amends a section above, that section has been updated to match.

| Ruling | Plan reference |
| --- | --- |
| Workspace on **TypeScript 6.0.3** (`typescript-eslint` peers `<6.1.0`); CI also type-checks the emitted `.d.ts` with TypeScript 7.0.2. | Overview constraints; M1 rulings, T16; M5 T1 |
| In-page transport is **`createInPageChannel()`** (page transport + agent handle); the earlier name `inPageTransport` is retired (§11.1 amended). | M1 T9 |
| Bridge sends a full summary `manifest` on every revision by default (`onChange: 'manifest' \| 'changed'`). | M1 rulings, T8 |
| Fill validation is **merge-based**: the full schema runs on current values merged with input; only issues on touched paths count. | M1 rulings, T6 |
| **Agent-set tracking**: a dirty field is user-edited unless its value equals what the agent last set. | M1 rulings, T6 |
| The inline **confirm queue lives in core** (`createConfirmQueue`); `useConfirmQueue(queue)` only subscribes. | M1 rulings, T5, T11 |
| **Transparent scopes** (`{ transparent: true }`) group tools without prefixing names. | M2 rulings, T1 |
| Tool **`origin`** field (`'code' \| 'native-form' \| 'dom' \| 'server'`), not in the manifest. | M2 rulings, T1; M3 T2 |
| `inertiaPages` (with props-declared tools and navigation) ships in **M2**; M1 ships `inertiaAdapter`. | M1 rulings; M2 T8 |
| **Lint reads manifests, not source** (`--manifest`, `--url`). | M4 rulings, T3 |
| Dev-only **tool budget**: `ToolmarkOptions.budget` (default 40) emits `tool_budget_exceeded` in `dev` only. | M1 constraints, T4 |
| **FormAdapter** members are `getValues`, `setValues(values, { source })`, `dirtyPaths()`, `submit()`, `fields()`, optional `onUserInteraction` (§8.1 amended; `dirtyFields`/`validate?`/`reset` dropped). | M1 T6; M3 T1 |
| `tm.manifest` has no `scope` option and `tm.scope` has no `parent` option; nesting is via `scope.scope()` (§5 amended). | M1 T4 |
| **MCP era routing** is Toolmark's own front door: the first stdio message picks the legacy handler (`initialize`) or the SDK's modern server. | M3 rulings, T3 |
| **Node floor `>=22.12`** (global `WebSocket`); CI matrix Node 22.x and 24.x. | Overview constraints; M1 T1; M5 constraints |
| **Tarball consumption**: pre-1.0 Innovation consumes `-next` versioned tarballs from `pnpm pack`, vendored under `innovation/resources/js/vendor-packages/toolmark/`; nothing is published before M5 (header, D32, §19, §20 amended). | Overview; final lane of M1–M4 |
| **Confirm rule**: `missing_confirm_handler` only when no allowed caller has a confirmation path; inline callers without a handler don't see the tool (§7, D7 amended). | M1 constraints, T4, T5 |
