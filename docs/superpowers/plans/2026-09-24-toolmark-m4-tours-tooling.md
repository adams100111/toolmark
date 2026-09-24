# Toolmark M4 — Tours and Tooling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `sdd-lanes` to implement this plan lane by lane.
> Plan-lite format. Requires M1–M3 merged.

**Goal:** Guided tours (show / guide / do; authored and agent-planned; styled overlay and headless),
the `toolmark lint` CLI with the optional TypeSafe judge, the documentation site with generated API
reference, and the two remaining runnable examples (Inertia + Laravel, Next.js).

**Architecture:** `@toolmark/tour` is a framework-free engine over the registry's anchors, state and
interaction events, plus a vanilla-DOM overlay and a React binding. `@toolmark/lint` inspects
**manifests** (from a file or collected from running pages through the testing hook), never app
source, so it works for any stack. The TypeSafe judge is a lint plugin that runs only in dev/CI.

**Tech Stack:** as overview, plus `vitepress` 1.6.4, `typedoc` 0.28.20,
`typedoc-plugin-markdown` 4.13.1, `typedoc-vitepress-theme` 1.1.4, `@typesafe-ai/sdk` 0.6.0,
`ajv` 8.20.0; example: `laravel/laravel` v13.10.1, `inertiajs/inertia-laravel` v3.3.4,
`laravel/wayfinder` v0.1.21, `laravel/reverb` v1.12.0, PHP 8.4, `next` 16.3.6.

**Spec:** §4 (tour, lint, judge), §11.5, §15, §16 (examples), §18, D30.

## Global constraints (M4 additions)

- Tour CSS custom properties (exact names): `--toolmark-tour-accent`, `--toolmark-tour-bg`,
  `--toolmark-tour-fg`, `--toolmark-tour-radius`, `--toolmark-tour-shadow`, `--toolmark-tour-z`
  (default `2147483000`), `--toolmark-tour-backdrop`. No selector outside `.toolmark-tour` and its
  descendants; `@toolmark/tour/styles.css` is the only file with side effects (`sideEffects:
  ["**/*.css"]`).
- Default tour strings (English): `next: "Next"`, `back: "Back"`, `close: "Close tour"`,
  `done: "Done"`, `stepOf: (i, n) => \`Step ${i} of ${n}\``; every string is overridable.
- Lint exit codes: `0` no errors, `1` errors found, `2` usage/runtime failure. Output formats
  `pretty` (default) and `json`.
- Lint rule ids (exact): `name-format`, `description-missing`, `description-short` (< 20 chars),
  `param-description-missing`, `schema-invalid`, `llm-name-collision`, `tool-budget` (default 40 per
  page), `consequential-hint-missing` (name or description matches
  `/\b(delete|remove|archive|destroy|drop|cancel|refund|pay|charge|submit|send|publish|approve|reject)\b/i`
  without `consequential` or `destructive`), `options-without-hint`.
- TypeSafe judge: API key from env `TYPESAFE_API_KEY`; missing key → judge disabled with a warning,
  lint still runs; findings ids `judge/description-quality`, `judge/overlap`,
  `judge/consequential-hint`.
- Tour `do`-mode highlight: `600` ms per changed field; none under `prefers-reduced-motion: reduce`.
- Node-project tests build registries with `createTestToolmark` (`@toolmark/testing`) or core's
  `createTestRegistry` (M1 constraints).
- Example package names: `@toolmark-examples/react-vite` (M1), `@toolmark-examples/nextjs`,
  `@toolmark-examples/inertia-laravel` (all private).
- Nothing is published to npm; the milestone ends with the `-next` tarball hand-off (Task 8).

## Rulings made while planning

- **Lint reads manifests, not source.** Static analysis of TSX/Blade cannot see runtime tools
  (DOM-scanned, server-declared, wizards). Inputs: `--manifest <file.json>` (repeatable) and
  `--url <url>` (repeatable; Playwright loads the page and reads `__toolmark_test__`).
