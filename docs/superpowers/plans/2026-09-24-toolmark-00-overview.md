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
| M1 | `2026-09-24-toolmark-m1-core.md` | workspace, core registry/policy/confirm/forms core, protocol v1, bridge + 4 transports, React + RHF, Inertia `useForm` adapter, testing basics, example, CI | Innovation simple form ≤ 3 rounds (via the Innovation adoption plan) |
| M2 | `2026-09-24-toolmark-m2-forms.md` | wizard, async options, arrays, files, DOM scanner + DOM adapter (incl. Inertia `<Form>`), `inertiaPages`, navigation, props-declared tools | Innovation wizard ≤ 5 rounds |
| M3 | `2026-09-24-toolmark-m3-reach.md` | WebMCP (experimental), `@toolmark/mcp`, OTel, tour hooks | same tools via WebMCP agent, desktop MCP client, Playwright |
| M4 | `2026-09-24-toolmark-m4-tours-tooling.md` | `@toolmark/tour`, lint + TypeSafe judge, docs site, examples (inertia-laravel, nextjs) | authored + planned tours run in Innovation |
| M5 | `2026-09-24-toolmark-m5-release.md` | release gates §21, security review, spec-watch, publish `1.0` | all gates green |

**Innovation adoption (spec §19)** is app-side work in `~/projects/innovation`, a different repo
with its own process (it uses Spec Kit under `.specify/`). It gets its own plan, written in that repo
with its own Spec Kit flow **before M1 starts**, consuming Toolmark `-next` tarballs. Toolmark plans
never edit Innovation.

- **Baseline first (prerequisite for the M1 exit check):** the adoption plan's first step records
  the current snapshot-and-script flow — 10 runs each of the simple-form task and the wizard task,
  recording rounds, wall time, input tokens and success rate — saved to
  `docs/release/innovation-baseline.md` in the Toolmark repo. The after-numbers go to
  `docs/release/innovation-results.md`; M5 Task 7 verifies both.
- **Pre-1.0 consumption is by tarball, not npm.** Changesets stay in pre mode `next` for version
  numbers, but nothing is published before M5. The final lane of every milestone plan runs
  `pnpm -r pack --pack-destination dist-tarballs` and writes the hand-off note; the Innovation
  adoption plan commits the tarballs under `innovation/vendor/toolmark/` and references them as
  `file:vendor/toolmark/<tgz>`. Local development uses `link:`. `dist-tarballs/` is git-ignored in
  the Toolmark repo.
- **Hosting:** the private GitHub repo `adams100111/toolmark` exists before M1 Task 16 (CI).

## Global constraints (apply to every milestone plan)

- Package names: `@toolmark/core`, `@toolmark/react`, `@toolmark/inertia`, `@toolmark/testing`,
  `@toolmark/tour`, `@toolmark/mcp`, `@toolmark/lint`, `@toolmark/judge-typesafe`. License MIT.
