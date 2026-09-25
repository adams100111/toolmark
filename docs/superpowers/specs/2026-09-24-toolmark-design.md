# Toolmark — design spec

- **Date:** 2026-09-24 (revised after the grilling session and the plan audit, same day)
- **Status:** agreed design (D1–D32), amended by the §23 rulings
- **Owner:** adams100111
- **First consumer (post-1.0):** Innovation (`dits-sa/innovation`), its AI assistant's form-filling
  "Entry Mode". It adopts the published `1.0`; it is not a release dependency (§19).
- **Release model:** one complete, production-ready `1.0` of all eight packages. No MVP. Internal
  milestones end with `-next` versioned tarballs (`pnpm pack`) verified by the in-repo tarball smoke
  test; nothing is published to npm before M5 and nothing is public until every release gate (§21)
  passes. Toolmark `1.0` depends on no other repository.

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

1. **Round budget (in-repo):** in `examples/react-vite`, a scripted protocol-v1 agent (no LLM) that
   starts from the summary manifest and may use `describe` completes the simple-form task in
   **≤ 3 agent rounds** and the multi-step wizard task (≥ 3 steps, one async `options` field) in
   **≤ 5 agent rounds**, with zero `invalid`/`refused` results (`e2e/round-budget.spec.ts`; evidence
   in `docs/release/round-budget.md`). A **round** is one agent turn that issues ≥ 1 tool call
   (`describe`/`call`): every agent→page message sent before the agent next awaits results counts as
   one round. The human's confirmation of a deferred call and the §12.3 acknowledgement turn (no
   page tools) are not rounds. A real consumer's before/after LLM measurement (Innovation, §19) is a
   post-1.0 case study, not a release gate.
2. The same tool declarations work unchanged for the in-app agent, a WebMCP browser agent, a desktop
   MCP client, a tour and Playwright tests — asserted on one declaration by
   `examples/react-vite/e2e/same-tools.spec.ts`.
3. Every release gate in §21 passes.
4. No app-specific (e.g. Innovation) code exists in any Toolmark package (checked in CI, M5).

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
| D3  | No app-specific code in packages. Innovation is the first **post-1.0** consumer; `1.0` is proven on the in-repo examples. | General-purpose; the release never waits on another repo. |
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
| D31 | `@toolmark/mcp`: CLI MCP server over stdio, **dual-era** (`2026-07-28` stateless and legacy `initialize` revisions ≤ `2025-11-25`) through the SDK's built-in `serveStdio` era selection (no Toolmark-written router), paired localhost WebSocket to the page (pairing code → session token). | Clients are mid-migration; the SDK owns protocol conformance; pairing prevents drive-by control. |
| D32 | Release gates (§21); per-milestone `-next` versioned tarballs verified by the in-repo tarball smoke test (no npm publish before M5); post-release spec-watch CI. | Production readiness is verified, not asserted. |

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
| `@toolmark/testing` | Playwright fixtures and matchers; `createTestToolmark()` for Vitest (also `/vitest`, which never imports Playwright); subpath `/page` (in-page test hook) |
| `@toolmark/tour` | tour engine, styled overlay, headless mode, authored and agent-planned tours; subpaths `/overlay`, `/react`, `/styles.css` |
| `@toolmark/mcp` | `toolmark-mcp` CLI: dual-era MCP stdio server + paired localhost WebSocket; subpath `/client` (browser: `mcpPairing`) |
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
  sensitivePaths?: () => string[]   // redacted from state(), telemetry (§14)
  origin?: 'code' | 'native-form' | 'dom' | 'server'; nativeName?: string   // via tm.info, not in the manifest
  run(input: I, ctx: ToolContext): ToolResult<O> | Promise<ToolResult<O>>
}