- **Tour overlay is vanilla DOM**, so non-React apps (Blade + `scanDom`) get tours too; React adds
  `useTour` for headless rendering.
- **Laravel example lives in `examples/inertia-laravel`** as a full Laravel 13 app that also
  exercises the §12.5 reference code (copied into the example) in CI; it is not published.

## Review focus

1. **Tour step whose anchor is missing** (element not rendered) → the step is skipped with an event,
   the tour continues (Task 1 `missing_anchor_skips_step`).
2. **Guide mode with invalid user input** → the tour stays on the step and shows the field's issue
   (Task 1 `guide_waits_until_valid`).
3. **Overlay in RTL and with reduced motion** → mirrored placement, no animation (Task 2
   `rtl_placement_mirrored`, `reduced_motion_no_transition`).
4. **Keyboard-only use of the overlay** → focus moves into the dialog, Esc closes, Tab cycles, focus
   returns to the anchor/previous element on close (Task 2 `keyboard_focus_management`).
5. **Lint against a page with no test hook** → exit code `2` with a message naming
   `installTestHook` (Task 3 `url_without_hook_exit_2`).

## File structure

```
packages/tour/  package.json tsconfig.json tsdown.config.ts vitest.config.ts
  src/index.ts engine.ts planner.ts types.ts
  src/overlay/{index,position,focus,render}.ts  src/styles.css
  src/react/index.ts   (useTour)
  test/*.test.ts
packages/lint/  package.json ...  src/{cli,run,rules/*,collect,format,judge}.ts  test/*
packages/judge-typesafe/  package.json ...  src/index.ts  test/*
docs/.vitepress/config.ts  docs/index.md  docs/guides/{tours,lint,nextjs,react}.md  docs/api/ (generated)
docs/release/next-tarballs.md  (append)
typedoc.json
vitest.config.ts   (modify: append tour, lint, judge-typesafe projects)
examples/inertia-laravel/  (Laravel 13 app incl. its package.json)  e2e/*.spec.ts
examples/nextjs/  (Next 16 App Router app)  e2e/*.spec.ts
examples/react-vite/src/{tour-page.tsx,routes.tsx}  e2e/{tour,multi-client,navigation}.spec.ts  e2e/support/relay-server.ts
.changeset/m4-tours-tooling.md
.github/workflows/ci.yml   (modify: php example job, nextjs job, docs build)
```

## Lanes

| Wave | Lane | Tasks | Owns files | Consumes |
| --- | --- | --- | --- | --- |
| 0 | A (normal) | 0 | new `package.json` files except `examples/inertia-laravel/package.json`, `examples/react-vite/package.json` (adds deps), root `package.json`, `pnpm-lock.yaml` (wave 0), `pnpm-workspace.yaml`, root `vitest.config.ts` | M3 |
| 1 | B (normal) | 1–2 | `packages/tour/**` except `package.json` | A |
| 1 | C (normal) | 3–4 | `packages/lint/**`, `packages/judge-typesafe/**` except `package.json` files | A |
| 1 | D (normal) | 5 | `examples/inertia-laravel/**` (the whole directory, including its `package.json`), plus that example's entries in `pnpm-lock.yaml` at the end of its lane | A |
| 1 | E (normal) | 6 | `examples/nextjs/**` except `package.json` | A |
| 2 | F (normal) | 7–8 | `docs/**` (except `docs/superpowers`), `typedoc.json`, `.github/workflows/ci.yml`, `.changeset/m4-tours-tooling.md`, `examples/react-vite/**` except `package.json` | B–E |

Shared-file rule: `pnpm-lock.yaml` is Lane A's in wave 0. In wave 1 only Lane D may touch it, and
only to add the `examples/inertia-laravel` dependencies at the end of its lane; the controller merges
any lockfile conflict by re-running `pnpm install`, never by hand-editing.

### Task 0: Package skeletons and dependencies   (Lane A, risk: normal)

