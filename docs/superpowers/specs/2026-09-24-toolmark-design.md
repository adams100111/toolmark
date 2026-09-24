# Toolmark — design spec

- **Date:** 2026-09-24
- **Status:** agreed design, pending written-spec review
- **Owner:** adams100111
- **First consumer:** Innovation (`dits-sa/innovation`), its AI assistant's form-filling "Entry Mode"

## 1. Purpose

Toolmark is a registry-first TypeScript toolkit that lets a web app **declare typed, safe actions
once** and serve them to every kind of agent:

- the app's **own in-app assistant** (server-side or in-page LLM),
- **browser agents** over WebMCP (`document.modelContext`),
- **guided tours** (later),
- **test harnesses** (Playwright).

It replaces scrape-the-DOM-and-run-generated-script automation with named tools, validated inputs
and typed results. Its promise is **stability**: apps code against Toolmark's API while the WebMCP
spec (a Community Group draft in origin trial) keeps changing underneath.

### Success criteria

1. Innovation's `SimpleChallengeForm` can be filled by its assistant in **≤ 3 LLM rounds**, measured
   against the current snapshot-and-script flow (rounds, wall time, input tokens, success rate).
2. The same tool declarations work unchanged for a WebMCP browser agent and in Playwright tests.
3. A second project adopts Toolmark without changes to `core`.
4. No Innovation-specific code exists in any Toolmark package.

### Non-goals

