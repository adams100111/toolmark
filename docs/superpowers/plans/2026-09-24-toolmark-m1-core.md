# Toolmark M1 — Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `sdd-lanes` to implement this plan lane by lane.
> Plan-lite format: exact contracts, behaviour and tests; no complete implementation code.

**Goal:** A working Toolmark core: workspace, registry with policy/confirmation/forms, bridge
protocol v1 with four transports, React + react-hook-form bindings, the Inertia `useForm` adapter,
the testing package, a runnable example and CI — enough for Innovation's simple challenge form.

**Architecture:** Registry-first (spec §3). `@toolmark/core` owns the tool model, call pipeline,
confirmation, form-tool semantics and the protocol; framework packages are thin bindings over core;
the bridge is a consumer attached with `tm.use()`.

**Tech Stack:** pnpm 12.6.0 workspace, TypeScript 6.0.3, tsdown 0.23.0, Vitest 5.0.1 (node + browser
mode via Playwright), ESLint 10 + typescript-eslint 8.70.1, React 19.3.0, react-hook-form 7.88.0,
@inertiajs/react 3.7.1 (+2.3.28 in tests), changesets 3.0.3.

**Spec:** `docs/superpowers/specs/2026-09-24-toolmark-design.md` §4–§9, §10.1 (`inertiaAdapter`),
§11.1, §11.6, §12, §14, §18. Overview + global constraints:
`docs/superpowers/plans/2026-09-24-toolmark-00-overview.md` (every task inherits them).

## Global constraints (M1 additions to the overview's list)

- `ToolmarkOptions.dev` (boolean, default `false`) selects development behaviour: misconfiguration
  **throws**; otherwise it is rejected and reported as an `error` event (spec §14).
- Default confirmation modes: `inapp: 'deferred'`, `test: 'deferred'`; `webmcp`, `mcp`, `tour`:
  `'inline'`; `human` never confirms.
- Default policy (spec §7): `readOnly` and unhinted tools → all callers; `consequential` → `inapp`,
  `webmcp`, `mcp`, `tour`, `test`, `human`; `destructive` → `inapp`, `test`, `human`.
- Per-scope call queue limit: `32` pending calls; beyond → `refused` code `busy`.
- Bridge remembers the last `1000` answered call ids to drop duplicates.
- Reserved `refused` codes (exact strings): `unknown_tool`, `stale`, `not_allowed`, `busy`,
  `undo_unavailable`, `confirmation_expired`.
- `error` event codes (exact strings): `duplicate_name`, `invalid_name`, `missing_confirm_handler`,
  `schema_conversion_failed`, `tool_threw`, `output_invalid`, `transport_failed`,
  `tool_budget_exceeded`.
- Tool budget (spec D21): `ToolmarkOptions.budget` default `40` visible tools; exceeding it emits
  `tool_budget_exceeded` once per revision, **in `dev` only** (never throws).
- Ids (`clientId`, `callId`, `confirmId`) come from `crypto.randomUUID()`.

## Rulings made while planning

- **TypeScript 6.0.3** for the workspace: `typescript-eslint` 8.70.1 peers `<6.1.0`. CI also checks
  the emitted `.d.ts` with TypeScript 7.0.2 (M5 gate; the CI job is created in Task 16).
- **Confirm queue lives in core** (`createConfirmQueue`) because the inline handler must exist when
  `createToolmark` runs, before React renders; `useConfirmQueue(queue)` only subscribes.
- **Bridge sends a full summary `manifest` on every revision** by default
  (`bridge({ onChange: 'manifest' | 'changed' })`, default `'manifest'`): the protocol has no
  agent→page manifest request, so a bare `changed` would leave autonomous agents without the new list.
- **`inertiaPages` moves to M2** with props-declared tools and navigation; M1 ships `inertiaAdapter`.
- **Fill validation is merge-based:** `<form>.fill` validates the full schema against
  current-values-merged-with-input and reports issues **only for paths the input touched**, so an
  incomplete form is fine and no partial-schema derivation is needed. The manifest's fill schema is
  the input JSON Schema with every `required` array removed (recursively).
- **Agent-set tracking:** a dirty field counts as *user-edited* unless its current value equals the
  value the agent last set there, so an agent can refine its own earlier fill.

## Review focus

1. **React StrictMode double mount** → tools are present after the remount and no `duplicate_name`
   error fires (Task 10 test `strict_mode_double_mount_keeps_tool`).
2. **Scope disposed while a call is in flight** (navigation mid-call) → the caller still receives a
   result and nothing hangs (Task 5 test `dispose_during_call_resolves`; Task 8 test
   `result_sent_after_scope_disposed`).
3. **Agent fill over a field the user already typed in** → skipped and listed in `skipped`, value
   untouched (Task 6 test `fill_skips_user_edited_field`).
4. **Two tabs on one channel** → only the addressed `clientId` executes (Task 8 test
   `ignores_call_for_other_client`).
5. **zod 3 schema with no converter** → development throws naming the tool and `jsonSchema`;
   production registers with `inputSchema: {}` and emits `schema_conversion_failed`, and calls are
   still validated (Task 4 tests `resolve_fails_dev_throws`, `resolve_fails_prod_event`).

## File structure

```
package.json · pnpm-workspace.yaml · tsconfig.base.json · eslint.config.js · .prettierrc.json
vitest.config.ts · .changeset/config.json · .gitignore · .npmrc · LICENSE · README.md
.github/workflows/ci.yml
packages/core/      package.json tsconfig.json tsdown.config.ts vitest.config.ts
  src/index.ts                 public exports
  src/standard-schema.ts       vendored Standard Schema v1 + Standard JSON Schema types
  src/tool.ts                  ToolDefinition, ToolHints, Caller, ToolContext, defineTool
  src/names.ts                 isValidToolName, toLlmName
  src/result.ts                ToolResult, FieldChange, ok/invalid/refuse/cancelled
  src/schema.ts                validateInput, resolveJsonSchema, stripRequired
  src/manifest.ts              ToolManifest, ToolManifestSummary, buildManifestEntry
  src/events.ts                typed emitter + ToolmarkEventMap
  src/scope.ts                 Scope tree
  src/registry.ts              createToolmark, Toolmark
  src/call.ts                  call pipeline
  src/policy.ts                resolvePolicy, isAllowed
  src/confirm.ts               deferred confirmation store
  src/confirm-queue.ts         createConfirmQueue (inline handler + subscribable state)
  src/queue.ts                 per-scope serial queue
  src/undo.ts                  undo store
  src/ids.ts                   newId()
  src/forms/types.ts           FormAdapter, FieldInfo, FormToolOptions
  src/forms/paths.ts           flatten/unflatten/get/set by dot path
  src/forms/form-tools.ts      createFormTools
  src/protocol/messages.ts     message types
  src/protocol/schemas.ts      JSON Schemas (draft 2020-12)
  src/protocol/validate.ts     validateMessage
  src/bridge/bridge.ts         bridge consumer
  src/bridge/transport.ts      BridgeTransport type
  src/bridge/echo.ts · websocket.ts · post-message.ts · in-page.ts
  scripts/emit-protocol-schemas.ts
  test/*.test.ts
packages/react/     package.json tsconfig.json tsdown.config.ts vitest.config.ts
  src/index.ts context.ts provider.tsx scope.tsx use-tool.ts use-agent-activity.ts
  src/use-form-tool.ts use-confirm-queue.ts use-pending-confirmations.ts
  src/rhf/index.ts
  test/*.test.tsx
packages/inertia/   package.json tsconfig.json tsdown.config.ts vitest.config.ts
  src/index.ts inertia-adapter.ts   test/inertia-adapter.test.tsx
packages/testing/   package.json tsconfig.json tsdown.config.ts vitest.config.ts
  src/index.ts fixture.ts matchers.ts test-toolmark.ts page/install-test-hook.ts
  test/*.test.ts
examples/react-vite/  package.json vite.config.ts index.html src/* e2e/*.spec.ts playwright.config.ts
docs/protocol-v1.md · docs/guides/laravel-reference.md
.changeset/initial-release.md
```