**Files:** Create `packages/tour/package.json`, `packages/lint/package.json`,
`packages/judge-typesafe/package.json`, `examples/nextjs/package.json`, each package's
`tsconfig.json`/`tsdown.config.ts`/`vitest.config.ts`/empty `src/index.ts`; Modify
`pnpm-workspace.yaml` catalog, root `package.json` (`docs:dev`, `docs:build` scripts), root
`vitest.config.ts` (append `packages/tour/vitest.config.ts`, `packages/lint/vitest.config.ts`,
`packages/judge-typesafe/vitest.config.ts`), `examples/react-vite/package.json` (add
`@toolmark/tour` `workspace:*`; dev `ws` 8.21.3 for the e2e relay). `examples/inertia-laravel/`
(including its `package.json`) is **not** created here — Lane D owns that whole directory.

**Exact values:** `@toolmark/tour` exports `"."`, `"./overlay"`, `"./react"`, `"./styles.css"`,
peer `react >=18.3.0 <20` optional; `@toolmark/lint` `bin: { "toolmark": "./dist/cli.js" }`, deps
`ajv` 8.20.0, `ajv-formats` 3.0.1, peer `@playwright/test ^1.63.0` optional (only for `--url`);
`@toolmark/judge-typesafe` dep `@typesafe-ai/sdk` 0.6.0. Every new package: `engines.node`
`">=22.12"`, `source` export conditions as in M1 Task 1. `examples/nextjs/package.json`: private,
name `@toolmark-examples/nextjs`, deps `next` 16.3.6, `react`/`react-dom` 19.3.0, `react-hook-form`,
`zod`, `@toolmark/core`/`react` `workspace:*`; dev `@playwright/test`.

**Tests:** `pnpm install && pnpm build` succeeds.

**Task gate:** `pnpm install && pnpm build && pnpm typecheck`

---

### Task 1: Tour engine and planner contract   (Lane B, risk: normal)

**Files:** Create `packages/tour/src/types.ts`, `engine.ts`, `planner.ts`, `src/index.ts`;
Test `test/engine.test.ts`, `test/planner.test.ts`.

**Interfaces — Produces:**
```ts
interface TourStep { tool: string; param?: string; title?: string; text: string; input?: unknown /* do mode */; waitFor?: 'input' | 'submit' }
type TourMode = 'show' | 'guide' | 'do'
interface Planner { plan(ctx: { goal: string; mode: TourMode; tools: ToolManifestSummary[]; describe(name: string): ToolManifest | undefined }): Promise<TourStep[]> }
interface TourState { status: 'idle' | 'running' | 'waiting' | 'done' | 'stopped'; index: number; steps: TourStep[]; anchor: Element | null; highlight?: Element | null; message?: string }
type TourEvent = { type: 'step_invalid' | 'anchor_missing' | 'step_skipped'; step: TourStep; reason: string }
interface Tour { readonly state: TourState; next(): Promise<void>; back(): void; stop(): void; subscribe(fn: (s: TourState) => void): () => void; on(fn: (e: TourEvent) => void): () => void }
function startTour(tm: Toolmark, o: { mode: TourMode; steps?: TourStep[]; goal?: string; planner?: Planner; reducedMotion?: boolean }): Promise<Tour>
```

**Behaviour:**
- Exactly one of `steps` / (`goal` + `planner`) → else throws `TypeError`.
- Planned steps are validated: unknown tool or param not in the tool's schema → dropped with a tour event `step_invalid` (`tour.on`).
- On entering a step: resolve `tm.anchor(tool, param)`; `null` → skip the step with a tour event `anchor_missing`.
- `show`: waits for `next()`.
- `guide`: listens for `interaction` events on the step's tool/param (`waitFor` default `input`); then checks `tm.state(tool).issues` for that param → issues → `status: 'waiting'` with `message` = first issue; none → advance.
- `do`: `tm.call(tool, input ?? {}, { caller: 'tour' })` (fill tools get `{ values: input }` when the tool name ends with `.fill` and `input` has no `values` key); `invalid`/`refused`/`error` → stop with `message`; consequential steps rely on the app's inline confirm.
- `do` highlighting: after a successful `.fill`, `TourState.highlight` is set to each changed field's anchor (`tm.anchor(tool, change.path)`) in `changes` order for `600` ms each, and the overlay spotlights `highlight ?? anchor`; then the tour advances. Under reduced motion (`startTour` option `reducedMotion`, default from `matchMedia('(prefers-reduced-motion: reduce)')`) there is no highlight sequence and it advances immediately.
- `stop()` ends the tour, unsubscribes everything; tools disappearing mid-tour (scope disposed) → the current step is skipped with a tour event `step_skipped`.

