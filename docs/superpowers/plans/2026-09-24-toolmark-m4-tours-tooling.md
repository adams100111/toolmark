# Toolmark M4 — Tours and Tooling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `sdd-lanes` to implement this plan lane by lane.
> Plan-lite format. Requires M1–M3 merged.

**Goal:** Guided tours (show / guide / do; authored and agent-planned; styled overlay and headless),
the `toolmark lint` CLI with the optional TypeSafe judge, the documentation site with generated API
reference, the two remaining runnable examples (Inertia + Laravel, Next.js), and the in-repo
same-tools and tour evidence (spec §1 SC2, §18, §20).

**Architecture:** `@toolmark/tour` is a framework-free engine over the registry's anchors, state and
interaction events, plus a vanilla-DOM overlay and a React binding. `@toolmark/lint` inspects
**manifests** (from a file or collected from running pages through the testing hook), never app
source, so it works for any stack. The TypeSafe judge is a Node-only lint plugin that runs only in
dev/CI.

**Tech Stack:** as overview, plus `vitepress` 1.6.4, `typedoc` 0.28.20,
`typedoc-plugin-markdown` 4.13.1, `typedoc-vitepress-theme` 1.1.4, `@typesafe-ai/sdk` 0.6.0,
`ajv` 8.20.0, `ajv-formats` 3.0.1, `axe-core` 4.13.0, `@axe-core/playwright` 4.13.0, `next` 16.3.6;
Laravel example: `laravel/laravel` v13.10.1 (php `^8.3`, framework `^13.17`), `inertiajs/inertia-laravel`
v3.3.4, `laravel/wayfinder` v0.1.21, `laravel/reverb` v1.12.0, PHP 8.4, Composer 2,
`laravel-vite-plugin` 3.2.0, `@laravel/vite-plugin-wayfinder` 0.1.10.

**Spec:** §4 (tour, lint, judge), §11.5, §12.2–§12.5, §13, §15, §16 (examples), §18, §20, §21, D30.

## Milestone exit check (in-repo; spec §20, overview)

M4 is done when all of these pass on a clean checkout (no other repository involved):

1. `examples/react-vite` `e2e/tour.spec.ts` green on **Chromium, Firefox and WebKit**:
   `tour_show_mode`, `tour_guide_mode_waits_for_valid_input`, `tour_do_mode_fills_and_confirms`,
   `tour_planned_via_agent_planner`, `tour_overlay_axe_clean` (every mode, zero serious/critical
   axe violations) (Task 8).
2. `examples/react-vite` `e2e/same-tools.spec.ts` › `same_declaration_all_surfaces` green (bridge,
   WebMCP, MCP, a `do` tour step, Playwright fixture; one registration; Chromium) (Task 8).
3. `examples/inertia-laravel`: `scripts/php.sh php artisan test` and its Playwright suite green, including
   `tour_authored_on_inertia_page` (Task 5).
4. `examples/nextjs` Playwright suite green (Task 6).
5. `pnpm docs:build` passes (TypeDoc non-strict per R5, VitePress build) (Task 7).
6. `toolmark lint` exits 0 on every example's manifests (`lint_clean` in each example suite).
7. The full react-vite suite (M1–M3 specs and `round-budget.spec.ts` included) and CI are green.
8. `node scripts/tarball-smoke.mjs dist-tarballs` passes on the M4 tarballs (all eight packages,
   `toolmark` and `toolmark-mcp` bins, `@toolmark/tour/styles.css` present) (Task 8).

## Global constraints (M4 additions)

- Tour CSS custom properties (exact names, defaults meet WCAG 2.2 AA: text ≥ 4.5:1 on `bg`, focus
  ring ≥ 3:1): `--toolmark-tour-accent` (`#1d4ed8`), `--toolmark-tour-bg` (`#ffffff`),
  `--toolmark-tour-fg` (`#111827`), `--toolmark-tour-radius` (`8px`), `--toolmark-tour-shadow`
  (`0 8px 24px rgb(0 0 0 / .2)`), `--toolmark-tour-z` (`2147483000`), `--toolmark-tour-backdrop`
  (`rgb(0 0 0 / .45)`). Every selector in `styles.css` starts with `.toolmark-tour`;
  `@toolmark/tour/styles.css` is the only file with side effects (`"sideEffects": ["**/*.css"]`).
- Default tour strings (English): `next: "Next"`, `back: "Back"`, `close: "Close tour"`,
  `done: "Done"`, `confirming: "Waiting for your confirmation"`,
  `stepOf: (i, n) => \`Step ${i} of ${n}\``; every string is overridable.
- Lint exit codes: `0` no errors, `1` errors found, `2` usage/runtime failure. Output formats
  `pretty` (default) and `json` (exact shapes in Task 3).
- Lint rule ids (exact; definitions in Task 3): `name-format`, `description-missing`,
  `description-short` (< 20 chars), `param-description-missing`, `schema-invalid`,
  `llm-name-collision`, `tool-budget` (default 40 per page), `consequential-hint-missing`,
  `options-without-hint`.
- TypeSafe judge: key from option `apiKey` or env `TYPESAFE_API_KEY`; missing key → judge disabled
  with one stderr warning, lint still runs; finding ids `judge/description-quality`, `judge/overlap`,
  `judge/overlap-truncated`, `judge/consequential-hint`, `judge/unavailable`. All judge findings are
  `warn` by default (a probabilistic model never fails CI); `strictHints: true` makes
  `judge/consequential-hint` an `error`.
- Tour `do`-mode highlight: `600` ms per changed field; none under `prefers-reduced-motion: reduce`.
- Node-project tests build registries with `createTestToolmark` (`@toolmark/testing/vitest`) or core's
  `createTestRegistry` (M1 constraints). `createTestToolmark` keeps production modes (`tour` is
  inline) with a default-approve inline handler.
- Source resolution: the condition is `@toolmark/source` (overview). Vitest/Vite configs set
  `resolve.conditions` and `ssr.resolve.conditions` to `['@toolmark/source', ...defaults]`.
  Anything that spawns built output (lint CLI, `toolmark-mcp`, Next.js, the tarball smoke) builds
  the needed packages first (`pnpm --filter "<pkg>..." build`).
- Example package names: `@toolmark-examples/react-vite` (M1), `@toolmark-examples/nextjs`,
  `@toolmark-examples/inertia-laravel` (all private). Root `build`/`typecheck`/`lint` cover
  `packages/*` only (R7); each example runs its own scripts in its own CI job.
- Fixed ports: react-vite `5173`, relay `0` (dynamic, via env `TOOLMARK_RELAY_PORT`), Next.js dev
  `3100` / start `3101`, Laravel `8010`, Reverb `8081`; every Playwright `webServer` uses
  `reuseExistingServer: !process.env.CI`.
- Browsers: react-vite tour/navigation/multi-client specs run on Chromium, Firefox, WebKit;
  WebMCP, MCP and same-tools specs, Laravel and Next.js on Chromium only (overview CI matrix).
- Every new public export gets its TSDoc comment in the task that adds it (R5).
- New packages start at `"version": "0.0.0"` with `license: "MIT"`, `description`, `repository`
  (`git+https://github.com/adams100111/toolmark.git`, `directory: "packages/<name>"`), and export
  `"./package.json"`.
- Nothing is published to npm. The milestone ends with the `-next` tarballs packed, smoke-tested and
  logged (Task 8). No external consumer is involved.

## Rulings made while planning

- **Lint reads manifests, not source.** Static analysis of TSX/Blade cannot see runtime tools
  (DOM-scanned, server-declared, wizards). Inputs: `--manifest <file.json>` (repeatable) and
  `--url <url>` (repeatable; Playwright loads the page and reads `__toolmark_test__`).
- **Tour overlay is vanilla DOM**, so non-React apps (Blade + `scanDom`) get tours too; React adds
  `useTour` for headless rendering.
- **Laravel example lives in `examples/inertia-laravel`** as a full Laravel 13 app that also
  exercises the §12.5 reference code (the same files the guide shows, checked byte-for-byte) in CI;
  it is not published.

## Rulings made while fixing (pass 2)

- **`confirming` is engine-driven:** the engine sets `status: 'confirming'` for the whole in-flight
  `do` call of any tool whose `describe(tool).hints` has `consequential` or `destructive` (M1's
  `confirm` event carries no caller, so event matching would be ambiguous).
- **Planned tours in react-vite use an app-level side channel** on the e2e relay
  (`toolmark-example/plan` messages), not protocol v1 — protocol v1 has no plan message and §11.5
  makes the planner app-supplied.
- **The tour panel lives on the example's main page** over the same `ChallengeForm` declaration, so
  `same-tools.spec.ts` exercises one registration (replaces the separate `tour-page.tsx`).
- **TypeDoc config is `typedoc.config.mjs`,** deriving `entryPoints` from every package's `exports`
  (`@toolmark/source` targets), so no subpath can be missed. Through M4: `notDocumented: false`,
  `notExported: false`; `TYPEDOC_STRICT=1` (script `docs:api:strict`) turns both on for M5.
- **Lane F may make TSDoc-comment-only edits** in `packages/*/src/**` in wave 2 to clear TypeDoc
  warnings (no code changes), after lanes B–E merged.
- **Docs deploy workflow is created in M4** and guarded by `if: ${{ !github.event.repository.private }}`,
  so it stays inert until the owner makes the repo public (§21/§22); M5 only verifies it.
- **`@toolmark/judge-typesafe` is Node-only:** its `"."` export has a `node` condition and no
  `import`/`default`, so browser bundlers fail fast instead of shipping the API client.