## Lanes

| Wave | Lane | Tasks | Owns files | Consumes (from) |
| --- | --- | --- | --- | --- |
| 0 | A (high) | 1–7 | root config, every `packages/*/package.json`, `pnpm-lock.yaml`, `packages/core/src/**` except `bridge/`, core tests for those | — |
| 1 | B (high, security) | 8–9 | `packages/core/src/bridge/**`, `packages/core/test/bridge*.test.ts`, `test/transport-*.test.ts` | A |
| 1 | C (normal) | 10–12 | `packages/react/src/**`, `packages/react/test/**` | A |
| 1 | D (normal) | 13 | `packages/inertia/src/**`, `packages/inertia/test/**` | A |
| 1 | E (normal) | 14 | `packages/testing/src/**`, `packages/testing/test/**` | A |
| 2 | F (normal) | 15–16 | `examples/react-vite/**`, `docs/**` (except `docs/superpowers`), `.github/workflows/ci.yml`, `.changeset/initial-release.md`, `packages/core/src/index.ts` export additions for bridge | A–E |

Shared-file rules: `pnpm-lock.yaml` and every `package.json` are **Lane A only** — Task 1 declares
all M1 dependencies up front; Wave-1 lanes must not add dependencies (report to the controller
instead). `packages/core/src/index.ts` is Lane A's, except that Lane F adds the bridge exports.
Lane B exports its symbols from `packages/core/src/bridge/index.ts` only.

---

### Task 1: Workspace scaffold and tooling   (Lane A, risk: normal)

**Files:** Create root `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`,
`eslint.config.js`, `.prettierrc.json`, `vitest.config.ts`, `.changeset/config.json`, `.gitignore`,
`.npmrc`, `LICENSE`, `README.md`; for each of `core`, `react`, `inertia`, `testing`:
`package.json`, `tsconfig.json`, `tsdown.config.ts`, `vitest.config.ts`, `src/index.ts`
(empty export); `packages/core/test/smoke.test.ts`.

**Interfaces:** Produces the workspace scripts: root `pnpm build` (`pnpm -r build`),
`pnpm typecheck` (`pnpm -r typecheck`), `pnpm lint` (`eslint .`), `pnpm test` (`vitest run`),
`pnpm format:check`.

**Exact values:**
- Root `packageManager`: `"pnpm@12.6.0"`; `engines.node`: `">=20.19"`.
- `pnpm-workspace.yaml`: `packages: ['packages/*', 'examples/*']` and a `catalog:` with every
  version in the overview's dev-tool table.
- Package deps: `core` — none (dev: `zod`, `zod-to-json-schema`, `ajv` 8.20.0, `ajv-formats` 3.0.1);
  `react` — dep `@toolmark/core: workspace:*`, peers `react >=18.3.0 <20`,
  `react-hook-form ^7.0.0` (optional), dev `react`, `react-dom`, `@types/react`, `@types/react-dom`, `react-hook-form`, `zod`, `@testing-library/react`, `@vitest/browser`, `@vitest/browser-playwright`; `inertia` — dep `@toolmark/core: workspace:*`, peers
  `@inertiajs/react ^2.0.0 || ^3.0.0`, `react >=18.3.0 <20`, dev `@inertiajs/react` (3.7.1) + the react dev set; `testing` — dep
  `@toolmark/core: workspace:*`, peer `@playwright/test ^1.63.0`, dev `@playwright/test`, `vite`; `examples/react-vite` — private package `@toolmark-examples/react-vite` with `vite`, `@vitejs/plugin-react`, `react`, `react-dom`, `react-hook-form`, `zod`, `@playwright/test`, and the four `workspace:*` packages.
- `react` package `exports`: `"."` and `"./rhf"`. `core` package `exports`: `"."`, `"./protocol"`,
  `"./bridge"`, `"./bridge/echo"`, `"./bridge/websocket"`, `"./bridge/post-message"`,
  `"./bridge/in-page"`, and `"./protocol/v1/*.json"` (emitted files).
- `tsconfig.base.json`: `"strict": true`, `"exactOptionalPropertyTypes": true`,
  `"noUncheckedIndexedAccess": true`, `"verbatimModuleSyntax": true`, `"target": "ES2022"`,
  `"module": "NodeNext"`, `"moduleResolution": "NodeNext"`, `"lib": ["ES2022","DOM","DOM.Iterable"]`.
- ESLint: `no-eval`, `no-new-func`, `no-implied-eval` = `error`; typescript-eslint
  `recommendedTypeChecked`.
- Root `vitest.config.ts` uses `test.projects: ['packages/*']`. Core runs `environment: 'node'`;
  react/inertia run browser mode: provider `playwright` (from `@vitest/browser-playwright`),
  instances `[{ browser: 'chromium' }]`, headless.
- `.changeset/config.json`: `"access": "public"`, `"baseBranch": "main"`.

**Behaviour:**
- `pnpm install` succeeds from clean; `pnpm exec playwright install chromium` is documented in
  README and run once.
- `pnpm build` emits ESM + `.d.ts` for all four packages; `pnpm typecheck`, `pnpm lint` pass.

**Tests (write first):**
- `smoke_imports_core` — `import * as core from '../src/index.ts'` → module object is defined.

**Task gate:** `pnpm install && pnpm build && pnpm typecheck && pnpm lint && pnpm -F @toolmark/core exec vitest run test/smoke.test.ts`

---

### Task 2: Tool model, names, results, vendored Standard Schema   (Lane A, risk: normal)

**Files:** Create `packages/core/src/standard-schema.ts`, `src/tool.ts`, `src/names.ts`,
`src/result.ts`, `src/ids.ts`; Test `test/names.test.ts`, `test/result.test.ts`.

**Interfaces — Produces:**
```ts
type Caller = 'inapp' | 'webmcp' | 'mcp' | 'test' | 'tour' | 'human'
interface ToolHints { readOnly?: boolean; consequential?: boolean; destructive?: boolean; untrustedContent?: boolean }
interface ToolDefinition<I = unknown, O = unknown> {
  name: string; title?: string; description: string
  input?: StandardSchemaV1<unknown, I>; output?: StandardSchemaV1<unknown, O>
  jsonSchema?: JsonSchema; hints?: ToolHints
  summary?: (input: I) => string
  anchors?: AnchorSpec; state?: () => ToolState<I>        // AnchorSpec/ToolState declared now, used in M3
  run(input: I, ctx: ToolContext): ToolResult<O> | Promise<ToolResult<O>>
}
interface ToolContext {
  signal: AbortSignal; callId: string; caller: Caller
  confirm(req: { summary: string; changes?: FieldChange[] }): Promise<ConfirmOutcome>
  registerUndo(restore: () => ToolResult<unknown> | Promise<ToolResult<unknown>>): void
  files: { resolve(ref: FileRef): Promise<File> }          // FileRef declared now, implemented in M2
}
type ConfirmOutcome = { approved: true; input?: unknown } | { approved: false; reason?: string }
function defineTool<I, O>(def: ToolDefinition<I, O>): ToolDefinition<I, O>
type JsonSchema = Record<string, unknown>
interface FieldChange { path: string; before: unknown; after: unknown }
type ToolResult<T> = …exactly spec §6…
function ok<T>(data: T): ToolResult<T>
function invalid(issues: { path: string; message: string }[]): ToolResult<never>
function refuse(code: string, message: string, extra?: { rev?: number }): ToolResult<never>
function cancelled(by: 'operator' | 'signal' | 'policy'): ToolResult<never>
function isValidToolName(name: string): boolean
function toLlmName(fullName: string): string
function newId(): string
```