interface ToolContext {
  signal: AbortSignal
  callId: string
  caller: 'inapp' | 'webmcp' | 'mcp' | 'test' | 'tour' | 'human'
  confirm(req: { summary: string; changes?: FieldChange[] }): Promise<ConfirmOutcome>
  files: { resolve(ref: FileRef): Promise<File> }   // D27
  registerUndo(restore: () => ToolResult<unknown> | Promise<ToolResult<unknown>>): void  // D19
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
tm.info(name)                                 // { origin, nativeName?, sensitivePaths } | undefined; not in the manifest
```

Rules:

- **Names** use `A–Z a–z 0–9 _ - .` (MCP tool-name rules), scopes joined with `.`. Manifests also carry
  `llmName` (`.` → `__`). Tool names are a **public contract**: renaming one is a breaking change.
- **Collisions** throw in development and are rejected with an `error` event in production.
- **Removal** only via scope disposal, `signal` abort or the registration handle.
- `scope.when` hides a scope's tools from `manifest()` and `call()` while false.
- **Concurrency (D22):** calls are queued per scope in arrival order; scopes run in parallel.
- **SSR (D24):** without `document`, registration and consumers are inert no-ops.
- **`ctx.confirm(req)`** inside `run`: caller `human` → `{ approved: true }`; an inline-mode caller →
  awaits the inline handler (bounded by the call signal and the confirmation expiry); a deferred-mode
  caller or no handler → `{ approved: false, reason: 'confirmation_unavailable' }` plus a dev `error`
  event `ctx_confirm_unavailable` (tools that always need confirmation declare `consequential`
  instead). It never throws.

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
  `busy` (scope queue full), `undo_unavailable`, `confirmation_expired`, `file_rejected` (§8.4),
  `navigation_failed` (§10.1). The full list of `refused` and `error` event codes, with their
  milestone of origin, is published in `docs/reference/codes.md` (M4).
- Helpers: `ok`, `invalid`, `refuse`, `cancelled`.
- A thrown exception becomes `{ status: 'error' }` with a generic message; details go to events only.

## 7. Policy and confirmation

| Hint | Confirmation | Default exposure |
| --- | --- | --- |
| readOnly | never | all callers |
| (none) | no | all callers |
| consequential | required unless caller is `human` | inapp, webmcp, mcp, tour (`do` mode), test, human |
| destructive | required; never auto-submitted | inapp, test, human |

- Per-caller policy (`policy: { webmcp: { allow: [...], tools?: { allow?, deny? } } }`) filters
  `manifest()` and `call()`. `policy[c].allow` (hint classes) **replaces** caller `c`'s defaults;
  callers not listed keep their defaults; `human` is fixed and not configurable. `tools` filters by
  full name or `prefix.*`; deny wins. `manifest()`/`describe()` without a caller apply no policy
  filter (debug view).
- **Two confirmation modes (D16):**
  - **Deferred** (default for `inapp`): the call returns `needs_confirmation` immediately with a
    `confirmId`, `summary` and `changes`. The app renders it (e.g. a chat card). On approval the app
    calls `tm.confirmPending(confirmId, { approved: true })`; the tool runs as caller `human`, and the
    result is delivered to the agent as a new bridge message (`confirmed`, §12).
  - **Inline** (default for `webmcp`, `mcp`, `tour`): `ctx.confirm()` awaits the app's handler in the
    page, since those callers wait on their own.
  - Modes are configurable per caller for `inapp` and `test` only; `webmcp`, `mcp` and `tour` are
    always inline (anything else → dev throw / prod `error` event `invalid_confirm_mode`), so those
    consumers never receive `needs_confirmation`. `createTestToolmark()` keeps the production modes and
    installs an inline handler (default: approve).
- Pending confirmations expire (default 10 minutes) and are dropped on scope disposal. A `confirmId`
  is single-use: the first `confirmPending` consumes it; any later or concurrent call →
  `refused` `confirmation_expired`.
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

Adapters: `rhfAdapter(form, { onSubmit, elementFor?, root? })` (`@toolmark/react/rhf`,
react-hook-form ≥ 7, field arrays via array paths; `root` enables automatic anchors and focus/submit
interaction events), `inertiaAdapter(form)` (`@toolmark/inertia`, server errors → `invalid`), and the DOM adapter
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
  parent state, and resets the mounted step form from the new data. Returns `ok({ changes, skipped })`
  or `invalid`, every path prefixed `<step>.`.
- Without a mounted step adapter the wizard calls the optional `resetCurrent(values)`; the stepwise
  fallback re-registers its step fill tool (`refresh()`) when the current step changes.
- `create.goTo(step)`, `create.submit` (consequential). `submit` first validates every step's full
  schema; any issue → `invalid` (paths `<step>.<path>`) and no confirmation is created.
- **Fallback:** a wizard that cannot expose parent state registers per-step `useFormTool` tools plus
  `next`/`previous`, and the manifest reports `mode: 'stepwise'`.

### 8.3 Async options and arrays (D26)

- A field may declare `options: async ({ query, signal }) => [{ value, title }]`. The fill schema
  types it as its value type; `<name>.options({ field, query })` (read-only) returns candidates so
  agents select real IDs.
- Field arrays are JSON `array`s of objects; `fill` replaces an array unless given
  `{ $append: [...] }` or `{ $remove: [indexes] }`.
- Option and file field keys are dot paths; `[]` denotes any array index (`sponsors[].memberId`).

### 8.4 Files (D27)

- File fields accept `FileRef = { ref: string } | { url: string }`.
- `{ ref }` resolves through the app's `files.resolve` hook (e.g. an attachment uploaded in chat or the
  tour UI).
- `{ url }` is **disabled by default**; enabling requires `files.allowOrigins` (exact origins; `'*'`
  is a misconfiguration). Only `https:` URLs (or `http:` on `localhost`/`127.0.0.1`) without
  userinfo are fetched, with `credentials: 'omit'`, `redirect: 'error'`, `referrerPolicy:
  'no-referrer'`, `cache: 'no-store'` and a timeout (`files.timeoutMs`, default 30000 ms).
- Size/MIME limits apply to every resolved file (`ref` or `url`); a field limit can only narrow the
  global one. Violations → `refused` `file_rejected`. File values appear in `changes`/results as
  JSON-safe `{ file: { name, size, type } }`.
- The manifest describes file fields as `{ type: 'object', properties: { ref, url } }` with the
  accepted MIME types and size limit.

## 9. React (`@toolmark/react`, React ≥ 18.3)

- `<ToolmarkProvider toolmark>`, `<ToolScope name when>`.
- `useTool(def)`: registered while mounted; latest closure; StrictMode-safe.
- `useFormTool`, `useWizardTool` (§8).
- `useConfirmQueue(queue)` → `{ pending, approve(input?), reject(reason?) }` for inline mode (the
  queue is core's `createConfirmQueue()`, created before React renders), and
  `usePendingConfirmations()` for deferred mode. Hooks are SSR-safe (server snapshots).
- `useAgentActivity()`, `useToolAnchor(tool, param?)`.

## 10. Inertia and DOM

### 10.1 Inertia (`@toolmark/inertia`, `@inertiajs/react` 2–3)

- `inertiaAdapter(form, { submit: { method, url }, elementFor? })` wraps `useForm`.
- `inertiaPages({ router, initialPage, propsKey? })`: a page scope per visit, disposed on navigation
  (D23); registers server-declared tools from the `toolmark` props key (§12.4). Malformed entries
  are skipped with an `error` event, never thrown. A props entry whose `visit.method` is not `get`
  is at least `consequential` (a `destructive` hint is kept, `readOnly` is dropped); a name
  collision is skipped with a `duplicate_name` event, never thrown.
- `navigationTool({ routes, visit })`: routes are `(params) => { url, method }` functions (Wayfinder
  or Ziggy). **GET only**: a route with another method → `refused` `navigation_failed` (mutations
  are server-declared tools). Returns `ok` before the page scope is disposed; a `changed` message
  follows.
- Inertia `<Form>` (uncontrolled) is covered by the DOM adapter.

### 10.2 Declarative HTML (`@toolmark/core/dom`)

- Honours native WebMCP attributes (`toolname`, `tooldescription`, `toolautosubmit`,
  `toolparamdescription`); Toolmark additions use `data-tool-*` (`data-tool`, `-description`,
  `-group`, `-readonly`, `-consequential`, `-destructive`, `-confirm`, `-column`, `-type`, `-param-*`,
  `-options-url`).
- `scanDom({ root, observe: true })` keeps tools in sync via `MutationObserver`. The scanned root must
  hold only app-authored markup: subtrees under `[data-tool-ignore]`, `[contenteditable]`,
  `<iframe>` and `<template>` are never scanned (§14).
- Schema synthesis: text/email/url/tel (format, length, pattern), number/range (type from `step`,
  min/max/multipleOf), date/time/datetime-local (format, min/max), checkbox (boolean / array enum),
  radio/select (enum; option titles listed in the `description`), `select[multiple]` (array, uniqueItems), `fieldset[name]` (nested
  object), file (FileRef, accept, size), `required`, `value` (default). Hidden, password, `cc-*`,
  disabled and `data-tool-ignore` controls are excluded from schemas, values and `changes`, and are
  never written.
- DOM filling sets values through native setters and dispatches `input`/`change`, with the same
  `changes`/`skipped`/undo semantics (dirty = differs from the load snapshot and is not the value the
  agent last set, or touched by a trusted user event; a form `reset` re-snapshots).
- Buttons become action tools (a button that would submit a form is `consequential` unless marked
  otherwise); tables with `data-tool-column` become read-only query tools (`where`, `limit`) with
  `untrustedContent`.
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

- `tm.use(webmcp({ polyfill?, filter?, exposedTo?, modelContext? }))` (`modelContext` is an
  advanced injection point, default `document.modelContext ?? navigator.modelContext`), `polyfill: 'none' | (() => Promise<PolyfillModule>)`
  (default `'none'`; e.g. `polyfill: () => import('@mcp-b/webmcp-polyfill')`, so bundlers never
  resolve the optional peer unless the app opts in).
- Registers visible tools via `document.modelContext.registerTool()` (one `AbortSignal` each), maps
  hints to `readOnlyHint` / `consequentialHint` / `untrustedContentHint`, routes `execute` through
  `tm.call(..., { caller: 'webmcp' })` with inline confirmation; `execute` resolves the `ToolResult`
  object (the browser serializes it). Registration rejections are caught and reported as `error`
  events. Native declarative forms are not re-registered (`tm.info(name).nativeName`).
- Absorbs spec drift (getter location, promise-returning `registerTool`, event naming). The adapter's
  own suites (Chromium) gate releases; the WebMCP WPT suites run in the spec-watch job and are
  informational (§21).

### 11.3 Desktop MCP (`@toolmark/mcp`, D31)

- `toolmark-mcp` is launched by the MCP client (stdio). It is a **dual-era** server built on the
  official SDK (`@modelcontextprotocol/server` 2.1.0): `serveStdio(factory, { legacy: 'serve' })`
  from `@modelcontextprotocol/server/stdio` selects the era from the opening exchange and pins one
  server instance from the factory. Modern clients get stateless `2026-07-28` (`server/discover`
  advertises modern revisions only, per-request `_meta`, `resultType`, cacheable lists); legacy
  clients negotiate via `initialize` (the SDK's supported revisions, latest `2025-11-25`). Toolmark
  writes no era router and no legacy handler.
- It exposes the paired page's tools as MCP tools (inline confirmation in the page) and sends
  list-changed notifications when the manifest changes (the SDK routes them per era). MCP tool
  `name` = the manifest `llmName` (mapped back to the full name on `tools/call`); `annotations`
  always carry explicit `readOnlyHint`/`destructiveHint` (MCP defaults `destructiveHint` to true).
  `untrustedContent` tools say so in their description, and their results are prefixed
  `[untrusted page content]` and carry `_meta: { 'toolmark/untrustedContent': true }`.
- **Pairing.** While no page is paired, `tools/list` returns exactly one read-only tool
  `toolmark_pairing` whose result shows the current one-time pairing code and how to enter it in the
  app; the code is also printed to stderr. The page side,
  `tm.use(mcpPairing({ code?, port?, onStatus? }))` (the code comes from the app's pairing UI;
  without a code the page resumes from its stored session token, and is inert when it has none;
  `onStatus` reports `connecting` / `paired` / `rejected` / `superseded` / `disconnected` /
  `unreachable`), connects to
  `ws://127.0.0.1:<port>`. A correct code is consumed, a fresh code is issued, and the page receives a
  **session token** (kept in `sessionStorage`) that it uses to resume on reconnect and reload without
  a new code. A newer pairing supersedes the old page: its socket is closed with a terminal close
  code that stops its reconnect loop. Once paired, `toolmark_pairing` is removed and `list_changed`
  is sent. The CLI binds to localhost only and rejects upgrades whose `Origin` (missing included) is
  not on the `--allow-origin` list.
- **Deadlines and cancellation.** Each call has a deadline (`--call-timeout`, default `600000` ms, the
  deferred-confirmation expiry). On deadline or on MCP cancellation the CLI sends a protocol `cancel`
  for that call to the page and returns `cancelled`; a late `result` is dropped, and an inline
  confirmation still awaiting the human is withdrawn, so a timed-out call never runs afterwards.

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
- Overlay: CSS variables for theming, no global CSS, RTL, keyboard and screen-reader accessible
  (axe-clean), `prefers-reduced-motion` respected. The overlay is modal (focus trap) only in `do`
  mode; in `show`/`guide` the highlighted field stays operable, and while an inline confirmation is
  pending the overlay releases its trap so the app's confirm UI can be used. Headless mode exposes the
  same engine via hooks.

### 11.6 Testing (`@toolmark/testing`)

- Extends `@playwright/test`: fixture `tools` (`call`, `get`, `list`, `confirm(confirmId, outcome)`,
  `autoConfirm`); matchers `toHaveTools`, `toBeConsequential`, `toBeReadOnly`, `toHaveChanged`.
- Uses an in-page test consumer (no WebMCP dependency).
- `createTestToolmark()` for Vitest (`@toolmark/testing/vitest`): production confirmation modes,
  scripted inline confirmations, call recorder.
- The in-page test hook accepts every caller except `human` and is installed only outside production
  builds.

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
  `tm.anchor(tool, param?)` → `Element | null` (SVG and custom elements included).
  `AnchorSpec` = `{ element?, params?, resolve?(param) }`; `tm.anchor` precedence: `setAnchor`
  override → `params[param]` → `resolve(param)` → `null`.
- `state`: `tm.state(tool)` → `{ values, issues, step? }` without side effects.
- Interaction events `{ tool, param?, kind: 'input' | 'focus' | 'submit', caller: 'human' }` are
  emitted only for user-originated changes.

## 14. Errors and security

- **No code execution**: only registered tools with validated input run. No `eval`/`new Function` in
  any package (lint-enforced in CI).
- **Server is the authority**: client tools and policy are agent UX and safety only.
- **Prompt injection**: page/user content in results is marked `untrustedContent` (propagated to
  WebMCP, MCP and bridge results); descriptions come only from code, server props or app-authored
  markup inside the scanned DOM root (`data-tool-ignore` excludes user HTML, §10.2).
- **Untrusted input paths**: agent input never writes a path the tool's schema does not declare, and
  any path segment `__proto__`, `prototype` or `constructor` is rejected (no prototype pollution).
- **Bridge and MCP pairing security**: §12.2 MUSTs; bounded inbound message size; MCP pairing code +
  session token, origin allow-list (missing `Origin` rejected), localhost binding, page frames
  validated and bound to the paired `clientId` (§11.3).
- **Files**: URL fetching off by default, allow-listed origins, `credentials: 'omit'`, size/type
  limits.
- **Timeouts and cancellation**: every call has a signal; no hanging promises. A tool that ignores its
  aborted signal is abandoned after a grace period and its scope queue slot is released; inline
  confirmations are bounded by the call signal and the confirmation expiry.
- **Development vs production**: misconfiguration throws in development, is rejected with an event in
  production.
- **Privacy**: `state()`, manifests, `fill` `changes`/`skipped`, confirmation payloads and telemetry
  exclude or redact (`'[redacted]'`) password, `autocomplete="cc-*"` and app-declared sensitive
  fields; OTel never records inputs/results by default.

## 15. Internationalization

- `description` targets LLMs (English recommended); `title`, `summary` and change labels are
  user-facing and localized by the app (e.g. Arabic/English).
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
| TypeScript | 7.0.2 | workspace pins 6.0.3 (`typescript-eslint` 8.70.1 peers `<6.1.0`, typedoc 0.28.20 caps at 6.0.x); 7.0.2 only in the CI types check (§23) |
| tsdown | 0.23.0 | ESM + `.d.ts` |
| Vitest | 5.0.1 | unit + browser mode |
| @playwright/test | 1.63.0 | e2e + testing package |
| @changesets/cli | 3.0.3 | versioning + provenance |
| typedoc | 0.28.20 | API reference |
| @standard-schema/spec | 1.1.0 | types + Standard JSON Schema |
| zod | 4.6.5 | dev/test |
| react · @inertiajs/react · next | 19.3.0 · 3.7.1 · 16.3.6 | peers: React ≥ 18.3; Inertia 2–3; Next example |
| react-hook-form | 7.88.0 | optional peer |
| @modelcontextprotocol/server · /client | 2.1.0 · 2.1.0 | `@toolmark/mcp` (dual-era via `serveStdio`, verified 2026-09-24) · dev/e2e client |
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
- **Versioning path:** every package starts at `0.0.0`; milestones version in changesets pre mode
  `next` (`-next` tarballs, never published); before the release candidate a `major` changeset for
  all eight packages yields `1.0.0-next.<n>`, and `pre exit` yields `1.0.0`. The eight packages form
  one changesets `fixed` group (one release train, D2).
- **Publishing:** the first publish is an owner bootstrap with a short-lived granular npm token; the
  owner then configures npm trusted publishing (OIDC) for each package and revokes the token. The
  publish job runs on Node 24 in a protected GitHub environment approved only by the owner, with npm
  provenance.
- Every package ships ESM only, `LICENSE`, `README`, `repository` (with `directory`), `homepage`,
  `bugs`, `keywords` and `publishConfig.provenance`, and passes publint and
  `attw --profile esm-only`.

## 18. Testing strategy

- **Unit (Vitest):** registry (scopes, collisions, policy, deferred/inline confirmation, results,
  events, revisions, concurrency, undo), schema resolution, protocol validation, files policy.
- **DOM (Vitest browser mode):** React hooks (StrictMode, disposal, latest closure), RHF, Inertia,
  wizard and DOM adapters setting values, dirty-field skipping, anchors and interaction events.
- **Contract:** protocol v1 schemas against recorded fixtures; MCP conformance for both eras; the
  Laravel reference in the `inertia-laravel` example.
- **E2E (Playwright, Chromium/Firefox/WebKit):** examples via `@toolmark/testing`, tours in all three
  modes, deferred confirmation, multi-tab targeting, navigation mid-conversation. WebMCP on Chromium
  (the WPT suites run informationally in spec-watch).
- **Release evidence (in-repo):** round budget (`examples/react-vite/e2e/round-budget.spec.ts`,
  success criterion 1), same-tools (`e2e/same-tools.spec.ts`, success criterion 2), authored and
  agent-planned tours on Chromium/Firefox/WebKit, and the tarball smoke test
  (`scripts/tarball-smoke.mjs`). Innovation's measured before/after run is post-1.0 (§19).

## 19. Post-1.0 consumer track: Innovation adoption (not a release dependency)

Innovation adopts Toolmark after `1.0.0` is published. It may trial `-next` or release-candidate
tarballs as a courtesy, but no Toolmark milestone, exit check or release gate waits on it. Its plan
and evidence live in the Innovation repo with its own Spec Kit flow.

0. **Baseline first:** before any change to Innovation's assistant Entry Mode code, record the
   current snapshot-and-script flow — 10 runs each of the simple-form task and the wizard task,
   recording rounds, wall time, input tokens and success rate — in the Innovation repo.
1. Put `browser_script` behind a config flag defaulting to off (independent security fix).
2. Depend on the published `@toolmark/*` `^1.0.0` from npm.
3. `SimpleChallengeForm`: `useFormTool(rhfAdapter(form), …)` with a global `zod-to-json-schema`
   converter; localized fields via an app-side adapter; lookups via async `options`.
4. Advanced wizard: `useWizardTool` over `ChallengeForm`'s `formData`/`setFormData`.
5. Chat popup: `bridge({ transport: echoTransport(…) })`, manifest with entry-mode messages, deferred
   confirmation card (existing options-bubble pattern).
6. `AiAssistant` module: `PageCallTool`/`PageDescribeTool`, protocol-v1 `BrowserBridge` with the
   §12.2 security rules (adapted from §12.5). Snapshot stays as fallback for pages without tools.
7. Measure after on the same tasks as the baseline; results stay in the Innovation repo and may be
   linked from the Toolmark docs as a case study.
8. Idea and project create/edit forms; then delete the snapshot scraper and the prompt's filling
   recipes. Other pages migrate later (Innovation's scope).

## 20. Build milestones (internal, all ship in `1.0`)

Each milestone ends with `-next` versioned tarballs that pass the in-repo tarball smoke test
(`scripts/tarball-smoke.mjs`: installs the packed tarballs into a fresh temp project outside the
workspace, imports and type-checks every public entry, runs every `bin`); nothing is published to
npm before M5. No exit check depends on another repository.

| Milestone | Scope | Exit check |
| --- | --- | --- |
| M1 · Core | §5–§7, protocol v1, bridge + all transports, React (`useTool`, `useFormTool`, confirm hooks), RHF + Inertia adapters, testing basics | `round-budget.spec.ts` › `simple_form_within_3_rounds` green; CI green; tarball smoke passes |
| M2 · Forms complete | wizard, async options, arrays, files, undo, DOM adapter incl. Inertia `<Form>`, navigation, props-declared tools | `round-budget.spec.ts` › `wizard_within_5_rounds` green; tarball smoke passes |
| M3 · Reach | WebMCP (experimental), `@toolmark/mcp`, OTel, tour hooks | One example tool declaration driven by a WebMCP agent (polyfill), a desktop MCP client (SDK client via `toolmark-mcp`) and the Playwright fixture (`e2e/reach.spec.ts`); tarball smoke passes (incl. `toolmark-mcp` bin) |
| M4 · Tours & tooling | `@toolmark/tour`, lint + TypeSafe judge, docs site, examples incl. Next.js | Authored and agent-planned tours e2e green in `examples/react-vite` on Chromium/Firefox/WebKit (axe-clean); an authored tour runs in `examples/inertia-laravel`; `same-tools.spec.ts` green; the Laravel and Next.js example suites green; `pnpm docs:build` passes; `toolmark lint` exits 0 on every example; tarball smoke passes |
| M5 · Release | §21 gates, security review, publish `1.0` | All gates green; publish is owner-confirmed |

## 21. Release gates (definition of done for `1.0`)

- All unit, DOM, contract and E2E suites green on the CI matrix: Node 22/24; React 18.3/19 ×
  Inertia 2/3 **excluding React 18.3 × Inertia 3** (Inertia 3 requires React 19); zod 4 everywhere
  plus a zod 3 axis that runs only the converter-specific tests; Chromium/Firefox/WebKit (WebMCP on
  Chromium). The Laravel and Next.js examples run on Chromium.
- Per-package bundle budgets enforced in CI; `@toolmark/core` has zero runtime dependencies (budgets
  set from the first measured build).
- Every public export documented (TypeDoc `notDocumented` is an error from M5; TSDoc is written with
  each export from M1); API reference generated; guides for React, Inertia, Next.js, Laravel
  reference, WebMCP, MCP, tours.
- Security review against §14 completed and findings resolved.
- Every package meets the §17 metadata rules (publint, `attw --profile esm-only`).
- Releases via changesets with npm provenance through the §17 publishing path; changelog and
  deprecation policy published (docs site deployed once the repo is public).
- **In-repo release-candidate evidence:** on the release-candidate tarballs, the tarball smoke test
  passes and the round-budget e2e (`docs/release/round-budget.md`, regenerated) meets success
  criterion 1; `same-tools.spec.ts` and the tours e2e are green. The round-budget, same-tools and
  tours e2e run against the built release-candidate packages (`TOOLMARK_DIST=1` disables the
  `@toolmark/source` condition in `examples/react-vite`).
- WebMCP WPT suites are informational (spec-watch), not a gate; the adapter's own WebMCP suites on
  Chromium gate.
- Post-release: a weekly **spec-watch** CI job runs the WebMCP WPT suites and checks Chrome's
  implementation status; drift ships as patch/minor releases of the experimental adapter.

## 22. Owner actions outside the design

- Reserve the `toolmark` npm org (account 2FA).
- Confirm code ownership (employment IP terms) before the first public commit.
- Make the repository public; enable Pages (GitHub Actions source), private vulnerability reporting,
  "Allow GitHub Actions to create and approve pull requests" and branch protection on `main`.
- Create the protected GitHub environment `npm-release` (owner as the only reviewer), run the
  first-publish bootstrap with a short-lived granular token, configure trusted publishing for each of
  the eight packages, and revoke the token (§17).
- GitHub Actions budget for the private-repo CI matrix (or self-hosted runners) until the repo is
  public.
- Set the repository variable `TOOLMARK_PUBLISH_ENABLED=true` only after `npm-release` exists with
  the owner as the only reviewer (the publish job is skipped without it); enable Dependabot alerts
  and secret scanning with push protection; after trusted publishing is configured, optionally set
  each package to "Require two-factor authentication and disallow tokens".

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
| Tool **`origin`** field (`'code' \| 'native-form' \| 'dom' \| 'server'`), not in the manifest. | M2 rulings, T1; M3 T3 |
| `inertiaPages` (with props-declared tools and navigation) ships in **M2**; M1 ships `inertiaAdapter`. | M1 rulings; M2 T8 |
| **Lint reads manifests, not source** (`--manifest`, `--url`). | M4 rulings, T3 |
| Dev-only **tool budget**: `ToolmarkOptions.budget` (default 40) emits `tool_budget_exceeded` in `dev` only. | M1 constraints, T4 |
| **FormAdapter** members are `getValues`, `setValues(values, { source })`, `dirtyPaths()`, `submit()`, `fields()`, optional `onUserInteraction` (§8.1 amended; `dirtyFields`/`validate?`/`reset` dropped). | M1 T6; M3 T2 |
| `tm.manifest` has no `scope` option and `tm.scope` has no `parent` option; nesting is via `scope.scope()` (§5 amended). | M1 T4 |
| **MCP era routing uses the SDK**: `serveStdio(factory, { legacy: 'serve' })` from `@modelcontextprotocol/server/stdio` (2.1.0, verified) selects the era; Toolmark writes no era router or legacy handler; `server/discover` advertises only `2026-07-28`, legacy clients negotiate via `initialize` (D31, §11.3 amended; supersedes the earlier hand-written router). | M3 rulings, T4 |
| **Node floor `>=22.12`** (global `WebSocket`); CI matrix Node 22.x and 24.x. | Overview constraints; M1 T1; M5 constraints |
| **Tarball hand-off**: each milestone packs `-next` versioned tarballs (`pnpm -r --filter "./packages/*" pack --pack-destination "$PWD/dist-tarballs"`) and verifies them with `scripts/tarball-smoke.mjs` (created in M1 T16); nothing is published before M5; handing tarballs to any consumer is an optional courtesy, not a gate (header, D32, §19, §20 amended; supersedes "Tarball consumption"). | Overview; final lane of M1–M4; M5 T7 |
| **Confirm rule**: `missing_confirm_handler` only when no allowed caller has a confirmation path; inline callers without a handler don't see the tool (§7, D7 amended). | M1 constraints, T4, T5 |
| **Release independence (R1)**: `1.0` depends on no consumer repo. SC1 is proven by the round-budget e2e (scripted agent, no LLM; round = one agent turn issuing ≥ 1 tool call), SC2 by `same-tools.spec.ts`, packaging by the tarball smoke test, tours by authored + agent-planned e2e on three browsers. Innovation adoption, its baseline and before/after measurement are a post-1.0 consumer track (header, §1, D3, D32, §15, §18–§21 amended). | Overview; M1 T15–T16; M2 T10; M3 T7; M4 T5, T8; M5 T7b |
| **MCP pairing (R3)**: unpaired, the server lists only `toolmark_pairing` (result shows the code; code also on stderr); a correct code is consumed and re-issued and the page gets a session token for resume/reload; a newer pairing supersedes the old page with a terminal close code (no reconnect loop); call deadline (`--call-timeout`, default `600000`) or MCP cancellation sends protocol `cancel` to the page. `mcpPairing({ code?, port?, onStatus? })` (§11.3, §14 amended; see "M3 pass-2 API additions"). | M3 T4, T5 |
| **MCP tool mapping**: MCP `name` = `llmName`; annotations always carry explicit `readOnlyHint`/`destructiveHint`; `untrustedContent` propagates as description note + result prefix + `_meta['toolmark/untrustedContent']` (§11.3, §14 amended). | M3 T4 |
| **Versioning and publishing (R4)**: packages start at `0.0.0`; pre mode `next` for milestones; a `major` changeset for all 8 before the RC → `1.0.0`; one `fixed` group; owner bootstrap publish with a short-lived granular token, then trusted publishing (OIDC) per package and token revoked; publish job on Node 24 behind the owner-approved `npm-release` environment (§17, §21, §22 amended). | M1 T1, T16; M3 T1; M4 T0; M5 T7a–T7c |
| **Doc comments (R5)**: every task that adds a public export writes its TSDoc in the same task (from M1); TypeDoc runs non-strict (`notDocumented` off) through M4; M5 turns `notDocumented` on as an error after a gap-fill task (§21 amended). | Overview constraints; M4 T7; M5 T3 |
| **CI matrix (R6)**: React 18.3 × Inertia 3 excluded (Inertia 3 requires React 19); the zod 3 axis runs only the converter-specific tests; installed `zod` stays 4.x elsewhere (§21 amended). | M1 T16; M5 T1 |
| **Root scripts (R7)**: root `build`/`typecheck`/`lint` cover `packages/*` only; examples run their own scripts in dedicated CI jobs; ESLint ignores examples' build output (`.next/`, `vendor/`, `public/build/`, `dist/`). | Overview constraints; M1 T1; M4 T0 |
| **Package metadata (R8)**: every package has LICENSE, README, `repository` (with `directory`), `homepage`, `bugs`, `keywords`, `publishConfig.provenance`, and passes publint + `attw --profile esm-only` (§17, §21 amended). | M5 T2 (metadata task) |
| **Currency (R9, 2026-09-24)**: vite 8.3.0 → 8.3.1; everything else current. Workspace TypeScript stays 6.0.3 (typescript-eslint 8.70.1 peers `<6.1.0`, typedoc 0.28.20 caps at 6.0.x); TS 7.0.2 only in the CI types check and the tarball smoke test. | Overview table |
| **`ctx.confirm`** takes `{ summary, changes? }`: `human` → approved; inline → awaits the handler; deferred or no handler → `{ approved: false, reason: 'confirmation_unavailable' }` + dev event `ctx_confirm_unavailable`. **`ctx.registerUndo(restore)`** stores a restorer under `callId` for `tm.undo` (§5 amended). | M1 T2, T5 |
| **Confirm modes**: only `inapp`/`test` modes are configurable; `webmcp`, `mcp`, `tour` are always inline (`invalid_confirm_mode` otherwise), so they never see `needs_confirmation`; `createTestToolmark` keeps production modes with a default-approve inline handler. A `confirmId` is single-use (§7, §11.6 amended). | M1 T4, T5, T14 |
| **Policy semantics**: `policy[c].allow` replaces caller `c`'s default hint classes; unlisted callers keep defaults; `human` is fixed; `policy[c].tools` allow/deny by full name or `prefix.*` (deny wins); no-caller `manifest()`/`describe()` is unfiltered. Default exposure also includes `test` and `human` for consequential/destructive (§7 amended). | M1 constraints, T4 |
| **Plan signatures supersede spec text**: `useConfirmQueue(queue)` (no `confirm`), `inertiaAdapter(form, { submit, elementFor? })`, `inertiaPages({ router, initialPage, propsKey? })`, `mcpPairing({ code?, port?, onStatus? })`, `webmcp({ polyfill?, filter?, exposedTo?, modelContext? })` (§9, §10.1, §11.2, §11.3 amended). | M1 T11, T13; M2 T8; M3 T3, T5 |
| **WebMCP polyfill is an app-supplied loader** (`polyfill: 'none' \| () => import('@mcp-b/webmcp-polyfill')`, default `'none'`) so bundlers never resolve the optional peer implicitly; `execute` resolves the result object; WPT suites are informational, the adapter's own Chromium suites gate (§11.2, §18, §21 amended). | M3 T3, T7; M5 T6 |
| **`tm.info(name)`** → `{ origin, nativeName?, sensitivePaths }` (not in the manifest; `sensitivePaths` added in M3, default `[]`); native declarative forms set `nativeName` so the WebMCP adapter skips tools the browser already exposes (§5, §11.2 amended). | M2 T1, T6; M3 T1, T3 |
| **DOM rules**: dirty = differs from the load snapshot and not the agent-set value, or touched by a trusted user event (`reset` re-snapshots); subtrees under `data-tool-ignore`/`contenteditable`/`iframe`/`template` are not scanned; hidden/password/`cc-*`/disabled controls are excluded; a submitting button is consequential (§10.2, §14 amended). | M2 T5, T6 |
| **Navigation is GET-only**; mutations are server-declared tools; malformed props entries are skipped with an `error` event (§10.1 amended). | M2 T8 |
| **Wizard submit validates every step** before creating a confirmation (§8.2 amended). | M2 T4 |
| **Anchors return `Element \| null`** (SVG, custom elements) (§13 amended). | M3 T1 |
| **Tour overlay modality**: modal (focus trap) only in `do` mode; `show`/`guide` keep the anchor operable; the trap and backdrop are released while an inline confirmation is pending; axe-clean (§11.5 amended). | M4 T2, T8 |
| **Testing entries**: `@toolmark/testing/vitest` exports `createTestToolmark` without importing Playwright (the `@playwright/test` peer is optional); the test hook rejects caller `human` and is installed only outside production builds (§4, §11.6 amended). | M1 T1, T14, T15 |
| **Source condition is `@toolmark/source`** (package-unique, internal, outside semver) so consumers that set a generic `source` condition never compile Toolmark's `.ts`; packages keep shipping `src` so the condition's targets exist. | Overview constraints; M1 T1 |
| **Security hardening from the plan audit**: untrusted field paths (`__proto__`/`prototype`/`constructor`, undeclared paths) rejected; sensitive-field redaction in fill results and confirmation payloads; abort grace period releases scope queues; bounded inbound message size; file URL fetch restricted to `https:` without userinfo, `redirect: 'error'`, no referrer, timeout; limits apply to `ref` files too (§8.4, §14 amended). | M1 T5, T6, T8; M2 T3 |
| **Release gating (M5)**: publish job runs only from environment `npm-release` with repo variable `TOOLMARK_PUBLISH_ENABLED`, refuses pre mode and prerelease versions (`check-release-versions --stable`); size budgets use gzip; security review has 14 checklist items checked by `check-security-review.mjs`; RC evidence runs on built `dist` via `TOOLMARK_DIST=1` (one switch in one example config, not a permanent CI job) (§21, §22 amended). | M5 T2, T4, T7a, T7b |
| **Server-declared mutations confirm**: props tools with a non-GET visit are at least `consequential`; collisions are events, never thrown; visits settle through per-visit callbacks (`finish` alone is an `error`) using the `visit-outcome` mapping that M1 creates for `inertiaAdapter` and M2's props tools reuse (§10.1 amended). | M1 T13; M2 T8 |
| **Policy options**: `policy[c].allow` is optional (omitted → defaults kept, `tools` still filters); `policy.human` or an unknown hint class → `invalid_policy` (dev throw / prod event) (§7). | M1 T4 |
| **Inertia adapter outcomes**: `inertiaAdapter.submit` settles on per-visit callbacks (`onSuccess` → `ok`; `onError` → `invalid`; `onHttpException`/`onInvalid` → `error` "Request failed"; `onNetworkError`/`onException` → `error` "Network error"; cancelled/interrupted → `cancelled`; a finish with no outcome → `error` "Visit did not complete") and submits the adapter's latest values via `form.transform`. The mapping lives in `@toolmark/inertia`'s internal `visit-outcome.ts` (M1); `InertiaVisitCallbacks` carries both the v2 and v3 callback names (§10.1). | M1 T13; M2 T8 |
| **WebSocket transport hooks**: `websocketTransport` takes `terminalCloseCodes` (close codes that stop reconnecting), `onOpen(socket, { receive(timeoutMs?) })` (frames during `onOpen` go to `receive`, never the bridge) and `onStatus` (`connecting` / `open` / `closed` with `closeCode` and `firstConnectFailed` / `stopped`); all land in M1, and MCP pairing only consumes them (§11.1, §11.3). | M1 T9; M3 T5 |
| **M1 pass-2 API**: `FormToolOptions.sensitive?: string[]` and `FieldInfo.sensitive?: boolean` (with `FieldInfo.element?: Element \| null`) drive redaction everywhere; `ToolmarkOptions.abortGraceMs` (default 5000); `BridgeOptions.maxMessageBytes` (default 1048576); an aborted or expired inline `ctx.confirm` resolves `{ approved: false, reason: 'signal' \| 'expired' }` (§5, §14). | M1 T4–T6, T8 |
| **M2 pass-2 contract rulings**: the fill manifest schema inserts array-op branches and `fileFieldSchema` after `stripRequired`; `fromJsonSchema` implements Standard JSON Schema (draft 2020-12 only); a `{ ref }` with no `files.resolve` → `refused` `file_rejected` + dev event `files_not_configured` (M1 threw a `ToolmarkError`); DOM select/radio titles are `enum` + `"Options: <value> = <label>; …"` in `description` (no custom keyword); wizard fill returns `ok({ changes, skipped })` / `invalid` with `<step>.<path>` paths; `resetCurrent(values)` for parent-state wizards without a step adapter; stepwise wizards `refresh()` their step fill tool; disabled/hidden DOM buttons → `refused` `not_allowed`; table `limit` above 500 is clamped; option/file keys use `[]` for any array index (§8.2–§8.4, §10.2 amended). | M2 T1–T7 |
| **M3 pass-2 API additions**: `AnchorSpec.resolve`, `ToolDefinition.sensitivePaths` / `tm.info().sensitivePaths`, `mcpPairing({ code?, port?, onStatus? })`, `webmcp({ modelContext? })`, `rhfAdapter(form, { root? })`, `BridgeOptions.caller: 'inapp' \| 'mcp'`; pairing close codes 4400/4401/4408/4409 terminal, 4429/1001 transient; unpaired grace 2000 ms; `toolmark_pairing` callable any time; `--port 0` allowed; a page reload fails pending MCP calls with an unknown-outcome `error` (§5, §11.3, §13 amended). | M3 T1, T2, T3, T5 |
| **M4 pass-2 rulings**: the tour `confirming` status is engine-driven (the whole in-flight `do` call of a consequential/destructive tool); TypeSafe judge findings are `warn` unless `strictHints`; `@toolmark/judge-typesafe` exports `"."` with a `node` condition only; `toolmark lint --judge` executes the named module (documented) (§4, §11.5). | M4 T1, T3, T4 |
| **Pass-3 consistency rulings**: the round-budget e2e runs on Chromium only (its report is one row per task; other example specs run on three browsers); the zod 3 axis runs tests whose names contain `zod3` (`vitest run --project core-node -t zod3`); the docs deploy workflow is M4's `docs-deploy.yml` (M5 hardens it, never adds a second one); TypeDoc strict validation becomes the default in M5 (`typedoc.config.mjs`) (§18, §21). | M1 T3; M4 T7, T8; M5 T1, T3, T3b, T7b |
| **Pass-4 pre-execution rulings**: core keeps an internal (unexported, outside semver) `emitEvent(tm, type, payload)` in `registry.ts` with the same `onError`/listener-isolation rules, used by the wizard, DOM and interaction emitters; ESLint type-checks every package through its `tsconfig.test.json`; Playwright runs that import `@toolmark/testing` build it first; the Laravel example runs PHP/Composer via `scripts/php.sh` (host PHP, else Docker `php:8.4-cli` + `composer:2`), CI keeps `setup-php` (§21). | M1 T1, T15–T16; M2 T1, T3, T10; M3 T1, T2, T7; M4 T0, T5 |
| **M1 execution rulings (2026-09-25)**: `missing_confirm_handler` only when ≥ 1 non-human caller is allowed and none has a confirmation path; `llmName` collisions are `duplicate_name`; new code `invalid_scope` (scope object from another registry); pending confirmations capped at 100 (oldest expire); a deferred/inline form submit approved after the form values changed → `refused` `stale` ("Form changed since confirmation was requested"); fills write the schema-validated value and fail closed with "Undeclared field" when a nested value cannot be matched to a declared schema node (`$ref`/`allOf`/`anyOf`/`oneOf`/`additionalProperties` resolved; open `{}` nodes keep values after the forbidden-key scan); `FormAdapter.dirtyPaths()` returns leaf paths only; a tool with neither `input` nor `jsonSchema` accepts only `undefined` or `{}`; protocol `ok.data` and `FieldChange.before/after` may be absent ("no value"); bridge `caller` is validated at runtime (`'inapp'` in M1, never `'human'`); bridge results are serialized with JSON semantics (`toJSON`, Date → ISO string); `@toolmark/inertia` type-checks with `moduleResolution: Bundler` (Inertia's `.d.ts` use extensionless re-exports); the example port is `TOOLMARK_EXAMPLE_PORT` (default 5173); `node --test "scripts/*.test.mjs"`; `onPendingConsumed` is an `@internal` core export for React. | M1 execution ledger |
