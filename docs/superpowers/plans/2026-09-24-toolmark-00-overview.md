# Toolmark 1.0 — plan overview

> **For agentic workers:** REQUIRED SUB-SKILL: Use `sdd-lanes` (the user's replacement for
> superpowers:subagent-driven-development / executing-plans) to implement each milestone plan.
> Plans are plan-lite: exact contracts and tests, no complete implementation code.

**Goal:** Ship the complete, production-ready Toolmark `1.0` defined by the spec, as five internal
milestones, each a separate plan executed in order.

**Spec:** `docs/superpowers/specs/2026-09-24-toolmark-design.md` (D1–D32). Every plan argues from it;
executors read both.

## Milestone plans (execute in order)

| # | Plan | Delivers | Exit check (spec §20) |
| --- | --- | --- | --- |
| M1 | `2026-09-24-toolmark-m1-core.md` | workspace, core registry/policy/confirm/forms core, protocol v1, bridge + 4 transports, React + RHF, Inertia `useForm` adapter, testing basics, example + round-budget e2e, CI, tarball smoke script | `round-budget.spec.ts` › `simple_form_within_3_rounds` green; CI green; tarball smoke passes |
| M2 | `2026-09-24-toolmark-m2-forms.md` | wizard, async options, arrays, files, DOM scanner + DOM adapter (incl. Inertia `<Form>`), `inertiaPages`, navigation, props-declared tools | `round-budget.spec.ts` › `wizard_within_5_rounds` green; tarball smoke passes |
| M3 | `2026-09-24-toolmark-m3-reach.md` | WebMCP (experimental), `@toolmark/mcp`, OTel, tour hooks | one example tool declaration driven via WebMCP (polyfill), a desktop MCP client (SDK client via `toolmark-mcp`) and the Playwright fixture (`e2e/reach.spec.ts`); tarball smoke passes (incl. `toolmark-mcp` bin) |
| M4 | `2026-09-24-toolmark-m4-tours-tooling.md` | `@toolmark/tour`, lint + TypeSafe judge, docs site, examples (inertia-laravel, nextjs), same-tools e2e | authored + agent-planned tours e2e in `examples/react-vite` on Chromium/Firefox/WebKit (axe-clean); authored tour in `examples/inertia-laravel`; `same-tools.spec.ts` green; Laravel + Next.js example suites green; `pnpm docs:build`; `toolmark lint` clean on every example; tarball smoke passes |
| M5 | `2026-09-24-toolmark-m5-release.md` | release gates §21, docs gap-fill, package metadata, security review, spec-watch, publish `1.0` | all §21 gates green (incl. round budget + tarball smoke on the RC); publish is owner-confirmed |

**Release independence.** Toolmark 1.0 depends on no other repository. Innovation adoption (spec
§19) is a post-1.0 consumer track planned and executed in `~/projects/innovation`; Toolmark plans
never edit Innovation and no Toolmark exit check or gate waits on it.

- **Success criterion 1 in-repo:** `examples/react-vite/e2e/round-budget.spec.ts` (M1 T15 creates it
  with `simple_form_within_3_rounds`; M2 T10 adds `wizard_within_5_rounds`). A scripted in-page agent
  (no LLM) starts from the attach `manifest` (summary) and may `describe`; a **round** is one agent
  turn issuing ≥ 1 tool call (all agent→page messages sent before it next awaits results); human
  confirmation is not a round. Both tests assert zero `invalid`/`refused` results. With
  `ROUND_BUDGET_REPORT=<file>` set the spec writes a JSON report (`{ task, rounds, messages,
  manifestBytes, describeBytes, wallMs }`); the milestone's final lane renders it into
  `docs/release/round-budget.md` with `scripts/render-round-budget.mjs` (M1 T16). The spec runs on
  Chromium only (one report row per task). M5 Task 7b regenerates it on the release candidate.
- **Success criterion 2 in-repo:** `examples/react-vite/e2e/same-tools.spec.ts` (M4 T8) drives one
  tool declaration through the in-app bridge, WebMCP, MCP, a `do`-mode tour step and the Playwright
  fixture, with identical `ok` data.