**Exact values:** name regex `^[A-Za-z0-9_.-]{1,128}$`; `llmName` regex `^[a-zA-Z0-9_-]{1,64}$`;
long-name rule: first 55 chars + `_` + 8 lowercase hex of 32-bit FNV-1a (offset `0x811c9dc5`, prime
`0x01000193`) over the UTF-8 bytes of the full name.

**Behaviour:**
- `standard-schema.ts` copies `StandardSchemaV1`, `StandardTypedV1` and `StandardJSONSchemaV1`
  interfaces from `@standard-schema/spec` 1.1.0 verbatim (types only, header comment with source).
- `toLlmName` replaces every `.` with `__`, then applies the long-name rule; the result always
  matches the llmName regex.
- Result helpers return frozen plain objects (structured-cloneable).

**Tests (write first):**
- `valid_names` — `a`, `challenges.create.fill`, 128 chars → true; `""`, `a b`, `a/b`, 129 chars → false.
- `llm_name_replaces_dots` — `challenges.create.fill` → `challenges__create__fill`.
- `llm_name_long_is_hashed_and_stable` — 100-char name → length 64, matches regex, same input gives same output, different inputs differ.
- `result_helpers_shapes` — each helper returns the exact spec §6 shape; `refuse('stale','x',{rev:3})` includes `rev: 3`.
- `results_are_structured_cloneable` — `structuredClone(ok({a:1}))` deep-equals the original.

**Task gate:** `pnpm -F @toolmark/core exec vitest run test/names.test.ts test/result.test.ts && pnpm -F @toolmark/core typecheck`

---

### Task 3: Schema validation and JSON Schema resolution   (Lane A, risk: normal)

**Files:** Create `packages/core/src/schema.ts`; Test `test/schema.test.ts`.

**Interfaces — Produces:**
```ts
function validateInput<T>(schema: StandardSchemaV1<unknown, T> | undefined, value: unknown):
  Promise<{ ok: true; value: T } | { ok: false; issues: { path: string; message: string }[] }>
type JsonSchemaConverter = (schema: StandardSchemaV1) => JsonSchema | undefined
function resolveJsonSchema(tool: ToolDefinition, converter: JsonSchemaConverter | undefined):
  { ok: true; schema: JsonSchema } | { ok: false; reason: string }
function stripRequired(schema: JsonSchema): JsonSchema
```

**Behaviour:**
- `validateInput` with no schema returns `{ ok: true, value }`; awaits async `validate` results.
- Issue `path` joins Standard Schema path segments (`PropertyKey` or `{ key }`) with `.`; root issues use `""`.
- Resolution order (spec §6): `tool.jsonSchema` → `schema['~standard'].jsonSchema.input({ target: 'draft-2020-12' })` → `converter(schema)` → failure. A throwing converter or Standard JSON Schema method counts as failure with its message in `reason`.
- No input schema → `{ type: 'object', properties: {}, additionalProperties: false }`.
- `stripRequired` removes `required` recursively (object `properties`, `items`, `anyOf`/`oneOf`/`allOf`, `$defs`) without mutating its argument.
- The registry (Task 4) turns a failure into: `dev` → throw `ToolmarkError` code `schema_conversion_failed` with message containing the tool name and the word `jsonSchema`; production → `inputSchema: {}` + `error` event.