- A WebMCP polyfill (use native, or MCP-B's `@mcp-b/webmcp-polyfill` as an optional peer).
- Any UI in `core`, `react` or `inertia` (confirmation is headless; tours are a later package).
- Any AI model in a runtime package.
- A server/PHP package (the server side is a documented protocol, §9).
- React Native or other non-browser platforms.

## 2. Decisions

| ID  | Decision                                                                                                                 | Rationale                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| D1  | **Registry-first core.** Tools live in Toolmark's registry; WebMCP, the in-app bridge, tours and tests are consumers.     | Gains don't depend on browser support; spec churn stays in one adapter.                      |
| D2  | pnpm monorepo, **JS/TS only**: `core`, `react`, `inertia`, `testing`.                                                    | Reuse and one release train. Packagist can't publish from a subfolder; no 2nd Laravel user.   |
| D3  | Innovation is the first consumer, linked locally. No Innovation-specific code in packages; app specifics use extension points. | General-purpose, proven on real use.                                                   |
| D4  | No custom polyfill; native WebMCP or MCP-B's polyfill as optional peer.                                                  | MCP-B already tracks the spec and its WPT suite.                                             |
| D5  | Types via **Standard Schema v1**; manifest JSON Schema via **Standard JSON Schema**, with fallbacks (D14).               | Library-agnostic (zod, valibot, arktype).                                                    |
| D6  | Every call returns a typed `ToolResult`; expected outcomes never throw.                                                  | Agents need structured outcomes.                                                             |
| D7  | Policy lives in the registry; consequential/destructive tools require a confirm handler.                                 | Safety enforced in code, not prompt text.                                                    |
| D8  | Tour hooks (anchors, state, human interaction events) in core; tour UI is a later package.                              | Cheap now, hard to retrofit.                                                                 |
| D9  | No AI model in runtime packages; TypeSafe appears only as an optional lint judge (Phase 2).                             | Stability, no lock-in, no keys in the browser.                                               |
| D10 | Name **Toolmark**, npm scope `@toolmark/*`.                                                                              | Free on npm as of 2026-09-24 (org not yet reserved).                                         |
| D11 | Phase 0 form adapters: **react-hook-form** (primary) and Inertia `useForm`. Inertia `<Form>` in Phase 1 via the DOM path. | Innovation: 43 RHF files, 51 `zodResolver`, 2 Inertia `useForm`, 0 Inertia `<Form>`; `<Form>` is uncontrolled. |
| D12 | LLM exposure default: a single `page_call(tool, input)` tool; per-tool mode optional.                                    | Stable cached tool prefix; no name aliasing; registry validates anyway.                      |
| D13 | Confirmation is headless: policy in core + React `useConfirmQueue()`. No visual component.                               | Apps have their own design systems; avoids a UI maintenance surface.                         |
| D14 | Global `jsonSchema` converter option; per-tool override.                                                                 | zod 3 apps plug in `zod-to-json-schema` once.                                                |
| D15 | Hosted at `github.com/adams100111/toolmark`, private through Phase 0, public at `0.1.0` under MIT.                       | npm scope independent of GitHub owner; transferable later.                                   |

## 3. Architecture

```
producers (declare tools)                    consumers (use tools)
useTool / useFormTool   ─┐                ┌─►  webmcp()     document.modelContext
inertia forms & routes  ─┼─►  REGISTRY  ──┼─►  bridge()     in-app agent (server or page)
data-tool-* scanner     ─┤    scopes      ├─►  testing      Playwright fixtures
server-declared (props) ─┘    policy      └─►  tour (later) show / guide / do
                              events · manifest() · call()
```

Producers add tools to scopes. The registry validates, applies policy and emits events. Consumers
read `manifest()`, invoke `call()` and subscribe to changes. Consumers never know about each other.

### Packages

| Package              | Phase | Contents                                                                                              |
| -------------------- | ----- | ----------------------------------------------------------------------------------------------------- |
| `@toolmark/core`     | 0     | registry, tool model, validation, results, policy, scopes, events, `manifest()`/`call()`; subpaths `/bridge`, `/bridge/echo`, `/protocol` (0), `/webmcp`, `/dom` (1) |
| `@toolmark/react`    | 0     | provider, `useTool`, `useFormTool`, `<ToolScope>`, `useConfirmQueue`, `useAgentActivity`, `useToolAnchor`; subpath `/rhf` |
| `@toolmark/inertia`  | 0     | `inertiaAdapter` (`useForm`), `inertiaPages` scopes, `navigationTool`, props-declared tools            |
| `@toolmark/testing`  | 0     | Playwright fixtures and matchers; `createTestToolmark()` for Vitest                                    |
| `@toolmark/lint`     | 2     | CLI checks; pluggable judges                                                                          |
| `@toolmark/judge-typesafe` | 2 | optional TypeSafe (Jev) judge, dev/CI only                                                          |
| `@toolmark/tour`     | 3     | show / guide / do tours over the registry                                                             |

## 4. Tool model and registry (`@toolmark/core`)

```ts
interface ToolDefinition<I = unknown, O = unknown> {
  name: string                 // local name; full name = scope path + "." + name
  title?: string
  description: string          // must say when to use the tool
  input?: StandardSchemaV1<I>
  output?: StandardSchemaV1<O>
  jsonSchema?: JsonSchema      // per-tool override (D14)
  hints?: { readOnly?: boolean; consequential?: boolean; destructive?: boolean; untrustedContent?: boolean }
  anchors?: AnchorSpec         // §11
  state?: () => ToolState<I>   // §11
  run(input: I, ctx: ToolContext): ToolResult<O> | Promise<ToolResult<O>>
}

interface ToolContext {
  signal: AbortSignal
  caller: 'inapp' | 'webmcp' | 'test' | 'tour' | 'human'
  confirm(req: ConfirmRequest): Promise<ConfirmOutcome>
}
```

Registry API:

```ts
const tm = createToolmark({ confirm, policy, jsonSchema, onError })
tm.register(tool, { scope?, signal? })        // → { name, dispose() }
tm.scope(name, { parent?, when? })            // nested; dispose() removes the subtree
tm.manifest({ caller?, scope? })              // ToolManifest[], JSON-safe, sorted by name
tm.call(name, input, { caller, signal? })     // Promise<ToolResult>, never throws
tm.subscribe(listener)                        // debounced change notification with revision
tm.events.on('call' | 'result' | 'confirm' | 'interaction' | 'change', fn)
tm.use(consumer)                              // → dispose()
tm.anchor(name, param?) / tm.state(name)      // §11
```

Rules:

- **Names** use `A–Z a–z 0–9 _ - .` (MCP tool-name rules), scopes joined with `.`. Manifests also
  carry `llmName` (`.` → `__`) because OpenAI/Anthropic function names disallow dots.
- **Collisions**: a duplicate full name in a live scope throws in development and is rejected with an
  `error` event in production. Never silent replacement.
- **Removal** only via scope disposal, `signal` abort or the registration handle (mirrors WebMCP,
  which has no unregister-by-name).
- `scope.when` hides a scope's tools from `manifest()` and `call()` while false.
- `subscribe` is debounced (one notification per microtask batch) and carries a monotonically
  increasing `rev`.

## 5. Schemas, validation and results

- Input/output types are **Standard Schema v1** (`@standard-schema/spec` ≥ 1.1).
- JSON Schema for the manifest resolves in this order: `tool.jsonSchema` → the schema's Standard JSON
  Schema (`~standard.jsonSchema.input({ target: 'draft-2020-12' })`) → the global `jsonSchema`
  converter → development error / production: tool registered without schema and an `error` event.
- The registry validates input **before** `run`; output validation runs in development only.

```ts
type ToolResult<T> =
  | { status: 'ok'; data: T }
  | { status: 'invalid'; issues: { path: string; message: string }[] }
  | { status: 'refused'; code: string; message: string }
  | { status: 'cancelled'; by: 'operator' | 'signal' | 'policy' }
  | { status: 'error'; message: string }
```

- Helpers: `ok`, `invalid`, `refuse`, `cancelled`.
- An exception thrown by `run` becomes `{ status: 'error' }` with a generic message; the stack goes
  only to `events`/`onError`.
- Consumers serialize for their channel (WebMCP: JSON string today; `outputSchema` when specified).

## 6. Policy and confirmation

| Hint          | Confirm                                  | Default exposure |
| ------------- | ---------------------------------------- | ---------------- |
| readOnly      | never                                    | all callers      |
| (none)        | no                                       | all callers      |
| consequential | always, except caller `human`            | inapp, webmcp    |
| destructive   | always; never auto-submitted             | inapp only       |

- Policy is configurable per caller (`policy: { webmcp: { allow: [...] } }`) and filters both
  `manifest()` and `call()`.
- Registering a consequential or destructive tool without a `confirm` handler fails immediately.
- `confirm(req)` receives `{ tool, title, input, caller, hints, summary, changes? }` and returns
  `{ approved: true, input? } | { approved: false, reason? }`. Edited input is re-validated.
- **Toolmark ships no confirm UI** (D13).
- **Client policy is not an authorization boundary.** The server authorizes every mutation.

## 7. Consumers

### 7.1 WebMCP (`@toolmark/core/webmcp`, Phase 1)

- `tm.use(webmcp({ polyfill: 'auto' | 'none', filter? }))`. `'auto'`: native if present, else
  `@mcp-b/webmcp-polyfill` if installed, else inactive.
- Registers each visible tool via `document.modelContext.registerTool()` with one `AbortSignal` per
  registration; maps hints to `readOnlyHint` / `consequentialHint` / `untrustedContentHint`; `execute`
  routes through `tm.call(..., { caller: 'webmcp' })`.
- Absorbs spec drift (getter location, promise-returning `registerTool`, event naming). Behaviour is
  pinned by tests against the WebMCP draft of 2026-09-17 and re-verified at each release.

### 7.2 In-app bridge (`@toolmark/core/bridge`, Phase 0)

- `tm.use(bridge({ transport }))` speaks protocol v1 (§9) over a transport.
- Transports: `echoTransport({ channel, resultUrl })` (Laravel Echo in, HTTP POST out) in Phase 0;
  `websocket()`, `postMessage()`, `inPage()` later.
- Sends `manifest` on attach and `changed` on every registry revision; answers every `call` exactly
  once; honours `cancel` by aborting the call's signal.

## 8. Adapters

### 8.1 React (`@toolmark/react`, React ≥ 18.3)

- `<ToolmarkProvider toolmark>`, `<ToolScope name when>`.
- `useTool(def)` registers while mounted, always uses the latest closure, and is StrictMode-safe
  (double mount does not produce duplicate-name errors).
- `useFormTool(adapter, { name, description, input, steps? })` registers `<name>.fill` (safe,
  partial input, sets values through the adapter) and `<name>.submit` (consequential).
- `FormAdapter<V>`: `getValues`, `setValues(partial)`, `validate?`, `submit`, `fields()`.
- `rhfAdapter(form)` from `@toolmark/react/rhf` (react-hook-form ≥ 7), Phase 0 primary adapter.
- `useConfirmQueue()` → `{ confirm, pending, approve(input?), reject(reason?) }`.
- `useAgentActivity()` (Phase 0); `useToolAnchor(tool, param?)` (Phase 1, with the tour hooks in §11).

### 8.2 Inertia (`@toolmark/inertia`, `@inertiajs/react` 2–3)

- `inertiaAdapter(form)` wraps `useForm` (`setData`, `errors`, submit); server validation errors map
  to `invalid` issues.
- `inertiaPages({ router })`: a page scope per visit, disposed on navigation; reads server-declared
  tools from a documented props shape (§9.3).
- `navigationTool({ routes, visit })`: routes are any `(params) => { url, method }` functions
  (Wayfinder or Ziggy).
- Inertia `<Form>` is uncontrolled (values from the DOM; its ref exposes `submit`/`reset`/`setError`
  only) and is supported in Phase 1 through the DOM path (§8.3).

### 8.3 Declarative HTML (`@toolmark/core/dom`, Phase 1)

- Native WebMCP attributes (`toolname`, `tooldescription`, `toolautosubmit`, `toolparamdescription`)
  are honoured as-is; Toolmark additions use `data-tool-*` (`data-tool`, `-description`, `-group`,
  `-readonly`, `-consequential`, `-destructive`, `-confirm`, `-column`, `-type`, `-param-*`).
- `tm.use(scanDom({ root, observe: true }))` keeps tools in sync via `MutationObserver`.
- Schema synthesis covers text/email/url/tel (format, length, pattern), number/range
  (type from `step`, min/max/multipleOf), date/time/datetime-local (format, min/max), checkbox
  (boolean / array enum), radio/select (enum with titles), `select[multiple]` (array, uniqueItems),
  `fieldset[name]` (nested object), `required`, `value` (default).
- Buttons become no-argument action tools; tables with `data-tool-column` become read-only query
  tools (`where`, `limit`) with `untrustedContent` set.

## 9. Bridge protocol v1 and server reference

Toolmark ships **no server package**. Any backend implements this protocol.

### 9.1 Messages

```jsonc
{ "protocol": 1, "type": "manifest", "rev": 7, "tools": [ToolManifest] }            // page → agent
{ "protocol": 1, "type": "changed", "rev": 8 }                                      // page → agent
{ "protocol": 1, "type": "call", "id": "c1", "tool": "challenges.create.fill", "input": {} } // agent → page
{ "protocol": 1, "type": "cancel", "id": "c1" }                                     // agent → page
{ "protocol": 1, "type": "result", "id": "c1", "result": ToolResult }               // page → agent
```

`ToolManifest = { name, llmName, title?, description, inputSchema, hints }`.

JSON Schemas for all messages ship in `@toolmark/core/protocol`.

### 9.2 Rules

- `id` is unique per conversation; the page answers each `call` exactly once.
- The server maps a missing result after its timeout to `timeout` (a server-side status, not part of
  `ToolResult`).
- An unknown `protocol` value is answered with `{ status: 'error', message: 'unsupported protocol' }`.
- Recommended LLM exposure (D12): one `page_call(tool, input)` tool whose description renders the
  current manifest; alternative: one LLM tool per manifest entry using `llmName`.

### 9.3 Server-declared tools

A documented Inertia props key (`toolmark`) carrying `ToolManifest`-shaped entries plus an execution
descriptor (`{ visit: { url, method } }`). The server filters entries with its own authorization
before rendering. `@toolmark/inertia` registers them in the page scope.

### 9.4 Laravel reference

The docs ship a Laravel reference (a `PageCallTool`, a protocol-v1 `BrowserBridge` using Broadcasting
out / HTTP POST back / cache hand-off with a blocking Redis pop when available, and a props builder)
to copy into apps. If a second Laravel project needs it, it is extracted to its **own** repo
(`toolmark-laravel`), never a monorepo folder.

## 10. Testing package (`@toolmark/testing`)

- Extends `@playwright/test`: fixture `tools` with `call`, `get`, `list`, `autoConfirm(bool)`;
  matchers `toHaveTools`, `toBeConsequential`, `toBeReadOnly`.
- Talks to the page registry through an in-page test consumer (no WebMCP dependency).
- `createTestToolmark()` for Vitest: scripted confirm handler, call recorder.

## 11. Tour hooks (core)

- `anchors`: form adapters supply field elements automatically; `useToolAnchor` covers custom widgets.
  `tm.anchor(tool, param?)` returns `HTMLElement | null`.
- `state`: `tm.state(tool)` returns `{ values, issues, step? }` without side effects.
- Interaction events: `{ tool, param?, kind: 'input' | 'focus' | 'submit', caller: 'human' }`, emitted
  by form adapters for user-originated changes only (agent-originated changes carry their caller).

## 12. Errors and security

- **No code execution**: consumers can only call registered tools with validated input. No `eval` or
  `new Function` in any package (enforced by lint rule in CI).
- **Server is the authority**: client tools and policy are UX/safety for agents only.
- **Prompt injection**: results carrying page/user content are marked `untrustedContent`; tool
  descriptions come only from code or server props, never from scraped page text.
- **Timeouts and cancellation**: every call has a signal; no hanging promises.
- **Development vs production**: misconfiguration (missing confirm, duplicate names, schema
  conversion failure) throws in development and is rejected with an event in production.
- **Privacy**: `state()` and manifests exclude `type="password"` and `autocomplete="cc-*"` fields by
  default.

## 13. Repository, tooling and stability

```
toolmark/
├─ packages/{core,react,inertia,testing}/
├─ examples/{react-vite,inertia-laravel}/   # runnable in CI
├─ docs/
└─ pnpm-workspace.yaml
```

Latest stable versions checked on npm, 2026-09-24 (re-verify when the plan executes):

| Tool | Version | Note |
| --- | --- | --- |
| pnpm | 12.6.0 | workspace + catalogs |
| TypeScript | 7.0.2 | confirm tsdown/Vitest compatibility before pinning |
| tsdown | 0.23.0 | ESM + `.d.ts` |
| Vitest | 5.0.1 | unit + browser mode |
| @playwright/test | 1.63.0 | e2e + testing package |
| @changesets/cli | 3.0.3 | versioning |
| @standard-schema/spec | 1.1.0 | types + Standard JSON Schema |
| zod | 4.6.5 | dev/test only |
| react · @inertiajs/react | 19.3.0 · 3.7.1 | peers: React ≥ 18.3; Inertia 2–3 |
| react-hook-form | 7.88.0 | optional peer |
| @mcp-b/webmcp-polyfill · webmcp-types | 5.1.0 · 0.1.9 | optional peer · dev types |
| zod-to-json-schema | 3.25.2 | documented converter for zod 3 apps (not a dependency) |

**Stability policy:** `0.x` while WebMCP is in origin trial. Public API = exported types, hooks,
`data-tool-*` attributes and bridge protocol v1. Spec changes are absorbed inside the `webmcp`
adapter. Deprecations warn at least one minor version before removal. `1.0` when WebMCP ships
outside origin trial.

## 14. Testing strategy

- **Unit (Vitest):** registry (scopes, collisions, policy, confirm, results, events, revisions),
  schema resolution order, protocol message validation, serialization.
- **DOM (Vitest browser mode):** React hooks (StrictMode, unmount disposal, latest closure), RHF and
  Inertia adapters setting values through form state, anchors and interaction events.
- **Contract:** protocol v1 JSON Schemas validated against recorded fixtures; the Laravel reference
  tested in the `inertia-laravel` example.
- **E2E (Playwright):** examples exercised through `@toolmark/testing`, including confirm flows.
- **Consumer check:** Innovation's measured before/after run (success criterion 1).

## 15. Innovation adoption (first consumer, app-side work)

1. Put `browser_script` behind a config flag defaulting to off (security fix independent of Toolmark).
2. Depend on the local packages via `link:`.
3. `SimpleChallengeForm`: `useFormTool(rhfAdapter(form), …)` with a global `zod-to-json-schema`
   converter. Innovation's localized-field convention becomes an app-side adapter.
4. The chat popup attaches `bridge(echoTransport(…))` and sends the manifest with entry-mode messages.
5. `AiAssistant` module: add `PageCallTool`, upgrade `BrowserToolBase` into a protocol-v1 bridge
   (adapted from §9.4). Snapshot remains the fallback for pages without tools.
6. Measure before/after on the same task (rounds, time, input tokens, success rate).
7. Roll out to the advanced challenge form, ideas and projects; then delete the snapshot scraper and
   the prompt's filling recipes.

## 16. Phases

| Phase | Scope | Exit criterion |
| --- | --- | --- |
| 0 · Core | §4–§6, bridge + echo transport, protocol v1 + schemas + Laravel reference docs, React (`useTool`, `useFormTool`, `useConfirmQueue`), RHF adapter, Inertia `useForm` adapter, testing basics | Success criterion 1 met and measured |
| 1 · Reach | WebMCP consumer, navigation tool, tour hooks, DOM scanner incl. Inertia `<Form>` | Same tools used by a WebMCP agent and Playwright MCP |
| 2 · Tooling | lint CLI, TypeSafe judge, docs site, examples in CI; publish `0.1.0` publicly | A second project adopts without core changes |
| 3 · Tours | `@toolmark/tour` | A guided flow in Innovation with no hard-coded steps |

## 17. Owner actions outside the design

- Reserve the `toolmark` npm org.
- Confirm code ownership (employment IP terms) before the first public commit.