- ESM only: `"type": "module"`, `exports` maps with `types` + `import`, `"sideEffects": false`
  (except `@toolmark/tour`'s CSS entry).
- `engines.node`: `">=22.12"` (Node 22 has a global `WebSocket`; tests may inject `ws` where a Node
  server is needed). Browser code targets ES2022.
- **TypeScript 6.0.3 for the workspace** (ruling: `typescript-eslint` 8.70.1 peers
  `typescript >=4.8.4 <6.1.0`; TS 7.0.2 is latest). CI additionally runs `tsc --noEmit` against the
  published `.d.ts` with TypeScript 7.0.2.
- `@toolmark/core` has **zero runtime dependencies**. The Standard Schema v1 and Standard JSON
  Schema interfaces are vendored as types in `packages/core/src/standard-schema.ts` (the Standard
  Schema project permits copying the interface).
- Peer ranges: `react >=18.3.0 <20`; `@inertiajs/react ^2.0.0 || ^3.0.0`; `react-hook-form ^7.0.0`;
  `@opentelemetry/api ^1.9.0`; `@mcp-b/webmcp-polyfill ^5.0.0` (all optional except `react` for
  `@toolmark/react` and `@inertiajs/react` for `@toolmark/inertia`).
- No `eval`, `new Function`, or string-argument `setTimeout` anywhere: ESLint `no-eval`,
  `no-new-func`, `no-implied-eval` are errors.
- No Innovation-specific code, names or conventions in any package (D3).
- Tool name regex: `^[A-Za-z0-9_.-]{1,128}$`. `llmName` = name with `.` → `__`; must match
  `^[a-zA-Z0-9_-]{1,64}$`; if longer than 64, truncate to 55 chars + `_` + first 8 hex of FNV-1a hash
  of the full name.
- Bridge protocol constant `protocol: 1`.
- Deferred confirmation default expiry: `600000` ms.
- Source-first resolution: every package entry's `exports` carries a `"source"` condition pointing
  at its `src/*.ts` file; Vitest (`resolve.conditions: ['source']`) and `tsc`
  (`customConditions: ["source"]`) resolve workspace sources without a build (M1 Task 1).
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
| vite · @vitejs/plugin-react | 8.3.0 · 6.1.1 |
| eslint · typescript-eslint · prettier | 10.11.0 · 8.70.1 · 3.9.9 |
| @changesets/cli | 3.0.3 |
| publint · @arethetypeswrong/cli | 0.3.24 · 0.18.5 |
| size-limit · @size-limit/preset-small-lib | 14.0.0 |
| react · react-dom · @types/react · @types/react-dom | 19.3.0 |
| @testing-library/react | 16.3.3 |
| react-hook-form | 7.88.0 |
| @inertiajs/react · @inertiajs/core | 3.7.1 (tests also run 2.x) |
| zod (dev) · zod-to-json-schema (dev) | 4.6.5 · 3.25.2 |
| laravel-echo · pusher-js (dev) | 2.5.0 · 8.6.0 |
| ws · @types/ws | 8.21.3 · 8.18.1 |
| @modelcontextprotocol/server | 2.1.0 |
| @opentelemetry/api · @opentelemetry/sdk-trace-base (dev) | 1.9.1 · 2.11.0 |
| @mcp-b/webmcp-polyfill · webmcp-types | 5.1.0 · 0.1.9 |
| vitepress · typedoc | 1.6.4 · 0.28.20 |
| next (example) | 16.3.6 |

## Cross-milestone interface registry

Names every milestone relies on. A later plan may add names; it never renames these.

| Name | Package / file | Introduced |
| --- | --- | --- |
| `createToolmark(options): Toolmark` | core `src/registry.ts` | M1 |
| `defineTool`, `ToolDefinition`, `ToolHints`, `ToolContext`, `Caller` | core `src/tool.ts` | M1 |
| `ToolResult`, `ok`, `invalid`, `refuse`, `cancelled`, `FieldChange` | core `src/result.ts` | M1 |
| `ToolManifest`, `ToolManifestSummary` | core `src/manifest.ts` | M1 |
| `FormAdapter` (`getValues`, `setValues`, `dirtyPaths`, `submit`, `fields`, `onUserInteraction?`), `createFormTools`, `FormToolOptions` | core `src/forms/*.ts` | M1 |
| `ProtocolMessage` + `validateMessage` | core `src/protocol/*` | M1 |
| `bridge`, `BridgeTransport`, `echoTransport`, `websocketTransport`, `postMessageTransport`, `createInPageChannel` | core `src/bridge/*` | M1 |
| `ToolmarkProvider`, `useToolmark`, `useTool`, `ToolScope`, `useFormTool`, `useConfirmQueue`, `usePendingConfirmations`, `useAgentActivity` | react | M1 |
| `rhfAdapter` | react `/rhf` | M1 |
| `inertiaAdapter` | inertia | M1 |
| `createConfirmQueue`, `ConfirmQueue`, `PendingConfirmation`, `ToolmarkError` | core | M1 |
| `installTestHook`, `globalThis.__toolmark_test__` hook shape | testing `/page` | M1 |
| `createTestRegistry` (test helper, not exported) | core `test/helpers/create-test-registry.ts` | M1 |
| `test`, `expect`, `createTestToolmark`, `ToolsFixture` | testing | M1 |
| `createWizardTools`, `createStepwiseWizardTools`, `useWizardTool`, `FileRef`, `fromJsonSchema`, `scanDom`, `domFormAdapter`, `synthesizeFormSchema`, `navigationTool`, `propsTools`, `inertiaPages`, `inertiaFormComponentAdapter` | core / react / inertia | M2 |
| `webmcp`, `otel`, `useToolAnchor`, `mcpPairing`, `tm.anchor`/`setAnchor`/`state`, `startMcpServer`, `createPairingServer` | core `/webmcp`, `/otel`, react, mcp | M3 |
| `startTour`, `TourStep`, `Tour`, `Planner`, `mountTourOverlay`, `useTour`, `lint`, `Judge`, `Finding`, `typesafeJudge` | tour / lint / judge-typesafe | M4 |