**Tests (write first):**
- `validates_zod4_ok_and_issues` — zod 4 object; valid → ok with parsed value; invalid nested field → issue path `title.en`.
- `resolve_prefers_tool_json_schema` — tool.jsonSchema wins over zod 4 Standard JSON Schema.
- `resolve_uses_standard_json_schema` — zod 4 schema → output has `type: 'object'` and the property names.
- `resolve_uses_global_converter_for_zod3` — zod 3 schema (`zod/v3` import of the dev zod package) + `zodToJsonSchema` converter → ok.
- (The register-level failure tests `resolve_fails_dev_throws` / `resolve_fails_prod_event` live in Task 4's `test/registry-schema.test.ts`.)
- `strip_required_recursive_and_pure` — nested required arrays removed; original unchanged.

**Task gate:** `pnpm -F @toolmark/core exec vitest run test/schema.test.ts`

---

### Task 4: Registry, scopes, manifest, events, revisions   (Lane A, risk: high)

**Files:** Create `src/events.ts`, `src/scope.ts`, `src/manifest.ts`, `src/registry.ts`;
Modify `src/index.ts`; Test `test/registry.test.ts`, `test/registry-schema.test.ts`,
`test/manifest.test.ts`.

**Interfaces — Produces:**
```ts
interface ToolmarkOptions {
  dev?: boolean
  confirm?: (req: ConfirmRequest) => Promise<ConfirmOutcome>       // inline handler
  confirmMode?: Partial<Record<Caller, 'deferred' | 'inline'>>
  policy?: Partial<Record<Caller, { allow: Array<'readOnly' | 'default' | 'consequential' | 'destructive'> }>>
  jsonSchema?: JsonSchemaConverter
  confirmExpiryMs?: number                                         // default 600000
  budget?: number                                                  // default 40 (dev warning only)
  onError?: (e: ToolmarkErrorEvent) => void
}
interface ConfirmRequest { confirmId: string; tool: string; title?: string; caller: Caller; input: unknown; hints: ToolHints; summary: string; changes?: FieldChange[] }
interface Scope { readonly path: string; scope(name: string, opts?: { when?: boolean }): Scope; setWhen(v: boolean): void; dispose(): void; readonly disposed: boolean }
interface Registration { readonly name: string; dispose(): void }
interface ToolManifestSummary { name: string; llmName: string; title?: string; description: string; hints: ToolHints; mode?: 'stepwise' }
interface ToolManifest extends ToolManifestSummary { inputSchema: JsonSchema; outputSchema?: JsonSchema }
interface Toolmark {
  readonly clientId: string; readonly rev: number
  register<I, O>(tool: ToolDefinition<I, O>, opts?: { scope?: Scope; signal?: AbortSignal }): Registration
  scope(name: string, opts?: { when?: boolean }): Scope
  manifest(opts?: { caller?: Caller; detail?: 'summary' }): { rev: number; tools: ToolManifestSummary[] }
  manifest(opts: { caller?: Caller; detail: 'full' }): { rev: number; tools: ToolManifest[] }
  describe(name: string, opts?: { caller?: Caller }): ToolManifest | undefined
  call(name: string, input: unknown, opts: { caller: Caller; rev?: number; signal?: AbortSignal }): Promise<ToolResult<unknown>>   // Task 5
  pendingConfirmations(): PendingConfirmation[]                                                   // Task 5
  confirmPending(confirmId: string, outcome: ConfirmOutcome): Promise<ToolResult<unknown>>       // Task 5
  undo(callId: string): Promise<ToolResult<{ changes: FieldChange[] }>>                          // Task 5
  subscribe(listener: (rev: number) => void): () => void
  readonly events: { on<K extends keyof ToolmarkEventMap>(type: K, fn: (e: ToolmarkEventMap[K]) => void): () => void }
  use(consumer: (tm: Toolmark) => () => void): () => void
}
interface ToolmarkEventMap {
  call: { callId: string; tool: string; caller: Caller; input: unknown }
  result: { callId: string; tool: string; caller: Caller; result: ToolResult<unknown>; durationMs: number }
  confirm: { confirmId: string; tool: string; stage: 'pending' | 'approved' | 'rejected' | 'expired'; result?: ToolResult<unknown> }
  interaction: { tool: string; param?: string; kind: 'input' | 'focus' | 'submit'; caller: 'human' }
  change: { rev: number }
  error: ToolmarkErrorEvent
}
interface ToolmarkErrorEvent { code: string; message: string; tool?: string; cause?: unknown }
class ToolmarkError extends Error { code: string }
function createToolmark(options?: ToolmarkOptions): Toolmark
```

**Behaviour:**
- Full name = scope path + `.` + local name (root scope path is `""`). Invalid full name → `invalid_name` (throw in dev / event in prod, tool not registered).
- Duplicate live full name → `duplicate_name` (throw in dev / event in prod). Disposal is synchronous so dispose-then-register of the same name succeeds.
- Removal via `Registration.dispose()`, `signal` abort, or scope disposal (disposes all descendants). No unregister-by-name.
- A scope with `when: false` (or any ancestor with `when: false`) hides its tools from `manifest`/`describe`/`call` (call → `refused` `unknown_tool`).
- `rev` starts at 0 and increments once per registry mutation batch; `subscribe` listeners and the `change` event fire once per microtask batch with the latest `rev`.
- `manifest` is sorted by full name, includes only tools the caller is allowed to see (policy from Task 5 — until Task 5, all visible), and is JSON-safe.
- `use(consumer)` calls `consumer(tm)` and returns its disposer (idempotent).
- SSR (spec D24): when `typeof document === 'undefined'`, `register` and `use` are inert no-ops returning disposable handles, `manifest` returns `{ rev: 0, tools: [] }`, `call` returns `refused` `unknown_tool`. Controlled by an internal `isBrowser()` check that tests can override via `createToolmark({ __environment: 'browser' | 'server' })` (undocumented test hook).
- Registering a consequential/destructive tool when no inline `confirm` handler exists and any caller allowed for that hint uses inline mode → `missing_confirm_handler`.

**Tests (write first):**
- `register_and_manifest_sorted` — three tools in two scopes → manifest names sorted, `llmName` present.
- `duplicate_name_dev_throws_prod_event` — both modes.
- `dispose_then_register_same_name_ok` — no error.
- `scope_dispose_removes_descendants` — nested scopes → all tools gone, `rev` bumped once.
- `signal_abort_unregisters`.
- `when_false_hides_tools_and_refuses_call`.
- `subscribe_batches_per_microtask` — 5 registrations in one tick → listener called once with final rev.
- `ssr_is_inert` — `__environment: 'server'` → register returns handle, manifest empty, no throw.
- `budget_exceeded_dev_event_only` — 41 tools with `dev: true` → one `tool_budget_exceeded` event; `dev: false` → none.
- `missing_confirm_handler_on_consequential` — dev throws; with `policy` restricting consequential to `inapp` only (deferred) → no error.
- `registry-schema.test.ts`: `resolve_fails_dev_throws`, `resolve_fails_prod_event` (review focus 5; the prod variant also asserts a call with invalid input still returns `invalid`).
- `manifest.test.ts`: `summary_omits_schema`, `full_includes_schema`, `describe_unknown_undefined`, `manifest_is_json_safe` (`JSON.parse(JSON.stringify(m))` deep-equals).

**Implementation notes:** keep one `Map<fullName, Entry>`; each `Entry` references its `Scope`
node; visibility = entry alive ∧ every ancestor `when !== false`. Batch notifications with a
`queueMicrotask` flag.

**Task gate:** `pnpm -F @toolmark/core exec vitest run test/registry.test.ts test/registry-schema.test.ts test/manifest.test.ts`

---

### Task 5: Call pipeline, policy, confirmation, queue, undo   (Lane A, risk: high)

**Files:** Create `src/call.ts`, `src/policy.ts`, `src/confirm.ts`, `src/confirm-queue.ts`,
`src/queue.ts`, `src/undo.ts`; Modify `src/registry.ts`, `src/index.ts`; Test `test/call.test.ts`,
`test/policy.test.ts`, `test/confirm.test.ts`, `test/confirm-queue.test.ts`, `test/queue.test.ts`,
`test/undo.test.ts`.

**Interfaces — Produces:**
```ts
interface PendingConfirmation { confirmId: string; tool: string; title?: string; caller: Caller; input: unknown; summary: string; changes?: FieldChange[]; createdAt: number; expiresAt: number }
interface ConfirmQueue {
  handler: (req: ConfirmRequest) => Promise<ConfirmOutcome>
  getPending(): ConfirmRequest | null          // head of the FIFO
  subscribe(fn: () => void): () => void
  approve(input?: unknown): void
  reject(reason?: string): void
}
function createConfirmQueue(): ConfirmQueue
```

**Behaviour (pipeline order for `tm.call`):**
1. Resolve tool; missing/hidden → `refused` `unknown_tool` with current `rev`. If `opts.rev` is given, differs from current `rev`, **and** the tool is missing → `refused` `stale` with `rev` (a stale rev with an existing tool proceeds).
2. Policy: caller not allowed for the tool's hint class → `refused` `not_allowed`. Hint class = `destructive` > `consequential` > `readOnly` > `default`.
3. Validate input (Task 3) → `invalid` on failure.
4. Confirmation for consequential/destructive unless caller is `human`:
   - **deferred** mode → store a pending confirmation, emit `confirm` `pending`, return `needs_confirmation` `{ confirmId, summary, changes? }` (summary = `tool.summary?.(input)` ?? `tool.title` ?? tool name). `confirmPending(id, {approved:true, input?})` re-validates any edited input, runs the tool as caller `human`, emits `confirm` `approved` with the result, and returns it; rejection → `cancelled` `operator` + `confirm` `rejected`; after `confirmExpiryMs` → dropped, `confirm` `expired`, later `confirmPending` → `refused` `confirmation_expired`. Pending entries are dropped when their tool's scope is disposed (emit `expired`).
   - **inline** mode → `await options.confirm(req)`; rejected → `cancelled` `operator`; approved with `input` → re-validate.
5. Enqueue on the tool's **scope** queue (serial per scope, parallel across scopes); queue length > 32 → `refused` `busy`.
6. Run with `ctx` (`signal` = caller signal combined with a registry abort; `registerUndo` stores a restorer under `callId`). Thrown error → `error` with message `"Tool failed"` + `error` event `tool_threw` (cause attached). In `dev`, validate `ok` data against `output` schema → mismatch emits `output_invalid` (result still returned).
7. Emit `call` before step 3 and `result` after completion with `durationMs`.
- Caller `signal` aborted before run → `cancelled` `signal`; during run → the tool sees `ctx.signal.aborted`; the pipeline resolves with the tool's own result.
- **Scope disposed during a call:** the in-flight call still resolves with the tool's result; queued-but-not-started calls resolve `refused` `unknown_tool`.
- `undo(callId)`: runs the stored restorer once and deletes it; none stored (or the tool's scope disposed) → `refused` `undo_unavailable`.
- `createConfirmQueue`: FIFO; `handler` resolves when `approve`/`reject` is called for its request; `subscribe` fires on every change.

**Tests (write first):**
- `unknown_tool_refused_with_rev`; `stale_rev_missing_tool_refused_stale`; `stale_rev_existing_tool_runs`.
- `policy_defaults_table` — iterate spec §7 table × callers → allowed/`not_allowed` exactly as the M1 constraints list.
- `invalid_input_returns_issues`.
- `deferred_confirm_returns_needs_confirmation` → `confirmPending` approve runs as `human` (assert `ctx.caller`), emits `approved` with result.
- `deferred_confirm_edited_input_revalidated` — edited input invalid → `invalid`, tool not run.
- `deferred_reject_cancelled_operator`; `deferred_expiry_then_confirm_refused` (fake timers).
- `pending_dropped_on_scope_dispose`.
- `inline_confirm_approve_and_reject`.
- `human_caller_skips_confirmation`.
- `scope_calls_serialized` — two slow calls in one scope run sequentially; two scopes overlap.
- `queue_limit_busy` — 33rd queued call → `busy`.
- `thrown_error_becomes_error_result_and_event`.
- `dispose_during_call_resolves` — dispose scope mid-run → caller gets the tool's `ok`; a queued second call → `unknown_tool` (review focus 2).
- `abort_before_run_cancelled_signal`.
- `undo_runs_once_then_unavailable`.
- `confirm_queue_fifo_approve_reject`.

**Task gate:** `pnpm -F @toolmark/core exec vitest run test/call.test.ts test/policy.test.ts test/confirm.test.ts test/confirm-queue.test.ts test/queue.test.ts test/undo.test.ts`

---

### Task 6: Form tools core   (Lane A, risk: high)

**Files:** Create `src/forms/types.ts`, `src/forms/paths.ts`, `src/forms/form-tools.ts`;
Modify `src/index.ts`; Test `test/form-tools.test.ts`, `test/paths.test.ts`.

**Interfaces — Produces:**
```ts
interface FieldInfo { path: string; label?: string; element?: HTMLElement | null }
interface FormAdapter<V extends Record<string, unknown> = Record<string, unknown>> {
  getValues(): V
  setValues(values: Record<string, unknown>, opts: { source: 'agent' | 'undo' }): void   // flat dot paths; null = clear
  dirtyPaths(): string[]
  submit(): Promise<ToolResult<unknown>>
  fields(): FieldInfo[]
}
interface FormToolOptions<V> {
  name: string; description: string; title?: string
  input: StandardSchemaV1<unknown, V>; jsonSchema?: JsonSchema
  submitSummary?: (values: V) => string
}
function createFormTools<V extends Record<string, unknown>>(tm: Toolmark, adapter: FormAdapter<V>,
  opts: FormToolOptions<V> & { scope?: Scope }): { dispose(): void }
function flatten(obj: unknown): Record<string, unknown>        // leaf dot paths; arrays are leaves in M1
function getPath(obj: unknown, path: string): unknown
function setPath<T>(obj: T, path: string, value: unknown): T     // immutable
```

**Behaviour:**
- Registers `<name>.fill` (no hint) and `<name>.submit` (`consequential`, summary = `submitSummary(values)` ?? `"Submit <title ?? name>"`).
- Fill input: `{ values: Partial<V>, overwrite?: boolean }`. Its manifest schema = `{ type:'object', properties: { values: stripRequired(inputJsonSchema), overwrite: { type:'boolean' } }, required:['values'] }`.
- Fill semantics (spec D19): flatten `values`; `undefined` leaves → ignored; `null` → clear. A path is **user-edited** when it is in `adapter.dirtyPaths()` and its current value differs from the value the agent last set there. User-edited paths are skipped unless `overwrite: true`.
- Validation: merge current values with the non-skipped input (null → `undefined`), run `input` schema, keep only issues whose path equals or is under a touched path → any → `invalid` and **nothing is set**.
- Otherwise `adapter.setValues(changedPaths, { source: 'agent' })`, record agent-set values, register an undo restorer that sets the `before` values back with `source: 'undo'` (and forgets agent-set entries for those paths), and return `ok({ changes, skipped })` where `changes` = paths whose value actually changed.
- Submit runs `adapter.submit()` and returns its result.
- `dispose()` disposes both registrations.

**Tests (write first):** (use an in-memory `FormAdapter` fake defined in the test file)
- `fill_sets_values_and_reports_changes`.
- `fill_null_clears_undefined_leaves`.
- `fill_skips_user_edited_field` — fake marks `title` dirty with a user value → skipped, untouched, listed in `skipped` (review focus 3).
- `fill_overwrite_true_replaces_user_value`.
- `agent_can_refine_own_value` — fill `title`, fake marks it dirty (as RHF would), fill again → applied.
- `fill_invalid_touched_path_sets_nothing`.
- `fill_ignores_issues_on_untouched_paths` — required untouched field empty → still ok.
- `undo_restores_before_values` — via `tm.undo(callId)`.
- `submit_is_consequential_deferred_for_inapp` — returns `needs_confirmation`.
- `paths_flatten_get_set_immutable`.

**Task gate:** `pnpm -F @toolmark/core exec vitest run test/form-tools.test.ts test/paths.test.ts`

---

### Task 7: Protocol v1 messages, JSON Schemas, validator   (Lane A, risk: high)

**Files:** Create `src/protocol/messages.ts`, `src/protocol/schemas.ts`, `src/protocol/validate.ts`,
`src/protocol/index.ts`, `scripts/emit-protocol-schemas.ts`; Modify `packages/core/package.json`
(build script runs the emitter), `tsdown.config.ts` (entry `protocol`); Test
`test/protocol.test.ts`, `test/fixtures/protocol/*.json`.

**Interfaces — Produces:**
```ts
type PageToAgentMessage =
  | { protocol: 1; type: 'manifest'; clientId: string; rev: number; tools: ToolManifestSummary[] }
  | { protocol: 1; type: 'changed'; clientId: string; rev: number }
  | { protocol: 1; type: 'result'; clientId: string; id: string; result: ToolResult<unknown> }
  | { protocol: 1; type: 'confirmed'; clientId: string; confirmId: string; result: ToolResult<unknown> }
type AgentToPageMessage =
  | { protocol: 1; type: 'call'; clientId: string; id: string; rev?: number; tool: string; input: unknown }
  | { protocol: 1; type: 'describe'; clientId: string; id: string; tool: string }
  | { protocol: 1; type: 'cancel'; clientId: string; id: string }
type ProtocolMessage = PageToAgentMessage | AgentToPageMessage
function validateMessage(value: unknown, direction: 'toPage' | 'toAgent'):
  { ok: true; message: ProtocolMessage } | { ok: false; reason: string; unsupportedProtocol?: boolean; id?: string }
const protocolSchemas: { pageToAgent: JsonSchema; agentToPage: JsonSchema }
const PROTOCOL_VERSION = 1
```

**Exact values:** schema `$schema` `https://json-schema.org/draft/2020-12/schema`; `$id`s
`urn:toolmark:protocol:v1:page-to-agent` and `urn:toolmark:protocol:v1:agent-to-page`; emitted files
`dist/protocol/v1/page-to-agent.json`, `dist/protocol/v1/agent-to-page.json`.

**Behaviour:**
- `validateMessage` is hand-written (zero deps), rejects unknown `type`, missing fields, wrong
  types, extra top-level fields; `protocol !== 1` → `{ ok:false, unsupportedProtocol:true, id }` when an `id` string is present.
- `ToolResult` inside messages is validated structurally per status.
- The JSON Schemas and `validateMessage` agree on every fixture (checked with Ajv in tests only).

**Tests (write first):**
- `valid_fixtures_pass_both_validators` — every `fixtures/protocol/valid-*.json` passes `validateMessage` and Ajv (`ajv/dist/2020` + `ajv-formats`).
- `invalid_fixtures_fail_both_validators` — every `invalid-*.json` fails both (include: missing `clientId`, unknown `type`, `protocol: 2`, extra field, `result.status: 'maybe'`).
- `unsupported_protocol_reports_id`.
- `emitted_schema_files_match_exports` — run the emitter to a temp dir → JSON equals `protocolSchemas`.

**Task gate:** `pnpm -F @toolmark/core exec vitest run test/protocol.test.ts && pnpm -F @toolmark/core build`

---

### Task 8: Bridge consumer   (Lane B, risk: high, security)

**Files:** Create `packages/core/src/bridge/transport.ts`, `src/bridge/bridge.ts`,
`src/bridge/index.ts`; Test `packages/core/test/bridge.test.ts`.

**Interfaces:**
- Consumes: `Toolmark`, `validateMessage`, message types (Tasks 4–7).
- Produces:
```ts
interface BridgeTransport {
  send(message: PageToAgentMessage): void | Promise<void>
  onMessage(handler: (message: unknown) => void): () => void
  close?(): void
}
interface BridgeOptions { transport: BridgeTransport; onChange?: 'manifest' | 'changed'; caller?: 'inapp' }
function bridge(options: BridgeOptions): (tm: Toolmark) => () => void
```

**Behaviour:**
- On attach: send `manifest` (summary, caller `inapp`, current `rev`, `clientId`).
- On each registry revision: send `manifest` (default) or `changed` (`onChange: 'changed'`).
- Incoming messages are validated with `validateMessage(_, 'toPage')`; invalid → dropped + `error` event `transport_failed` (no reply); `unsupportedProtocol` with `id` → reply `result` `{ status:'error', message:'unsupported protocol' }`.
- Messages whose `clientId` ≠ `tm.clientId` are ignored silently (review focus 4).
- `call` → `tm.call(tool, input, { caller: 'inapp', rev, signal })` → exactly one `result` per `id`. A second `call` with an in-flight or recently answered `id` (last 1000) is ignored.
- `describe` → `result` `ok(tm.describe(tool))` or `refused` `unknown_tool`.
- `cancel` → aborts that call's controller; the pipeline yields `cancelled` `signal` (or the tool's own result if it ignores the signal) — still exactly one `result`.
- `confirm` events with stage `approved`/`rejected`/`expired` for confirmations created by bridge calls → send `confirmed` `{ confirmId, result }` (expired → `refused` `confirmation_expired`).
- Transport `send` rejection → `error` event `transport_failed`; never throws into the registry.
- Disposer unsubscribes everything and calls `transport.close?.()`; in-flight calls are aborted.

**Tests (write first):** (use an in-memory fake transport in the test file)
- `sends_manifest_on_attach`; `sends_manifest_on_change`; `sends_changed_when_configured`.
- `ignores_call_for_other_client` (review focus 4).
- `call_returns_single_result`; `duplicate_call_id_ignored`.
- `describe_ok_and_unknown`.
- `cancel_yields_cancelled_signal_once`.
- `deferred_confirmation_forwarded_as_confirmed` — call consequential → `needs_confirmation` result; `tm.confirmPending` approve → `confirmed` message with the tool's result.
- `unsupported_protocol_replies_error`; `invalid_message_dropped_with_event`.
- `result_sent_after_scope_disposed` — dispose the scope while the tool runs → `result` still sent (review focus 2).
- `dispose_aborts_inflight_and_closes_transport`.

**Task gate:** `pnpm -F @toolmark/core exec vitest run test/bridge.test.ts`

---

### Task 9: Transports — echo, websocket, postMessage, in-page   (Lane B, risk: high, security)

**Files:** Create `src/bridge/echo.ts`, `src/bridge/websocket.ts`, `src/bridge/post-message.ts`,
`src/bridge/in-page.ts`; Modify `src/bridge/index.ts`, `packages/core/tsdown.config.ts` (entries
`bridge/echo`, `bridge/websocket`, `bridge/post-message`, `bridge/in-page`) — `tsdown.config.ts` is
granted to Lane B for these entry lines only; Test `test/transport-echo.test.ts`,
`test/transport-websocket.test.ts`, `test/transport-post-message.test.ts`,
`test/transport-in-page.test.ts`.

**Interfaces — Produces:**
```ts
interface EchoLike { private(channel: string): { listen(event: string, cb: (payload: unknown) => void): unknown; stopListening(event: string): unknown } }
function echoTransport(o: { echo: EchoLike; channel: string; event?: string; postUrl: string; headers?: () => Record<string, string> }): BridgeTransport
function websocketTransport(o: { url: string; protocols?: string | string[]; maxDelayMs?: number }): BridgeTransport
function postMessageTransport(o: { target: Window; targetOrigin: string; allowedOrigins: string[] }): BridgeTransport
function createInPageChannel(): { transport: BridgeTransport; agent: { send(m: AgentToPageMessage): void; onMessage(h: (m: PageToAgentMessage) => void): () => void } }
```

**Exact values:** echo default `event`: `'.toolmark.message'`; echo POST headers:
`Content-Type: application/json`, `Accept: application/json`, `X-Requested-With: XMLHttpRequest`,
plus `headers()`; `credentials: 'same-origin'`. WebSocket reconnect: first delay `500` ms, doubling,
capped at `maxDelayMs` (default `30000`); send buffer max `100` messages (oldest dropped with
`transport_failed`-worthy error surfaced via the returned promise rejection).

**Behaviour:**
- **echo**: subscribes to `echo.private(channel)` (private channel is mandatory — D20); payload may be the message or `{ message }`. `send` POSTs JSON; non-2xx → rejected promise.
- **websocket**: JSON text frames; reconnects with backoff; buffered sends flush on open; `close()` stops reconnecting.
- **postMessage**: `targetOrigin` `'*'` → throws `TypeError('targetOrigin must be an exact origin')`; incoming events accepted only from `allowedOrigins` **and** `event.source === target`.
- **in-page**: both directions delivered asynchronously via `queueMicrotask`; used by in-page agents and tests.

**Tests (write first):**
- `echo_listens_on_private_channel_and_posts` — fake `EchoLike` + stubbed `fetch` → correct channel/event, POST body and headers; non-2xx rejects.
- `echo_accepts_wrapped_payload`.
- `websocket_reconnects_with_backoff_and_flushes` — fake WebSocket class, fake timers → delays 500, 1000, 2000…; buffered messages sent after open.
- `post_message_rejects_star_origin`; `post_message_filters_origin_and_source`.
- `in_page_round_trip_with_bridge` — `createInPageChannel` + `bridge` + registry → agent `call` gets `result`.

**Task gate:** `pnpm -F @toolmark/core exec vitest run test/transport-echo.test.ts test/transport-websocket.test.ts test/transport-post-message.test.ts test/transport-in-page.test.ts`

---

### Task 10: React provider, scopes, `useTool`, `useAgentActivity`   (Lane C, risk: normal)

**Files:** Create `packages/react/src/context.ts`, `src/provider.tsx`, `src/scope.tsx`,
`src/use-tool.ts`, `src/use-agent-activity.ts`, `src/index.ts`; Test `test/use-tool.test.tsx`,
`test/scope.test.tsx`, `test/use-agent-activity.test.tsx`.

**Interfaces — Produces:**
```ts
function ToolmarkProvider(p: { toolmark: Toolmark; children: ReactNode }): JSX.Element
function useToolmark(): Toolmark                      // throws outside provider: "useToolmark must be used inside <ToolmarkProvider>"
function ToolScope(p: { name: string; when?: boolean; children: ReactNode }): JSX.Element
function useCurrentScope(): Scope | undefined
function useTool<I, O>(def: ToolDefinition<I, O>): void
function useAgentActivity(): { active: Array<{ callId: string; tool: string; caller: Caller; startedAt: number }> }
```

**Behaviour:**
- `ToolScope` creates a child scope of the enclosing scope on mount, calls `setWhen(when ?? true)` when `when` changes, disposes on unmount.
- `useTool` registers in `useEffect` into the current scope; `run` always calls the latest `def.run` (ref); re-registers only when `name`, `description`, `title`, hints (shallow) or schema identities change.
- StrictMode double mount/unmount leaves exactly one live registration and no `duplicate_name` error.
- `useAgentActivity` subscribes via `useSyncExternalStore` to `call`/`result` events.

**Tests (write first):** (Vitest browser mode + `@testing-library/react`)
- `strict_mode_double_mount_keeps_tool` — `<StrictMode>` → manifest contains the tool once; no error event (review focus 1).
- `latest_closure_used` — rerender with new state → call returns the new value, no re-registration (rev unchanged).
- `reregisters_on_description_change`.
- `scope_nests_names` — `<ToolScope name="a"><ToolScope name="b">` → `a.b.tool`.
- `scope_when_false_hides`.
- `unmount_disposes`.
- `use_toolmark_outside_provider_throws`.
- `agent_activity_tracks_inflight_calls`.

**Task gate:** `pnpm -F @toolmark/react exec vitest run test/use-tool.test.tsx test/scope.test.tsx test/use-agent-activity.test.tsx`

---

### Task 11: `useFormTool`, `useConfirmQueue`, `usePendingConfirmations`   (Lane C, risk: normal)

**Files:** Create `packages/react/src/use-form-tool.ts`, `src/use-confirm-queue.ts`,
`src/use-pending-confirmations.ts`; Modify `src/index.ts`; Test `test/use-form-tool.test.tsx`,
`test/confirm-hooks.test.tsx`.

**Interfaces:**
- Consumes: `createFormTools`, `FormAdapter`, `FormToolOptions`, `createConfirmQueue`, `Toolmark.pendingConfirmations/confirmPending`.
- Produces:
```ts
function useFormTool<V extends Record<string, unknown>>(adapter: FormAdapter<V>, opts: FormToolOptions<V>): void
function useConfirmQueue(queue: ConfirmQueue): { pending: ConfirmRequest | null; approve(input?: unknown): void; reject(reason?: string): void }
function usePendingConfirmations(): { items: PendingConfirmation[]; approve(confirmId: string, input?: unknown): Promise<ToolResult<unknown>>; reject(confirmId: string, reason?: string): Promise<ToolResult<unknown>> }
```

**Behaviour:**
- `useFormTool` calls `createFormTools` in an effect under the current scope; the adapter is read through a ref so a new adapter object each render does not re-register.
- `usePendingConfirmations` re-renders on `confirm` events; `reject` calls `confirmPending(id, { approved:false, reason })`.

**Tests (write first):**
- `form_tool_registers_fill_and_submit_under_scope`.
- `form_tool_stable_across_renders` — 5 rerenders → rev unchanged.
- `confirm_queue_hook_shows_head_and_resolves`.
- `pending_confirmations_list_and_approve`.

**Task gate:** `pnpm -F @toolmark/react exec vitest run test/use-form-tool.test.tsx test/confirm-hooks.test.tsx`

---

### Task 12: react-hook-form adapter (`@toolmark/react/rhf`)   (Lane C, risk: normal)

**Files:** Create `packages/react/src/rhf/index.ts`; Test `test/rhf.test.tsx`.

**Interfaces — Produces:**
```ts
function rhfAdapter<V extends FieldValues>(form: UseFormReturn<V>, opts: {
  onSubmit: (values: V) => unknown | Promise<unknown>
  elementFor?: (path: string) => HTMLElement | null
}): FormAdapter<V>
```

**Behaviour:**
- `setValues`: for each path `form.setValue(path, value === null ? emptyFor(current) : value, { shouldDirty: true, shouldValidate: true, shouldTouch: false })`; `emptyFor` = `''` for strings, `null` otherwise.
- `dirtyPaths`: flattened leaf paths of `form.formState.dirtyFields` whose value is `true`.
- `submit`: `form.handleSubmit(onValid, onInvalid)()` wrapped in a promise → valid: `ok(await onSubmit(values))`; invalid: `invalid(issues)` from `formState.errors` (path + message); `onSubmit` throws → `error` result.
- `fields`: `Object.keys(flatten(form.getValues()))` mapped to `{ path, element: elementFor?.(path) ?? null }` (react-hook-form's mounted-field registry is private API, so it is not used).

**Tests (write first):** (real `useForm` with `zodResolver`-style resolver built inline from a zod 4 schema)
- `set_values_updates_form_and_marks_dirty`.
- `null_clears_string_to_empty`.
- `dirty_paths_reflect_user_typing` — Vitest browser-mode `userEvent.type` into an input → path listed.
- `submit_valid_calls_on_submit_ok`; `submit_invalid_returns_issues`.
- `end_to_end_fill_skips_user_typed_field` — `useFormTool(rhfAdapter(form))`, user types title, `tm.call('x.fill')` → `skipped` contains `title`.

**Task gate:** `pnpm -F @toolmark/react exec vitest run test/rhf.test.tsx`

---

### Task 13: Inertia `useForm` adapter   (Lane D, risk: normal)

**Files:** Create `packages/inertia/src/inertia-adapter.ts`, `src/index.ts`; Test
`test/inertia-adapter.test.tsx`.

**Interfaces — Produces:**
```ts
function inertiaAdapter<V extends Record<string, unknown>>(form: InertiaFormLike<V>, opts: {
  submit: { method: 'post' | 'put' | 'patch' | 'delete'; url: string }
  elementFor?: (path: string) => HTMLElement | null
}): FormAdapter<V>
interface InertiaFormLike<V> { data: V; setData(data: V): void; errors: Partial<Record<string, string>>; submit(method: string, url: string, opts: { onSuccess?: () => void; onError?: (errors: Record<string, string>) => void; onFinish?: () => void }): void }
```

**Behaviour:**
- `setValues` applies all paths to a clone of `form.data` with `setPath` and calls `setData(clone)` once.
- `dirtyPaths` = leaf paths whose value differs from a snapshot of `form.data` taken when the adapter is first created (Inertia has no per-field dirty state).
- `submit` wraps `form.submit(method, url, …)`: `onSuccess` → `ok({})`; `onError(errors)` → `invalid` with each key as `path`; never hangs (`onFinish` without either → `ok({})`).
- Works with `@inertiajs/react` 2.x and 3.x (`InertiaFormLike` is structural).

**Tests (write first):** (render a component using the real `useForm` from `@inertiajs/react` 3.7.1; a second test file variant is run in CI against 2.3.28 — Task 16 wires the matrix)
- `set_values_single_set_data`.
- `dirty_paths_against_initial_snapshot`.
- `submit_success_ok` / `submit_errors_invalid` — mock `router` visit via `form.submit` spy.

**Task gate:** `pnpm -F @toolmark/inertia exec vitest run test/inertia-adapter.test.tsx`

---

### Task 14: Testing package   (Lane E, risk: normal)

**Files:** Create `packages/testing/src/index.ts`, `src/fixture.ts`, `src/matchers.ts`,
`src/test-toolmark.ts`, `src/page/install-test-hook.ts`; Test `test/test-toolmark.test.ts`,
`test/fixture.spec.ts`, `test/fixture-page/index.html`, `test/fixture-page/main.ts`,
`playwright.config.ts` (its `webServer` runs `vite test/fixture-page --port 5179`; the page registers
two tools, one consequential, and calls `installTestHook`).

**Interfaces — Produces:**
```ts
// browser entry "@toolmark/testing/page"
function installTestHook(tm: Toolmark): () => void     // sets globalThis.__toolmark_test__
// node entry "@toolmark/testing"
const test: TestType<{ tools: ToolsFixture }, {}>       // extends @playwright/test
const expect: Expect<…with matchers…>
interface ToolsFixture {
  list(): Promise<ToolManifestSummary[]>
  get(name: string): Promise<ToolManifest>
  call(name: string, input?: unknown): Promise<ToolResult<unknown>>
  confirm(confirmId: string, outcome: ConfirmOutcome): Promise<ToolResult<unknown>>
  autoConfirm(on: boolean): void
}
// matchers: toHaveTools(names: string[]), toBeConsequential(), toBeReadOnly(), toHaveChanged(path: string, after: unknown)
function createTestToolmark(opts?: ToolmarkOptions): Toolmark & { calls: Array<{ tool: string; input: unknown; result: ToolResult<unknown> }>; approveAll(): Promise<void> }
```

**Exact values:** hook global `__toolmark_test__`; missing-hook error message
`"Toolmark test hook not found: call installTestHook(toolmark) in your app's test build"`; hook
wait timeout `5000` ms; package exports `"."` and `"./page"`.

**Behaviour:**
- Fixture calls run with caller `test` (deferred confirmation); `autoConfirm(true)` approves any `needs_confirmation` by calling `confirm` automatically and returns the final result.
- `toHaveTools` asserts a subset; `toHaveChanged` asserts an `ok` result's `changes` contains `{ path, after }`.
- `createTestToolmark` sets every caller to deferred mode and records every `result` event.

**Tests (write first):**
- `test_toolmark_records_calls`; `approve_all_runs_pending`.
- `fixture.spec.ts`: `lists_and_calls_tools`, `auto_confirm_runs_consequential`, `missing_hook_error_message`, `matchers_pass_and_fail_with_messages`.

**Task gate:** `pnpm -F @toolmark/testing exec vitest run && pnpm -F @toolmark/testing exec playwright test`

---

### Task 15: Example app `examples/react-vite` with end-to-end tests   (Lane F, risk: normal)

**Files:** Create `examples/react-vite/package.json`, `vite.config.ts`, `index.html`,
`src/main.tsx`, `src/app.tsx`, `src/challenge-form.tsx`, `src/in-page-agent.ts`,
`playwright.config.ts`, `e2e/form.spec.ts`; Modify `packages/core/src/index.ts` (export bridge
names from `./bridge/index.ts` — Lane F's one allowed core edit).

**Behaviour:**
- A react-hook-form + zod 4 challenge form (title `{ ar, en }`, type enum, startsAt date) registered via `useFormTool(rhfAdapter(form, …))` inside `<ToolScope name="challenges">`.
- A scripted in-page agent (no LLM) using `createInPageChannel` + `bridge` issues `call`s, and a confirm card rendered from `usePendingConfirmations`.
- `installTestHook(tm)` in the example.

**Tests (write first):** `e2e/form.spec.ts`
- `agent_fill_updates_visible_fields` — `tools.call('challenges.create.fill', …)` → inputs show values; `toHaveChanged`.
- `user_typed_field_is_skipped`.
- `submit_needs_confirmation_then_confirm_card_approves`.
- `bridge_round_trip_via_in_page_agent`.

**Task gate:** `pnpm -F @toolmark-examples/react-vite exec playwright test`

---

### Task 16: Docs, changeset, CI   (Lane F, risk: normal)

**Files:** Create `docs/protocol-v1.md`, `docs/guides/laravel-reference.md`,
`packages/*/README.md` (four), `.changeset/initial-release.md`, `.github/workflows/ci.yml`.

**Exact values:** CI on `push` and `pull_request`; Node `22`; jobs: `lint`, `typecheck`,
`test` (matrix `inertia: ['2.3.28', '3.7.1']`, installs the matrix version into the inertia
package for that job), `build`, `types-ts7` (installs `typescript@7.0.2` in a temp dir and runs
`tsc --noEmit` on a file importing every public entry), `e2e` (examples/react-vite).

**Behaviour:**
- `protocol-v1.md` documents every message, the §12.2 rules (including the security MUSTs), the LLM exposure pattern (`page_call`/`page_describe` descriptions to copy) and links the emitted JSON Schema files.
- `laravel-reference.md` gives copyable PHP for `PageCallTool`, `PageDescribeTool`, a protocol-v1 `BrowserBridge` (private channel broadcast, authenticated POST endpoint validating user/conversation/clientId/call-id binding and deadline, Redis `BLPOP` hand-off with cache polling fallback), and the `confirmed` handler. It is marked "reference — copy into your app; not a package".
- Changeset declares `minor` pre-release for all four packages (`-next` pre mode: `changeset pre enter next`).

**Tests:** none beyond CI running green on the branch; the reviewer checks the Laravel reference against §12.2 line by line.

**Task gate:** `pnpm lint && pnpm typecheck && pnpm test && pnpm build` (lane gate), then CI green on push.

---

## Self-review

- **Spec coverage (M1 scope):** §5 → T2/T4/T5; §6 → T2/T3/T5; §7 → T5; §8.1 → T6/T11/T12/T13;
  §9 (`useTool`, scopes, confirm hooks, activity) → T10/T11; §10.1 `inertiaAdapter` → T13
  (`inertiaPages`, navigation, props tools → M2 by ruling); §11.1 → T8/T9; §11.6 → T14; §12.1–12.3 →
  T7/T8/T16; §12.5 → T16; §14 (no eval, dev/prod, prompt-injection flag passthrough) → T1/T4/T5;
  §18 unit/DOM/contract/E2E → T3–T15. `useToolAnchor`, files, wizard, options, arrays → M2/M3.
- **Placeholders:** none; every task has exact names, values and tests.
- **Names:** `createFormTools`, `FormAdapter.setValues/dirtyPaths/submit/fields`, `ConfirmQueue`,
  `PendingConfirmation`, `bridge`, `BridgeTransport`, `createInPageChannel` are used identically in
  every task that consumes them; overview registry updated accordingly.
- **File ownership:** each file belongs to one lane; `tsdown.config.ts` entry lines for transports
  granted to Lane B explicitly; `packages/core/src/index.ts` bridge export line granted to Lane F.