- **Pre-1.0 builds are tarballs, not npm.** Changesets stay in pre mode `next`; nothing is published
  before M5. The final lane of every milestone runs
  `pnpm -r --filter "./packages/*" pack --pack-destination "$PWD/dist-tarballs"` and
  `node scripts/tarball-smoke.mjs dist-tarballs` (created in M1 Task 16: fresh temp project outside
  the workspace, every tarball as a `file:` dependency plus `pnpm.overrides`, dynamic-import of every
  node-safe entry, `import.meta.resolve` for browser-only entries, `tsc --noEmit` with TypeScript
  6.0.3 and 7.0.2 over every entry's types, every `bin` runs `--help`), and logs version, filenames,
  SHA-256 and the smoke result in `docs/release/next-tarballs.md`. `dist-tarballs/` is git-ignored.
  Handing tarballs to a consumer is an optional courtesy (documented recipe in `next-tarballs.md`),
  never a gate.
- **Hosting:** the private GitHub repo `adams100111/toolmark` exists before M1 Task 16 (CI).
- **RC evidence on built packages:** M5 runs the RC round-budget, same-tools and tours e2e with
  `TOOLMARK_DIST=1` (the example resolves built `dist` instead of `@toolmark/source`).

## Global constraints (apply to every milestone plan)

- Package names: `@toolmark/core`, `@toolmark/react`, `@toolmark/inertia`, `@toolmark/testing`,
  `@toolmark/tour`, `@toolmark/mcp`, `@toolmark/lint`, `@toolmark/judge-typesafe`. License MIT.
- ESM only: `"type": "module"`, `exports` maps with `types` + `import`, `"sideEffects": false`
  (except `@toolmark/tour`'s CSS entry), and `"./package.json"` exported.
- Every package starts at `"version": "0.0.0"` (M1 T1; M3 T1 for `mcp`; M4 T0 for tour, lint,
  judge-typesafe). Milestones version in changesets pre mode `next`; `.changeset/config.json` has
  `"fixed": [["@toolmark/*"]]` and `"privatePackages": { "version": false, "tag": false }`. Before
  the RC, M5 adds one `major` changeset for all 8 packages → `1.0.0-next.<n>`, then `pre exit` →
  `1.0.0` (spec §17).
- Publishing (M5 only): first publish is an owner bootstrap with a short-lived granular npm token;
  then npm trusted publishing (OIDC) per package and the token is revoked. The publish job runs on
  Node 24 in the owner-approved GitHub environment `npm-release`, with provenance.
- Package metadata (spec §17, checked in M5): every package has `LICENSE`, `README.md`, `license`,
  `description`, `repository` (`git+https://github.com/adams100111/toolmark.git`, with
  `directory`), `homepage`, `bugs`, `keywords`, `publishConfig: { access: 'public', provenance:
  true }`, and passes `publint --strict` and `attw --profile esm-only` on its packed tarball. New
  packages set `license`, `repository` and `description` when created.
- tsdown (every package): `format: ['esm']`, `dts: true`, `fixedExtension: false`, `target:
  'es2022'`, entries as a named map so outputs land at `dist/<entry>.js` + `dist/<entry>.d.ts`;
  `platform: 'neutral'` for browser/isomorphic entries, `'node'` for CLIs and node-only entries.
- `engines.node`: `">=22.12"` (Node 22 has a global `WebSocket`; tests may inject `ws` where a Node
  server is needed). Browser code targets ES2022.
- **TypeScript 6.0.3 for the workspace** (ruling: `typescript-eslint` 8.70.1 peers
  `typescript >=4.8.4 <6.1.0`; typedoc 0.28.20 peers TS up to 6.0.x; TS 7.0.2 is latest). TS 7.0.2
  runs only in the CI types check and the tarball smoke test, never through typescript-eslint or
  typedoc. TS ≥ 6 no longer auto-includes `@types/*`: Node-side packages set `"types": ["node"]`.
- `@toolmark/core` has **zero runtime dependencies**. The Standard Schema v1 and Standard JSON
  Schema interfaces are vendored as types in `packages/core/src/standard-schema.ts` (the Standard
  Schema project permits copying the interface).
- Peer ranges: `react >=18.3.0 <20`; `@inertiajs/react ^2.0.0 || ^3.0.0`; `react-hook-form ^7.0.0`;
  `@opentelemetry/api ^1.9.0`; `@mcp-b/webmcp-polyfill ^5.0.0` (all optional except `react` for
  `@toolmark/react` and `@inertiajs/react` for `@toolmark/inertia`).
- No `eval`, `new Function`, or string-argument `setTimeout` anywhere: ESLint `no-eval`,
  `no-new-func`, `no-implied-eval` are errors.
- No app-specific (e.g. Innovation) code, names or conventions in any package (D3); M5 adds an
  automated check.
- Tool name regex: `^[A-Za-z0-9_.-]{1,128}$`. `llmName` = name with `.` → `__`; must match
  `^[a-zA-Z0-9_-]{1,64}$`; if longer than 64, truncate to 55 chars + `_` + first 8 hex of FNV-1a hash
  of the full name.
- Bridge protocol constant `protocol: 1`.
- Deferred confirmation default expiry: `600000` ms.
- Source-first resolution: every package entry's `exports` carries a package-unique
  `"@toolmark/source"` condition pointing at its `src/*.ts` file; Vitest/Vite
  (`resolve.conditions` and `ssr.resolve.conditions`: `['@toolmark/source']`) and `tsc`
  (`customConditions: ["@toolmark/source"]`) resolve workspace sources without a build (M1 Task 1).
  Packages ship `files: ["dist", "src"]` so the condition's targets exist (publint-clean); the
  condition is internal and outside semver. Anything that spawns built output (CLI e2e, Next.js,
  tarball smoke) builds the needed packages first (`pnpm --filter "<pkg>..." build`). Playwright spec
  files run in Node and do not see `@toolmark/source`; any Playwright run that imports
  `@toolmark/testing` builds `@toolmark/testing...` first (gates and the CI `e2e` job).
- Root scripts `build`, `typecheck`, `lint` cover `packages/*` only (`pnpm -r --filter
  "./packages/*" …`); each example runs its own scripts in a dedicated CI job. ESLint ignores
  `**/dist/**`, `**/.next/**`, `examples/inertia-laravel/{vendor,public/build,storage}/**`,
  `docs/api/**`, `docs/.vitepress/{cache,dist}/**`, `**/test-results/**`, `**/playwright-report/**`.
- **TSDoc with every export:** every task that adds a public export writes its TSDoc comment in the
  same task (from M1); reviewers reject undocumented exports. TypeDoc runs with `notDocumented` off
  through M4; M5 turns it on as an error after a gap-fill task. M4 adds root script `docs:api:strict`
  (`TYPEDOC_STRICT=1`, turns on `notDocumented` and `notExported`); M5 gates on it and makes strict
  the default in `typedoc.config.mjs`.
- **Confirmation modes:** `inapp`/`test` configurable (default deferred); `webmcp`, `mcp`, `tour` are
  always inline, so those consumers never receive `needs_confirmation`. `createTestToolmark`
  keeps production modes with a default-approve inline handler.
- CI matrix (M1 creates, M5 completes): Node 22.x/24.x; React 18.3.1/19.3.0 × Inertia 2.3.28/3.7.1
  **excluding React 18.3 × Inertia 3** (Inertia 3 requires React 19); zod 4.6.5 everywhere plus a
  zod 3 axis running only the converter-specific tests (`zod/v3` + `zod-to-json-schema`);
  Chromium/Firefox/WebKit; WebMCP, Laravel and Next.js on Chromium only.
- Security-tagged tasks (`risk: high, security`) include every task that implements or documents
  the §12.2 MUSTs, pairing, DOM scanning of page content, file fetching, or server-declared tools.
- Node-environment tests build registries through `createTestRegistry` (core test helper, sets
  `__environment: 'browser'`) or `createTestToolmark` from `@toolmark/testing` (M1 Task 4).
- Spec rulings made in these plans are listed in spec §23.
- Commits: Conventional Commits; no AI attribution lines of any kind.
- Versions below were checked on npm 2026-09-24; re-verify with `npm view <pkg> version` at the start
  of each milestone and record bumps in that plan's ledger.

| Dev tool | Version |
| --- | --- |
| pnpm | 12.6.0 |
| typescript | 6.0.3 (workspace) · 7.0.2 (CI types check) |
| tsdown | 0.23.0 |
| vitest · @vitest/browser · @vitest/browser-playwright | 5.0.1 |
| @playwright/test | 1.63.0 |
| playwright | 1.63.0 (peer of @vitest/browser-playwright; same as @playwright/test; M1 catalog) |
| @testing-library/dom | pin at M1 start (peer ^10 of @testing-library/react) |
| @eslint/js | pin at M1 start |
| vite · @vitejs/plugin-react | 8.3.1 · 6.1.1 |
| eslint · typescript-eslint · prettier | 10.11.0 · 8.70.1 · 3.9.9 |
| @changesets/cli | 3.0.3 |
| publint · @arethetypeswrong/cli | 0.3.24 · 0.18.5 |
| size-limit · @size-limit/preset-small-lib | 14.0.0 |
| react · react-dom · @types/react · @types/react-dom | 19.3.0 |
| @testing-library/react | 16.3.3 |
| react-hook-form | 7.88.0 |
| @inertiajs/react · @inertiajs/core | 3.7.1 (tests also run 2.x) |
| zod (dev) · zod-to-json-schema (dev) | 4.6.5 · 3.25.2 |
| zod (M5 zod 3 CI axis only) | 3.25.76 |
| laravel-echo · pusher-js (dev) | 2.5.0 · 8.6.0 |
| ws · @types/ws | 8.21.3 · 8.18.1 |
| @modelcontextprotocol/server · @modelcontextprotocol/client (dev/e2e) | 2.1.0 · 2.1.0 |
| @opentelemetry/api · @opentelemetry/sdk-trace-base (dev) · @opentelemetry/sdk-metrics (dev) | 1.9.1 · 2.11.0 · 2.11.0 |
| @mcp-b/webmcp-polyfill · webmcp-types | 5.1.0 · 0.1.9 |
| vitepress · typedoc | 1.6.4 · 0.28.20 (VitePress bundles its own vite 5; expected) |
| typedoc-plugin-markdown · typedoc-vitepress-theme | 4.13.1 · 1.1.4 (re-verify at M4 start) |
| ajv · ajv-formats | 8.20.0 · 3.0.1 |
| @typesafe-ai/sdk | 0.6.0 (re-verify at M4 start) |
| axe-core · @axe-core/playwright | 4.13.0 · 4.13.0 |
| laravel-vite-plugin · @laravel/vite-plugin-wayfinder | 3.2.0 · 0.1.10 |
| @changesets/changelog-github | 1.0.1 |
| yaml (root dev, M5 `check-workflows`) | 2.9.1 |
| tsx · @types/node | pin at M1 start (`npm view`) · 22.x |
| next (example) | 16.3.6 |

## Cross-milestone interface registry

Names every milestone relies on. A later plan may add names; it never renames these.

| Name | Package / file | Introduced |
| --- | --- | --- |
| `createToolmark(options): Toolmark` | core `src/registry.ts` | M1 |
| `defineTool`, `ToolDefinition`, `ToolHints`, `ToolContext`, `Caller` | core `src/tool.ts` | M1 |
| `ToolResult`, `ok`, `invalid`, `refuse`, `cancelled`, `FieldChange` | core `src/result.ts` | M1 |
| `ToolManifest`, `ToolManifestSummary` | core `src/manifest.ts` | M1 |
| `FormAdapter` (`getValues`, `setValues`, `dirtyPaths`, `submit`, `fields`; `onUserInteraction?` added M3), `createFormTools`, `FormToolOptions`, `FieldInfo` | core `src/forms/*.ts` | M1 |
| `ProtocolMessage` + `validateMessage` | core `src/protocol/*` | M1 |
| `bridge`, `BridgeTransport`, `echoTransport`, `websocketTransport` (with `terminalCloseCodes`, `onOpen(socket, { receive(timeoutMs?) })`, `onStatus`), `postMessageTransport`, `createInPageChannel` | core `src/bridge/*` | M1 |
| `ToolmarkProvider`, `useToolmark`, `useTool`, `ToolScope`, `useFormTool`, `useConfirmQueue`, `usePendingConfirmations`, `useAgentActivity` | react | M1 |
| `rhfAdapter` | react `/rhf` | M1 |
| `inertiaAdapter`, `InertiaFormLike`, `InertiaVisitCallbacks` (v2 + v3 callback names); internal `visit-outcome.ts` mapping (reused by M2 props tools) | inertia | M1 |
| `createConfirmQueue`, `ConfirmQueue`, `PendingConfirmation`, `ToolmarkError` | core | M1 |
| `installTestHook`, `globalThis.__toolmark_test__` hook shape | testing `/page` | M1 |
| `createTestRegistry` (test helper, not exported) | core `test/helpers/create-test-registry.ts` | M1 |
| `test`, `expect`, `createTestToolmark` (also `@toolmark/testing/vitest`; production confirm modes, `inline: 'approve' \| 'reject' \| handler`), `ToolsFixture` | testing | M1 |
| `Toolmark`, `ToolmarkOptions`, `ConfirmRequest`, `ConfirmOutcome`, `Scope`, `Registration`, `ToolmarkEventMap`, `JsonSchema`, `JsonSchemaConverter`, `BridgeOptions`, `PageToAgentMessage`, `AgentToPageMessage`, `PROTOCOL_VERSION`, `protocolSchemas`, `useCurrentScope`, `ToolContext.registerUndo`, `HintClass`, `CallerPolicy`, `FormToolOptions.sensitive`, `FieldInfo.sensitive`, `ToolmarkOptions.abortGraceMs`, `BridgeOptions.maxMessageBytes` | core / react | M1 |
| `AnchorSpec` (`element?`, `params?`; `resolve?` added M3), `ToolState` (declared in M1 T2, behaviour in M3) | core `src/tool.ts` | M1 |
| `createWizardTools`, `createStepwiseWizardTools`, `useWizardTool`, `FileRef`, `fromJsonSchema`, `scanDom`, `domFormAdapter`, `synthesizeFormSchema`, `navigationTool`, `propsTools`, `inertiaPages`, `inertiaFormComponentAdapter` | core / react / inertia | M2 |
| `ArrayOp`, `OptionsProvider`, `FilesOptions`, `FileFieldSpec`, `fileFieldSchema`, `WizardStep`, `WizardToolOptions`, `StepwiseWizardOptions`, `RouterLike`, `InertiaEventName`, `PropsToolEntry`, `RouteFn`, `ToolOrigin`, `ToolDefinition.origin`, `ToolDefinition.nativeName`, `ToolDefinition.mode`, `tm.info` (`{ origin, nativeName? }`; `sensitivePaths` added M3), transparent scopes, `FormToolOptions.options`/`files`, `createStepwiseWizardTools(...).refresh` (`discoverFields`, `resolveFileRef` stay internal) | core / inertia | M2 |
| `webmcp` (`{ polyfill?, filter?, exposedTo?, modelContext? }`), `ModelContextLike`, `otel`, `useToolAnchor`, `mcpPairing` (`{ code?, port?, onStatus? }`), `McpPairingStatus`, `tm.anchor`/`setAnchor`/`state`, `tm.info().sensitivePaths`, `ToolDefinition.sensitivePaths`, `AnchorSpec.resolve`, `FormAdapter.onUserInteraction`, `rhfAdapter(form, { root? })`, `BridgeOptions.caller: 'inapp' \| 'mcp'`, `startMcpServer`, `createPairingServer`, `isAllowedUpgrade`, `createServerFactory`, `PageLink`, `toMcpTool`, `toMcpResult`, `PAIRING_TOOL_NAME` | core `/webmcp`, `/otel`, react, mcp (`mcpPairing` from `@toolmark/mcp/client`) | M3 |
| `startTour`, `TourStep`, `Tour`, `Planner`, `TourMode`, `TourState`, `TourEvent`, `TourStrings`, `mountTourOverlay`, `useTour`, `lint`, `Judge`, `Finding`, `ManifestFile`, `typesafeJudge` (named + default export) | tour / lint / judge-typesafe | M4 |

## Shared files across milestones

Files an earlier milestone creates and a later one extends. Each later edit has one owning lane
(named in that plan's lane table) and changes only what this table lists.

| File / setting | M1 (creates) | M2 | M3 | M4 | M5 |
| --- | --- | --- | --- | --- | --- |
| `pnpm-workspace.yaml` catalog | every row of the dev-tool table (except the M5-only zod 3 axis row) incl. `playwright`, `@testing-library/dom`, `@eslint/js`, `tsx` (T1, Lane A) | — (verify versions) | — (verify versions) | — (verify versions; bump if `npm view` moved) (T0, A) | — (verify; `zod@3.25.76` is installed only inside the `zod3` job) |
| root `vitest.config.ts` `test.projects` | `core-node`, `react`, `inertia`, `testing` (T1, A) | + `core-browser` (T1, A) | + `mcp` (T1, A) | + `tour`, `lint`, `judge-typesafe` (T0, A) | browser instances only (T1, A) |
| root `package.json` scripts / devDeps | `build`, `typecheck`, `lint`, `test`, `format:check`; tooling devDeps (T1, A) | — | — | + `docs:api`, `docs:api:strict`, `docs:dev`, `docs:build`, `docs:preview`; docs devDeps (T0, A) | + `quality`, `size`, `test:all` (T1–T2, A), `docs:check` (controller); devDeps `publint`, `@arethetypeswrong/cli`, `size-limit`, `@size-limit/preset-small-lib`, `yaml` (T2, A) |
| `packages/core/package.json` exports + `tsdown.config.ts` entries | `.`, `./protocol`, `./protocol/v1/*.json`, `./bridge*` (T1, A; bridge entry lines Lane B) | + `./dom` (T1, A) | + `./webmcp`, `./otel`; optional peers (T1, A) | — | metadata fields only (T2, A) |
| `packages/core/src/index.ts` | Lane A (never re-exports the bridge) | Lane A | Lane A (T1) | — | Lane E only for security fixes |
| `eslint.config.js` ignores + `parserOptions.project` | the full overview list; `project: ['./packages/*/tsconfig.test.json']` (T1, A) | — | — | verify, append missing ignores only (T0, A) | — |
| `packages/*/tsconfig.test.json` (ESLint project + `typecheck`) | core, react, inertia, testing; react/inertia `tsconfig.json` `jsx: react-jsx`; example bundler-mode tsconfig (T1, A) | — | + `mcp` (T1, A) | + `tour` (`jsx: react-jsx`), `lint`, `judge-typesafe` (T0, A) | — |
| `packages/core/src/registry.ts` internal `emitEvent` | — | creates (T1, A); used by T4 (A), T5–T6 (B) | used by T2 (B), no edit | — | — |
| `.gitignore` | T1, A | — | — | append missing (T0, A) | + `.quality/` (T2, A) |
| `.github/workflows/ci.yml` jobs | `lint`, `typecheck`, `build`, `test` (4-cell matrix, Chromium), `types-ts7` (= tarball smoke), `e2e` (react-vite, Chromium, round-budget artifact) (T16, F) | — | — (Playwright `globalSetup` builds `@toolmark/mcp...`) | + `docs`, `example-nextjs`, `example-laravel`; `e2e` builds packages and installs 3 browsers, keeping M1's steps (T7, F) | full matrix, browser axis, `zod3`, `quality`, hardening + SHA pins, triggers (T1–T2, A) |
| other workflows | — | — | — | `docs-deploy.yml` (T7, F) | hardens `docs-deploy.yml` (T3b, B); + `release.yml` (T7a, F), `spec-watch.yml` (T6, D), `dependabot.yml` (T1, A) |
| `scripts/tarball-smoke.mjs` | creates (T16, F) | only if `./dom` is unhandled (T12, E) | — (bins already run) | only if non-JS export targets are unchecked (T8, F) | + second tarball-dir argument (T2, A) |
| `scripts/render-round-budget.mjs` | creates (T16, F) | reuses | — | reuses | + `--check` budget enforcement (T7b, F) |
| `examples/react-vite/package.json` | T1, A | — | + `@toolmark/mcp`, polyfill, OTel, MCP client (T1, A) | + `@toolmark/tour`, `@toolmark/lint`, `ws`, `@types/ws`, `@axe-core/playwright` (T0, A) | — |
| `examples/react-vite/playwright.config.ts` | Chromium, `webServer` (T15, F) | — | + `globalSetup` (`e2e/global-setup.ts`) (T7, F) | 3 browsers; Chromium-only: `webmcp`, `mcp`, `reach`, `same-tools`, `lint-clean`, `round-budget` (T8, F) | verify projects (T1, A) |
| `examples/react-vite/vite.config.ts` | `@toolmark/source` conditions (T15, F) | + `plain-form.html` input (T10, E) | — | — | + `TOOLMARK_DIST` switch (T2, A) |
| `docs/release/{next-tarballs,round-budget}.md` | create (T16, F) | append / re-render (T12, E) | append (T7, F) | append / re-render (T8, F) | RC + 1.0.0 entries (T7b–T7c, F) |
| `.changeset/` | `config.json` (T1, A); `pre.json`, `initial-release.md` (T16, F) | `m2-forms.md` (T12, E) | `m3-reach.md` (T7, F) | `m4-tours-tooling.md` (T8, F) | `release-1-0.md`, `pre exit` (T7b–T7c, F) |