- **Laravel dev server runs with `PHP_CLI_SERVER_WORKERS=4`:** the scripted agent's request blocks
  on `BrowserBridge` while the page POSTs its result; a single-worker `artisan serve` deadlocks.
- **Next.js e2e runs against `next dev` (port 3100, test hook installed) and `next start` (3101,
  production: hook absent)** — keeps §11.6 "hook only outside production builds".
- **"Lint clean" is proven per example** by a `lint_clean` spec that spawns the built CLI against the
  running app (Laravel with `--storage-state` from a logged-in context).
- **Wayfinder route files are generated at build** by `@laravel/vite-plugin-wayfinder`, not
  committed (git-ignored).
- **Guide mode needs `onUserInteraction`:** `inertiaAdapter` (Inertia `useForm`) emits none, so guide
  mode there is documented as unsupported; no core flag is added.
- **Not applied:** round-budget tests in the Laravel example (m4 audit M16) — pass-1 ruling keeps the
  round budget in `examples/react-vite` only.

## Rulings made while fixing (pass 3, cross-plan consistency)

- `round-budget.spec.ts` runs on Chromium only (like `reach`, `same-tools`, `webmcp`, `mcp`,
  `lint-clean`), so `ROUND_BUDGET_REPORT` holds one entry per task; the remaining react-vite specs
  (incl. M2's `wizard`/`dom`) run on all three browsers.
- New CI jobs use M1's job template (Node default `24.x`); the modified `e2e` job keeps M1's
  round-budget artifact and no-test-hook steps.
- Every catalog version M4 needs is already in the M1 catalog; Task 0 only re-verifies and bumps.

## Rulings made while fixing (pass 4, pre-execution verification)

- Ruling (P4): the Laravel example's local gates run PHP and Composer through Docker when `php` is
  not on PATH — `examples/inertia-laravel/scripts/php.sh` uses host `php`/`composer` if present,
  else `docker run --rm -v "$PWD":/app -w /app …` on a small image built from
  `examples/inertia-laravel/docker/Dockerfile` (`FROM php:8.4-cli` + `pdo_sqlite`, `mbstring`,
  `pcntl`, Composer copied from `composer:2`), publishing the `artisan serve`/`reverb:start` ports on
  host `127.0.0.1` for the Playwright `webServer`; CI keeps `shivammathur/setup-php` (host path).
  Both files are Lane D's. No owner action (no O8) — the execution machine has Docker 29.5.2 and no
  host PHP/Composer, and host installs need the owner — cost if wrong: Docker-mode e2e may need the
  single-container fallback (T5), ledgered by the lane.
- Ruling (P4): every new package (`tour`, `lint`, `judge-typesafe`) gets a `tsconfig.test.json` and
  the `build`/`typecheck`/`lint` scripts from Lane A in Task 0, and `tour`'s `tsconfig.json` sets
  `"jsx": "react-jsx"` — M1's ESLint uses a `parserOptions.project` glob over
  `packages/*/tsconfig.test.json`, and wave-1 lanes may not edit Lane A's config files — cost if
  wrong: none.

## Review focus

1. **Tour step whose anchor is missing** (element not rendered) → the step is skipped with an event,
   the tour continues (Task 1 `missing_anchor_skips_step`).
2. **Guide mode with invalid user input** → the tour stays on the step and shows the field's issue
   (Task 1 `guide_waits_until_valid`).
3. **Overlay modality** → modal only in `do`; `show`/`guide` leave the anchor operable; the trap and
   backdrop release while an inline confirmation is pending (Task 2
   `guide_mode_not_modal_anchor_focusable`, `confirming_releases_trap_and_backdrop`).
4. **Overlay in RTL and with reduced motion** → mirrored placement and arrow keys, no animation
   (Task 2 `rtl_placement_mirrored`, `rtl_arrow_keys_mirrored`, `reduced_motion_no_transition`).
5. **Keyboard-only use in `do` mode** → focus moves into the dialog, Tab cycles, Esc closes, focus
   returns on close (Task 2 `keyboard_focus_management`); axe clean (`overlay_axe_clean`).
6. **Lint against a page with no test hook** → exit `2` with the M1 hook message (Task 3
   `url_without_hook_exit_2`).
7. **Judge without a key never constructs the SDK client** (the constructor throws) (Task 4
   `no_key_never_constructs_client`).
8. **Laravel security MUSTs end to end** (other user's result, unknown/duplicate id, late result,
   testing routes absent outside testing) (Task 5 PHPUnit).

## File structure

```
packages/tour/  package.json tsconfig.json tsconfig.test.json tsdown.config.ts vitest.config.ts
  src/index.ts engine.ts planner.ts param-schema.ts types.ts
  src/overlay/{index,position,focus,render}.ts  src/styles.css
  src/react/index.ts   (useTour)
  test/{engine,planner,overlay,styles}.test.ts  test/react.test.tsx
packages/lint/  package.json tsconfig.json tsconfig.test.json tsdown.config.ts vitest.config.ts
  src/{index,cli,run,collect,format,judge,manifest-file}.ts  src/rules/*.ts  src/manifest.schema.json
  test/{rules,cli,collect,manifest-file}.test.ts  test/fixtures/**
packages/judge-typesafe/  package.json tsconfig.json tsconfig.test.json tsdown.config.ts vitest.config.ts
  src/index.ts  test/judge.test.ts  test/judge.live.test.ts
docs/.vitepress/config.ts  docs/index.md  docs/getting-started.md
docs/concepts/{registry,scopes,callers,policy,confirmation,results}.md
docs/guides/{tours,lint,nextjs,react}.md  docs/reference/codes.md  docs/api/ (generated, ignored)
docs/guides/laravel-reference.md   (modify: `// file:` markers, synced from the example)
docs/release/{next-tarballs,round-budget}.md   (append / re-render)
typedoc.config.mjs  tsconfig.docs.json
scripts/check-laravel-reference.mjs  scripts/check-laravel-reference.test.mjs
scripts/tarball-smoke.mjs   (modify only if it misses non-JS exports, Task 8)
vitest.config.ts   (modify: append tour, lint, judge-typesafe projects)
examples/inertia-laravel/  (Laravel 13 app incl. package.json, composer.lock)  e2e/*.spec.ts
  docker/Dockerfile  scripts/php.sh   (PHP/Composer through Docker when `php` is not on PATH)
examples/nextjs/  (Next 16 App Router app)  e2e/*.spec.ts
examples/react-vite/src/{tour-panel.tsx,routes.tsx,relay-planner.ts}
examples/react-vite/e2e/{tour,same-tools,multi-client,navigation,lint-clean}.spec.ts  e2e/support/relay-server.ts
.changeset/m4-tours-tooling.md
.github/workflows/ci.yml   (modify)  .github/workflows/docs-deploy.yml   (new)
```

## Lanes

| Wave | Lane | Tasks | Owns files | Consumes |
| --- | --- | --- | --- | --- |
| 0 | A (normal) | 0 | new `package.json` files except `examples/inertia-laravel/package.json`; `examples/react-vite/package.json` (adds deps); root `package.json`; `pnpm-lock.yaml` (wave 0); `pnpm-workspace.yaml`; root `vitest.config.ts`; `.gitignore`; `eslint.config.js` (ignores only); each new package's `tsconfig.json`/`tsconfig.test.json`/`tsdown.config.ts`/`vitest.config.ts`/stub `src/index.ts` | M3 |
| 1 | B (normal) | 1–2 | `packages/tour/**` except `package.json` and Lane A's config files | A |
| 1 | C (normal) | 3–4 | `packages/lint/**`, `packages/judge-typesafe/**` except `package.json` and Lane A's config files | A |
| 1 | D (high, security) | 5 | `examples/inertia-laravel/**` (whole directory incl. `package.json`, `composer.lock`), plus that example's entries in `pnpm-lock.yaml` at the end of its lane | A |
| 1 | E (normal) | 6 | `examples/nextjs/**` except `package.json` | A |
| 2 | F (normal) | 7–8 | `docs/**` (except `docs/superpowers`), `typedoc.config.mjs`, `tsconfig.docs.json`, `.github/workflows/ci.yml`, `.github/workflows/docs-deploy.yml`, `scripts/check-laravel-reference*.mjs`, `scripts/tarball-smoke.mjs` (Task 8 extension only), `.changeset/m4-tours-tooling.md`, `examples/react-vite/**` except `package.json` (incl. M1–M3's `src/app.tsx`, `src/main.tsx`, `playwright.config.ts`, `e2e/global-setup.ts`); TSDoc-comment-only edits in `packages/*/src/**`; at the hand-off step: every `packages/*/package.json` `version`, `packages/*/CHANGELOG.md`, `.changeset/pre.json` | B–E |

Shared-file rules:
- `pnpm-lock.yaml` is Lane A's in wave 0. In wave 1 only Lane D may touch it, and only to add the
  `examples/inertia-laravel` dependencies at the end of its lane; the controller merges any lockfile
  conflict by re-running `pnpm install`, never by hand-editing.
- Earlier-milestone files modified here and their M4 owner: `examples/react-vite/package.json` (A),
  root `package.json`/`vitest.config.ts`/`pnpm-workspace.yaml`/`.gitignore`/`eslint.config.js` (A),
  `docs/guides/laravel-reference.md`, `docs/release/*.md`, M2/M3 guides (link to `codes.md`),
  `.github/workflows/ci.yml`, `scripts/tarball-smoke.mjs`, react-vite sources and configs (F).

---

### Task 0: Package skeletons and dependencies   (Lane A, risk: normal)

**Files:** Create for each of `tour`, `lint`, `judge-typesafe`: `packages/<p>/package.json`,
`tsconfig.json`, `tsconfig.test.json`, `tsdown.config.ts`, `vitest.config.ts`, stub `src/index.ts` (`export {}`); create
`examples/nextjs/package.json`; Modify `pnpm-workspace.yaml` (catalog), root `package.json`
(scripts, devDeps), root `vitest.config.ts`, `examples/react-vite/package.json`, `.gitignore`,
`eslint.config.js` (append only ignores missing from M1's list), `pnpm-lock.yaml`.
`examples/inertia-laravel/` is **not** created here — Lane D owns that whole directory.

**Exact values:**
- Catalog (`pnpm-workspace.yaml`): M1 seeded it from the overview table, so `vitepress` 1.6.4,
  `typedoc` 0.28.20, `typedoc-plugin-markdown` 4.13.1, `typedoc-vitepress-theme` 1.1.4,
  `@typesafe-ai/sdk` 0.6.0, `axe-core` 4.13.0, `@axe-core/playwright` 4.13.0, `next` 16.3.6,
  `laravel-vite-plugin` 3.2.0, `@laravel/vite-plugin-wayfinder` 0.1.10, `ws` 8.21.3 and `@types/ws`
  8.18.1 are already present. Re-verify each with `npm view <pkg> version`; a bump edits the catalog
  entry and the ledger; add an entry only if one is genuinely missing.
- Root devDeps: `vitepress`, `typedoc`, `typedoc-plugin-markdown`, `typedoc-vitepress-theme`
  (catalog). Root scripts: `"docs:api": "typedoc --options typedoc.config.mjs"`,
  `"docs:api:strict": "TYPEDOC_STRICT=1 typedoc --options typedoc.config.mjs"`,
  `"docs:dev": "pnpm docs:api && vitepress dev docs"`,
  `"docs:build": "pnpm docs:api && vitepress build docs"`,
  `"docs:preview": "vitepress preview docs"`. (VitePress bundles its own vite 5; expected — do not
  "fix" it.)
- `@toolmark/tour`: `version` `0.0.0`; exports
  `"."` `{ "@toolmark/source": "./src/index.ts", "types": "./dist/index.d.ts", "import": "./dist/index.js" }`,
  `"./overlay"` (`src/overlay/index.ts` → `dist/overlay.{js,d.ts}`),
  `"./react"` (`src/react/index.ts` → `dist/react.{js,d.ts}`),
  `"./styles.css": "./dist/styles.css"` (no source condition), `"./package.json"`;
  `"sideEffects": ["**/*.css"]`; `files: ["dist","src"]`; dep `@toolmark/core` `workspace:*`; peer
  `react >=18.3.0 <20` (optional via `peerDependenciesMeta`); dev: `react`, `react-dom`,
  `@types/react`, `@types/react-dom`, `@testing-library/react`, `@testing-library/dom`,
  `@vitest/browser`, `@vitest/browser-playwright`, `playwright` (explicit provider peer, as in M1/M2),
  `axe-core` (catalog). `tsdown.config.ts`: entry
  `{ index: 'src/index.ts', overlay: 'src/overlay/index.ts', react: 'src/react/index.ts' }`,
  `platform: 'neutral'`, `copy: [{ from: 'src/styles.css', to: 'dist' }]` (tsdown 0.23 `copy`,
  verified with ctx7), overview output settings. Lane A writes an empty `src/styles.css`.
  `tsconfig.json` sets `"jsx": "react-jsx"` (for `src/react/index.ts` and `test/react.test.tsx`).
- `@toolmark/lint`: `version` `0.0.0`; `bin: { "toolmark": "./dist/cli.js" }`; exports `"."`
  (`src/index.ts`: `lint`, `Judge`, `Finding`, `ManifestFile`), `"./manifest.schema.json":
  "./dist/manifest.schema.json"`, `"./package.json"`; deps `@toolmark/core` `workspace:*` (types
  only, `import type`), `ajv` 8.20.0, `ajv-formats` 3.0.1; peer `@playwright/test ^1.63.0` optional
  (only for `--url`); dev `@playwright/test`, `@types/node`. tsdown: entry `{ index, cli }`,
  `platform: 'node'`, `copy: [{ from: 'src/manifest.schema.json', to: 'dist' }]`; `src/cli.ts` starts
  with `#!/usr/bin/env node` (tsdown keeps it and sets mode 755). tsconfig `"types": ["node"]`.
- `@toolmark/judge-typesafe`: `version` `0.0.0`; exports `"."`
  `{ "@toolmark/source": "./src/index.ts", "types": "./dist/index.d.ts", "node": "./dist/index.js" }`,
  `"./package.json"`; dep `@typesafe-ai/sdk` 0.6.0; peer `@toolmark/lint` `workspace:^`; dev
  `@toolmark/lint` `workspace:*`, `@toolmark/core` `workspace:*`, `@types/node`. tsdown
  `platform: 'node'`. tsconfig `"types": ["node"]`.
- Every new package: `engines.node` `">=22.12"`, `type: module`, metadata per Global constraints;
  scripts `build` (`tsdown`), `typecheck` (`tsc -p tsconfig.test.json`), `lint` (`eslint .`);
  `tsconfig.test.json` extends `tsconfig.json` with `"noEmit": true`, includes `src`, `test` and
  `*.config.ts`, and sets `"types": ["node"]` (`tour` adds the Vitest 5 browser-mode types, as
  M1's react package). M1's ESLint `parserOptions.project` glob (`./packages/*/tsconfig.test.json`)
  picks these up; `eslint.config.js` is not edited for them.
- Vitest projects (append to root `test.projects`): `packages/tour/vitest.config.ts` → project
  `tour`, browser mode (provider `playwright()` from `@vitest/browser-playwright`, instances
  `[{ browser: 'chromium' }]`, headless), include `test/**/*.test.{ts,tsx}`;
  `packages/lint/vitest.config.ts` → project `lint`, `environment: 'node'`;
  `packages/judge-typesafe/vitest.config.ts` → project `judge-typesafe`, node, exclude
  `test/*.live.test.ts` unless `TYPESAFE_API_KEY` is set. All set `resolve.conditions` and
  `ssr.resolve.conditions` to `['@toolmark/source', ...defaults]`.
- `examples/nextjs/package.json`: private, name `@toolmark-examples/nextjs`; scripts
  `"dev": "next dev -p 3100"`, `"build": "next build"`, `"start": "next start -p 3101"`,
  `"typecheck": "tsc --noEmit"`; deps `next` 16.3.6, `react`/`react-dom` 19.3.0, `react-hook-form`
  7.88.0, `zod` 4.6.5, `@toolmark/core`, `@toolmark/react` `workspace:*`; dev `@playwright/test`,
  `@toolmark/testing`, `@toolmark/lint` `workspace:*`, `typescript` (catalog 6.0.3), `@types/react`,
  `@types/react-dom`, `@types/node`.
- `examples/react-vite/package.json` adds: dep `@toolmark/tour` `workspace:*`; dev
  `@toolmark/lint` `workspace:*`, `ws` 8.21.3, `@types/ws` 8.18.1, `@axe-core/playwright` 4.13.0
  (skip any already present from M3).
- `.gitignore` appends (if missing): `docs/api/`, `docs/.vitepress/cache/`, `docs/.vitepress/dist/`,
  `.next/`, `test-results/`, `playwright-report/`, `*.tsbuildinfo`.
- `eslint.config.js`: confirm the overview ignore list (`**/.next/**`, `docs/api/**`,
  `docs/.vitepress/{cache,dist}/**`, `examples/inertia-laravel/{vendor,public/build,storage}/**`,
  test outputs) is present; append what is missing, nothing else.

**Tests:** `pnpm install && pnpm build` succeeds; `pnpm -F @toolmark/tour build` emits
`dist/styles.css`; `head -1 packages/lint/dist/cli.js` is the shebang.

**Task gate:** `pnpm install && pnpm build && pnpm typecheck && pnpm lint`

---

### Task 1: Tour engine and planner contract   (Lane B, risk: normal)

**Files:** Create `packages/tour/src/types.ts`, `engine.ts`, `planner.ts`, `param-schema.ts`,
`src/index.ts`; Test `test/engine.test.ts`, `test/planner.test.ts`.

**Interfaces — Consumes (M1–M3):** `tm.anchor(tool, param?)`, `tm.state(tool)`,
`tm.events.on('interaction' | 'change', …)`, `tm.subscribe`, `tm.manifest({ caller: 'tour' })`,
`tm.describe(name, { caller: 'tour' })`, `tm.call(…, { caller: 'tour' })`. Wizard anchors and
interaction params use `<step>.<path>` (M3 T2).

**Interfaces — Produces:**
```ts
interface TourStep { tool: string; param?: string; title?: string; text: string; input?: unknown /* do mode */; waitFor?: 'input' | 'submit' }
type TourMode = 'show' | 'guide' | 'do'
interface Planner { plan(ctx: { goal: string; mode: TourMode; tools: ToolManifestSummary[]; describe(name: string): ToolManifest | undefined; signal: AbortSignal }): Promise<TourStep[]> }
interface TourState { status: 'idle' | 'running' | 'waiting' | 'confirming' | 'done' | 'stopped'; mode: TourMode; index: number; steps: TourStep[]; anchor: Element | null; highlight?: Element | null; message?: string }
type TourEvent =
  | { type: 'step_invalid' | 'anchor_missing' | 'step_skipped'; step: TourStep; reason: string }
  | { type: 'step_entered'; step: TourStep; index: number }
  | { type: 'done' }
interface Tour { readonly state: TourState; next(): Promise<void>; back(): void; stop(): void; subscribe(fn: (s: TourState) => void): () => void; on(fn: (e: TourEvent) => void): () => void }
function startTour(tm: Toolmark, o: { mode: TourMode; steps?: TourStep[]; goal?: string; planner?: Planner; reducedMotion?: boolean; signal?: AbortSignal }): Promise<Tour>
```

**Behaviour:**
- Exactly one of `steps` / (`goal` + `planner`) → else throws `TypeError`.
- Planner: called with `tools` = `tm.manifest({ caller: 'tour' }).tools` (summary) and `describe` =
  `tm.describe(name, { caller: 'tour' })`. A planner throw rejects `startTour` with that error. Zero
  valid steps → state `stopped`, `message` `"no valid steps"`.
- A planned step is valid when `describe(step.tool)` exists and `param` (if given) resolves by
  `paramSchema(inputSchema, param, toolName)`: walks dot segments through `properties` (numeric
  segments through `items`); for names ending `.fill` it starts at `properties.values` if present,
  else at `properties.steps` where the first segment is the step name. Invalid → dropped with
  `step_invalid` (`reason` `unknown_tool` | `unknown_param`). `paramSchema` stays internal.
- On entering a step: emit `step_entered`; resolve `tm.anchor(tool, param)`; `null` → skip with
  `anchor_missing`. Tools disappearing mid-tour (the current step's tool no longer describable after
  a `change`) → skip with `step_skipped` (`reason` `tool_removed`).
- `show`: waits for `next()`.
- `guide`: listens for `interaction` events on the step's tool/param (`waitFor` default `input`;
  `submit` waits for kind `submit`). Validation runs `400` ms after the last `input` event, or
  immediately when focus leaves the anchor (`focusout`): `tm.state(tool).issues` for that param →
  any → `status: 'waiting'`, `message` = first issue; none → advance. Guide mode requires an adapter
  with `onUserInteraction` (RHF, DOM, Inertia `<Form>`); `inertiaAdapter` supports show/do only
  (documented, Task 7).
- `do`: input is wrapped as `{ values: input }` only when `describe(tool).inputSchema.properties`
  has `values` and `input` is an object without a `values` key; otherwise passed unchanged (wizard
  `{ steps }` fills are never wrapped). `tm.call(tool, input ?? {}, { caller: 'tour', signal })`.
  For tools with `consequential`/`destructive` hints the state is `confirming` for the whole call
  (the app's inline confirm UI must be usable; Task 2). `invalid`/`refused`/`error`/`cancelled` →
  `stopped` with `message`; a `needs_confirmation` result (should not happen: `tour` is always
  inline) → `stopped` with `message` = its summary.
- `do` highlighting: after an `ok` fill, `highlight` is each changed field's anchor
  (`tm.anchor(tool, change.path)`, falling back to the step's anchor; wizard paths are
  `<step>.<path>`) in `changes` order for `600` ms each; then advance. Reduced motion (option
  `reducedMotion`, default `matchMedia('(prefers-reduced-motion: reduce)').matches`) → no highlight
  sequence, advance immediately.
- `back()` moves the index only; in `do` mode it never undoes (apps use `tm.undo`).
- After the last step: state `done`, event `done`. `stop()` (or `signal` abort) → `stopped`,
  unsubscribes everything.

**Tests (write first):** `authored_show_mode_advances` · `missing_anchor_skips_step` (review focus
1) · `guide_waits_until_valid` (review focus 2; fake timers: 400 ms debounce, `focusout` validates
at once) · `do_mode_calls_as_tour_and_wraps_fill_values` · `do_mode_wizard_fill_not_wrapped` ·
`do_mode_consequential_sets_confirming` · `do_mode_highlights_changes` (fake timers; two changed
fields → each anchor for 600 ms in order, then advance; `reducedMotion: true` → no highlight) ·
`do_mode_failure_stops_with_message` · `planner_steps_validated_and_invalid_dropped` ·
`planner_validates_nested_and_wizard_params` · `lifecycle_events_and_back_never_undoes` ·
`tool_removed_mid_tour_skips` · `exactly_one_source_required`.

**Task gate:** `pnpm -F @toolmark/tour exec vitest run test/engine.test.ts test/planner.test.ts`

---

### Task 2: Overlay UI, stylesheet and React binding   (Lane B, risk: normal)

**Files:** Create `packages/tour/src/overlay/index.ts`, `position.ts`, `focus.ts`, `render.ts`,
`src/styles.css` (replaces Lane A's empty file), `src/react/index.ts`; Test `test/overlay.test.ts`
(browser mode), `test/styles.test.ts`, `test/react.test.tsx`.

**Interfaces — Produces:**
```ts
function mountTourOverlay(tour: Tour, o?: { container?: HTMLElement; strings?: Partial<TourStrings> }): () => void
interface TourStrings { next: string; back: string; close: string; done: string; confirming: string; stepOf(i: number, n: number): string }
function useTour(tour: Tour | null): TourState | null
```

**Behaviour:**
- Renders a root `.toolmark-tour` with a spotlight (backdrop with a cut-out around the anchor's rect;
  `aria-hidden="true"`; the cut-out has `pointer-events: none` so the anchor stays clickable) and a
  dialog (`role="dialog"`, `aria-labelledby` → title, `aria-describedby` → step text, an
  `aria-live="polite"` region holding the step counter and `message`), positioned beside the anchor
  (preferred side: bottom, then top, end, start), repositioned via `ResizeObserver` + `scroll`.
- Works unstyled-but-functional without the stylesheet (inline `position` and `z-index` from the CSS
  variables). Docs require `import '@toolmark/tour/styles.css'` once (Next.js: `app/layout.tsx`).
- Modality by `state.mode`: `do` → `aria-modal="true"`, focus trapped (Tab/Shift+Tab cycle).
  `show`/`guide` → `aria-modal="false"`, no trap; on step entry focus moves to the anchor in
  `guide` and to the dialog in `show`; `F6` and `Alt+T` toggle focus between dialog and anchor.
- While `state.status === 'confirming'` the overlay releases any trap, hides the backdrop
  (`display: none`), shows `strings.confirming`, and restores both afterwards.
- Direction from the anchor's computed `direction`; the dialog gets `dir`; `rtl` mirrors start/end
  placement and arrow keys (← = next, → = back); LTR: ← back, → next (only while focus is in the
  dialog). Esc → `tour.stop()` only when focus is inside the dialog. On close focus returns to the
  previously focused element.
- `prefers-reduced-motion: reduce` → no transitions, `scrollIntoView({ behavior: 'auto' })`;
  otherwise `'smooth'`.
- `styles.css`: the Global-constraint variables and defaults; `@media (forced-colors: active)` rules
  using system colours (`Canvas`, `CanvasText`, `Highlight`); every selector under `.toolmark-tour`.
- `useTour` wraps `tour.subscribe` in `useSyncExternalStore` (server snapshot `null`) for headless UIs.

**Tests (write first):** `renders_dialog_near_anchor` · `repositions_on_resize` ·
`rtl_placement_mirrored` · `rtl_arrow_keys_mirrored` · `reduced_motion_no_transition` ·
`keyboard_focus_management` (do mode) · `guide_mode_not_modal_anchor_focusable` ·
`confirming_releases_trap_and_backdrop` · `overlay_axe_clean` (`axe-core` `axe.run(root)` → zero
serious/critical violations for show/guide/do, LTR and RTL, default and a dark variable set) ·
`works_without_stylesheet` · `strings_overridable` · `styles_scoped_to_root_class` (parses
`src/styles.css`; every selector starts with `.toolmark-tour`) · `use_tour_headless_state`.

**Task gate:** `pnpm -F @toolmark/tour exec vitest run && pnpm -F @toolmark/tour build`

---

### Task 3: `toolmark lint` CLI and rules   (Lane C, risk: normal)

**Files:** Create `packages/lint/src/cli.ts`, `run.ts`, `collect.ts`, `format.ts`, `judge.ts`,
`manifest-file.ts`, `manifest.schema.json`, `src/rules/*.ts` (one file per rule id),
`src/index.ts`; Test `test/rules.test.ts`, `test/cli.test.ts`, `test/collect.test.ts`,
`test/manifest-file.test.ts`, `test/fixtures/**` (manifest JSON files; a static HTML page with an
inline fake `__toolmark_test__`, and one without).

**Interfaces — Produces:**
```ts
interface Finding { rule: string; severity: 'error' | 'warn'; tool?: string; page?: string; message: string; score?: number }
interface Judge { name: string; judge(input: { page: string; tools: ToolManifest[] }): Promise<Finding[]> }
interface ManifestFile { page: string; tools: ToolManifest[] }
function lint(o: { manifests: ManifestFile[]; judges?: Judge[]; budget?: number }): Promise<Finding[]>
// CLI: toolmark lint [--manifest file]... [--url url]... [--storage-state file] [--judge spec]... [--budget n] [--format pretty|json]
```

**Behaviour — rules** (severity; one finding per offending tool/param):
- `name-format` (error): name fails `^[A-Za-z0-9_.-]{1,128}$`, has an empty segment (`..`, leading or
  trailing `.`), or `llmName` fails `^[a-zA-Z0-9_-]{1,64}$`.
- `description-missing` (warn): `description` empty or whitespace.
- `description-short` (warn): trimmed `description` shorter than 20 chars (not also reported when
  missing).
- `param-description-missing` (warn): a leaf property (no `properties`, or `type` ≠ `object`) of
  `inputSchema` without `description`; for `.fill` tools the walk starts at `properties.values` /
  `properties.steps.properties.<step>`; `message` names the dot path.
- `schema-invalid` (error): `new Ajv2020({ strict: false, allErrors: true, validateFormats: true })`
  + `addFormats` fails to compile `inputSchema`, or its root `type` is not `object`.
- `llm-name-collision` (error): two tools on the same page share an `llmName`.
- `tool-budget` (warn): tools on a page > budget (`--budget`, default 40).
- `consequential-hint-missing` (error): the regex
  `/\b(delete|remove|archive|destroy|drop|cancel|refund|pay|charge|submit|send|publish|approve|reject)\b/i`
  matches a name segment (split on `.`, `_`, `-`) or the first sentence of `description`, and the
  tool has neither `consequential` nor `destructive`; tools with `readOnly: true` are exempt.
- `options-without-hint` (warn): a `<form>.options` tool exists on the page and (a) a field in its
  `field` enum lacks the description suffix `(use <form>.options to find valid values)` in
  `<form>.fill`'s schema (M2 T2), or (b) the `.options` tool lacks `readOnly: true`.

**Behaviour — inputs and output:**
- `--manifest` accepts per file: `{ "page": string, "tools": ToolManifest[] }`, an array of those,
  or the test-hook shape `{ "rev": number, "tools": ToolManifest[] }` (page = file basename).
  Anything else → exit 2 `invalid manifest file: <path>`. The shape is
  `@toolmark/lint/manifest.schema.json`.
- `--url`: dynamic-imports `@playwright/test` (missing → exit 2
  `--url requires @playwright/test`); Chromium in a fresh context (with `--storage-state <file>` if
  given), waits for `__toolmark_test__` (5000 ms), collects
  `manifest({ detail: 'full', caller: 'inapp' })`; page = the URL; missing hook → exit 2 with the
  M1 hook error message.
- `--judge <spec>`: a spec starting with `.` or `/` resolves against `process.cwd()`; a bare
  specifier resolves with `createRequire(path.join(process.cwd(), 'package.json')).resolve(spec)`,
  then `import(pathToFileURL(resolved))`. Not found → exit 2 `judge module not found: <spec>`. The
  default export: a function is called with no arguments to get the `Judge`; otherwise it is the
  `Judge`. A judge throw → one warn finding `judge-failed` (`message` has the judge name and error).
  Docs state that `--judge` executes the named module.
- Argument parsing with `node:util` `parseArgs` (no dependency).
- `pretty`: one line per finding `<severity> <rule> <page> <tool>: <message>` grouped by page, then
  `<n> error(s), <m> warning(s)`. `json`: `{ "findings": Finding[], "summary": { "errors": n, "warnings": m } }`.

**Tests (write first):** per rule id `<rule>_positive` and `<rule>_negative` ·
`options_without_hint_missing_suffix` · `options_without_hint_not_readonly` · `manifest_file_shapes`
· `cli_exit_codes` · `cli_json_format` · `cli_pretty_format` · `url_collects_manifest` ·
`url_without_hook_exit_2` (review focus 6) · `storage_state_passed_to_context` ·
`judge_resolved_from_cwd` · `judge_errors_become_warnings` · `judge_module_factory_or_object` ·
`bin_has_shebang` (on the build).

**Task gate:** `pnpm exec playwright install chromium && pnpm -F @toolmark/lint build && pnpm -F @toolmark/lint exec vitest run`

---

### Task 4: TypeSafe judge   (Lane C, risk: normal)

**Files:** Create `packages/judge-typesafe/src/index.ts`; Test `test/judge.test.ts`,
`test/judge.live.test.ts`.

**Interfaces — Produces:**
```ts
function typesafeJudge(o?: { apiKey?: string; qualityThreshold?: number; hintThreshold?: number; overlapThreshold?: number; maxPairs?: number; strictHints?: boolean; model?: string; fetch?: (input: string, init?: RequestInit) => Promise<Response> }): Judge
export default typesafeJudge   // also exported by name
```
Defaults: `qualityThreshold` `1.5`, `hintThreshold` `0.85`, `overlapThreshold` `0.8`, `maxPairs`
`200`, `strictHints` `false`.

**Behaviour** (SDK 0.6.0 verified against `dist/index.d.mts`: `TypeSafeClient`, `score`, `noul`,
`APIError`, `APIConnectionError`, `APITimeoutError`; re-check at execution, ledger divergence):
- Key: `o.apiKey ?? process.env.TYPESAFE_API_KEY`; empty/whitespace → print
  `toolmark lint: TYPESAFE_API_KEY not set; judge-typesafe disabled` to stderr once, return `[]`,
  and **never construct** `TypeSafeClient` (its constructor throws without a key). Client:
  `new TypeSafeClient({ apiKey, timeout: 60000, logLevel: 'warn', fetch: o.fetch })`.
- `state` = `{ page, tools: [{ name, title?, description, params: [{ path, description? }] }] }` —
  names, titles, descriptions and schema property paths/descriptions only; never values, `default`,
  `enum`, `examples` or `const`.
- Questions (keys `q:<i>`, `h:<i>`, `o:<i>:<j>`; instructions are JSON objects referencing tools by
  name), sent with `client.systemOne({ state, questions, model? })`, at most 100 questions per
  request (more → several requests, same state):
  - Quality: `score({ question: 'How clearly does this description tell an agent when to use this tool?', tool }, ['No usable guidance', 'Vague', 'Adequate', 'Clear', 'Precise, with when-to-use and when-not-to-use'])`
    → answer `.score` (expected score, 0-indexed rubric) `< qualityThreshold` → warn
    `judge/description-quality` with `score`.
  - Hint (only tools without `consequential`/`destructive`/`readOnly`):
    `noul({ question: 'Does calling this tool change data, spend money, send messages or otherwise have effects the user must approve?', tool })`
    → `.noul >= hintThreshold` → `judge/consequential-hint` (warn; error with `strictHints`).
  - Overlap: `noul({ question: 'Would an agent likely confuse these two tools and call one when it meant the other?', a, b })`
    for pairs with equal **scope** (name minus its last segment; for names ending
    `.fill|.submit|.options|.goTo|.next|.previous|.step.fill`, minus the last two segments),
    excluding pairs whose names minus the last segment are identical (siblings of one form/wizard).
    At most `maxPairs` pairs per page in name order; the rest are skipped with one warn
    `judge/overlap-truncated`. `.noul >= overlapThreshold` → warn `judge/overlap`.
- SDK errors (`APIError`, `APIConnectionError` incl. `APITimeoutError`) → one warn finding
  `judge/unavailable` naming the error class; never throws.
- Node-only package (export condition `node`); README and `docs/guides/lint.md` say "install as a
  devDependency; sends tool names, descriptions and parameter descriptions to api.typesafe.ai".

**Tests (write first)** (a fake `fetch` returns canned `/v1/systemone` bodies; no module mocking):
`maps_scores_and_nouls_to_findings` · `score_threshold_uses_expected_score` ·
`hint_severity_warn_unless_strict` · `pairs_only_within_scope_excluding_siblings` ·
`pairs_capped_at_max` · `questions_chunked_at_100` · `no_key_never_constructs_client` (review focus
7) · `sdk_error_becomes_warning` · `state_contains_no_values` · `default_and_named_export_same`;
`judge.live.test.ts` (runs only when `TYPESAFE_API_KEY` is set; not in CI).

**Task gate:** `pnpm -F @toolmark/judge-typesafe exec vitest run`

---

### Task 5: Example — Inertia + Laravel 13   (Lane D, risk: high, security)

**Prerequisites:** either host `php -v` ≥ 8.4 with `pdo_sqlite`, `sqlite3`, `mbstring`, `pcntl`
plus `composer -V` 2.x, or (when `php` is not on PATH, as on the execution machine) a running Docker
(`docker info`). Nothing is installed on the host. The lane ledgers `scripts/php.sh php -v` and
`scripts/php.sh composer -V`; it stops only if neither host PHP nor Docker is available (pass-4
ruling).

**PHP through Docker (pass-4 ruling):** every local `php`/`composer` invocation in this task goes
through `examples/inertia-laravel/scripts/php.sh <php|composer> <args…>` (mode 755, Lane D):
- Host `php` on PATH → `exec "$@"` (CI takes this path via `shivammathur/setup-php`).
- Otherwise → `docker run --rm --init -i -v "$PWD":/app -w /app --user "$(id -u):$(id -g)"
  -e COMPOSER_HOME=/tmp/composer` plus `-e` pass-through of `APP_ENV`, `CACHE_STORE`,
  `REDIS_HOST`, `PHP_CLI_SERVER_WORKERS` when set, `--add-host=host.docker.internal:host-gateway
  -e REVERB_HOST=host.docker.internal` (the app container reaches the Reverb container through the
  host; the browser still uses the `VITE_REVERB_*` values), and for each port in `PHP_PORTS`
  (space-separated) `-p 127.0.0.1:<port>:<port>` with `--name toolmark-php-<first port>` after a
  `docker rm -f` of a stale container of that name; image `toolmark-php:8.4`, built on first use
  (`docker build -t toolmark-php:8.4 docker/` when `docker image inspect` fails).
- `docker/Dockerfile`: `FROM php:8.4-cli`; `apt-get install` `libsqlite3-dev`, `libonig-dev`,
  `unzip`, `git`; `docker-php-ext-install pdo_sqlite mbstring pcntl`; `COPY --from=composer:2
  /usr/bin/composer /usr/bin/composer`. `sqlite3` ships enabled in the official image (verify with
  `php -m`, ledger).
- Bootstrap (the directory must be empty for `create-project`): with no host `composer`, run
  `docker run --rm -v "$PWD/examples":/app -w /app --user "$(id -u):$(id -g)" -e COMPOSER_HOME=/tmp/composer composer:2 create-project --no-scripts laravel/laravel:13.10.1 inertia-laravel`,
  then add `docker/Dockerfile` and `scripts/php.sh`, then `scripts/php.sh composer run-script
  post-root-package-install` and `scripts/php.sh composer run-script post-create-project-cmd`; all
  later `composer require` / `php artisan` steps use `scripts/php.sh`.
- If SQLite WAL misbehaves across the two containers on the bind mount, the lane runs `artisan
  serve` and `reverb:start` in one container (`scripts/php.sh sh -c '… & …'` with both ports in
  `PHP_PORTS`) and ledgers it; no owner action.

**Files:** Create `examples/inertia-laravel/**`: the app via
`composer create-project laravel/laravel:13.10.1 examples/inertia-laravel` (the Docker bootstrap above
when host Composer is absent), then `scripts/php.sh composer require inertiajs/inertia-laravel:3.3.4 laravel/wayfinder:0.1.21 laravel/reverb:1.12.0`,
`scripts/php.sh php artisan install:broadcasting --reverb --no-interaction` (committed); `package.json` (replaces
the skeleton's wholesale), `vite.config.ts`, `tsconfig.json`, `resources/js/**` (React pages),
`app/Toolmark/{PageCallTool,PageDescribeTool,BrowserBridge,ConfirmedHandler,PropsBuilder}.php`,
`app/Http/Controllers/Testing/{LoginController,ScriptedAgentController}.php`,
`app/Http/Controllers/TourPlanController.php`, `database/seeders/ToolmarkDemoSeeder.php`,
migrations (`conversations`, `agent_turns`, `challenges`), `routes/{web,channels}.php`,
`.env.example`, `composer.json` scripts, `composer.lock`, `tests/Feature/*Test.php`,
`playwright.config.ts`, `e2e/*.spec.ts`, `docker/Dockerfile`, `scripts/php.sh`; Modify `pnpm-lock.yaml` (this example's entries only, at
the end of the lane, via `pnpm install`).

**Exact values (frontend):** `package.json` private, name `@toolmark-examples/inertia-laravel`,
scripts `"build": "vite build"`, `"dev": "vite"`, `"typecheck": "tsc --noEmit"`; deps
`@inertiajs/react` 3.7.1, `react`/`react-dom` 19.3.0, `react-hook-form` 7.88.0, `zod` 4.6.5,
`laravel-echo` 2.5.0, `pusher-js` 8.6.0, `@toolmark/core`, `@toolmark/react`, `@toolmark/inertia`,
`@toolmark/tour` `workspace:*`; dev `vite` 8.3.1, `@vitejs/plugin-react` 6.1.1,
`laravel-vite-plugin` 3.2.0, `@laravel/vite-plugin-wayfinder` 0.1.10, `typescript` 6.0.3,
`@types/react`, `@types/react-dom`, `@playwright/test`, `@axe-core/playwright` 4.13.0,
`@toolmark/testing`, `@toolmark/lint` `workspace:*`. `vite.config.ts`: `laravel({ input:
'resources/js/app.tsx' })`, `react()`, `wayfinder()`, `resolve.conditions` and
`ssr.resolve.conditions` = `['@toolmark/source', ...defaultClientConditions]`.

**Exact values (environment):**
- `.env.example` (committed; `.env` git-ignored): `APP_ENV=local`, `APP_URL=http://127.0.0.1:8010`,
  `DB_CONNECTION=sqlite`, `DB_DATABASE=database/database.sqlite`, `BROADCAST_CONNECTION=reverb`,
  `QUEUE_CONNECTION=sync`, `CACHE_STORE=database`, `REDIS_CLIENT=phpredis`,
  `REVERB_APP_ID=toolmark`, `REVERB_APP_KEY=toolmark-key`, `REVERB_APP_SECRET=toolmark-secret`,
  `REVERB_HOST=127.0.0.1`, `REVERB_PORT=8081`, `REVERB_SCHEME=http`, and `VITE_REVERB_APP_KEY`,
  `VITE_REVERB_HOST`, `VITE_REVERB_PORT`, `VITE_REVERB_SCHEME` mirroring them.
- `config/database.php` sqlite: `'busy_timeout' => 5000`, `'journal_mode' => 'wal'`.
- Broadcast events implement `ShouldBroadcastNow` (no queue worker). Private channel
  `toolmark.{userId}.{conversationId}` authorizes only the conversation's owner.
- `composer.json` script `toolmark:setup`:
  `@php -r "file_exists('.env') || copy('.env.example', '.env');"`, `@php artisan key:generate --ansi`,
  `@php -r "touch('database/database.sqlite');"`, `@php artisan migrate:fresh --seed --force`.
- `ToolmarkDemoSeeder`: users `alice@example.test`, `bob@example.test` (password `password`), one
  conversation each, three challenges for alice.
- Routes registered only when `app()->environment('local', 'testing')`: `GET /testing/login/{user}`
  (logs in, redirects to `?next=`), `POST /testing/agent/script` (authenticated; body
  `{ conversationId, clientId, steps: [{ type: 'call' | 'describe', tool, input? }] }` →
  `ScriptedAgentController` sends each as a protocol-v1 message over the private channel, awaits the
  result through `BrowserBridge`, returns `{ calls: n, results: [...] }`).
  `POST /tour/plan` (authenticated, all envs) returns fixed `TourStep[]` for a `goal` (scripted
  server planner, no LLM).
- Ids (`id`, `confirmId`) are `Str::uuid()` v4 or 32-char `Str::random`; bound to user,
  conversation and `clientId` in the cache with the deadline.
- Wayfinder output (`resources/js/{actions,routes,wayfinder}/`) is generated by the Vite plugin at
  build and git-ignored. The skeleton's `.gitignore` already covers `vendor/`, `.env`,
  `public/build`, `database/*.sqlite*`.
- `playwright.config.ts`: `use.baseURL` `http://127.0.0.1:8010`; `bind` is `'127.0.0.1'` when host
  `php` is on PATH, else `'0.0.0.0'` (inside the container; `php.sh` publishes only on host
  `127.0.0.1`); `webServer`:
  `[{ command: 'scripts/php.sh php artisan serve --host=' + bind + ' --port=8010', env: { PHP_CLI_SERVER_WORKERS: '4', PHP_PORTS: '8010' }, url: 'http://127.0.0.1:8010/up', reuseExistingServer: !process.env.CI },
    { command: 'scripts/php.sh php artisan reverb:start --host=' + bind + ' --port=8081', env: { PHP_PORTS: '8081' }, port: 8081, reuseExistingServer: !process.env.CI }]`
  (`CACHE_STORE`/`REDIS_HOST` pass through from the environment); project `chromium` only;
  `globalSetup` logs in as alice and saves `test-results/alice.json` storage state.

**Behaviour:**
- Pages: challenge list (server-declared `challenges.archive` destructive tool via the `toolmark`
  prop, filtered by the server's authorization in `PropsBuilder`), challenge create (react-hook-form +
  `useFormTool`; `rhfAdapter(form, { elementFor })` so anchors resolve), a three-step wizard, an
  Inertia `<Form>` page (`inertiaFormComponentAdapter`). Each page shows its `clientId` in
  `data-testid="toolmark-client-id"` and calls `installTestHook` when `import.meta.env.MODE !==
  'production'`.
- `navigationTool` over Wayfinder route functions (GET-only); `inertiaPages({ router, initialPage })`.
- Bridge: `bridge({ transport: echoTransport(…) })` (M1 T9 signature) over the private channel;
  results POST back to an authenticated endpoint validated by `BrowserBridge` (§12.2 MUSTs); cache
  hand-off with Redis `BLPOP` when `CACHE_STORE=redis`, cache polling otherwise.
- `ConfirmedHandler` follows §12.3: on `confirmed` it appends the outcome to the conversation as a
  tool-result message (`agent_turns` row) and dispatches **one** follow-up turn whose tool list
  withholds `page_call`/`page_describe`.
- The challenge create page mounts `mountTourOverlay` with an authored three-step `show` tour
  (`?tour=authored`) and a planned tour whose `Planner` POSTs `{ goal, tools }` to `/tour/plan`
  (`?tour=planned`).
- The `app/Toolmark/*.php` files are the reference: each starts with `// file: app/Toolmark/<Name>.php`
  so Lane F can sync `docs/guides/laravel-reference.md` byte-for-byte (Task 7 check).

**Tests (write first):**
- PHPUnit (`tests/Feature/BrowserBridgeTest.php`, `ConfirmedHandlerTest.php`, `TestingRoutesTest.php`,
  `PropsBuilderTest.php`): `test_rejects_result_from_other_user`,
  `test_rejects_unknown_or_duplicate_id`, `test_rejects_after_deadline`,
  `test_accepts_valid_result_once`, `test_channel_auth_only_owner`,
  `test_confirmed_triggers_single_followup_without_tools` (exactly one tool-result message and one
  follow-up turn whose tools contain neither `page_call` nor `page_describe`),
  `test_testing_routes_absent_outside_local_and_testing`, `test_props_builder_filters_by_authorization`.
- Playwright `e2e/app.spec.ts`: `fill_create_form_via_bridge` · `wizard_one_call` ·
  `archive_requires_confirmation` (deferred → approve → `confirmed` → one follow-up turn) ·
  `navigation_then_new_page_tools` · `messages_conform_to_protocol_schemas` (captures every Echo
  frame and bridge POST body; each validates with `validateMessage` from `@toolmark/core/protocol`) ·
  `tour_authored_on_inertia_page` (show tour steps through three anchors; axe on `.toolmark-tour` has
  no serious/critical violations) · `planned_tour_from_server_planner` ·
  `lint_clean` (spawns `node <@toolmark/lint dir>/dist/cli.js lint --url <each page>
  --storage-state test-results/alice.json` → exit 0).

**Task gate:** `pnpm -r --filter "./packages/*" build && cd examples/inertia-laravel && scripts/php.sh composer install --no-interaction && scripts/php.sh composer run toolmark:setup && scripts/php.sh php artisan test && pnpm exec playwright install chromium && pnpm build && pnpm exec playwright test`

---

### Task 6: Example — Next.js 16 App Router   (Lane E, risk: normal)

**Files:** Create `examples/nextjs/**` except `package.json` (Task 0): `next.config.ts`,
`tsconfig.json`, `app/layout.tsx`, `app/page.tsx`, `app/providers.tsx`, `app/challenge-form.tsx`,
`app/in-page-agent.tsx`, `playwright.config.ts`, `e2e/global-setup.ts`, `e2e/global-teardown.ts`,
`e2e/app.spec.ts`, `e2e/lint-clean.spec.ts`.

**Exact values:** `next.config.ts`: `transpilePackages: ['@toolmark/core', '@toolmark/react']`
(Turbopack has no custom resolve condition, so `@toolmark/*` resolve through `import` to `dist/`:
packages are built first). `tsconfig.json` is standalone (does not extend `tsconfig.base.json`):
`moduleResolution: "bundler"`, `strict: true`, `jsx` as `next build` writes it. Env
`NEXT_TELEMETRY_DISABLED=1`. `globalSetup` spawns `next dev -p 3100` and `next start -p 3101`
(after `next build`), piping output to `test-results/next-dev.log` / `next-start.log`, waits for both
URLs; `globalTeardown` kills them. Next 16 keeps dev output in `.next/dev` so both can run; verify
with ctx7 at execution, else give dev its own `distDir` via env and ledger it.

**Behaviour:** `ToolmarkProvider` in a `"use client"` `providers.tsx`; `installTestHook` runs inside a
`useEffect` only when `process.env.NODE_ENV !== 'production'`; a server-rendered page with a client
form using `useFormTool`; the registry is never created on the server; an in-page agent via
`createInPageChannel`.

**Tests (write first):** `ssr_renders_without_registry_errors` (both ports: server log has no line
matching `/(^|\s)(⨯|Error\b)|toolmark/i`; browser console has no message matching
`/hydrat|did not match|server rendered HTML|Minified React error #4(18|23|25)/i`) ·
`client_tools_after_hydration` (dev: `window.__toolmark_test__` appears only after hydration) ·
`fill_via_in_page_agent` · `production_build_omits_test_hook` (3101: the hook never appears) ·
`lint_clean` (spawns the built lint CLI with `--url http://127.0.0.1:3100/` → exit 0).

**Task gate:** `pnpm -r --filter "./packages/*" build && pnpm -F @toolmark-examples/nextjs build && pnpm -F @toolmark-examples/nextjs typecheck && pnpm -F @toolmark-examples/nextjs exec playwright install chromium && pnpm -F @toolmark-examples/nextjs exec playwright test`

---

### Task 7: Docs site, API reference, guides, CI   (Lane F, risk: normal)

**Files:** Create `docs/.vitepress/config.ts`, `docs/index.md`, `docs/getting-started.md`,
`docs/concepts/{registry,scopes,callers,policy,confirmation,results}.md`,
`docs/guides/{tours,lint,nextjs,react}.md`, `docs/reference/codes.md`, `typedoc.config.mjs`,
`tsconfig.docs.json`, `scripts/check-laravel-reference.mjs`,
`scripts/check-laravel-reference.test.mjs`, `.github/workflows/docs-deploy.yml`; Modify
`docs/guides/laravel-reference.md` (sync from `examples/inertia-laravel/app/Toolmark/*.php` with
`// file:` first lines), M2/M3 guides (link `reference/codes.md`), `.github/workflows/ci.yml`;
TSDoc-comment-only edits in `packages/*/src/**` where TypeDoc warns.

**Behaviour:**
- `typedoc.config.mjs`: `entryPointStrategy: 'resolve'`; `entryPoints` computed from every
  `packages/*/package.json` `exports` value that has an `@toolmark/source` target (covers core
  `.`/`protocol`/`bridge*`/`dom`/`webmcp`/`otel`, react `.`/`rhf`, inertia, testing `.`/`page`/`vitest`,
  tour `.`/`overlay`/`react`, mcp `.`/`client`, lint, judge-typesafe); throws if any package yields
  none. `tsconfig: 'tsconfig.docs.json'` (extends `tsconfig.base.json`, `include:
  ["packages/*/src"]`, `customConditions: ["@toolmark/source"]`, `types: ["node"]`, `noEmit`).
  `plugin: ['typedoc-plugin-markdown', 'typedoc-vitepress-theme']`, `out: 'docs/api'`,
  `docsRoot: 'docs'`, `sidebar: { autoConfiguration: true, format: 'vitepress', collapsed: true }`,
  `excludePrivate`, `excludeInternal`, `treatWarningsAsErrors: true`, `validation: { invalidLink:
  true, notExported: strict, notDocumented: strict }` where `strict = process.env.TYPEDOC_STRICT ===
  '1'` (R5: off through M4; M5 runs `docs:api:strict`).
- `docs/.vitepress/config.ts`: `srcExclude: ['superpowers/**', 'ROADMAP.md', 'release/**',
  'security/**']`, `cleanUrls: true`, `base: process.env.DOCS_BASE ?? '/toolmark/'`,
  `lastUpdated: true`, `ignoreDeadLinks: [/^https?:\/\/(localhost|127\.0\.0\.1)/]`; sidebar imports
  `../api/typedoc-sidebar.json`. Links to files outside `docs/` use
  `https://github.com/adams100111/toolmark/blob/main/...` URLs.
- Sections: Getting started, Concepts (registry, scopes, callers, policy, confirmation modes,
  results), Guides (all guides from M1–M4), Protocol v1, Laravel reference, Reference (codes), API.
- `docs/guides/react.md`: `ToolmarkProvider`, `ToolScope`, `useTool`, `useFormTool` + `rhfAdapter`,
  `useWizardTool`, `useConfirmQueue(queue)`/`usePendingConfirmations`, `useAgentActivity`,
  `useToolAnchor`, `useTour`, StrictMode behaviour, each with a runnable snippet.
- `docs/guides/tours.md`: modes and modality, authored steps, planner contract + recipes
  (bridge/relay-backed, HTTP `/tour/plan`), CSS variables with defaults, `styles.css` import (Next.js
  in `app/layout.tsx`), strings, RTL, reduced motion, headless `useTour`, guide mode needs
  `onUserInteraction` (`inertiaAdapter`: show/do only).
- `docs/guides/lint.md`: rules with definitions, exit codes, formats, `--manifest` shape,
  `--url`/`--storage-state`, `--judge` (executes the module), invocation
  `pnpm exec toolmark lint` / `npx -p @toolmark/lint toolmark lint`; the judge: key, thresholds,
  data sent to api.typesafe.ai, dev-only install.
- `docs/guides/nextjs.md`: client boundary, SSR no-op, test hook only in dev, build packages before
  `next build` in a monorepo.
- `docs/reference/codes.md`: every `refused` code and `error` event code with its milestone of
  origin (from the M1–M3 plans and code).
- `scripts/check-laravel-reference.mjs`: each fenced `php` block in `laravel-reference.md` whose
  first line is `// file: app/Toolmark/<Name>.php` equals that example file after normalising line
  endings; exit 1 on any mismatch or missing file.
- CI (`ci.yml`): new jobs follow M1's job template (`node-version` default `24.x`, pnpm from
  `packageManager`, `pnpm install --frozen-lockfile`); M1's jobs keep their steps.
  - `docs`: `pnpm docs:build` and `node scripts/check-laravel-reference.mjs`.
  - `e2e` (react-vite, modified): adds `pnpm -r --filter "./packages/*" build` first and installs
    `chromium firefox webkit` (`--with-deps`); keeps M1's steps (`typecheck`, Playwright with
    `ROUND_BUDGET_REPORT=round-budget.json` + artifact upload, prod `build` + no-test-hook grep); the
    Playwright run covers every project (Global constraints).
  - `example-nextjs`: the Task 6 gate commands; env `NEXT_TELEMETRY_DISABLED=1`.
  - `example-laravel`: matrix `bridge-cache: [database, redis]`; `services.redis` (`redis:7`, port
    6379) on the redis leg; `shivammathur/setup-php@v2` with `php-version: '8.4'`,
    `extensions: mbstring, pdo_sqlite, sqlite3, pcntl, redis`, `tools: composer:v2`,
    `coverage: none`; Composer cache keyed on `examples/inertia-laravel/composer.lock`; env
    `CACHE_STORE=${{ matrix.bridge-cache }}`, `REDIS_HOST=127.0.0.1`; then the Task 5 gate commands
    with `playwright install --with-deps chromium`; then `composer audit` (report only).
- `docs-deploy.yml`: on `push` to `main` and `workflow_dispatch`; job
  `if: ${{ !github.event.repository.private }}`; `permissions: { contents: read, pages: write,
  id-token: write }`; builds with `DOCS_BASE=/toolmark/`, `actions/configure-pages`,
  `actions/upload-pages-artifact` (`docs/.vitepress/dist`), `actions/deploy-pages` (latest majors at
  execution; M5 pins SHAs).

**Tests (write first):** `laravel_reference_matches_example` (`node --test
scripts/check-laravel-reference.test.mjs`: matching fixture → 0; one changed byte → 1);
`pnpm docs:build` succeeds with zero TypeDoc warnings under non-strict validation.

**Task gate:** `node --test scripts/check-laravel-reference.test.mjs && node scripts/check-laravel-reference.mjs && pnpm docs:build`

---

### Task 8: Cross-cutting e2e in `examples/react-vite`, exit check, tarball hand-off   (Lane F, risk: normal)

**Files:** Create `examples/react-vite/src/tour-panel.tsx`, `src/routes.tsx`, `src/relay-planner.ts`,
`e2e/tour.spec.ts`, `e2e/same-tools.spec.ts`, `e2e/multi-client.spec.ts`, `e2e/navigation.spec.ts`,
`e2e/lint-clean.spec.ts`, `e2e/support/relay-server.ts`; Modify `examples/react-vite/src/app.tsx`,
`src/main.tsx`, `playwright.config.ts`, `e2e/global-setup.ts` (M3), `docs/release/next-tarballs.md`
(append M4), `docs/release/round-budget.md` (re-render); at the hand-off step the version files
listed in the lane table; `scripts/tarball-smoke.mjs` only if it misses non-JS exports.

**Behaviour:**
- `app.tsx`: if the example's `createToolmark` has no inline `confirm` handler yet, add one from
  `createConfirmQueue` rendered through `useConfirmQueue(queue)` as an inline confirm dialog
  (webmcp/mcp/tour are inline callers). Mount `<TourPanel>` on the main page, over the same
  `ChallengeForm` declaration (single `useFormTool`). Log every registry `result` event
  `{ caller, tool, result }` to `window.__example.results` (test-only, same guard as the test hook).
- `tour-panel.tsx`: buttons start the authored three-step tour (`challenges.create.fill` params
  `title.en` and `type`, then `challenges.create.submit` with `waitFor: 'submit'`) in `show`, `guide`
  and `do`, and a planned tour (`relayPlanner`) in `show` and `do`; `mountTourOverlay`; tour events
  rendered into `data-testid="tour-events"`.
- `relay-planner.ts`: a `Planner` that sends `{ kind: 'toolmark-example/plan', id, goal, tools }` on
  its own relay socket and resolves `{ kind: 'toolmark-example/plan-result', id, steps }` (app-level
  side channel, not protocol v1).
- `routes.tsx`: a `location.hash` switch (`#/routes/a`, `#/routes/b`, no router dependency); each
  route renders its own `<ToolScope>` with different tools.
- `relay-server.ts`: a Node `ws` relay on port 0 started in `globalSetup`
  (`process.env.TOOLMARK_RELAY_PORT`); forwards every frame to every other socket. Pages opt in with
  `?relay=<port>` (`bridge({ transport: websocketTransport({ url: 'ws://127.0.0.1:<port>' }) })`)
  instead of the in-page agent; the test drives the agent side over its own socket.
- `global-setup.ts`: builds `pnpm --filter "@toolmark/mcp..." --filter "@toolmark/lint..." build`
  once (extends M3's build step), then starts the relay.
- `playwright.config.ts`: projects `chromium`, `firefox`, `webkit` for `tour`, `navigation`,
  `multi-client`, `form`, `wizard`, `dom` specs; `webmcp`, `mcp`, `reach`, `same-tools`,
  `lint-clean` and `round-budget` on `chromium` only (`testMatch`/`testIgnore` per project;
  round-budget stays single-browser so its report has one row per task, pass-3 ruling).
- **Tarball hand-off (last step of the milestone):** `pnpm changeset version` (pre mode `next`,
  versions only — no publish), commit, `pnpm -r --filter "./packages/*" pack --pack-destination
  "$PWD/dist-tarballs"` (all eight packages), `node scripts/tarball-smoke.mjs dist-tarballs`
  (extend the script first if it does not check that non-JS export targets such as
  `./styles.css` and `./manifest.schema.json` exist in the tarball), re-render
  `docs/release/round-budget.md` with `node scripts/render-round-budget.mjs` from the Chromium
  `ROUND_BUDGET_REPORT`, and append the M4 entry (version,
  filenames, SHA-256, smoke result) to `docs/release/next-tarballs.md`.

**Tests (write first):**
- `tour.spec.ts` (3 browsers): `tour_show_mode` (overlay steps through anchors on Next; nothing
  filled; the anchor stays clickable) · `tour_guide_mode_waits_for_valid_input` (invalid typed value
  keeps the step with the issue shown; valid value advances) · `tour_do_mode_fills_and_confirms`
  (fills with highlighted changes; the consequential submit shows the inline confirm while the
  overlay is `confirming`; approving submits) · `tour_planned_via_agent_planner` (the test agent
  answers the plan request with three valid steps and one unknown tool; `step_invalid` is shown;
  runs in `show` and `do`) · `tour_overlay_axe_clean` (`new AxeBuilder({ page })
  .include('.toolmark-tour').analyze()` in each mode → no serious/critical violations).
- `same-tools.spec.ts` (Chromium): `same_declaration_all_surfaces` — the summary manifest lists
  `challenges.create.fill` exactly once; the same input is sent through (1) the in-page bridge agent,
  (2) WebMCP polyfill `execute`, (3) an MCP SDK client via `toolmark-mcp` pairing (llmName), (4) a
  one-step `do` tour, (5) the Playwright `tools` fixture, reloading the page between surfaces (MCP
  resumes with its session token); each `result` event (`inapp`, `webmcp`, `mcp`, `tour`, `test`) is
  `ok` with identical `changes`.
- `multi-client.spec.ts`: `two_tabs_only_addressed_client_executes` (two pages on one relay; a `call`
  addressed to tab B's `clientId` → only B's form changes and exactly one `result` arrives).
- `navigation.spec.ts`: `navigation_mid_conversation_new_manifest` (agent calls a route-A tool, the
  page navigates to route B → a new `manifest` with route B's tools arrives; a call to the old tool
  with the old `rev` → `refused` `stale` carrying the current `rev`).
- `lint-clean.spec.ts`: `lint_clean` (spawns the built lint CLI with `--url` for `/` and both routes
  → exit 0).

**Task gate:** `pnpm -F @toolmark-examples/react-vite exec playwright test` (all projects, incl. the
M1–M3 specs), then the lane gate `pnpm lint && pnpm typecheck && pnpm test && pnpm build`, then the
milestone exit check (every item above), CI green on push, and the M4 tarballs listed in
`docs/release/next-tarballs.md` with a passing smoke result.

---

## Self-review

- **Spec coverage:** §11.5 (modes, modality, authored/planned, overlay, headless, RTL, a11y/axe,
  reduced motion) → T1/T2/T8; §4 lint + judge → T3/T4; §12.2–§12.5 (security MUSTs, §12.3 follow-up,
  server-declared tools, Laravel reference) → T5 + T7 check; §13 anchors/state/interaction → T1;
  §15 i18n (tour strings, RTL) → T2; §16 examples → T5/T6/T8; §18 E2E (tours in three modes on three
  browsers, multi-tab targeting, navigation mid-conversation, planned tours, same-tools) → T8; §20 M4
  exit → "Milestone exit check" (every item has a named test or gate); §21 docs (API reference,
  guides, non-strict TypeDoc through M4, deploy once public) → T7; D30 → T1/T2.
- **Names:** `startTour`, `TourStep`, `Tour`, `Planner`, `TourMode`, `TourState`, `TourEvent`,
  `TourStrings`, `mountTourOverlay`, `useTour`, `lint`, `Judge`, `Finding`, `typesafeJudge`
  (named + default) match the overview registry row for M4; `ManifestFile` is additive; `paramSchema`
  stays internal. `TourState` gains `mode` and status `'confirming'`, `TourEvent` gains
  `step_entered`/`done`, `TourStrings` gains `confirming` (M4 introduces these types, so nothing is
  renamed).
- **Consumed interfaces:** `tm.anchor`/`state`/`events.on('interaction')` (M1 T4, M3 T1–T2),
  `createInPageChannel`, `websocketTransport`, `echoTransport` via `bridge({ transport })` (M1 T9),
  test hook shape and missing-hook message (M1 T14), `@toolmark/source` condition and packages-only
  root scripts (overview), `webmcp({ polyfill: loader })` (M3 T3), `mcpPairing({ code?, port?,
  onStatus? })` and session resume (M3 T5), `e2e/support/mcp-client.ts` and `e2e/global-setup.ts`
  (M3 T7), `.options` description suffix (M2 T2), `tarball-smoke.mjs` and `render-round-budget.mjs`
  (M1 T16).
- **Ownership:** new `package.json` files and root configs are Lane A's (Task 0) except
  `examples/inertia-laravel/`, which Lane D owns whole (plus its lockfile entries at lane end);
  `ci.yml`, `docs-deploy.yml`, docs, TypeDoc config, the Laravel reference check, and react-vite
  sources/configs (incl. M1–M3 files) are Lane F's; F's hand-off step owns version/CHANGELOG/pre.json
  rewrites. Lanes B–E touch disjoint directories.
- **Currency:** every version above is from the overview table or verified 2026-09-24 (npm,
  Packagist, `@typesafe-ai/sdk` 0.6.0 `.d.mts`); Task 0 re-verifies npm versions and ledgers bumps.
- **Placeholders:** none; options still to confirm at execution (tsdown `copy`, Next 16 `.next/dev`,
  GitHub Pages action majors) name the fallback and the ledger entry.
