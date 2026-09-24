# Toolmark M1 — Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `sdd-lanes` to implement this plan lane by lane.
> Plan-lite format: exact contracts, behaviour and tests; no complete implementation code.

**Goal:** A working Toolmark core: workspace, registry with policy/confirmation/forms, bridge
protocol v1 with four transports, React + react-hook-form bindings, the Inertia `useForm` adapter,
the testing package, a runnable example whose simple-form task completes within the round budget
(≤ 3 agent rounds, `e2e/round-budget.spec.ts`), CI, and the tarball smoke test
(`scripts/tarball-smoke.mjs`).

**Architecture:** Registry-first (spec §3). `@toolmark/core` owns the tool model, call pipeline,
confirmation, form-tool semantics and the protocol; framework packages are thin bindings over core;
the bridge is a consumer attached with `tm.use()`.

**Tech Stack:** pnpm 12.6.0 workspace, TypeScript 6.0.3 (7.0.2 only in the tarball smoke / CI types
check), tsdown 0.23.0, Vitest 5.0.1 (node + browser mode via Playwright 1.63.0), Vite 8.3.1, ESLint
10.11.0 + typescript-eslint 8.70.1, React 19.3.0 (18.3.1 in the CI matrix), react-hook-form 7.88.0,
@inertiajs/react 3.7.1 (+2.3.28 in the CI matrix), changesets 3.0.3, tsx (pinned at M1 start).

**Spec:** `docs/superpowers/specs/2026-09-24-toolmark-design.md` §1 (success criterion 1), §4–§9,
§10.1 (`inertiaAdapter`), §11.1, §11.6, §12, §14, §17, §18, §20 (M1 row), §23. Overview + global
constraints: `docs/superpowers/plans/2026-09-24-toolmark-00-overview.md` (every task inherits them,
including "Release independence", the tsdown settings, the `@toolmark/source` condition, root-script
scope, TSDoc-with-every-export and the CI matrix).

## Global constraints (M1 additions to the overview's list)

- `ToolmarkOptions.dev` (boolean, default `false`) selects development behaviour: misconfiguration
  **throws** a `ToolmarkError`; otherwise it is rejected and reported as an `error` event (spec §14).
- **Confirmation modes (spec §7):** `inapp` and `test` are configurable, default `'deferred'`;
  `webmcp`, `mcp`, `tour` are always `'inline'` (any other value → `invalid_confirm_mode`, dev throw /
  prod event, value ignored); `human` never confirms.
- **Default policy (spec §7, §23 "Policy semantics"):** `readOnly` and unhinted tools → all callers;
  `consequential` → `inapp`, `webmcp`, `mcp`, `tour`, `test`, `human`; `destructive` → `inapp`,
  `test`, `human`.
- Per-scope call queue limit: `32` pending calls; beyond → `refused` code `busy`.
- Abort grace period: `ToolmarkOptions.abortGraceMs`, default `5000` ms (spec §14).
- Undo store: at most `100` entries (oldest evicted).
- Bridge remembers the last `1000` answered `call`/`describe` ids to drop duplicates; inbound
  messages are bounded to `maxMessageBytes` (default `1048576`, UTF-8 bytes of the serialized
  message) and nesting depth `64`.
- **Codes (exact strings; M4 consolidates them in `docs/reference/codes.md`):**
  - `refused` codes: `unknown_tool`, `stale`, `not_allowed`, `busy`, `undo_unavailable`,
    `confirmation_expired`.
  - `error` event codes: `duplicate_name`, `invalid_name`, `missing_confirm_handler`,
    `schema_conversion_failed`, `tool_threw`, `output_invalid`, `transport_failed`,
    `tool_budget_exceeded`, `ctx_confirm_unavailable`, `invalid_confirm_mode`, `invalid_policy`,
    `late_result`, `invalid_message`, `scope_disposed`.
  - `ToolmarkError` codes thrown/rejected only (never events): `invalid_path` (path helpers),
    `files_not_configured` (`ctx.files.resolve` in M1).
- Tool budget (spec D21): `ToolmarkOptions.budget` default `40` visible tools; exceeding it emits
  `tool_budget_exceeded` once per revision, **in `dev` only** (never throws).
- **Ids** (`clientId`, `callId`, `confirmId`) come from `newId()`: `crypto.randomUUID()` when it
  exists, else an RFC 4122 v4 UUID built from `crypto.getRandomValues(new Uint8Array(16))`
  (`randomUUID` is secure-context only). Never `Math.random`.
- **Confirm rule (spec §7, D7):** registration fails with `missing_confirm_handler` **only** when a
  consequential/destructive tool has no confirmation path for **any** caller allowed to use it (a
  path = deferred mode, or inline mode with an inline `confirm` handler configured). A caller whose
  mode is `inline` while no inline handler is configured does not see the tool (filtered from
  `manifest`/`describe` for that caller) and a call from it returns `refused` `not_allowed`; one
  dev-only `error` event `missing_confirm_handler` (warning semantics, never throws) is emitted per
  such tool.
- **Untrusted input (spec §14):** agent input never writes a path the tool's schema does not declare;
  any path segment `__proto__`, `prototype` or `constructor` is rejected.
- **Privacy (spec §14):** form-tool `changes` (fill and undo results) report sensitive paths with
  `before`/`after` = `'[redacted]'`. A path is sensitive when listed in `FormToolOptions.sensitive`,
  when its `FieldInfo.sensitive` is `true`, or when its `FieldInfo.element` is
  `input[type=password]` or has an `autocomplete` value starting with `cc-`.
- **Node-environment tests:** `createToolmark({ __environment })` stays as the undocumented test
  hook. Every node-project test in M1–M4 builds registries through
  `packages/core/test/helpers/create-test-registry.ts` (`createTestRegistry(opts)`, which sets
  `__environment: 'browser'`), or through `createTestToolmark` from `@toolmark/testing/vitest` where a
  package outside core needs one; only the SSR test passes `__environment: 'server'` directly.
- **Source-first resolution:** every package entry's `exports` has an `"@toolmark/source"` condition
  pointing at `src/*.ts`; Vitest/Vite and `tsc` resolve it, so tests and typecheck never need a prior
  build. The condition is internal and outside semver (overview).
- **Test imports:** tests import package code by the package's own name (`@toolmark/core`, resolved
  to source by the condition) or by relative `.js` specifiers; never `.ts` specifiers.
- **TSDoc (R5):** every task that adds a public export writes its TSDoc comment (one line minimum,
  `@param`/`@returns` where not obvious, `@internal` for `__environment`) in the same task; reviewers
  reject undocumented exports.
- **Pre-1.0 builds are tarballs:** nothing is published to npm before M5. The final lane packs
  `-next` versioned tarballs and verifies them with the tarball smoke test (Task 16). Handing them to
  any consumer is an optional courtesy, never a gate (overview "Release independence").

## Rulings made while planning

- **TypeScript 6.0.3** for the workspace: `typescript-eslint` 8.70.1 peers `<6.1.0`. TypeScript 7.0.2
  checks the packed `.d.ts` in the tarball smoke test (CI job `types-ts7`, Task 16).
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
  value the agent last set there (as stored by the adapter), so an agent can refine its own fill.

## Rulings made while fixing (pass 2 of the plan audit)

- `policy[c].allow` is optional (omitted → caller keeps its default hint classes, `tools` still
  applies); a `policy.human` entry → `invalid_policy` (dev throw / prod event, entry ignored).
- `websocketTransport` gains `terminalCloseCodes`, a `receive(timeoutMs?)` helper for `onOpen` and an
  `onStatus` callback in M1 Task 9 (M3 pairing consumes them) instead of M3 editing an M1 transport.
- The CI job `types-ts7` is the tarball smoke run (TS 6.0.3 and 7.0.2 over the packed types, `nodenext`
  and `bundler`, no custom conditions); there is no separate workspace-resolved TS 7 check.
- `docs/release/round-budget.md` is rendered by `scripts/render-round-budget.mjs` from the
  `ROUND_BUDGET_REPORT` JSON (one array entry per task), so M2 and M5 regenerate it the same way.
- The M1 code list is published as a section of `docs/protocol-v1.md`; M4 consolidates every code in
  `docs/reference/codes.md` (spec §6).