**Tests (write first):** `authored_show_mode_advances` · `missing_anchor_skips_step` (review focus 1) · `guide_waits_until_valid` (review focus 2) · `do_mode_calls_as_tour_and_wraps_fill_values` · `do_mode_highlights_changes` (fake timers: two changed fields → `highlight` is each field's anchor for 600 ms in `changes` order, then advance; `reducedMotion: true` → no highlight, immediate advance) · `do_mode_failure_stops_with_message` · `planner_steps_validated_and_invalid_dropped` · `exactly_one_source_required`.

**Task gate:** `pnpm -F @toolmark/tour exec vitest run test/engine.test.ts test/planner.test.ts`

---

### Task 2: Overlay UI and React binding   (Lane B, risk: normal)

**Files:** Create `packages/tour/src/overlay/index.ts`, `position.ts`, `focus.ts`, `render.ts`,
`src/styles.css`, `src/react/index.ts`; Test `test/overlay.test.ts` (browser mode),
`test/react.test.tsx`.

**Interfaces — Produces:**
```ts
function mountTourOverlay(tour: Tour, o?: { container?: HTMLElement; strings?: Partial<TourStrings> }): () => void
interface TourStrings { next: string; back: string; close: string; done: string; stepOf(i: number, n: number): string }
function useTour(tour: Tour | null): TourState | null
```

**Behaviour:**
- Renders a spotlight (backdrop with a cut-out around the anchor's rect) and a dialog (`role="dialog"`, `aria-modal="true"`, `aria-labelledby` title, `aria-live="polite"` status for `message`), positioned beside the anchor (preferred side: bottom, then top, end, start), repositioned on scroll/resize via `ResizeObserver` + `scroll` listeners.
- Direction from the anchor's computed `direction`; `rtl` mirrors start/end placement.
- `prefers-reduced-motion: reduce` → no transitions, `scrollIntoView({ behavior: 'auto' })`; otherwise `'smooth'`.
- Focus: moves to the dialog on open, traps Tab/Shift+Tab, Esc → `tour.stop()`, restores focus to the previously focused element on close. Buttons: Back, Next/Done, Close; keyboard shortcuts ← / → for back/next when focus is inside the dialog.
- `useTour` wraps `tour.subscribe` in `useSyncExternalStore` for headless UIs.

**Tests (write first):** `renders_dialog_near_anchor` · `repositions_on_resize` · `rtl_placement_mirrored` · `reduced_motion_no_transition` (review focus 3) · `keyboard_focus_management` (review focus 4) · `strings_overridable` · `use_tour_headless_state`.

**Task gate:** `pnpm -F @toolmark/tour exec vitest run`

---

### Task 3: `toolmark lint` CLI and rules   (Lane C, risk: normal)

**Files:** Create `packages/lint/src/cli.ts`, `run.ts`, `collect.ts`, `format.ts`, `judge.ts`,
`src/rules/*.ts` (one file per rule id), `src/index.ts`; Test `test/rules.test.ts`,
`test/cli.test.ts`, `test/collect.test.ts`.

**Interfaces — Produces:**
```ts
interface Finding { rule: string; severity: 'error' | 'warn'; tool?: string; page?: string; message: string; score?: number }
interface Judge { name: string; judge(input: { page: string; tools: ToolManifest[] }): Promise<Finding[]> }
function lint(o: { manifests: Array<{ page: string; tools: ToolManifest[] }>; judges?: Judge[]; budget?: number }): Promise<Finding[]>
// CLI: toolmark lint [--manifest file]... [--url url]... [--judge module]... [--budget n] [--format pretty|json]
```

**Behaviour:**
- Rule severities: `name-format`, `schema-invalid`, `llm-name-collision`, `consequential-hint-missing` → error; the rest → warn.
- `schema-invalid` compiles each `inputSchema` with Ajv 2020 (+ formats); failure → error.
- `--url` uses Playwright Chromium, waits for `__toolmark_test__` (5000 ms) and collects `manifest({ detail: 'full', caller: 'inapp' })`; missing hook → exit 2 with the M1 hook error message.
- `--judge <module>` dynamic-imports the module's default export: if it is a function, it is called with no arguments to obtain the `Judge` (e.g. `typesafeJudge`); otherwise it is used as the `Judge`. Judge errors are reported as warn findings, never crash the run.
- `json` format prints `{ findings, summary: { errors, warnings } }`.

**Tests (write first):** one test per rule id (positive + negative) · `cli_exit_codes` · `cli_json_format` · `url_without_hook_exit_2` (review focus 5) · `judge_errors_become_warnings` · `judge_module_factory_or_object` (default export as factory function and as plain `Judge` object both work).

**Task gate:** `pnpm -F @toolmark/lint exec vitest run`

---

### Task 4: TypeSafe judge   (Lane C, risk: normal)

**Files:** Create `packages/judge-typesafe/src/index.ts`; Test `test/judge.test.ts`.

**Interfaces — Produces:** `export default function typesafeJudge(o?: { apiKey?: string; overlapThreshold?: number; hintThreshold?: number }): Judge` (defaults: `overlapThreshold` `0.8`, `hintThreshold` `0.85`).

**Behaviour:**
- Before coding, read the live TypeSafe docs (`https://docs.typesafe.ai/llms.txt`, the JavaScript SDK page and the Score/Noul primitive pages) and use the current `@typesafe-ai/sdk` 0.6.0 API exactly; ledger any divergence from this plan.
- One request per page with independent questions (they run in parallel server-side): per tool a **Score** "how clearly does this description tell an agent when to use this tool" (levels 1–5 with concrete level descriptions) → level ≤ 2 → warn `judge/description-quality`; per tool a **Noul** "does this action change data, spend money, send messages or otherwise have effects the user must approve" → probability ≥ `hintThreshold` and no `consequential`/`destructive` hint → error `judge/consequential-hint`; per pair of tools sharing the same scope prefix a **Noul** "would an agent confuse these two tools" → ≥ `overlapThreshold` → warn `judge/overlap`.
- State sent: tool names, titles, descriptions and schema property names/descriptions only — never user data.
- No key → returns `[]` and prints a single warning to stderr.

**Tests (write first):** (SDK client mocked) `maps_scores_and_nouls_to_findings` · `pairs_only_within_scope_prefix` · `no_key_disabled_with_warning` · `state_contains_no_values`.

**Task gate:** `pnpm -F @toolmark/judge-typesafe exec vitest run`

---

### Task 5: Example — Inertia + Laravel 13   (Lane D, risk: normal)

**Files:** Create `examples/inertia-laravel/**` (Laravel 13 app via `composer create-project
laravel/laravel` v13.10.1, `inertiajs/inertia-laravel` v3.3.4, `laravel/wayfinder` v0.1.21, React
frontend with `@inertiajs/react` 3.7.1), including its `package.json`, `e2e/*.spec.ts`,
`playwright.config.ts`; Modify `pnpm-lock.yaml` (this example's entries only, at the end of the
lane, via `pnpm install`).

**Exact values:** `package.json` private, name `@toolmark-examples/inertia-laravel`, frontend deps
`@inertiajs/react` 3.7.1, `react` 19.3.0, `react-dom` 19.3.0, `react-hook-form` 7.88.0, `zod` 4.6.5,
`laravel-echo` 2.5.0, `pusher-js` 8.6.0, `vite` 8.3.0, `@vitejs/plugin-react` 6.1.1,
`laravel-vite-plugin` (latest at execution; record the exact version in the ledger),
`@toolmark/core`, `@toolmark/react`, `@toolmark/inertia` `workspace:*`; dev `@playwright/test`,
`@toolmark/testing` `workspace:*`.

**Behaviour:**
- Pages: challenge list (server-declared `challenges.archive` destructive tool via the `toolmark` prop), challenge create (react-hook-form + `useFormTool`), a three-step wizard, an Inertia `<Form>` page (`inertiaFormComponentAdapter`).
- `navigationTool` over Wayfinder route functions; `inertiaPages`.
- The §12.5 Laravel reference code copied in under `app/Toolmark/` (`PageCallTool`, `PageDescribeTool`, `BrowserBridge`, confirmed handler, props builder) with a scripted "agent" controller (no LLM) that drives protocol v1 over a private channel on **Laravel Reverb** (`laravel/reverb` v1.12.0, started with `php artisan reverb:start` by the Playwright `webServer` config), proving the security MUSTs end to end.
- PHPUnit tests cover: result from another user rejected; unknown/duplicate id rejected; late result rejected.
- The confirmed handler follows spec §12.3: on a `confirmed` message it appends the outcome to the conversation as a tool-result message and starts **one** follow-up agent turn limited to acknowledging it; that turn is given no page tools (`page_call`/`page_describe` withheld), so it cannot start new actions.

**Tests (write first):** PHPUnit `BrowserBridgeTest` (`rejects_result_from_other_user`, `rejects_unknown_or_duplicate_id`, `rejects_after_deadline`, `confirmed_triggers_single_followup_without_tools` — a `confirmed` message → exactly one tool-result message appended and one follow-up turn dispatched whose tool list contains neither `page_call` nor `page_describe`); Playwright `e2e/app.spec.ts` (`fill_create_form_via_bridge`, `wizard_one_call`, `archive_requires_confirmation`, `navigation_then_new_page_tools`).

**Task gate:** `cd examples/inertia-laravel && composer install && php artisan test && pnpm exec playwright test`

---

### Task 6: Example — Next.js 16 App Router   (Lane E, risk: normal)

**Files:** Create `examples/nextjs/**` (App Router app, `next` 16.3.6) except `package.json` (Task
0), `e2e/app.spec.ts`, `playwright.config.ts`.

**Behaviour:** `ToolmarkProvider` in a `"use client"` providers component; a server-rendered page
with a client form using `useFormTool`; proves SSR no-op (no hydration warnings, no registry on
the server) and client registration after hydration; in-page agent via `createInPageChannel`.

**Tests (write first):** `ssr_renders_without_registry_errors` (checks server log + no hydration
warning in console) · `client_tools_after_hydration` · `fill_via_in_page_agent`.

**Task gate:** `pnpm -F @toolmark-examples/nextjs build && pnpm -F @toolmark-examples/nextjs exec playwright test`

---

### Task 7: Docs site, API reference, guides, CI   (Lane F, risk: normal)

**Files:** Create `docs/.vitepress/config.ts`, `docs/index.md`, `docs/guides/tours.md`,
`docs/guides/lint.md`, `docs/guides/nextjs.md`, `docs/guides/react.md`, `typedoc.json`; Modify
`.github/workflows/ci.yml`; Create `.changeset/m4-tours-tooling.md`.

**Behaviour:**
- VitePress site with sections: Getting started, Concepts (registry, scopes, callers, policy, confirmation modes, results), Guides (all guide files from M1–M4), Protocol v1, Laravel reference, API (generated).
- `docs/guides/react.md` (the React guide spec §21 requires): `ToolmarkProvider`, `ToolScope`, `useTool`, `useFormTool` + `rhfAdapter`, `useWizardTool`, `useConfirmQueue`/`usePendingConfirmations`, `useAgentActivity`, `useToolAnchor`, `useTour`, StrictMode behaviour, each with a runnable snippet.
- `typedoc.json`: entry points = every package's public entry; plugins `typedoc-plugin-markdown` + `typedoc-vitepress-theme`; output `docs/api`; `treatWarningsAsErrors: true` and `validation.notDocumented: true` (every public export documented — M5 gate).
- CI adds jobs: `example-laravel` (PHP 8.4 via `shivammathur/setup-php@v2`, composer, `php artisan test`, Playwright), `example-nextjs`, `docs` (`pnpm docs:build`).

**Tests:** `pnpm docs:build` succeeds with zero TypeDoc warnings.

**Task gate:** `pnpm docs:build`.

---

### Task 8: Cross-cutting e2e in `examples/react-vite`, tarball hand-off   (Lane F, risk: normal)

**Files:** Create `examples/react-vite/src/tour-page.tsx`, `src/routes.tsx`,
`e2e/tour.spec.ts`, `e2e/multi-client.spec.ts`, `e2e/navigation.spec.ts`,
`e2e/support/relay-server.ts`; Modify `examples/react-vite/src/app.tsx`,
`examples/react-vite/playwright.config.ts`, `docs/release/next-tarballs.md` (append the M4 entry).

**Behaviour:**
- Tour page: the challenge form plus an authored three-step tour runnable in `show`, `guide` and `do` modes with `mountTourOverlay` and an inline `confirm` handler (`createConfirmQueue`).
- Two client-side routes (`routes.tsx`), each rendering its own `<ToolScope>` with different tools, so a route change disposes one scope and registers another.
- `relay-server.ts`: a Node `ws` relay started in `globalSetup`; it forwards every frame to every other socket. Pages opt into it with `?relay=<port>` (`bridge(websocketTransport(…))`) instead of the in-page agent; the test drives the agent side over its own socket.
- **Tarball hand-off (last step of the milestone):** `pnpm changeset version` (pre mode `next`, versions only — no publish), commit, `pnpm -r --filter "./packages/*" pack --pack-destination "$PWD/dist-tarballs"` (now all eight packages), and append the M4 entry to `docs/release/next-tarballs.md`.

**Tests (write first):**
- `tour.spec.ts`: `tour_show_mode` (overlay steps through anchors on Next; nothing filled) · `tour_guide_mode_waits_for_valid_input` (invalid typed value keeps the step with the issue shown; valid value advances) · `tour_do_mode_fills_and_confirms` (fills with highlighted changes; the consequential submit step shows the inline confirm; approving submits).
- `multi-client.spec.ts`: `two_tabs_only_addressed_client_executes` (two pages on one relay; a `call` addressed to tab B's `clientId` → only B's form changes and exactly one `result` arrives).
- `navigation.spec.ts`: `navigation_mid_conversation_new_manifest` (agent calls a route-A tool, the page navigates to route B → a new `manifest` with route B's tools arrives; a call to the old tool with the old `rev` → `refused` `stale` or `unknown_tool` with the current `rev`).

**Task gate:** `pnpm -F @toolmark-examples/react-vite exec playwright test` then the lane gate `pnpm lint && pnpm typecheck && pnpm test && pnpm build`, then the M4 tarballs exist and are listed in `docs/release/next-tarballs.md`.

---

## Self-review

- **Spec coverage:** §11.5 (modes, authored/planned, overlay, headless, RTL, a11y, reduced motion) →
  T1/T2; §4 lint + judge → T3/T4; §15 i18n (tour strings) → T2; §16 examples → T5/T6; docs + API
  reference → T7; D30 → T1/T2; §18 E2E (tours in all three modes, multi-tab targeting, navigation
  mid-conversation) → T8.
- **Names:** `startTour`, `TourStep`, `useTour` match the overview registry; `mountTourOverlay`,
  `lint`, `Judge`, `Finding`, `typesafeJudge` added.
- **Ownership:** new `package.json` files are Lane A's (Task 0) except `examples/inertia-laravel/`,
  which Lane D owns whole (plus its lockfile entries at lane end); `ci.yml` and the react-vite example
  sources are Lane F's.
- **Placeholders:** the TypeSafe SDK call shapes are read from live docs at execution by explicit
  instruction (the spec forbids coding against remembered APIs); everything else is fixed here.