- `inertiaAdapter` settles on per-visit callbacks through the internal `visit-outcome.ts` mapping
  (both Inertia majors' callback names); a visit that finishes with no outcome callback is an `error`
  (`"Visit did not complete"`), never `ok`. M2's props tools reuse the mapping unchanged.
- App-declared sensitive paths are `FormToolOptions.sensitive?: string[]` (the name M3's `state()`
  redaction uses), and `FieldInfo` gains `sensitive?: boolean`; `FieldInfo.element` widens to
  `Element | null` (spec §13 anchors).
- An inline `ctx.confirm` that is aborted or expires resolves `{ approved: false, reason: 'signal' }`
  or `{ approved: false, reason: 'expired' }` (never throws, spec §5).

## Rulings made while fixing (pass 3, cross-plan consistency)

- The WebSocket transport hooks M3 needs (`receive(timeoutMs?)`, `onStatus`) are specified here in
  Task 9 as well as `terminalCloseCodes`; M3 never edits `websocket.ts`.
- The Inertia visit-outcome mapping lives in `packages/inertia/src/visit-outcome.ts` (Task 13) with
  both majors' callback names and abort support; M2 Lane D consumes it for props tools and does not
  edit `inertia-adapter.ts`.
- Converter-specific tests carry `zod3` in their names so the M5 zod 3 axis selects them with
  `-t zod3`.

## Review focus

1. **React StrictMode double mount** → tools are present after the remount and no `duplicate_name`
   error fires, including tools inside `<ToolScope>` (Task 10 tests `strict_mode_double_mount_keeps_tool`,
   `strict_mode_tool_inside_scope_registered_once`).
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
6. **Untrusted agent input** → `__proto__`/undeclared paths never written, `Object.prototype`
   untouched (Task 6 tests `fill_rejects_proto_path_no_pollution`, `fill_unknown_field_invalid`).
7. **A tool that ignores its abort signal** → the caller gets `cancelled` after the grace period and
   the scope queue moves on (Task 5 test `abort_releases_queue_after_grace`).

## File structure

```
package.json · pnpm-workspace.yaml · tsconfig.base.json · eslint.config.js · .prettierrc.json
vitest.config.ts · .changeset/config.json · .changeset/pre.json · .changeset/initial-release.md
.gitignore · .npmrc · LICENSE · README.md · .github/workflows/ci.yml
scripts/tarball-smoke.mjs · scripts/tarball-smoke.test.mjs · scripts/render-round-budget.mjs
packages/core/      package.json tsconfig.json tsconfig.test.json tsdown.config.ts vitest.node.config.ts README.md
  src/index.ts                 public exports
  src/standard-schema.ts       vendored Standard Schema v1 + Standard JSON Schema types
  src/tool.ts                  ToolDefinition, ToolHints, Caller, ToolContext, AnchorSpec, ToolState, FileRef, defineTool
  src/names.ts                 isValidToolName, toLlmName
  src/result.ts                ToolResult, FieldChange, ok/invalid/refuse/cancelled
  src/errors.ts                ToolmarkError
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
  src/forms/paths.ts           flatten/get/set by dot path (proto-safe)
  src/forms/form-tools.ts      createFormTools
  src/protocol/messages.ts     message types
  src/protocol/schemas.ts      JSON Schemas (draft 2020-12)
  src/protocol/validate.ts     validateMessage
  src/protocol/index.ts
  src/bridge/bridge.ts         bridge consumer
  src/bridge/transport.ts      BridgeTransport type
  src/bridge/index.ts · echo.ts · websocket.ts · post-message.ts · in-page.ts
  scripts/emit-protocol-schemas.ts
  test/*.test.ts · test/fixtures/protocol/*.json
  test/helpers/create-test-registry.ts   createTestRegistry (sets __environment: 'browser')
packages/react/     package.json tsconfig.json tsconfig.test.json tsdown.config.ts vitest.config.ts README.md
  src/index.ts context.ts provider.tsx scope.tsx use-tool.ts use-agent-activity.ts
  src/use-form-tool.ts use-confirm-queue.ts use-pending-confirmations.ts
  src/rhf/index.ts
  test/*.test.tsx
packages/inertia/   package.json tsconfig.json tsconfig.test.json tsdown.config.ts vitest.config.ts README.md
  src/index.ts inertia-adapter.ts visit-outcome.ts (internal)   test/inertia-adapter.test.tsx test/visit-outcome.test.ts
packages/testing/   package.json tsconfig.json tsconfig.test.json tsdown.config.ts vitest.config.ts README.md
  src/index.ts vitest.ts fixture.ts matchers.ts test-toolmark.ts page/install-test-hook.ts
  test/*.test.ts · test/fixture.spec.ts · test/fixture-page/* · playwright.config.ts
examples/react-vite/  package.json tsconfig.json vite.config.ts index.html playwright.config.ts
  src/main.tsx app.tsx challenge-form.tsx in-page-agent.ts
  e2e/form.spec.ts e2e/round-budget.spec.ts e2e/support/round-recorder.ts
docs/protocol-v1.md · docs/guides/laravel-reference.md
docs/release/next-tarballs.md · docs/release/round-budget.md
```

## Lanes

| Wave | Lane | Tasks | Owns files | Consumes (from) |
| --- | --- | --- | --- | --- |
| 0 | A (high) | 1–7 | root config (`package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `eslint.config.js`, `.prettierrc.json`, `vitest.config.ts`, `.changeset/config.json`, `.gitignore`, `.npmrc`, `LICENSE`, `README.md`), every `packages/*/{package.json,tsconfig.json,tsconfig.test.json,tsdown.config.ts,vitest*.config.ts}`, `examples/react-vite/{package.json,tsconfig.json}`, `pnpm-lock.yaml`, `packages/core/src/**` except `bridge/`, `packages/core/scripts/**`, `packages/core/test/helpers/**`, core tests for those | — |
| 1 | B (high, security) | 8–9 | `packages/core/src/bridge/**`, `packages/core/test/bridge*.test.ts`, `packages/core/test/transport-*.test.ts`; the bridge entry lines of `packages/core/tsdown.config.ts` | A |
| 1 | C (normal) | 10–12 | `packages/react/src/**`, `packages/react/test/**` | A |
| 1 | D (normal) | 13 | `packages/inertia/src/**`, `packages/inertia/test/**` | A |
| 1 | E (normal) | 14 | `packages/testing/src/**`, `packages/testing/test/**`, `packages/testing/playwright.config.ts` | A |
| 2 | F (high, security for T16) | 15–16 | `examples/react-vite/**` except `package.json`/`tsconfig.json`, `docs/**` except `docs/superpowers/**` and `docs/ROADMAP.md`, `packages/*/README.md`, `scripts/**` (repo root), `.github/workflows/ci.yml`, `.changeset/initial-release.md`, `.changeset/pre.json`; during the Task 16 hand-off only, the `version` fields and `CHANGELOG.md` files that `pnpm changeset version` writes | A–E |

Shared-file rules: `pnpm-lock.yaml` and every `package.json` (including the example's) are **Lane A
only** — Task 1 declares all M1 dependencies up front; Wave-1 and Wave-2 lanes must not add
dependencies (report to the controller instead). `packages/core/src/index.ts` is Lane A's alone; the
bridge is published only through the `@toolmark/core/bridge*` subpaths (spec §4) and is never
re-exported from the core root. Lane B exports its symbols from `packages/core/src/bridge/index.ts`
and the per-transport entry files. `packages/core/test/helpers/**` is Lane A's; other lanes import it
read-only. Lane A creates `export {}` stubs for the react/inertia/testing tsdown entries in Task 1;
the owning Wave-1 lane replaces them. The only exception to "one owner per file" is the Task 16
`pnpm changeset version` step listed above.

---

### Task 1: Workspace scaffold and tooling   (Lane A, risk: normal)

**Files:** Create root `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`,
`eslint.config.js`, `.prettierrc.json`, `vitest.config.ts`, `.changeset/config.json`, `.npmrc`,
`LICENSE`, `README.md`; Modify `.gitignore` (exists: `.superpowers/`, `.DS_Store`); for each of
`core`, `react`, `inertia`, `testing`: `package.json`, `tsconfig.json`, `tsconfig.test.json`,
`tsdown.config.ts`, `src/index.ts` (empty export), plus the Vitest project config
(`packages/core/vitest.node.config.ts`; `vitest.config.ts` for the other three);
stub sources for every other tsdown entry of react/inertia/testing (`packages/react/src/rhf/index.ts`,
`packages/testing/src/vitest.ts`, `packages/testing/src/page/install-test-hook.ts`; `export {}`, owned
by Lanes C and E afterwards); `examples/react-vite/package.json`, `examples/react-vite/tsconfig.json`;
`packages/core/test/smoke.test.ts`.

**Interfaces:** Produces the workspace scripts (packages only, R7): root
`pnpm build` = `pnpm -r --filter "./packages/*" build`, `pnpm typecheck` =
`pnpm -r --filter "./packages/*" typecheck`, `pnpm lint` = `pnpm -r --filter "./packages/*" lint`,
`pnpm test` = `vitest run`, `pnpm format:check` = `prettier --check .`. Each package: `build`
(`tsdown`), `typecheck` (`tsc -p tsconfig.test.json`), `lint` (`eslint .`). The example: `dev`
(`vite --port 5173 --strictPort`), `build` (`vite build`), `typecheck` (`tsc -p tsconfig.json`), `e2e`
(`playwright test`).

**Exact values:**
- Root `packageManager`: `"pnpm@12.6.0"`; `engines.node`: `">=22.12"` (root and every package).
- `pnpm-workspace.yaml`: `packages: ['packages/*', 'examples/*']` and a `catalog:` with every
  version in the overview's dev-tool table (except the M5-only zod 3 axis row; later milestones only
  verify or bump catalog entries, overview "Shared files across milestones"), plus `playwright` 1.63.0, `@testing-library/dom`,
  `@eslint/js` and `tsx` (the last three pinned with `npm view <pkg> version` at M1 start and recorded
  in the milestone ledger).
- Root devDeps (all `catalog:`): `typescript`, `vitest`, `@vitest/browser`,
  `@vitest/browser-playwright`, `playwright`, `@playwright/test`, `eslint`, `@eslint/js`,
  `typescript-eslint`, `prettier`, `tsdown`, `@changesets/cli`, `@types/node` (22.x), `tsx`.
  `@vitest/browser-playwright` peers `vitest` exactly (`5.0.1`): bump both together.
- Every `packages/*/package.json`: `"version": "0.0.0"`, `"type": "module"`, `"sideEffects": false`,
  `"license": "MIT"`, `"description"` (one sentence), `"repository": { "type": "git", "url":
  "git+https://github.com/adams100111/toolmark.git", "directory": "packages/<name>" }`, `"files":
  ["dist", "src"]`, and `"./package.json": "./package.json"` in `exports`.
- Package deps: `core` — none (dev: `zod`, `zod-to-json-schema`, `ajv` 8.20.0, `ajv-formats` 3.0.1,
  `tsx`, `@types/node`); `react` — dep `@toolmark/core: workspace:*`, peers `react >=18.3.0 <20`,
  `react-hook-form ^7.0.0` (optional), dev `react`, `react-dom`, `@types/react`, `@types/react-dom`,
  `react-hook-form`, `zod`, `@testing-library/react`, `@testing-library/dom`, `@vitest/browser`,
  `@vitest/browser-playwright`, `playwright`; `inertia` — dep `@toolmark/core: workspace:*`, peers
  `@inertiajs/react ^2.0.0 || ^3.0.0`, `react >=18.3.0 <20`, dev `@inertiajs/react` (3.7.1) + the
  react dev set; `testing` — dep `@toolmark/core: workspace:*`, peer `@playwright/test ^1.63.0`
  (optional in `peerDependenciesMeta`), dev `@playwright/test`, `vite`, `@types/node`;
  `examples/react-vite` (created here, owned by Lane A) — private package
  `@toolmark-examples/react-vite` with `vite`, `@vitejs/plugin-react`, `react`, `react-dom`,
  `react-hook-form`, `zod`, `@playwright/test`, `typescript`, `@types/react`, `@types/react-dom`,
  `@types/node`, and the four `workspace:*` packages.
- `exports` (every code entry uses the condition order `{ "@toolmark/source": "./src/<file>.ts",
  "types": "./dist/<entry>.d.ts", "import": "./dist/<entry>.js" }`):

  | Package | Subpath | Source | Dist entry | tsdown platform |
  | --- | --- | --- | --- | --- |
  | core | `.` | `src/index.ts` | `index` | neutral |
  | core | `./protocol` | `src/protocol/index.ts` | `protocol/index` | neutral |
  | core | `./protocol/v1/*.json` | — (no source condition) | `dist/protocol/v1/*.json` (emitted) | — |
  | core | `./bridge` | `src/bridge/index.ts` | `bridge/index` | neutral |
  | core | `./bridge/echo` · `/websocket` · `/post-message` · `/in-page` | `src/bridge/<name>.ts` | `bridge/<name>` | neutral |
  | react | `.` · `./rhf` | `src/index.ts` · `src/rhf/index.ts` | `index` · `rhf/index` | neutral |
  | inertia | `.` | `src/index.ts` | `index` | neutral |
  | testing | `.` | `src/index.ts` | `index` | node |
  | testing | `./vitest` | `src/vitest.ts` | `vitest` | neutral |
  | testing | `./page` | `src/page/install-test-hook.ts` | `page/install-test-hook` | neutral |

  Subpaths whose sources arrive later (core `./protocol` in Task 7, `./bridge*` in Task 9) are
  declared now; the task that creates the source adds its tsdown entry.
- Every `tsdown.config.ts`: `format: ['esm']`, `dts: true`, `fixedExtension: false`, `target:
  'es2022'`, `clean: true`, `entry` as a named map (e.g. `{ index: 'src/index.ts' }`), `platform` per
  the table (a package with mixed platforms uses one config per platform in an array), peers and
  `@toolmark/*` external.
- `tsconfig.base.json`: `"strict": true`, `"exactOptionalPropertyTypes": true`,
  `"noUncheckedIndexedAccess": true`, `"verbatimModuleSyntax": true`, `"target": "ES2022"`,
  `"module": "NodeNext"`, `"moduleResolution": "NodeNext"`, `"lib": ["ES2022","DOM","DOM.Iterable"]`,
  `"customConditions": ["@toolmark/source"]`, `"types": []`. Each package `tsconfig.json` includes
  `src` (used by tsdown's dts); `tsconfig.test.json` extends it with `"noEmit": true`, includes
  `src`, `test`, `scripts` (core) and `*.config.ts`, and sets `"types": ["node"]` for core and
  testing; react/inertia add the Vitest 5 browser-mode types (confirm the type entry name with ctx7
  at execution).
- ESLint (`eslint.config.js`, flat): `@eslint/js` recommended + typescript-eslint
  `recommendedTypeChecked` with `parserOptions.projectService: true`; `no-eval`, `no-new-func`,
  `no-implied-eval` = `error`; `**/*.{js,mjs,cjs}` files use `tseslint.configs.disableTypeChecked`;
  `ignores` exactly the overview list (`**/dist/**`, `**/.next/**`,
  `examples/inertia-laravel/{vendor,public/build,storage}/**`, `docs/api/**`,
  `docs/.vitepress/{cache,dist}/**`, `**/test-results/**`, `**/playwright-report/**`).
- Root `vitest.config.ts` lists projects **explicitly** (no nested project lists):
  `test.projects: ['packages/core/vitest.node.config.ts', 'packages/react/vitest.config.ts',
  'packages/inertia/vitest.config.ts', 'packages/testing/vitest.config.ts']`; later milestones append
  their configs to this list. Project names: `core-node`, `react`, `inertia`, `testing`.
- `core-node`: `environment: 'node'`, include `test/**/*.test.ts`, exclude
  `test/{dom,browser}-*.test.ts` (browser-mode files arrive in M2). react/inertia run browser mode:
  `browser.enabled: true`, `provider: playwright()` (from `@vitest/browser-playwright`), `instances:
  [{ browser: 'chromium' }]`, headless. `testing`: `environment: 'node'`, include
  `['test/**/*.test.ts']` (so Playwright's `*.spec.ts` files are never collected by Vitest).
- Every Vitest/Vite config sets `resolve.conditions` **and** `ssr.resolve.conditions` to
  `['@toolmark/source', …the defaults]` (Vitest turns `ssr.resolve.conditions` into worker
  `--conditions`; re-check option names with ctx7 at execution) so workspace imports resolve to
  `src/*.ts` without a build.
- Core gates run from the root with `pnpm exec vitest run --project core-node <files>`; other
  packages keep `pnpm -F <pkg> exec vitest run <files>` (their single `vitest.config.ts`).
- `.changeset/config.json`: `"access": "public"` (takes effect only at the M5 publish),
  `"baseBranch": "main"`, `"fixed": [["@toolmark/*"]]`, `"privatePackages": { "version": false,
  "tag": false }`. Pre mode `next` is used for **version numbers only**: no workflow or task before M5
  runs `changeset publish`.
- `.gitignore` adds `dist/`, `node_modules/`, `dist-tarballs/`, `.next/`, `docs/api/`,
  `docs/.vitepress/cache/`, `docs/.vitepress/dist/`, `test-results/`, `playwright-report/`,
  `*.tsbuildinfo`, `round-budget.json` to the existing entries.

**Behaviour:**
- `pnpm install` succeeds from clean; `pnpm exec playwright install chromium` is documented in
  README and run once.
- `pnpm build` emits `dist/<entry>.js` + `dist/<entry>.d.ts` (never `.mjs`/`.d.mts`) for all four
  packages; `pnpm typecheck`, `pnpm lint` pass.

**Tests (write first):**
- `smoke_imports_core` — `import * as core from '@toolmark/core'` → module object is defined.

**Task gate:** `pnpm install && pnpm build && test -f packages/core/dist/index.js && test -f packages/core/dist/index.d.ts && pnpm typecheck && pnpm lint && pnpm exec vitest run --project core-node test/smoke.test.ts`

---

### Task 2: Tool model, names, results, ids, vendored Standard Schema   (Lane A, risk: normal)

**Files:** Create `packages/core/src/standard-schema.ts`, `src/tool.ts`, `src/names.ts`,
`src/result.ts`, `src/errors.ts`, `src/ids.ts`; Modify `src/index.ts`; Test `test/names.test.ts`,
`test/result.test.ts`, `test/ids.test.ts`.

**Interfaces — Produces:**
```ts
type Caller = 'inapp' | 'webmcp' | 'mcp' | 'test' | 'tour' | 'human'
interface ToolHints { readOnly?: boolean; consequential?: boolean; destructive?: boolean; untrustedContent?: boolean }
interface ToolDefinition<I = unknown, O = unknown> {
  name: string; title?: string; description: string
  input?: StandardSchemaV1<unknown, I>; output?: StandardSchemaV1<unknown, O>
  jsonSchema?: JsonSchema; hints?: ToolHints
  summary?: (input: I) => string
  anchors?: AnchorSpec; state?: () => ToolState<I>        // declared now, behaviour in M3
  run(input: I, ctx: ToolContext): ToolResult<O> | Promise<ToolResult<O>>
}
interface AnchorSpec { element?: () => Element | null; params?: Record<string, () => Element | null> }
interface ToolState<I> { values: Partial<I>; issues: { path: string; message: string }[]; step?: string }
type FileRef = { ref: string } | { url: string }          // declared now, implemented in M2
interface ToolContext {
  signal: AbortSignal; callId: string; caller: Caller
  confirm(req: { summary: string; changes?: FieldChange[] }): Promise<ConfirmOutcome>
  registerUndo(restore: () => ToolResult<unknown> | Promise<ToolResult<unknown>>): void
  files: { resolve(ref: FileRef): Promise<File> }
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
class ToolmarkError extends Error { readonly code: string; constructor(code: string, message: string, options?: { cause?: unknown }) }
function isValidToolName(name: string): boolean
function toLlmName(fullName: string): string
function newId(): string
```

**Exact values:** name regex `^[A-Za-z0-9_.-]{1,128}$`; `llmName` regex `^[a-zA-Z0-9_-]{1,64}$`;
long-name rule: first 55 chars + `_` + 8 lowercase hex of 32-bit FNV-1a (offset `0x811c9dc5`, prime
`0x01000193`) over the UTF-8 bytes of the full name. `newId()` format: lowercase
`xxxxxxxx-xxxx-4xxx-[89ab]xxx-xxxxxxxxxxxx`.

**Behaviour:**
- `standard-schema.ts` copies `StandardSchemaV1`, `StandardTypedV1` and `StandardJSONSchemaV1`
  interfaces from `@standard-schema/spec` 1.1.0 verbatim (types only, header comment with source).
- `toLlmName` replaces every `.` with `__`, then applies the long-name rule; the result always
  matches the llmName regex.
- Result helpers return frozen plain objects (structured-cloneable).
- `newId()` uses `crypto.randomUUID()` when it is a function, else sets the version/variant bits on
  `crypto.getRandomValues(new Uint8Array(16))` and formats it.

**Tests (write first):**
- `valid_names` — `a`, `challenges.create.fill`, 128 chars → true; `""`, `a b`, `a/b`, 129 chars → false.
- `llm_name_replaces_dots` — `challenges.create.fill` → `challenges__create__fill`.
- `llm_name_long_is_hashed_and_stable` — 100-char name → length 64, matches regex, same input gives same output, different inputs differ.
- `result_helpers_shapes` — each helper returns the exact spec §6 shape; `refuse('stale','x',{rev:3})` includes `rev: 3`.
- `results_are_structured_cloneable` — `structuredClone(ok({a:1}))` deep-equals the original.
- `new_id_falls_back_without_random_uuid` — stub `crypto.randomUUID` to `undefined` → 1000 ids, all v4 format, all unique.

**Task gate:** `pnpm exec vitest run --project core-node test/names.test.ts test/result.test.ts test/ids.test.ts && pnpm -F @toolmark/core typecheck`

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
- `resolve_uses_global_converter_for_zod3` — zod 3 schema (`zod/v3` import of the dev zod package) + `zodToJsonSchema` converter → ok. (Converter-specific: every converter-specific test has `zod3` in its name and imports only `zod/v3` + `zod-to-json-schema`; the M5 zod 3 axis runs `pnpm exec vitest run --project core-node -t zod3`.)
- (The register-level failure tests `resolve_fails_dev_throws` / `resolve_fails_prod_event` live in Task 4's `test/registry-schema.test.ts`.)
- `strip_required_recursive_and_pure` — nested required arrays removed; original unchanged.

**Task gate:** `pnpm exec vitest run --project core-node test/schema.test.ts`

---

### Task 4: Registry, scopes, manifest, events, revisions, policy options   (Lane A, risk: high)

**Files:** Create `src/events.ts`, `src/scope.ts`, `src/manifest.ts`, `src/registry.ts`,
`packages/core/test/helpers/create-test-registry.ts`; Modify `src/index.ts`; Test
`test/registry.test.ts`, `test/registry-schema.test.ts`, `test/registry-options.test.ts`,
`test/manifest.test.ts`.

**Interfaces — Produces:**
```ts
type HintClass = 'readOnly' | 'default' | 'consequential' | 'destructive'
interface CallerPolicy { allow?: HintClass[]; tools?: { allow?: string[]; deny?: string[] } }
interface ToolmarkOptions {
  dev?: boolean
  confirm?: (req: ConfirmRequest) => Promise<ConfirmOutcome>       // inline handler
  confirmMode?: { inapp?: 'deferred' | 'inline'; test?: 'deferred' | 'inline'; webmcp?: 'inline'; mcp?: 'inline'; tour?: 'inline' }
  policy?: Partial<Record<Exclude<Caller, 'human'>, CallerPolicy>>
  jsonSchema?: JsonSchemaConverter
  confirmExpiryMs?: number                                         // default 600000
  abortGraceMs?: number                                            // default 5000
  budget?: number                                                  // default 40 (dev warning only)
  onError?: (e: ToolmarkErrorEvent) => void
  /** @internal undocumented test hook; overrides the isBrowser() check */
  __environment?: 'browser' | 'server'
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
function createToolmark(options?: ToolmarkOptions): Toolmark
// packages/core/test/helpers/create-test-registry.ts (test-only, not exported from the package)
function createTestRegistry(opts?: ToolmarkOptions): Toolmark   // createToolmark({ dev: true, ...opts, __environment: 'browser' })
```

**Behaviour:**
- Full name = scope path + `.` + local name (root scope path is `""`). Invalid full name → `invalid_name` (throw in dev / event in prod, tool not registered).
- Duplicate live full name → `duplicate_name` (throw in dev / event in prod). Disposal is synchronous so dispose-then-register of the same name succeeds.
- `register` into a disposed scope → `scope_disposed` (dev throw / prod event), not registered.
- Removal via `Registration.dispose()`, `signal` abort, or scope disposal (disposes all descendants). No unregister-by-name.
- A scope with `when: false` (or any ancestor with `when: false`) hides its tools from `manifest`/`describe`/`call` (call → `refused` `unknown_tool`).
- **Revisions:** `rev` starts at 0 and increments **synchronously** on the first mutation after the last notification (so `manifest()` right after `register` already carries the new `rev`); later mutations in the same microtask do not increment again; `subscribe` listeners and the `change` event fire once in a microtask with the latest `rev`. Creating a scope with no tools does not change `rev`.
- **Options validation at `createToolmark`:** `confirmMode` values other than listed (e.g. `webmcp: 'deferred'`, a `human` key) → `invalid_confirm_mode`; a `policy.human` entry or an unknown hint class → `invalid_policy`. Dev throws; prod emits the event and ignores that entry.
- **Policy semantics (spec §7):** `policy[c].allow`, when present, **replaces** caller `c`'s default hint classes (widening allowed, e.g. `destructive` for `webmcp`); callers not listed keep defaults; `human` is fixed. `policy[c].tools` filters by full name or `prefix.*`: with `allow`, only matching tools pass; `deny` wins over `allow`. A tool is visible to a caller only when both its hint class and its name pass. `manifest()`/`describe()` **without** `caller` apply no policy filter (debug view); `when: false` still hides.
- `manifest` is sorted by full name, includes only tools the caller is allowed to see, and is JSON-safe.
- `use(consumer)` calls `consumer(tm)` and returns its disposer (idempotent).
- **Events:** `onError` receives every `error` event object after `events.on('error')` listeners. An exception thrown by `onError` or by any listener is caught, reported once per listener via `console.error`, and never breaks the pipeline or the registry.
- SSR (spec D24): when `typeof document === 'undefined'`, `register` and `use` are inert no-ops returning disposable handles, `manifest` returns `{ rev: 0, tools: [] }`, `call` returns `refused` `unknown_tool`. Controlled by an internal `isBrowser()` check that tests can override via `createToolmark({ __environment: 'browser' | 'server' })` (undocumented test hook). Every node-project test builds its registry with `createTestRegistry` (M1 constraints); only `ssr_is_inert` passes `'server'` directly.
- Confirm rule (M1 constraints): registering a consequential/destructive tool fails with `missing_confirm_handler` (dev throw / prod event, tool not registered) **only** when no caller allowed for its hint class has a confirmation path (deferred mode, or inline mode with `options.confirm`). Otherwise it registers; callers in inline mode without a handler are filtered out of `manifest`/`describe` for that tool, and one dev-only `missing_confirm_handler` warning event is emitted per such tool.

**Tests (write first):**
- `register_and_manifest_sorted` — three tools in two scopes → manifest names sorted, `llmName` present.
- `duplicate_name_dev_throws_prod_event` — both modes.
- `dispose_then_register_same_name_ok` — no error.
- `register_into_disposed_scope_rejected` — dev throws `scope_disposed`; prod → event, not registered.
- `scope_dispose_removes_descendants` — nested scopes → all tools gone, `rev` bumped once.
- `signal_abort_unregisters`.
- `when_false_hides_tools_and_refuses_call`.
- `rev_increments_synchronously` — `register` then `manifest()` in the same tick → new `rev`; 5 registrations → `rev` +1.
- `subscribe_batches_per_microtask` — 5 registrations in one tick → listener called once with final rev.
- `ssr_is_inert` — `__environment: 'server'` → register returns handle, manifest empty, no throw.
- `budget_exceeded_dev_event_only` — 41 tools with `dev: true` → one `tool_budget_exceeded` event; `dev: false` → none.
- `no_confirmation_path_dev_throws` — consequential tool, no `confirm` handler, `policy` `{ inapp: { allow: ['readOnly','default'] }, test: { allow: ['readOnly','default'] } }` (only inline callers remain for consequential) → dev throws `missing_confirm_handler`; prod → not registered + `error` event.
- `inline_callers_hidden_without_handler` — consequential tool, default policy, no `confirm` handler → registers (`inapp` is deferred); `manifest({ caller: 'webmcp' })` and `describe(name, { caller: 'mcp' })` omit it, `manifest({ caller: 'inapp' })` lists it; exactly one dev `missing_confirm_handler` event for the tool; `dev: false` → no event.
- `registry-schema.test.ts`: `resolve_fails_dev_throws`, `resolve_fails_prod_event` (review focus 5; the prod variant also asserts a call with invalid input still returns `invalid`).
- `registry-options.test.ts`: `policy_override_replaces_defaults` (`webmcp: { allow: ['readOnly'] }` hides unhinted tools from `webmcp` only; `destructive` added for `webmcp` shows it); `policy_tool_name_deny` (`deny: ['admin.*']` wins over `allow: ['admin.list']`); `no_caller_manifest_unfiltered`; `invalid_confirm_mode_rejected` (`webmcp: 'deferred'` dev throws / prod event); `policy_human_rejected` (`invalid_policy`); `on_error_receives_error_events`; `throwing_listener_does_not_break_call`.
- `manifest.test.ts`: `summary_omits_schema`, `full_includes_schema`, `describe_unknown_undefined`, `manifest_is_json_safe` (`JSON.parse(JSON.stringify(m))` deep-equals).

**Implementation notes:** keep one `Map<fullName, Entry>`; each `Entry` references its `Scope`
node; visibility = entry alive ∧ every ancestor `when !== false` ∧ policy for the caller. Batch
notifications with a `queueMicrotask` flag.

**Task gate:** `pnpm exec vitest run --project core-node test/registry.test.ts test/registry-schema.test.ts test/registry-options.test.ts test/manifest.test.ts`

---

### Task 5: Call pipeline, policy, confirmation, queue, undo   (Lane A, risk: high)

**Files:** Create `src/call.ts`, `src/policy.ts`, `src/confirm.ts`, `src/confirm-queue.ts`,
`src/queue.ts`, `src/undo.ts`; Modify `src/registry.ts`, `src/index.ts`; Test `test/call.test.ts`,
`test/policy.test.ts`, `test/confirm.test.ts`, `test/confirm-queue.test.ts`, `test/queue.test.ts`,
`test/undo.test.ts`, `test/ctx.test.ts`.

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
1. Resolve the tool for the caller. If it is missing or hidden for that caller: when `opts.rev` is given and differs from the current `rev` → `refused` `stale` with `rev`; otherwise → `refused` `unknown_tool` with `rev`. If the tool exists, a differing `rev` is ignored.
2. Policy (Task 4 semantics): caller not allowed for the tool's hint class or name → `refused` `not_allowed`. Hint class = `destructive` > `consequential` > `readOnly` > `default`. A consequential/destructive tool called by a caller whose mode is `inline` while no inline `confirm` handler is configured → `refused` `not_allowed` (confirm rule).
3. Emit `call`; validate input (Task 3) → `invalid` on failure.
4. Confirmation for consequential/destructive unless caller is `human`:
   - **deferred** mode → store a pending confirmation, emit `confirm` `pending`, return `needs_confirmation` `{ confirmId, summary, changes? }` (summary = `tool.summary?.(input)` ?? `tool.title` ?? tool name). `confirmPending(id, outcome)` consumes the `confirmId` **synchronously** on its first call (any later or concurrent call → `refused` `confirmation_expired`); approval re-validates any edited input, then enqueues the run as caller `human` on the tool's scope queue like any call (`busy` applies), emits `confirm` `approved` with the result, and returns it; rejection → `cancelled` `operator` + `confirm` `rejected`; after `confirmExpiryMs` → dropped, `confirm` `expired`, later `confirmPending` → `refused` `confirmation_expired`. Pending entries are dropped when their tool's scope is disposed (emit `expired`).
   - **inline** mode → `await options.confirm(req)` raced against the call signal and `confirmExpiryMs`; rejected → `cancelled` `operator`; signal abort → `cancelled` `signal`; expiry → `cancelled` `operator` + `confirm` `expired`; approved with `input` → re-validate.
5. Enqueue on the tool's **scope** queue (serial per scope, parallel across scopes); queue length > 32 → `refused` `busy`.
6. Run with `ctx` (`signal` = caller signal combined with a registry abort; `registerUndo` stores a restorer under `callId`; `files.resolve` rejects with `ToolmarkError('files_not_configured')` in M1 — M2 replaces it). Thrown error → `error` with message `"Tool failed"` + `error` event `tool_threw` (cause attached). In `dev`, validate `ok` data against `output` schema → mismatch emits `output_invalid` (result still returned unchanged); in production `output` is never validated.
7. Emit `result` after completion with `durationMs`.
- **`ctx.confirm(req)` inside `run` (spec §5):** caller `human` → `{ approved: true }`; caller in inline mode with a handler → awaits `options.confirm({ ...req, confirmId: newId(), tool, title, caller, input, hints })` with the same bounds as step 4 inline (signal → `{ approved: false, reason: 'signal' }`, expiry → `{ approved: false, reason: 'expired' }`) and emits `confirm` `pending`/`approved`/`rejected`/`expired`; caller in deferred mode, or no handler → resolves `{ approved: false, reason: 'confirmation_unavailable' }` and emits dev-only `error` `ctx_confirm_unavailable`. It never throws.
- **Cancellation and grace period (spec §14):** caller `signal` aborted before run → `cancelled` `signal`. During run the tool sees `ctx.signal.aborted`; if it settles within `abortGraceMs` its own result is returned, otherwise the pipeline resolves `cancelled` `signal`, releases the scope queue slot, and a later tool result is dropped with `error` event `late_result`.
- **Scope disposed during a call:** the in-flight call still resolves with the tool's result; queued-but-not-started calls resolve `refused` `unknown_tool`.
- **Undo:** `undo(callId)` runs the stored restorer once and deletes it; none stored (or the tool's registration disposed) → `refused` `undo_unavailable`. The store keeps at most 100 entries (oldest evicted) and drops a tool's entries when its registration is disposed.
- `createConfirmQueue`: FIFO; `handler` resolves when `approve`/`reject` is called for its request; `subscribe` fires on every change; a request whose call aborts is removed and its handler promise settles `{ approved: false, reason: 'signal' }`.

**Tests (write first):**
- `unknown_tool_refused_with_rev`; `stale_rev_missing_tool_refused_stale`; `stale_rev_existing_tool_runs`.
- `policy_defaults_table` — iterate spec §7 table × callers → allowed/`not_allowed` exactly as the M1 constraints list.
- `invalid_input_returns_issues`.
- `deferred_confirm_returns_needs_confirmation` → `confirmPending` approve runs as `human` (assert `ctx.caller`), emits `approved` with result.
- `deferred_confirm_edited_input_revalidated` — edited input invalid → `invalid`, tool not run.
- `deferred_reject_cancelled_operator`; `deferred_expiry_then_confirm_refused` (fake timers).
- `confirm_pending_is_single_use` — two concurrent approves → one run, the other `refused` `confirmation_expired`.
- `confirm_pending_uses_scope_queue` — approval while another call in the scope runs → runs after it.
- `pending_dropped_on_scope_dispose`.
- `inline_confirm_approve_and_reject`.
- `inline_confirm_times_out` — handler never answers, fake timers past `confirmExpiryMs` → `cancelled` `operator`, `confirm` `expired`; and aborted signal → `cancelled` `signal`.
- `inline_caller_without_handler_not_allowed` — no `confirm` handler, `webmcp` calls a consequential tool → `refused` `not_allowed`, tool not run.
- `human_caller_skips_confirmation`.
- `ctx_confirm_modes` (`test/ctx.test.ts`) — `human` → approved; `webmcp` with handler → handler called with `confirmId`/`tool`/`caller`, outcome returned; `inapp` (deferred) → `{ approved: false, reason: 'confirmation_unavailable' }` + one dev `ctx_confirm_unavailable` event; `webmcp` without handler (readOnly tool) → same `confirmation_unavailable`.
- `ctx_files_not_configured` — `ctx.files.resolve({ ref: 'x' })` rejects with code `files_not_configured`.
- `scope_calls_serialized` — two slow calls in one scope run sequentially; two scopes overlap.
- `queue_limit_busy` — 33rd queued call → `busy`.
- `thrown_error_becomes_error_result_and_event`.
- `output_invalid_dev_event_result_kept` — dev: `ok` data failing `output` → result returned unchanged + one `output_invalid` event; `output_not_validated_in_prod`.
- `dispose_during_call_resolves` — dispose scope mid-run → caller gets the tool's `ok`; a queued second call → `unknown_tool` (review focus 2).
- `abort_before_run_cancelled_signal`.
- `abort_releases_queue_after_grace` — tool ignores its signal; abort → `cancelled` `signal` after `abortGraceMs`; the next queued call in the scope runs; the late result emits `late_result` (review focus 7).
- `undo_runs_once_then_unavailable`; `undo_store_capped` (101 entries → oldest `undo_unavailable`).
- `confirm_queue_fifo_approve_reject`.

**Task gate:** `pnpm exec vitest run --project core-node test/call.test.ts test/policy.test.ts test/confirm.test.ts test/confirm-queue.test.ts test/queue.test.ts test/undo.test.ts test/ctx.test.ts`

---

### Task 6: Form tools core   (Lane A, risk: high, security)

**Files:** Create `src/forms/types.ts`, `src/forms/paths.ts`, `src/forms/form-tools.ts`;
Modify `src/index.ts`; Test `test/form-tools.test.ts`, `test/paths.test.ts`.

**Interfaces — Produces:**
```ts
interface FieldInfo { path: string; label?: string; element?: Element | null; sensitive?: boolean }
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
  sensitive?: string[]                     // dot paths always redacted (spec §14)
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
- **Path safety:** `paths.ts` rejects any segment equal to `__proto__`, `prototype` or `constructor`: `flatten` never emits such a path (it records it as rejected), and `getPath`/`setPath` throw `ToolmarkError('invalid_path')`. A fill whose input contains such a key returns `invalid` with issue `{ path, message: 'Invalid field path' }` and sets nothing. Objects created by `flatten`/`setPath` use own-property checks only.
- Fill semantics (spec D19): flatten `values`; `undefined` leaves → ignored; `null` → clear. A path is **user-edited** when it is in `adapter.dirtyPaths()` and its current value differs (deep equality) from the value the agent last set there. User-edited paths are skipped unless `overwrite: true`.
- Validation: merge current values with the non-skipped input (null → `undefined`), run `input` schema, keep only issues whose path equals or is under a touched path → any → `invalid` and **nothing is set**.
- **Declared paths only (spec §14):** after validation, every touched path must be a declared leaf of the resolved input JSON Schema (walking `properties`, `items`, `anyOf`/`oneOf`/`allOf` branches) or appear in `flatten(validated.value)`; otherwise → `invalid` issue `{ path, message: 'Unknown field' }` and nothing is set.
- Otherwise `adapter.setValues(changedPaths, { source: 'agent' })`; the agent-set record for each path is `getPath(adapter.getValues(), path)` read **after** `setValues` (the value as stored, e.g. RHF's `''` for a cleared string). Register an undo restorer that sets the `before` values back with `source: 'undo'` **only for paths whose current value still equals the agent-set value** (others are skipped and reported in the undo result's `skipped`), and forgets agent-set entries for restored paths. Return `ok({ changes: FieldChange[]; skipped: string[] })` where `changes` = paths whose value actually changed and `skipped` lists full dot paths, sorted.
- **Redaction:** in `changes` of fill and undo results, sensitive paths (M1 constraints: `opts.sensitive`, `FieldInfo.sensitive`, or a password/`cc-*` element from `adapter.fields()`) have `before` and `after` = `'[redacted]'`.
- Submit runs `adapter.submit()` and returns its result.
- `dispose()` disposes both registrations.

**Tests (write first):** (use an in-memory `FormAdapter` fake defined in the test file)
- `fill_sets_values_and_reports_changes` — exact result shape `{ changes, skipped }`.
- `fill_null_clears_undefined_leaves`.
- `fill_skips_user_edited_field` — fake marks `title` dirty with a user value → skipped, untouched, listed in `skipped` (review focus 3).
- `fill_overwrite_true_replaces_user_value`.
- `agent_can_refine_own_value` — fill `title`, fake marks it dirty (as RHF would), fill again → applied.
- `agent_refine_after_null_clear` — fill `title: null`, fake stores `''`, fill again → applied.
- `fill_invalid_touched_path_sets_nothing`.
- `fill_ignores_issues_on_untouched_paths` — required untouched field empty → still ok.
- `fill_rejects_proto_path_no_pollution` — input parsed from `'{"values":{"__proto__":{"x":1}}}'` and a `constructor.prototype.x` path → `invalid`, nothing set, `({} as any).x === undefined` (review focus 6).
- `fill_unknown_field_invalid` — `organization_id` not in the schema → `invalid` `Unknown field`, nothing set.
- `fill_redacts_sensitive_paths` — `sensitive: ['pin']` and a field whose element is `input[type=password]` → `before`/`after` `'[redacted]'`.
- `undo_restores_before_values` — via `tm.undo(callId)`.
- `undo_skips_user_edited_since` — user changes a filled path, undo → that path skipped and reported.
- `submit_is_consequential_deferred_for_inapp` — returns `needs_confirmation`.
- `paths_flatten_get_set_immutable`; `paths_reject_prototype_keys`.

**Task gate:** `pnpm exec vitest run --project core-node test/form-tools.test.ts test/paths.test.ts`

---

### Task 7: Protocol v1 messages, JSON Schemas, validator   (Lane A, risk: high)

**Files:** Create `src/protocol/messages.ts`, `src/protocol/schemas.ts`, `src/protocol/validate.ts`,
`src/protocol/index.ts`, `scripts/emit-protocol-schemas.ts`; Modify `packages/core/package.json`
(`build` script), `tsdown.config.ts` (entry `protocol/index`); Test `test/protocol.test.ts`,
`test/fixtures/protocol/*.json`.

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
// scripts/emit-protocol-schemas.ts
function emitProtocolSchemas(outDir: string): Promise<void>     // CLI: --out <dir>, default dist/protocol/v1
```

**Exact values:** schema `$schema` `https://json-schema.org/draft/2020-12/schema`; `$id`s
`urn:toolmark:protocol:v1:page-to-agent` and `urn:toolmark:protocol:v1:agent-to-page`; emitted files
`dist/protocol/v1/page-to-agent.json`, `dist/protocol/v1/agent-to-page.json`; core `build` script
`tsdown && tsx scripts/emit-protocol-schemas.ts` (emitter after tsdown, whose `clean` would delete it).

**Behaviour:**
- `validateMessage` is hand-written (zero deps). Top-level message objects and `ToolResult` objects
  are strict (unknown `type`, missing fields, wrong types and extra properties rejected); `tools[]`
  items and `hints` allow unknown properties (forward-compatible additions such as M2's `mode`);
  `input` and `result.data` are unconstrained. `protocol !== 1` →
  `{ ok:false, unsupportedProtocol:true, id }` when an `id` string is present.
- `ToolResult` inside messages is validated structurally per status.
- The JSON Schemas and `validateMessage` agree on every fixture (checked with Ajv in tests only).

**Tests (write first):**
- `valid_fixtures_pass_both_validators` — every `fixtures/protocol/valid-*.json` passes `validateMessage` and Ajv (`ajv/dist/2020` + `ajv-formats`); include a manifest tool with an extra property.
- `invalid_fixtures_fail_both_validators` — every `invalid-*.json` fails both (include: missing `clientId`, unknown `type`, `protocol: 2`, extra top-level field, `result.status: 'maybe'`, extra field in a `ToolResult`).
- `unsupported_protocol_reports_id`.
- `emitted_schema_files_match_exports` — `emitProtocolSchemas(tmpDir)` → JSON equals `protocolSchemas`.

**Task gate:** `pnpm exec vitest run --project core-node test/protocol.test.ts && pnpm -F @toolmark/core build && test -f packages/core/dist/protocol/v1/page-to-agent.json`

---

### Task 8: Bridge consumer   (Lane B, risk: high, security)

**Files:** Create `packages/core/src/bridge/transport.ts`, `src/bridge/bridge.ts`,
`src/bridge/index.ts`; Modify `packages/core/tsdown.config.ts` (entry `bridge/index` only); Test
`packages/core/test/bridge.test.ts`.

**Interfaces:**
- Consumes: `Toolmark`, `validateMessage`, message types (Tasks 4–7).
- Produces:
```ts
interface BridgeTransport {
  send(message: PageToAgentMessage): void | Promise<void>
  onMessage(handler: (message: unknown) => void): () => void
  close?(): void
}
interface BridgeOptions { transport: BridgeTransport; onChange?: 'manifest' | 'changed'; caller?: 'inapp'; maxMessageBytes?: number }
function bridge(options: BridgeOptions): (tm: Toolmark) => () => void
```

**Behaviour:**
- On attach: send `manifest` (summary, `manifest({ caller })` with `caller` = `options.caller ?? 'inapp'`, current `rev`, `clientId`).
- On each registry revision: send `manifest` (default) or `changed` (`onChange: 'changed'`).
- Incoming messages larger than `maxMessageBytes` (default `1048576`, UTF-8 bytes of `JSON.stringify`) or nested deeper than `64` are dropped with `error` event `invalid_message`. Otherwise they are validated with `validateMessage(_, 'toPage')`; invalid → dropped + `error` event `invalid_message` (no reply); `unsupportedProtocol` with `id` → reply `result` `{ status:'error', message:'unsupported protocol' }`.
- Messages whose `clientId` ≠ `tm.clientId` are ignored silently (review focus 4).
- `call` → `tm.call(tool, input, { caller, rev, signal })` → exactly one `result` per `id`. `call` and `describe` share the id space for dedupe: a second message with an in-flight or recently answered `id` (last 1000) is ignored.
- `describe` → `result` `ok(tm.describe(tool, { caller }))` or `refused` `unknown_tool` (policy-hidden tools are unknown to that caller).
- `cancel` → aborts that call's controller; the pipeline yields `cancelled` `signal` (or the tool's own result within the grace period) — still exactly one `result`. A `cancel` for an unknown or answered id is ignored.
- Before sending a `result`/`confirmed`, the bridge checks the `ToolResult` is JSON-safe (plain objects, arrays, strings, finite numbers, booleans, null; depth ≤ 64; `JSON.stringify` succeeds); otherwise it sends `{ status: 'error', message: 'Result not serializable' }` and emits `transport_failed`.
- `confirm` events with stage `approved`/`rejected`/`expired` for confirmations created by bridge calls → send `confirmed` `{ confirmId, result }` (expired → `refused` `confirmation_expired`).
- Transport `send` rejection → `error` event `transport_failed`; never throws into the registry.
- Disposer unsubscribes everything and calls `transport.close?.()`; in-flight calls are aborted.

**Tests (write first):** (use an in-memory fake transport in the test file)
- `sends_manifest_on_attach`; `sends_manifest_on_change`; `sends_changed_when_configured`.
- `ignores_call_for_other_client` (review focus 4).
- `call_returns_single_result`; `duplicate_call_id_ignored`; `describe_shares_dedupe_id_space`.
- `describe_ok_and_unknown`; `describe_respects_caller_policy` — a tool hidden from `inapp` by policy → `unknown_tool`, and absent from the attach manifest.
- `cancel_yields_cancelled_signal_once`; `cancel_unknown_id_ignored`.
- `deferred_confirmation_forwarded_as_confirmed` — call consequential → `needs_confirmation` result; `tm.confirmPending` approve → `confirmed` message with the tool's result.
- `unsupported_protocol_replies_error`; `invalid_message_dropped_with_event` (code `invalid_message`); `oversized_message_dropped`.
- `non_serializable_result_becomes_error` — tool returns `ok({ self })` with a cycle → `error` `Result not serializable` + `transport_failed`.
- `result_sent_after_scope_disposed` — dispose the scope while the tool runs → `result` still sent (review focus 2).
- `dispose_aborts_inflight_and_closes_transport`.

**Task gate:** `pnpm exec vitest run --project core-node test/bridge.test.ts`

---

### Task 9: Transports — echo, websocket, postMessage, in-page   (Lane B, risk: high, security)

**Files:** Create `src/bridge/echo.ts`, `src/bridge/websocket.ts`, `src/bridge/post-message.ts`,
`src/bridge/in-page.ts`; Modify `src/bridge/index.ts`, `packages/core/tsdown.config.ts` (entries
`bridge/echo`, `bridge/websocket`, `bridge/post-message`, `bridge/in-page` — Lane B's entry lines
only); Test `test/transport-echo.test.ts`, `test/transport-websocket.test.ts`,
`test/transport-post-message.test.ts`, `test/transport-in-page.test.ts`.

**Interfaces — Produces:**
```ts
interface EchoLike { private(channel: string): { listen(event: string, cb: (payload: unknown) => void): unknown; stopListening(event: string): unknown } }
function echoTransport(o: { echo: EchoLike; channel: string; event?: string; postUrl: string; headers?: () => Record<string, string> }): BridgeTransport
function websocketTransport(o: {
  url: string; protocols?: string | string[]; maxDelayMs?: number
  terminalCloseCodes?: number[]                                            // default []
  onOpen?: (socket: WebSocket, io: { receive(timeoutMs?: number): Promise<unknown> }) => void | Promise<void>
  onStatus?: (s: { state: 'connecting' | 'open' | 'closed' | 'stopped'; closeCode?: number; firstConnectFailed?: boolean }) => void
}): BridgeTransport
function postMessageTransport(o: { target: Window; targetOrigin: string; allowedOrigins: string[] }): BridgeTransport
function createInPageChannel(): { transport: BridgeTransport; agent: { send(m: AgentToPageMessage): void; onMessage(h: (m: PageToAgentMessage) => void): () => void } }
```

**Exact values:** echo default `event`: `'.toolmark.message'`; echo POST headers:
`Content-Type: application/json`, `Accept: application/json`, `X-Requested-With: XMLHttpRequest`,
plus `headers()`; `credentials: 'same-origin'`. WebSocket reconnect: first delay `500` ms, doubling,
capped at `maxDelayMs` (default `30000`); send buffer max `100` messages. postMessage envelope
`{ toolmark: 1, message }`.

**Behaviour:**
- **echo**: subscribes to `echo.private(channel)` (private channel is mandatory — D20); payload may be the message or `{ message }`. `send` POSTs JSON; non-2xx → rejected promise. `close()` calls `stopListening(event)` on the channel.
- **websocket**: JSON text frames; frames that are not valid JSON are ignored. Reconnects with backoff; on every (re)connect `onOpen(socket, io)` runs (and is awaited) **before** buffered bridge messages flush; frames arriving while `onOpen` is pending are delivered to `io.receive(timeoutMs?)` (FIFO; rejects with `Error('receive timeout')` after `timeoutMs`, or `Error('socket closed')` when the socket closes), never to the bridge handler; after `onOpen` resolves, frames go to the bridge. A rejecting `onOpen` stops the transport (no further reconnects) and surfaces `transport_failed`. A close whose code is in `terminalCloseCodes` stops the transport (no reconnect) and rejects pending sends with `Error('transport stopped')`. `onStatus` reports `connecting` (each attempt), `open` (after `onOpen` resolves), `closed` (with `closeCode`; `firstConnectFailed: true` when the very first connection never opened) and `stopped` (terminal code, rejecting `onOpen` or `close()`). `send` returns a promise that resolves when the frame is written to an open socket, and rejects with `Error('buffer overflow')` when that message is evicted from the 100-message buffer (oldest first), or `Error('transport stopped')` after `close()`/terminal stop. `close()` stops reconnecting. Uses the global `WebSocket` (Node ≥ 22.12 and browsers); tests inject a fake class.
- **postMessage**: `targetOrigin` `'*'` → throws `TypeError('targetOrigin must be an exact origin')`; `allowedOrigins` must be non-empty and must not contain `'*'` or `'null'` → `TypeError`. Outgoing messages are wrapped in the envelope; incoming events are accepted only when `data.toolmark === 1`, the origin is in `allowedOrigins` **and** `event.source === target`; anything else is ignored silently (no event).
- **in-page**: both directions delivered asynchronously via `queueMicrotask`; used by in-page agents and tests.

**Tests (write first):**
- `echo_listens_on_private_channel_and_posts` — fake `EchoLike` + stubbed `fetch` → correct channel/event, POST body and headers; non-2xx rejects.
- `echo_accepts_wrapped_payload`; `echo_close_stops_listening`.
- `websocket_reconnects_with_backoff_and_flushes` — fake WebSocket class, fake timers → delays 500, 1000, 2000…; buffered messages sent after open.
- `websocket_on_open_runs_before_flush` — `onOpen` sends a frame and resolves later → that frame precedes every buffered message, on the first connect and after a reconnect; rejecting `onOpen` → no reconnect, `send` rejects.
- `websocket_frames_during_on_open_go_to_receive` — a frame received while `onOpen` awaits `io.receive()` resolves it and never reaches the bridge handler.
- `websocket_terminal_close_code_stops_reconnect` — `terminalCloseCodes: [4409]`, server closes 4409 → no reconnect timer, pending `send` rejects `transport stopped`, `onStatus` ends with `stopped`.
- `websocket_non_terminal_close_reconnects` — close 1001 with `terminalCloseCodes: [4409]` → reconnect scheduled.
- `websocket_receive_times_out` — `onOpen` awaits `receive(100)` with no frame → rejects `receive timeout` (fake timers).
- `websocket_on_status_reports_first_connect_failure` — first socket errors before open → `closed` with `firstConnectFailed: true`; later states `connecting` → `open` after a successful reconnect.
- `websocket_buffer_overflow_rejects_oldest` — 101 sends while closed → first rejects `buffer overflow`.
- `post_message_rejects_star_origin`; `post_message_rejects_null_origin`; `post_message_filters_origin_and_source`; `post_message_ignores_foreign_messages` (no envelope → ignored, no event).
- `in_page_round_trip_with_bridge` — `createInPageChannel` + `bridge` + registry → agent `call` gets `result`.

**Task gate:** `pnpm exec vitest run --project core-node test/transport-echo.test.ts test/transport-websocket.test.ts test/transport-post-message.test.ts test/transport-in-page.test.ts`

---

### Task 10: React provider, scopes, `useTool`, `useAgentActivity`   (Lane C, risk: normal)

**Files:** Create `packages/react/src/context.ts`, `src/provider.tsx`, `src/scope.tsx`,
`src/use-tool.ts`, `src/use-agent-activity.ts`, `src/index.ts`; Test `test/use-tool.test.tsx`,
`test/scope.test.tsx`, `test/use-agent-activity.test.tsx`, `test/ssr.test.tsx`.

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
- `ToolScope` creates its child scope of the enclosing scope **during render**, lazily in a ref (children's effects run before the parent's, so the scope must exist before they register). The effect cleanup disposes it and clears the ref; the effect body re-creates it if the ref is empty (StrictMode remount) and re-renders children through a state tick. Context carries the live `Scope`. `setWhen(when ?? true)` runs when `when` changes.
- `useTool` registers in `useEffect` into the current scope; `run`, `summary` and `state` always call the latest `def` (ref); re-registers only when `name`, `description`, `title`, hints (shallow) or schema identities change. In `dev`, more than 3 re-registrations of one tool within 1 s emit one `console.warn` advising to hoist the schema.
- StrictMode double mount/unmount leaves exactly one live registration and no `duplicate_name` error.
- `useAgentActivity` subscribes via `useSyncExternalStore` to `call`/`result` events, with a `getServerSnapshot` returning a module-level frozen empty value and a cached client snapshot (new object only on change).

**Tests (write first):** (Vitest browser mode + `@testing-library/react`)
- `strict_mode_double_mount_keeps_tool` — `<StrictMode>` → manifest contains the tool once; no error event (review focus 1).
- `strict_mode_tool_inside_scope_registered_once` — `<StrictMode><ToolScope name="a">` + `useTool` → `a.tool` present once, no `scope_disposed`/`duplicate_name` event.
- `latest_closure_used` — rerender with new state → call returns the new value, no re-registration (rev unchanged).
- `reregisters_on_description_change`.
- `scope_nests_names` — `<ToolScope name="a"><ToolScope name="b">` → `a.b.tool`.
- `scope_when_false_hides`.
- `unmount_disposes`.
- `use_toolmark_outside_provider_throws`.
- `agent_activity_tracks_inflight_calls`.
- `ssr_render_to_string_is_inert` — `react-dom/server` `renderToString` of provider + `ToolScope` + `useTool` + `useAgentActivity` with a `__environment: 'server'` registry → no throw, manifest empty.

**Task gate:** `pnpm -F @toolmark/react exec vitest run test/use-tool.test.tsx test/scope.test.tsx test/use-agent-activity.test.tsx test/ssr.test.tsx`

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
- `useFormTool` calls `createFormTools` in an effect under the current scope; the adapter is read through a ref (updated every render) so a new adapter object each render does not re-register and every call uses the latest adapter.
- `useConfirmQueue` and `usePendingConfirmations` use `useSyncExternalStore` with a `getServerSnapshot` returning a module-level frozen empty value (`{ pending: null }` / `[]`) and cached client snapshots.
- `usePendingConfirmations` re-renders on `confirm` events; `reject` calls `confirmPending(id, { approved:false, reason })`.

**Tests (write first):**
- `form_tool_registers_fill_and_submit_under_scope`.
- `form_tool_stable_across_renders` — 5 rerenders → rev unchanged.
- `confirm_queue_hook_shows_head_and_resolves`.
- `pending_confirmations_list_and_approve`.
- `confirm_hooks_ssr_inert` — `renderToString` with both hooks → no throw, empty values.

**Task gate:** `pnpm -F @toolmark/react exec vitest run test/use-form-tool.test.tsx test/confirm-hooks.test.tsx`

---

### Task 12: react-hook-form adapter (`@toolmark/react/rhf`)   (Lane C, risk: normal)

**Files:** Replace the Task 1 stub `packages/react/src/rhf/index.ts` (its tsdown entry `rhf/index`
exists since Task 1); Test `test/rhf.test.tsx`.

**Interfaces — Produces:**
```ts
function rhfAdapter<V extends FieldValues>(form: UseFormReturn<V>, opts: {
  onSubmit: (values: V) => unknown | Promise<unknown>
  elementFor?: (path: string) => Element | null
}): FormAdapter<V>
```

**Behaviour:**
- `setValues`: for each path `form.setValue(path, value === null ? emptyFor(current) : value, { shouldDirty: true, shouldValidate: true, shouldTouch: false })`; `emptyFor` = `''` for strings, `null` otherwise.
- **Dirty tracking:** RHF only updates proxied `formState` fields that are read. `rhfAdapter` reads `form.formState.dirtyFields` when it is constructed (the adapter is created during render), so tracking is active even when the app never reads `formState`. Verify against RHF 7.88 with ctx7 at execution; if a render-time read is not enough, use `form.subscribe({ formState: { dirtyFields: true } })` and raise the peer floor to the version that added it (ledger the peer range change and tell the controller).
- `dirtyPaths`: flattened leaf paths of `form.formState.dirtyFields` whose value is `true`.
- `submit`: `form.handleSubmit(onValid, onInvalid)()` wrapped in a promise → valid: `ok(result)` where `result = await onSubmit(values)` when it is JSON-safe, else `ok({})`; invalid: `invalid(issues)` from `formState.errors` (path + message); `onSubmit` throws → `error` result.
- `fields`: `Object.keys(flatten(form.getValues()))` mapped to `{ path, element: elementFor?.(path) ?? null }` (react-hook-form's mounted-field registry is private API, so it is not used). Elements drive sensitive-field redaction in core.

**Tests (write first):** (real `useForm` with `zodResolver`-style resolver built inline from a zod 4 schema)
- `set_values_updates_form_and_marks_dirty`.
- `null_clears_string_to_empty`.
- `dirty_paths_reflect_user_typing` — Vitest browser-mode `userEvent.type` into an input → path listed.
- `dirty_paths_without_app_reading_form_state` — a component that never touches `formState`; user types → path listed.
- `submit_valid_calls_on_submit_ok`; `submit_invalid_returns_issues`; `submit_non_json_result_becomes_empty_ok` (`onSubmit` returns an object with a function → `ok({})`).
- `end_to_end_fill_skips_user_typed_field` — `useFormTool(rhfAdapter(form))`, user types title, `tm.call('x.fill')` → `skipped` contains `title`.

**Task gate:** `pnpm -F @toolmark/react exec vitest run test/rhf.test.tsx`

---

### Task 13: Inertia `useForm` adapter   (Lane D, risk: normal)

**Files:** Create `packages/inertia/src/inertia-adapter.ts`, `src/visit-outcome.ts` (internal, not
exported from the package), `src/index.ts`; Test `test/inertia-adapter.test.tsx`,
`test/visit-outcome.test.ts`.

**Interfaces — Produces:**
```ts
function inertiaAdapter<V extends Record<string, unknown>>(form: InertiaFormLike<V>, opts: {
  submit: { method: 'post' | 'put' | 'patch' | 'delete'; url: string }
  elementFor?: (path: string) => Element | null
}): FormAdapter<V>
interface InertiaVisitCallbacks {
  onSuccess?: () => void; onError?: (errors: Record<string, string>) => void
  onHttpException?: (response: unknown) => void; onNetworkError?: (error: unknown) => void   // Inertia 3 names
  onInvalid?: (response: unknown) => void; onException?: (error: unknown) => void            // Inertia 2 names (verify per major)
  onCancel?: () => void; onCancelToken?: (token: { cancel(): void }) => void
  onFinish?: (visit?: { cancelled?: boolean; interrupted?: boolean }) => void
}
// internal, src/visit-outcome.ts (M2 props tools reuse it unchanged)
function visitOutcome(o?: { signal?: AbortSignal }): { callbacks: InertiaVisitCallbacks; result: Promise<ToolResult<unknown>> }
interface InertiaFormLike<V> {
  data: V; setData(data: V): void; errors: Partial<Record<string, string>>
  transform(callback: (data: V) => Record<string, unknown>): void
  submit(method: string, url: string, opts: InertiaVisitCallbacks): void
}
```

**Behaviour:**
- **Stale-state safety:** `setData` is React state, so `form.data` stays old until the next render. The adapter keeps a local `current` copy: `setValues` applies all paths to a clone of `current` with `setPath`, updates `current` synchronously and calls `setData(clone)` once; `getValues()` returns `current`; `current` re-syncs from `form.data` when a newer render's `form.data` differs from the last value the adapter wrote. `submit` calls `form.transform(() => current)` before `form.submit(…)` so the visit sends the latest values.
- **Adapter state across renders:** apps call `inertiaAdapter(form, …)` every render and `useFormTool` keeps the latest object, so per-form state (`current`, the initial snapshot) lives in a module-level `WeakMap` keyed by a render-stable identity of the form (`form.setData`; verify it is referentially stable in 2.3.28 and 3.7.1 at execution — if neither version offers a stable key, stop and ask the controller for a ruling).
- `dirtyPaths` = leaf paths whose value differs from the snapshot of `form.data` taken when the adapter state is first created (Inertia has no per-field dirty state).
- `visitOutcome(o)` builds one visit's callbacks and a promise that settles **once**: `onSuccess` → `ok({})`; `onError(errors)` → `invalid` with each key as `path`; `onHttpException`/`onInvalid` → `error` `"Request failed"`; `onNetworkError`/`onException` → `error` `"Network error"`; `onCancel` or `onFinish` with `visit.cancelled`/`visit.interrupted` → `cancelled` `signal`; `onFinish` with no earlier outcome (Inertia 2 HTTP/network failures) → `error` `"Visit did not complete"`. `o.signal` abort cancels the visit through the `onCancelToken` token. Both majors' callback names are passed (structural; unknown ones are ignored by Inertia). Never hangs; never reports a failed visit as `ok`.
- `submit` = `form.submit(method, url, visitOutcome().callbacks)` and returns its `result`.
- Works with `@inertiajs/react` 2.x and 3.x (`InertiaFormLike` is structural; the Inertia 3-only callbacks are simply never called on 2.x).

**Tests (write first):** (one test file; renders a component using the real `useForm` from the installed `@inertiajs/react` — 3.7.1 locally; CI runs it again with 2.3.28, Task 16. Visits are observed with `vi.spyOn(router, 'visit')` on the `router` exported by `@inertiajs/react` — verify the export in both majors; the spy invokes the callbacks it receives.)
- `set_values_single_set_data`.
- `dirty_paths_against_initial_snapshot`; `adapter_state_survives_rerender` (new adapter object each render keeps the snapshot).
- `fill_then_immediate_submit_sends_new_values` — fill then submit in the same tick → the visit payload has the new values.
- `submit_success_ok` / `submit_errors_invalid`.
- `submit_finish_without_outcome_is_error`; `submit_cancelled_visit_is_cancelled`.
- `submit_http_exception_is_error` — runs only when the installed major is ≥ 3 (read `@inertiajs/react/package.json`).
- `test/visit-outcome.test.ts` (pure, no Inertia): `visit_outcome_maps_every_callback` (each callback → the exact result above), `visit_outcome_settles_once` (a later callback after the first outcome is ignored), `visit_outcome_signal_cancels_token`.

**Task gate:** `pnpm -F @toolmark/inertia exec vitest run test/inertia-adapter.test.tsx test/visit-outcome.test.ts`

---

### Task 14: Testing package   (Lane E, risk: normal)

**Files:** Create `packages/testing/src/fixture.ts`, `src/matchers.ts`, `src/test-toolmark.ts`;
Replace the Task 1 stubs `src/index.ts`, `src/vitest.ts`, `src/page/install-test-hook.ts`; Test
`test/test-toolmark.test.ts`, `test/vitest-entry.test.ts`, `test/fixture.spec.ts`,
`test/fixture-page/index.html`, `test/fixture-page/main.ts`, `test/fixture-page/vite.config.ts`
(`resolve.conditions` includes `'@toolmark/source'`), `playwright.config.ts` (its `webServer` runs
`vite test/fixture-page --port 5179 --strictPort`; the page registers two tools, one consequential,
and calls `installTestHook`).

**Interfaces — Produces:**
```ts
// browser entry "@toolmark/testing/page"
function installTestHook(tm: Toolmark): () => void     // sets globalThis.__toolmark_test__
// hook shape (all values JSON-safe, or promises of JSON-safe values):
type TestHookCaller = Exclude<Caller, 'human'>
globalThis.__toolmark_test__ = {
  manifest(opts?: { caller?: TestHookCaller; detail?: 'summary' | 'full' }): { rev: number; tools: ToolManifestSummary[] | ToolManifest[] }
  describe(name: string, opts?: { caller?: TestHookCaller }): ToolManifest | undefined
  call(name: string, input: unknown, opts?: { caller?: TestHookCaller }): Promise<ToolResult<unknown>>   // caller default 'test'
  confirmPending(confirmId: string, outcome: ConfirmOutcome): Promise<ToolResult<unknown>>
  pending(): PendingConfirmation[]
}
// node entry "@toolmark/testing" (imports @playwright/test)
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
// "@toolmark/testing/vitest" (never imports @playwright/test) and re-exported from "@toolmark/testing"
function createTestToolmark(opts?: ToolmarkOptions & { inline?: 'approve' | 'reject' | ((req: ConfirmRequest) => Promise<ConfirmOutcome>) }):
  Toolmark & { calls: Array<{ tool: string; caller: Caller; input: unknown; result: ToolResult<unknown> }>; confirms: ConfirmRequest[]; approveAll(): Promise<void> }
```

**Exact values:** hook global `__toolmark_test__`; missing-hook error message
`"Toolmark test hook not found: call installTestHook(toolmark) in your app's test build"`; hook
wait timeout `5000` ms; `call` with caller `'human'` rejects with
`TypeError('caller human is not allowed through the test hook')`; package exports `"."`, `"./vitest"`
and `"./page"` (declared in Task 1); Vitest include `['test/**/*.test.ts']` (Task 1) so
`fixture.spec.ts` runs only under Playwright.

**Behaviour:**
- Fixture calls run with caller `test` (deferred confirmation); `autoConfirm(true)` approves any `needs_confirmation` by calling `confirm` automatically and returns the final result.
- `toHaveTools` asserts a subset; `toHaveChanged` asserts an `ok` result's `changes` contains `{ path, after }`.
- `createTestToolmark` keeps the **production** confirmation modes (`inapp`, `test` deferred; `webmcp`, `mcp`, `tour` inline), installs an inline handler from `inline` (default `'approve'`; `opts.confirm`, when given, wins) that records each request in `confirms`, sets `__environment: 'browser'` (so it works in node-environment tests of any package), records every `result` event in `calls`, and `approveAll()` approves every pending deferred confirmation.
- The hook is for test builds only: apps install it behind a non-production check (Task 15 shows the pattern).

**Tests (write first):**
- `test_toolmark_records_calls`; `approve_all_runs_pending`.
- `test_toolmark_keeps_production_modes` — `webmcp` call to a consequential tool → handler approves, tool runs (no `needs_confirmation`); `inline: 'reject'` → `cancelled` `operator`; `inapp` → `needs_confirmation`.
- `vitest_entry_has_no_playwright_import` (`test/vitest-entry.test.ts`) — the source graph of `src/vitest.ts` (static scan of its imports, transitively within the package) contains no `@playwright/test`.
- `fixture.spec.ts`: `lists_and_calls_tools`, `auto_confirm_runs_consequential`, `missing_hook_error_message`, `matchers_pass_and_fail_with_messages`, `hook_rejects_human_caller`.

**Task gate:** `pnpm -F @toolmark/testing exec vitest run && pnpm -F @toolmark/testing exec playwright test`

---

### Task 15: Example app `examples/react-vite`, e2e and round budget   (Lane F, risk: normal)

**Files:** Create `examples/react-vite/vite.config.ts` (`resolve.conditions` and
`ssr.resolve.conditions` include `'@toolmark/source'`), `index.html`, `src/main.tsx`, `src/app.tsx`,
`src/challenge-form.tsx`, `src/in-page-agent.ts`, `playwright.config.ts`, `e2e/form.spec.ts`,
`e2e/round-budget.spec.ts`, `e2e/support/round-recorder.ts`. The example's `package.json` and
`tsconfig.json` were created by Lane A in Task 1. No file outside `examples/react-vite/` is edited.

**Exact values:** `playwright.config.ts`: `webServer` `{ command: 'pnpm dev', port: 5173,
reuseExistingServer: !process.env.CI }`, `projects: [{ name: 'chromium', use: devices['Desktop Chrome'] }]`
(M5 adds firefox/webkit). Report env var `ROUND_BUDGET_REPORT`; report entry
`{ task: string; rounds: number; messages: number; manifestBytes: number; describeBytes: number; wallMs: number }`.

**Behaviour:**
- A react-hook-form + zod 4 challenge form (title `{ ar, en }`, type enum, startsAt date) registered via `useFormTool(rhfAdapter(form, …))` inside `<ToolScope name="challenges">` (tools `challenges.create.fill` / `challenges.create.submit`).
- Imports come from public subpaths only: `@toolmark/core`, `@toolmark/core/bridge`, `@toolmark/core/bridge/in-page`, `@toolmark/react`, `@toolmark/react/rhf`.
- A scripted in-page agent (no LLM) in `src/in-page-agent.ts` uses `createInPageChannel` + `bridge` (caller `inapp`). It exposes `turn(messages: AgentToPageMessage[]): Promise<PageToAgentMessage[]>` (sends every message, then awaits one reply per `call`/`describe` id) and keeps the attach `manifest` and every `confirmed` message it receives. A confirm card is rendered from `usePendingConfirmations`.
- Test-only globals (`installTestHook(tm)` and `window.__toolmark_agent__`) are installed only when `import.meta.env.MODE !== 'production'`, through a dynamic `import('@toolmark/testing/page')` inside that branch so production builds drop them.
- `e2e/support/round-recorder.ts` drives the agent via `page.evaluate`: each `turn(...)` invocation is one **round** (overview definition: one agent turn issuing ≥ 1 `describe`/`call`); it counts rounds and messages, measures the byte length of the attach `manifest` and of every `describe` result, and wall time from the first turn to the final result. With `ROUND_BUDGET_REPORT` set it appends its entry to that file (a JSON array; the round-budget spec runs serially so appends never race).

**Tests (write first):**
- `e2e/form.spec.ts`: `agent_fill_updates_visible_fields` — `tools.call('challenges.create.fill', …)` → inputs show values; `toHaveChanged`. `user_typed_field_is_skipped`. `submit_needs_confirmation_then_confirm_card_approves`. `bridge_round_trip_via_in_page_agent`.
- `e2e/round-budget.spec.ts` › `simple_form_within_3_rounds` — starting from the attach `manifest` only: round 1 `describe` `challenges.create.fill`; round 2 `call` fill with complete valid values → `ok`; round 3 `call` submit → `needs_confirmation`; the test clicks Approve on the confirm card (not a round) → a `confirmed` message with `ok` arrives. Asserts rounds ≤ 3 and zero `invalid`/`refused` results; writes the report entry `task: 'simple_form'`.
- `example_prod_build_has_no_test_hook` (gate step) — `pnpm -F @toolmark-examples/react-vite build`, then no file in `examples/react-vite/dist` contains `__toolmark_test__` or `__toolmark_agent__`.

**Task gate:** `pnpm -F @toolmark-examples/react-vite typecheck && pnpm -F @toolmark-examples/react-vite exec playwright test && pnpm -F @toolmark-examples/react-vite build && ! grep -rqE "__toolmark_(test|agent)__" examples/react-vite/dist`

---

### Task 16: Docs, changeset, CI, tarball smoke, hand-off   (Lane F, risk: high, security)

Security-tagged because it writes the Laravel reference implementing the §12.2 MUSTs (overview
"Security-tagged tasks").

**Files:** Create `docs/protocol-v1.md`, `docs/guides/laravel-reference.md`,
`docs/release/next-tarballs.md`, `docs/release/round-budget.md`, `packages/*/README.md` (four),
`.changeset/initial-release.md`, `.changeset/pre.json` (via `pnpm changeset pre enter next`),
`.github/workflows/ci.yml`, `scripts/tarball-smoke.mjs`, `scripts/tarball-smoke.test.mjs`,
`scripts/render-round-budget.mjs`.

**Prerequisites:** the private GitHub repo `adams100111/toolmark` exists and `origin` points at it
(confirm with `gh repo view adams100111/toolmark`). No other repository or consumer artifact is
required.

**Exact values:**
- **CI** (`ci.yml`) on `push` and `pull_request`. Every job: `actions/checkout`, `pnpm/action-setup`
  (version from `packageManager`), `actions/setup-node` (`node-version` from the matrix, default
  `24.x`; `cache: pnpm`), `pnpm install --frozen-lockfile`. Jobs:
  - `lint`, `typecheck`, `build` — root scripts (packages only).
  - `test` — `pnpm exec playwright install --with-deps chromium`, then `pnpm test` (resolves
    sources via `@toolmark/source`, does **not** depend on `build`). `matrix.include` (spec §21, R6;
    React 18.3 × Inertia 3 is never included because Inertia 3 requires React 19):
    `{ node: 22.x, react: 19.3.0, inertia: 3.7.1 }`, `{ node: 24.x, react: 19.3.0, inertia: 3.7.1 }`,
    `{ node: 24.x, react: 19.3.0, inertia: 2.3.28 }`, `{ node: 24.x, react: 18.3.1, inertia: 2.3.28 }`.
    A non-default cell first runs
    `pnpm -F @toolmark/react -F @toolmark/inertia add -D react@<react> react-dom@<react> @types/react@<18|19> @types/react-dom@<18|19>`
    and `pnpm -F @toolmark/inertia add -D @inertiajs/react@<inertia>` as needed (the job never
    commits; `pnpm install --no-frozen-lockfile` follows). Chromium only in M1; the zod 3 axis and
    Firefox/WebKit are added in M5.
  - `types-ts7` — runs `pnpm build`, the pack command below and `node scripts/tarball-smoke.mjs dist-tarballs`
    (which includes the TypeScript 7.0.2 check of the packed types), plus `node --test scripts/`.
  - `e2e` — `examples/react-vite`: install chromium, `typecheck`, `playwright test` with
    `ROUND_BUDGET_REPORT=round-budget.json`, prod `build` + the no-test-hook grep; uploads
    `round-budget.json` as an artifact.
- **Changeset:** `pnpm changeset pre enter next` (creates `.changeset/pre.json`);
  `.changeset/initial-release.md` declares `minor` for `@toolmark/core`, `@toolmark/react`,
  `@toolmark/inertia`, `@toolmark/testing` (the `fixed` group keeps them equal). Expected M1 version
  after `pnpm changeset version`: `0.1.0-next.0` for all four. **Versions only; nothing is published
  before M5.**
- **Pack command:** `pnpm -r --filter "./packages/*" pack --pack-destination "$PWD/dist-tarballs"`.

**Behaviour:**
- `protocol-v1.md` documents every message, the §12.2 rules (including the security MUSTs and that
  ids are unguessable), the LLM exposure pattern (`page_call`/`page_describe` descriptions to copy),
  the deferred-confirmation server behaviour (spec §12.3: on `confirmed`, append the outcome to the
  conversation as a tool-result message and start **one** follow-up agent turn limited to
  acknowledging it, with no page tools, so it cannot start new actions), D23's full-reload behaviour
  (pending calls time out server-side; the new page load sends a fresh `manifest` with a new
  `clientId`), the transports' security notes (echo: private channels only, `headers()` must supply
  Laravel's CSRF header `X-XSRF-TOKEN` from the `XSRF-TOKEN` cookie, `postUrl` must be same-origin;
  postMessage envelope and exact origins), inbound size limits, a "Codes (M1)" section listing every
  code from the M1 constraints, and links the emitted JSON Schema files.
- `laravel-reference.md` gives copyable PHP for `PageCallTool`, `PageDescribeTool`, a protocol-v1
  `BrowserBridge` (private channel broadcast, authenticated POST endpoint validating
  user/conversation/clientId/call-id binding and deadline, rejecting unknown or duplicate results,
  Redis `BLPOP` hand-off with cache polling fallback), and the `confirmed` handler (appends the
  outcome as a tool-result message and dispatches one follow-up turn with `page_call`/`page_describe`
  withheld). It is marked "reference — copy into your app; not a package".
- Each `packages/*/README.md`: one-paragraph purpose, install line, "ESM only; Node ≥ 22.12" (react:
  "React ≥ 18.3"; inertia: "Inertia 3 requires React 19"), a minimal snippet, a link to
  `docs/protocol-v1.md`; M5 completes them.
- **`scripts/tarball-smoke.mjs <dir>`** (Node ESM, no dependencies beyond Node and pnpm): creates a
  temp directory under `os.tmpdir()` (outside the workspace); writes a `package.json` with every
  `<dir>/*.tgz` as a `file:` dependency and `pnpm.overrides` mapping each `@toolmark/*` to its
  tarball, plus every tarball's `peerDependencies` (at the catalog versions), `@types/react`,
  `@types/node`, `typescript@6.0.3` and `typescript-7: npm:typescript@7.0.2`; runs `pnpm install`;
  then (a) reads each installed package's `exports` (wildcards expanded against the packed files):
  every target file must exist; every JS entry is dynamically imported by `node` (Toolmark entries
  are import-safe without a DOM, D24; an explicit `browserOnly` list in the script, empty in M1, is
  checked with `import.meta.resolve` instead); JSON entries are parsed; (b) generates `smoke.ts`
  importing every JS entry's types and runs `tsc --noEmit` with TypeScript 6.0.3 and 7.0.2, each with
  `{ module: 'nodenext', moduleResolution: 'nodenext' }` and `{ module: 'preserve',
  moduleResolution: 'bundler' }`, `strict: true`, `skipLibCheck: false`, `types: ['node']` and **no**
  `customConditions` (verify at execution which bin `typescript@7.0.2` ships — `tsc` or `tsgo` — and
  record the invocation in the ledger); (c) runs every declared `bin` with `--help` (none in M1).
  Exits 0 or 1 and prints a one-line summary per check.
- **`scripts/render-round-budget.mjs <json>`** writes `docs/release/round-budget.md`: one table row
  per report entry (`task`, `rounds`, budget, `messages`, `manifestBytes`, `describeBytes`, `wallMs`),
  the commit SHA and date, and the round definition from the overview.
- **Hand-off (last step of the milestone):** `pnpm changeset version` (pre mode `next`), commit the
  version bump, run the pack command, then `node scripts/tarball-smoke.mjs dist-tarballs`. Download
  `round-budget.json` from the green CI `e2e` run (or run the spec locally with
  `ROUND_BUDGET_REPORT`) and render `docs/release/round-budget.md`. `docs/release/next-tarballs.md`
  gets the M1 entry: version, each tarball's filename and SHA-256, the smoke result, and a generic
  consumer recipe (vendor the tarballs, reference them as `file:<dir>/<tgz>` with `pnpm.overrides`
  mapping every `@toolmark/*` to its tarball, or `link:` for local development) — an optional
  courtesy, never a gate.

**Tests (write first):** `scripts/tarball-smoke.test.mjs` (`node:test`, run with
`node --test scripts/`):
- `smoke_detects_missing_export_file` — a fixture package whose `exports` points at a missing file,
  packed with `pnpm pack` into a temp dir → smoke exits 1 and names the entry.
- `smoke_passes_minimal_valid_package` — a fixture with one valid entry and types → exit 0.
The reviewer checks the Laravel reference against §12.2 line by line.

**Task gate:** `pnpm lint && pnpm typecheck && pnpm test && pnpm build` (lane gate), `node --test scripts/`,
then CI green on push, then the tarballs exist in `dist-tarballs/`,
`node scripts/tarball-smoke.mjs dist-tarballs` exits 0, and `docs/release/next-tarballs.md` and
`docs/release/round-budget.md` carry the M1 entries.

---

## Milestone exit check (spec §20, overview M1 row)

M1 is done when all of these hold on `main`:

1. `examples/react-vite/e2e/round-budget.spec.ts` › `simple_form_within_3_rounds` is green (rounds ≤ 3,
   zero `invalid`/`refused`), with its entry rendered in `docs/release/round-budget.md`.
2. CI is green: every job in `.github/workflows/ci.yml` (`lint`, `typecheck`, `build`, the `test`
   matrix, `types-ts7`, `e2e`), which covers every task gate.
3. `node scripts/tarball-smoke.mjs dist-tarballs` passes on the `0.1.0-next.0` tarballs and the result
   is logged in `docs/release/next-tarballs.md`.

No exit condition depends on another repository. Innovation's measured before/after run is a post-1.0
consumer track (spec §19).

## Self-review

- **Spec coverage (M1 scope):** §1 SC1 (simple form) → T15/T16 round budget; §5 → T2/T4/T5 (incl.
  `ctx.confirm`, `registerUndo`; `tm.info` is M2, `tm.anchor`/`state` M3); §6 → T2/T3/T5; §7 → T4/T5
  (policy semantics, confirm modes, single-use `confirmId`); §8.1 → T6/T11/T12/T13; §9 (`useTool`,
  scopes, confirm hooks, activity, SSR snapshots) → T10/T11; §10.1 `inertiaAdapter` → T13
  (`inertiaPages`, navigation, props tools → M2 by ruling); §11.1 → T8/T9; §11.6 → T14 (`/vitest`,
  hook rejects `human`, prod builds exclude it: T15); §12.1–12.3 → T7/T8/T16; §12.5 → T16; §14 → T1
  (no eval), T4 (dev/prod), T5 (grace period, bounded inline confirm), T6 (untrusted paths,
  redaction), T8/T9 (bounded messages, envelopes, origins); §17 (0.0.0, pre mode, `fixed`,
  metadata basics) → T1/T16; §18 unit/DOM/contract/E2E + release evidence (round budget, tarball
  smoke) → T3–T16; §20 M1 exit → "Milestone exit check". Wizard, options, arrays, files → M2;
  `useToolAnchor` → M3.
- **Placeholders:** none; execution-time verifications are named where an external API must be
  confirmed (Vitest condition options, RHF dirty tracking, Inertia `setData` stability and `router`
  export, the TS 7 bin), each with a stop-and-ask or ledger rule.
- **Names:** `createFormTools`, `FormAdapter.setValues/dirtyPaths/submit/fields`, `FieldInfo.sensitive`,
  `FormToolOptions.sensitive`, `ConfirmQueue`, `PendingConfirmation`, `bridge`, `BridgeTransport`,
  `createInPageChannel`, `createTestRegistry`, `createTestToolmark` are used identically in every task
  that consumes them and match the overview registry.
- **File ownership:** each file belongs to one lane (table above); `tsdown.config.ts` bridge entry
  lines are granted to Lane B; nothing outside `examples/react-vite/`, `docs/`, `scripts/`, the
  READMEs, CI and changeset files is edited by Lane F, and core's root `index.ts` never re-exports
  the bridge; `.changeset/pre.json` and the `changeset version` writes are Lane F's; the example's
  `package.json`/`tsconfig.json` and `packages/core/test/helpers/**` are Lane A's.
- **Dependencies:** Task 1 declares every M1 dependency (root, four packages, example, including
  `playwright`, `@testing-library/dom`, `tsx`, `@types/node`); Waves 1–2 add none.
- **TSDoc:** every task that adds an export writes its TSDoc (global constraint); reviewers check it
  per task.
