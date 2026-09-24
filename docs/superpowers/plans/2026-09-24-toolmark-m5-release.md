# Toolmark M5 — Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `sdd-lanes` to implement this plan lane by lane.
> Plan-lite format. Requires M1–M4 merged. **Publishing to npm, making the repo public, repository
> settings, the npm org, the IP check and approving the `npm-release` environment are owner-only
> actions. The plan ends at Task 7c: every other piece of work is done, `docs/release/owner-handoff.md`
> lists what the owner runs, and the controller stops.** Task 7d runs only after the owner reports
> that the publish run finished.

**Goal:** Prove every §21 release gate inside this repository, resolve what the security review
finds, set up the weekly spec-watch, bring `1.0.0` to a publish-ready state, and hand the outward
steps to the owner.

**Architecture:** Every gate is a runnable command, and CI runs it where possible: the matrix,
package quality (publint, attw, size, metadata, zero deps, no app code), docs completeness, and the
TS 6/7 types checks inside the tarball smoke. The security review is a structured, file:line-evidenced
report, followed by a findings-resolution wave. The release uses the changesets split-job workflow
with a protected `npm-release` environment. The first publish is an owner bootstrap with a
short-lived token. After it, the owner configures OIDC trusted publishing per package and revokes the
token.

**Tech Stack:** as overview, plus `publint` 0.3.24, `@arethetypeswrong/cli` 0.18.5, `size-limit`
14.0.0 + `@size-limit/preset-small-lib` 14.0.0, `@changesets/changelog-github` 1.0.1,
`changesets/action` v2 (2.1.2), GitHub OIDC for npm trusted publishing and provenance.

**Spec:** §1 SC1–SC4, §14, §17, §18, §20 (M5), §21, §22, §23; D2, D3, D15, D28, D32.

## Pre-flight (controller, before wave 0)

- **Stack currency** (CLAUDE.md rule): run `npm view <pkg> version` for every tool in this plan and
  in the overview table. Run `gh api repos/<owner>/<repo>/releases/latest --jq .tag_name` for every
  action in "Action pins". Check the current Node LTS lines (https://nodejs.org/dist/index.json).
  Record any bumps in the M5 ledger. A major bump stops the plan for a ruling.
- **Flag verification** (record the output in the ledger): `pnpm dlx publint@0.3.24 --help`,
  `pnpm dlx @arethetypeswrong/cli@0.18.5 --help` (`--profile esm-only`), `pnpm changeset --help`
  (`publish-plan`, `pack`, and `publish` flags `--from-pack-dir`/`--tag`), and the size-limit README
  (`gzip`, `import`, `ignore`, `rolldown`). Also run `npm trust --help` on npm ≥ 11.15, because the
  owner hand-off quotes its flags. For the Vitest 5 browser-instance filter, use ctx7
  `/vitest-dev/vitest`.
- **M1–M4 artifacts present:** `scripts/tarball-smoke.mjs`,
  `examples/react-vite/e2e/{round-budget,same-tools,tour}.spec.ts` (plus the planned-tour test
  `tour_planned_via_agent_planner`), `docs/release/{round-budget,next-tarballs}.md`, `typedoc.json`
  (non-strict), `docs/reference/codes.md`, `.changeset/{config.json,pre.json}` (pre mode `next`,
  `fixed` group), and `ci.yml` jobs from M1 T16 and M4 T7. If one is missing, that is a ruling, not a
  silent re-implementation.

## Global constraints (M5 additions)

- **CI matrix (exact, spec §21 / R6).** `matrix.include`:
  - `{ node: 22.x, react: 19.3.0, inertia: 3.7.1 }`: full unit + DOM suites.
  - `{ node: 24.x, react: 19.3.0, inertia: 3.7.1 }`: full unit + DOM suites.
  - `{ node: 24.x, react: 18.3.1, inertia: 2.3.28 }`: the `react`, `inertia` and `core-browser`
    projects.
  - `{ node: 24.x, react: 19.3.0, inertia: 2.3.28 }`: the `inertia` project.

  React 18.3 × Inertia 3 is never run, because Inertia 3 requires React 19. Installed `zod` is
  4.6.5 in every cell.

  A separate `zod3` job (Node 24) installs `zod@3.25.76` and runs only the converter-specific tests,
  which import `zod/v3` and `zod-to-json-schema`. The `browser` axis is `[chromium, firefox, webkit]`
  over the DOM projects and the `examples/react-vite` Playwright suite. The WebMCP suites, the
  Laravel example and the Next.js example run on chromium only.
- **Version swap in matrix jobs:** `pnpm -r --filter <pkg> add -D react@<v> react-dom@<v>
  @types/react@<18.3.x|19.x> @types/react-dom@<…>`, and likewise for `@inertiajs/react` and `zod`,
  then `pnpm install --no-frozen-lockfile` in that job only. The result is never committed. Every
  other job uses `pnpm install --frozen-lockfile`.
- **Workflow hardening (every workflow, checked by `scripts/check-workflows.mjs`):**
  - Top-level `permissions: {}`, with per-job grants.
  - `actions/checkout` with `persist-credentials: false`, except where a job must push, which is
    then named in the workflow.
  - Third-party and GitHub actions pinned by full 40-char commit SHA with a trailing `# vX.Y.Z`
    comment.
  - No `pull_request_target`.
  - `concurrency` set.
- **Action pins (verified 2026-09-24; re-verify in pre-flight):**

  | Action | Version |
  | --- | --- |
  | `actions/checkout` | 7.0.1 |
  | `actions/setup-node` | 7.0.0 |
  | `pnpm/action-setup` | 6.1.0 |
  | `actions/cache` | 6.1.0 |
  | `changesets/action` | 2.1.2 (sub-actions `select-mode`, `version`, `pack`, `publish`; v2 renamed inputs) |
  | `shivammathur/setup-php` | 2.37.2 |
  | `actions/upload-pages-artifact`, `actions/deploy-pages` | latest major at pre-flight |

  Dependabot (`github-actions` + `npm`, weekly) keeps the pins current.
- **Size budgets:** `.size-limit.json` has one entry per public JS entry. Each `path` is the built
  file that `exports[<subpath>].import` points to. Every entry sets `"import": "*"` and
  `"gzip": true`: gzip is the chosen compression, stated explicitly because Brotli is size-limit's
  default. `ignore` lists that package's `peerDependencies`. Workspace deps (for example
  `@toolmark/core` inside `@toolmark/react`) are counted, because they are the user's real cost.
  `@toolmark/tour/styles.css` has `{ "path": "packages/tour/dist/styles.css", "rolldown": false,
  "gzip": true }`. The node-only CLI entries (`@toolmark/mcp` root and bin, `@toolmark/lint`,
  `@toolmark/judge-typesafe`) get file-size-only entries (`"rolldown": false`). Each limit is the
  measured size of the first release build + 10 %, rounded up to the next 0.5 kB. The measured
  numbers go in the ledger.
- **Release version:** `1.0.0` for all eight packages as one `fixed` group. The WebMCP entry's TSDoc
  (`@experimental`), the `docs/guides/webmcp.md` banner and the core `description` keep the word
  **experimental** (D28).
- **Publishing (spec §17, R4):**
  - The publish job runs on Node `24.x` (npm ≥ 11.5.1 for OIDC) in environment `npm-release` with
    `permissions: { contents: write, id-token: write }`, and `NPM_CONFIG_PROVENANCE: 'true'`.
  - It refuses to run in pre mode, and it refuses any non-stable `@toolmark/*` version.
  - It runs only when the repository variable `TOOLMARK_PUBLISH_ENABLED` is `'true'`, which the
    owner sets.
  - `release.yml` is the only workflow that publishes. Every earlier build left the repo only as a
    `-next` tarball verified by `scripts/tarball-smoke.mjs`.
- **Security-tagged tasks** (4, 5) use the most capable model for implementation and review.
- **No destructive git; no outward action by agents.** No agent runs `npm publish` (except
  `--dry-run`), `npm trust`, `gh repo edit --visibility`, environment approvals, or `gh secret set`.
  No agent creates npm tokens.

## Rulings made while planning

- **Security fixes are their own wave** (Task 5) after the review, so parallel lanes never race on
  arbitrary files.
- **In-repo evidence is a gate artifact.** `docs/release/round-budget.md`, regenerated on the
  release candidate, must meet success criterion 1 (simple form ≤ 3 rounds, wizard ≤ 5, zero
  `invalid`/`refused`). `scripts/tarball-smoke.mjs` must pass on the RC tarballs, and
  `same-tools.spec.ts` and the tours e2e must be green on the RC build. If any check fails, the
  release stops. Innovation measurements are post-1.0 and never gate.

## Rulings made while fixing (pass 2)

- **RC e2e runs against built `dist`.** For the RC evidence only (Task 7b), `examples/react-vite`
  runs with `TOOLMARK_DIST=1`. That env var removes `@toolmark/source` from its Vite `resolve.conditions`
  and `ssr.resolve.conditions`, so the round budget, same-tools and tours exercise the built RC
  packages. This is one switch in one example config, run in the RC step and in the
  `release-dry-run` job. It is not a separate permanent CI job, so pass-1 ruling 17 stands.
- **Publish gate is a repo variable plus the environment.** GitHub creates an environment on first
  reference if it does not exist, and that environment has no protection. So the publish job also
  requires `vars.TOOLMARK_PUBLISH_ENABLED == 'true'`. Only the owner sets the variable, after
  creating `npm-release` with themself as the only reviewer. Pushing the 1.0.0 commit to `main`
  therefore skips the publish job, and the owner starts it with `workflow_dispatch`.
- **Publish client.** The primary path is `changesets/action/publish@v2` from the `pack` job's
  artifact (`changeset publish --from-pack-dir`). Task 7a verifies from the changesets source and
  docs that this path publishes through npm with OIDC and provenance on Node 24. If it does not, the
  job runs `npm publish <tgz> --access public --provenance` per tarball, then `pnpm changeset tag`
  and `git push --follow-tags`. The verified path goes in the ledger. Either way, the release-dry-run
  job smoke-tests the changesets-packed tarballs as well as the `pnpm pack` ones (pass-1 ruling 19).
- **Size compression is gzip.** Every size entry sets `"gzip": true`, because the spec and budget
  language say gzip.
- **App-code check pattern.** `check-no-app-code.mjs` fails on
  `/innovation|dits-sa|ChallengeForm|entry[ -]mode/i` in `packages/*/src/**` and `packages/*/README.md`.
  A bare "challenge" is not matched, to avoid false positives.
- **The source condition stays published.** `docs/policies/versioning.md` states that
  `@toolmark/source` and the shipped `src/` are internal and outside semver (pass-1 ruling 9).
  `publishConfig.exports` is not used.
- **Node 26 is not added** (pass-1 ruling 23). Pre-flight re-checks the LTS lines.
- **CI minutes (owner O6):**
  - The full matrix runs on `pull_request` to `main`, on `push` to `main`, and nightly
    (`cron: '0 3 * * *'`).
  - Pushes to other branches run the `node 24 × react 19.3.0 × inertia 3.7.1` cell on chromium only.
  - Branch protection requires the full-matrix job names.

## Review focus

1. **Consumers on TS 6/7 and both resolutions**: the tarball smoke type-checks every public entry
   from packed tarballs under `nodenext` and `bundler`, with no `customConditions` (Task 2).
2. **ESM consumers resolving exports wrong**: publint `--strict` and `attw --profile esm-only` pass
   on every packed tarball. CommonJS `require()` is unsupported and documented in each README (Tasks
   2, 3b).
3. **A dependency sneaking into core**: `check-zero-deps` fails CI (Task 2).
4. **Security regressions after review**: every finding gets a failing-first regression test
   (Task 5).
5. **Publishing before the owner approves, or publishing an RC as `latest`**: the pre-mode refusal,
   the stable-version check, the repo-variable gate and the owner-only environment (Task 7a).
6. **WebMCP spec drift after release**: the weekly job opens an issue with the diff (Task 6).

## File structure

```
.github/workflows/{ci,release,docs,spec-watch}.yml · .github/dependabot.yml
.github/ISSUE_TEMPLATE/{bug,feature}.yml · .github/pull_request_template.md
scripts/{check-zero-deps,check-package-meta,check-no-app-code,check-workflows}.mjs (+ *.test.mjs)
scripts/{check-docs,check-security-review,check-release-versions,spec-watch,render-round-budget}.mjs (+ tests)
scripts/tarball-smoke.mjs (modify)
.size-limit.json · typedoc.json (modify) · docs/.vitepress/config.ts (modify)
SECURITY.md · CONTRIBUTING.md · CODE_OF_CONDUCT.md · README.md
docs/policies/{versioning,deprecation,tool-names}.md · docs/security/{threat-model,review-2026}.md
docs/release/{checklist,owner-handoff,round-budget,next-tarballs}.md
.changeset/release-1-0.md · .spec-watch/{state.json,fixtures/**}
packages/*/{package.json (metadata),LICENSE,README.md}
```

## Lanes

| Wave | Lane | Tasks | Owns files | Consumes |
| --- | --- | --- | --- | --- |
| 0 | A (normal) | 1, 2 | `.github/workflows/ci.yml`; `.github/dependabot.yml`; `scripts/{check-zero-deps,check-package-meta,check-no-app-code,check-workflows}.mjs` + their `*.test.mjs` and `scripts/fixtures/**`; `scripts/tarball-smoke.mjs` (modify); `.size-limit.json`; root `package.json` (scripts + devDependencies); `pnpm-workspace.yaml` catalog; `pnpm-lock.yaml` (wave 0 only); `packages/*/vitest*.config.ts` (browser instances only); `examples/*/playwright.config.ts` (projects only); `examples/react-vite/vite.config.ts` (the `TOOLMARK_DIST` switch only); `packages/*/package.json` (metadata fields, `files`, `peerDependenciesMeta`; never `version`); `packages/*/LICENSE` | M4 |
| 1 | B (normal) | 3, 3b | TSDoc comment text in `packages/*/src/**` (comments only); `typedoc.json`; `docs/.vitepress/config.ts`; `docs/guides/**`; `docs/policies/**`; `docs/index.md`; `scripts/check-docs.mjs` + `scripts/check-docs.test.mjs`; `.github/workflows/docs.yml`; `README.md`; `SECURITY.md`; `CONTRIBUTING.md`; `CODE_OF_CONDUCT.md`; `.github/ISSUE_TEMPLATE/**`; `.github/pull_request_template.md`; `packages/*/README.md` | A |
| 1 | C (high, security) | 4 | `docs/security/**`; `scripts/check-security-review.mjs` + test | A |
| 1 | D (normal) | 6 | `.github/workflows/spec-watch.yml`, `.spec-watch/**`, `scripts/spec-watch.mjs`, `scripts/spec-watch.test.mjs` | A |
| 2 | E (high, security) | 5 | any source file named by a finding + its tests; the resolution columns of `docs/security/review-2026.md`; dependency bumps through the controller (`pnpm-lock.yaml` regenerated by `pnpm install`, never hand-edited) | C |
| 3 | F (high) | 7a–7c | `.github/workflows/release.yml`; `.changeset/**` (incl. `pre.json`, `release-1-0.md`, `config.json`); `docs/release/**`; `scripts/check-release-versions.mjs` + test; `scripts/render-round-budget.mjs` (if M1 did not create it); `packages/*/package.json` `version` and internal ranges (only through `changeset version`); `packages/*/CHANGELOG.md` (generated); `docs/ROADMAP.md` (T-M5 status at the stop) | all |

- **Serial waves.** Lanes B and E never overlap in time (waves 1 and 2). Lane B's
  `packages/*/src/**` grant covers TSDoc comment text only. If a doc gap reveals a code change, the
  lane reports it to the controller, which queues it for Lane E.
- **Wave-0 prerequisite.** Lane A's `pnpm-lock.yaml` grant ends when wave 0 merges. Wave-1 lanes add
  no dependencies. If a devDependency must be added (for example by Lane D), the controller adds it
  on the integration branch.

### Task 1: Complete the CI matrix   (Lane A, risk: normal)

**Files:** Modify `.github/workflows/ci.yml`, `packages/*/vitest*.config.ts` (browser `instances`
for chromium/firefox/webkit), `examples/react-vite/playwright.config.ts` (projects for all three
browsers; `webmcp` project chromium only), root `package.json` (`test:all` script). Create
`.github/dependabot.yml`.

**Exact values:** the matrix, version swap, hardening and action pins from Global constraints; the
`zod3` job and its test glob. The glob is the converter-test naming that M1 established, which the
lane reads from M1 T3/T6 and writes into `ci.yml` verbatim. Triggers: `pull_request` (branches
`[main]`), `push`, and `schedule: cron '0 3 * * *'`, with the reduced push cell described in the
rulings. Root script:
`"test:all": "pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm quality && pnpm -r --filter \"./examples/*\" run e2e"`.

**Behaviour:**
- The matrix cells run exactly the projects listed in Global constraints. Each cell's job name
  encodes its axes, for example `unit (node 24, react 18.3.1, inertia 2.3.28)`, so branch protection
  can name them.
- The browser axis runs each DOM project once per browser, selecting the Vitest 5 browser instance
  with the filter confirmed in pre-flight. It also runs `playwright test --project=<browser>` for
  `examples/react-vite`. WebMCP specs run in the chromium project only.
- The Laravel and Next.js example jobs (M4) stay chromium-only and are verified present.
  `types-ts7` from M1 stays. The `smoke` job (Task 2) adds the packed-tarball checks under both
  resolutions.
- Playwright browsers are cached with `actions/cache` keyed on the Playwright version. `concurrency`
  cancels superseded runs.
- Dependabot: the `github-actions` and `npm` ecosystems run weekly. npm updates are grouped by dev
  tooling, and `@toolmark/*` is ignored.

**Tests:** `check_workflows_rejects_unpinned_action` (from Task 2's script, run on a fixture). CI
green on the lane branch for every job.

**Task gate:** `node scripts/check-workflows.mjs .github/workflows/ci.yml`, then push the branch.
Every `ci.yml` job must be green (`gh run view --json jobs`).

---

### Task 2: Package metadata and quality gates   (Lane A, risk: normal)

**Files:**
- Create: `scripts/check-zero-deps.mjs`, `scripts/check-package-meta.mjs`,
  `scripts/check-no-app-code.mjs`, `scripts/check-workflows.mjs`, and a `*.test.mjs` per script with
  fixtures under `scripts/fixtures/**`; `.size-limit.json`; `packages/<name>/LICENSE` (a copy of the
  root `LICENSE`) for all 8.
- Modify: `packages/*/package.json` (metadata), `scripts/tarball-smoke.mjs`, root `package.json`
  (`quality`, `size`, and devDeps `publint` 0.3.24, `@arethetypeswrong/cli` 0.18.5, `size-limit` +
  `@size-limit/preset-small-lib` 14.0.0), `examples/react-vite/vite.config.ts` (the `TOOLMARK_DIST`
  switch), `ci.yml` (`quality` and `smoke` jobs).

**Exact values** (every `packages/<name>/package.json`):
- `"license": "MIT"`, `"author": "adams100111"`
- `"repository": { "type": "git", "url": "git+https://github.com/adams100111/toolmark.git", "directory": "packages/<name>" }`
  (npm provenance requires this exact URL)
- `"homepage": "https://github.com/adams100111/toolmark/tree/main/packages/<name>#readme"`
- `"bugs": { "url": "https://github.com/adams100111/toolmark/issues" }`
- `"keywords"`: `["toolmark","ai","agents","llm","tools"]` plus package-specific terms (core adds
  `"webmcp","mcp"`, react adds `"react","hooks"`, inertia adds `"inertia","laravel"`, and so on).
- `"description"`: one line. Core's description mentions "experimental WebMCP adapter".
- `"publishConfig": { "access": "public", "provenance": true }`
- `"files": ["dist", "src", "CHANGELOG.md"]`. npm always includes `README.md`, `LICENSE` and
  `package.json`.
- `"engines": { "node": ">=22.12" }`
- Optional peers have `peerDependenciesMeta.<peer>.optional: true`.

**Behaviour:**
- `pnpm quality`:
  1. Packs every package into `.quality/` with
     `pnpm -r --filter "./packages/*" pack --pack-destination "$PWD/.quality"`.
  2. For each tgz, runs `publint run <tgz> --strict` and `attw <tgz> --profile esm-only` (flags as
     verified in pre-flight).
  3. Runs `size-limit`, `check-zero-deps`, `check-package-meta .quality`, `check-no-app-code` and
     `check-workflows`.

  `.quality/` and `dist-tarballs/` are git-ignored; M1 created `.gitignore`, and the lane adds
  `.quality/` to it.
- `check-zero-deps`:
  - Fails if `packages/core/package.json` has any `dependencies` entry.
  - Fails if the built core root entry imports any bare specifier.
  - Fails if any other built core subpath imports anything except a declared optional peer
    (`@opentelemetry/api`, `@mcp-b/webmcp-polyfill`) that has `peerDependenciesMeta.*.optional: true`.
- `check-package-meta`:
  - Fails on any missing field above, or on a `repository.url`/`directory` mismatch.
  - Fails if an `exports` subpath (except `./package.json`) has no `.size-limit.json` entry.
  - Fails if a tarball lacks `package/LICENSE`, `package/README.md` or a `dist/` file named in
    `exports`/`bin`, or its `package.json` still contains `workspace:`.
- `check-no-app-code`: applies the pattern from the rulings.
- `check-workflows`: for every `.github/workflows/*.yml`, checks the hardening list in Global
  constraints. It uses a YAML parse via `yaml`, which is a root devDependency if M1 did not add it.
- `tarball-smoke.mjs` (extend, keep its CLI):
  - Its TS 6.0.3 and 7.0.2 type-check runs twice, with
    `{ "module": "nodenext", "moduleResolution": "nodenext" }` and
    `{ "module": "preserve", "moduleResolution": "bundler" }`.
  - Neither run sets `customConditions`, so the smoke proves consumers never need
    `@toolmark/source`.
  - It accepts a second tarball directory argument.
- `examples/react-vite/vite.config.ts`: when `process.env.TOOLMARK_DIST === '1'`, it omits
  `@toolmark/source` from `resolve.conditions` and `ssr.resolve.conditions`.
- Limits are measured with `pnpm build && pnpm size-limit --json` and committed in the same commit.

**Tests:**
- `check_zero_deps_fails_on_added_dependency`: fixture core with `dependencies: { x: '1' }` → exit 1.
- `check_zero_deps_allows_optional_peer_in_subpath`: fixture `otel` entry importing
  `@opentelemetry/api` (optional peer) → exit 0; a non-optional peer → exit 1.
- `check_package_meta_rejects_wrong_repository_url`: fixture with url `https://github.com/x/y` →
  exit 1 naming the field.
- `check_package_meta_rejects_tarball_without_license`: fixture tgz → exit 1.
- `check_package_meta_rejects_workspace_protocol_in_tarball`: fixture tgz → exit 1.
- `check_no_app_code_flags_innovation`: fixture src containing `Innovation` → exit 1.
- `check_workflows_rejects_unpinned_action`: fixture `uses: actions/checkout@v7` → exit 1.
- `check_workflows_rejects_missing_top_level_permissions`: fixture → exit 1.
- `smoke_typechecks_bundler_and_nodenext`: existing smoke test extended; a fixture tarball whose
  `types` resolve only under `bundler` → nodenext failure reported.

**Task gate:** `node --test scripts/*.test.mjs && pnpm build && pnpm quality &&
pnpm -r --filter "./packages/*" pack --pack-destination "$PWD/dist-tarballs" &&
node scripts/tarball-smoke.mjs dist-tarballs`

---

### Task 3: TSDoc gap-fill, then strict TypeDoc   (Lane B, risk: normal)

**Files:** Modify TSDoc comments in `packages/*/src/**` (comments only), `typedoc.json`,
`docs/.vitepress/config.ts`, and root `package.json` via the controller (`docs:check` script; Lane A
owns the file, so the controller applies the one-line script add at wave-1 merge). Create
`scripts/check-docs.mjs` and `scripts/check-docs.test.mjs`.

**Exact values:**
- `typedoc.json`: `"treatWarningsAsErrors": true`,
  `"validation": { "notDocumented": true, "invalidLink": true, "notExported": true }`. `entryPoints`
  = every `exports` subpath of every package, including `testing/vitest`, `testing/page`,
  `mcp/client`, `tour/overlay`, `tour/react`, `core/{bridge,dom,webmcp,otel}`. The workspace TS stays
  6.0.3 (typedoc caps at 6.0.x).
- VitePress `base: '/toolmark/'` (GitHub project Pages). `srcExclude` keeps
  `['superpowers/**','ROADMAP.md','release/**','security/**']`.
- Sidebar entries for `docs/policies/*` and `docs/reference/codes.md`.

**Behaviour:**
- Step 1 (gap-fill): run TypeDoc with `notDocumented` on, collect every warning, and write the
  missing TSDoc. Each comment needs a one-line summary, `@param`/`@returns` where non-obvious, and
  `@experimental` on every `core/webmcp` export. Then switch `typedoc.json` to strict.
- `check-docs.mjs` fails unless all of these hold:
  - These files exist and are reachable from the sidebar:
    - `docs/guides/{react,inertia,nextjs,webmcp,mcp,tours}.md`
    - `docs/guides/laravel-reference.md`
    - `docs/policies/{versioning,deprecation,tool-names}.md`
    - `docs/reference/codes.md`
  - Every `packages/*/README.md` exists and links the docs site.
  - The word "experimental" appears in the core `./webmcp` entry's TSDoc (`@experimental`), the
    `docs/guides/webmcp.md` banner, and `packages/core/package.json` `description` (D28).
  - `docs/guides/inertia.md` states "Inertia 3 requires React 19".

**Tests:** `check_docs_fails_on_missing_guide` and `check_docs_fails_without_experimental_label`
(fixture dirs).

**Task gate:** `node --test scripts/check-docs.test.mjs && pnpm docs:build && pnpm docs:check`.
TypeDoc must report zero warnings.

---

### Task 3b: Policies, community files, READMEs, docs deploy   (Lane B, risk: normal)

**Files:** Create or complete:
- `README.md`
- `SECURITY.md`
- `CONTRIBUTING.md`
- `CODE_OF_CONDUCT.md`
- `docs/policies/versioning.md`
- `docs/policies/deprecation.md`
- `docs/policies/tool-names.md`
- `.github/ISSUE_TEMPLATE/{bug,feature}.yml`
- `.github/pull_request_template.md`
- `.github/workflows/docs.yml`
- every `packages/*/README.md`

**Exact values:**
- `SECURITY.md`:
  - Reporting goes only through GitHub private vulnerability reporting
    (`https://github.com/adams100111/toolmark/security/advisories/new`).
  - Supported versions: `1.x`.
  - Acknowledgement target: 5 working days.
  - Scope: the §14 surfaces.
- `CODE_OF_CONDUCT.md`: Contributor Covenant 2.1; contact via the same advisory link or the owner's
  GitHub profile.
- `docs.yml`:
  - Triggers: `push` to `main` + `workflow_dispatch`.
  - Top-level `permissions: {}`. Build job: `contents: read`. Deploy job:
    `pages: write, id-token: write`, `environment: github-pages`.
  - The deploy job has `if: ${{ !github.event.repository.private }}`, so it is a no-op until the
    repo is public.

**Behaviour:**
- `versioning.md`:
  - Semver scope per §17: the public API list; WebMCP is experimental (D28), and its changes may
    ship in minors.
  - `@toolmark/source` and the shipped `src/` are internal and outside semver.
  - Changesets `fixed` release train; changelog location (per-package `CHANGELOG.md` + GitHub
    releases).
  - Supported Node (`>=22.12`), React (`>=18.3`; Inertia 3 needs React 19) and TypeScript (6.0,
    7.0) versions.
- `deprecation.md`:
  - A deprecation warns (dev-only `console.warn` and a TSDoc `@deprecated`) for at least one minor
    version before removal in the next major.
  - Deprecations are listed in the changeset and the changelog.
  - Protocol v1 message changes need a new protocol version.
- `tool-names.md`: tool names and `llmName` are a public contract of the app. It covers the rename
  guidance and the name regex.
- `CONTRIBUTING.md`:
  - pnpm setup and the root scripts (`test:all`).
  - Conventional Commits.
  - A changeset for every user-facing change; pre mode is removed after 1.0.
  - TSDoc on every export.
  - Security reports go to `SECURITY.md`, not issues.
- The PR template has a changeset checkbox, a TSDoc checkbox and a "security-relevant?" checkbox.
- Each package README has:
  - Install, a minimal example, and a link to its guide and API page.
  - The line "ESM only; Node ≥ 22.12; React ≥ 18.3 (Inertia 3 requires React 19)", where relevant.
  - For core, the experimental WebMCP note.
- The root README states the "one declaration, every agent" pitch, links to the packages and docs,
  and links the policies.

**Tests:** covered by `check-docs` (Task 3) and `check-workflows` (Task 2) over `docs.yml`.

**Task gate:** `pnpm docs:build && pnpm docs:check && node scripts/check-workflows.mjs .github/workflows/docs.yml`

---

### Task 4: Security review   (Lane C, risk: high, security)

**Files:** Create `docs/security/threat-model.md`, `docs/security/review-2026.md`,
`scripts/check-security-review.mjs` + `scripts/check-security-review.test.mjs`.

**Behaviour:** A reviewer on the most capable model audits the code at the wave-0 merge SHA, which
it records in the report. For each checklist item it writes a verdict (`pass` / `finding`) with
file:line or test-name evidence. Checklist, covering every bullet of spec §14 plus the added
surfaces:
1. **No code execution:** no `eval`/`new Function`/string timers in `packages/*/src` and built
   `dist` (ESLint rules + grep of `dist`); only registered tools with validated input run.
2. **Server is the authority:** the Laravel reference in `examples/inertia-laravel` re-validates
   server-declared tools server-side; docs say client policy is UX only.
3. **Prompt injection:**
   - `untrustedContent` propagates to bridge results, WebMCP, and MCP (description note, the
     `[untrusted page content]\n` prefix, and `_meta['toolmark/untrustedContent']`).
   - Descriptions come only from code, server props or app-authored markup.
   - `data-tool-ignore`, `contenteditable`, `iframe` and `template` subtrees are not scanned.
4. **Untrusted input paths:** `__proto__`/`prototype`/`constructor` segments and undeclared paths
   are rejected in fill, wizard, arrays and props tools.
5. **Bridge (§12.2 MUSTs):** addressing, id binding, duplicate handling, deadlines, and bounded
   inbound message size. `postMessage` checks origin and source. The Laravel reference is covered.
6. **MCP pairing:**
   - Code entropy, expiry, consume and re-issue.
   - Unpaired `tools/list` shows only `toolmark_pairing`.
   - Session-token storage and resume; a superseded page gets a terminal close code and does not
     loop reconnecting.
   - Origin allow-list, a missing `Origin` → 403, loopback-only binding, and frames bound to the
     paired `clientId`.
   - stdout purity on stdio; `--call-timeout` → protocol `cancel`.
7. **Files:**
   - URL fetch is off by default, with allow-listed origins and `https:` only.
   - No userinfo, `credentials: 'omit'`, `redirect: 'error'`, no referrer, `no-store`, and a
     timeout.
   - Size and MIME limits also apply to `ref` files; file values are JSON-safe.
8. **Timeouts and cancellation:**
   - Every `tm.call` path honours `signal`; the bridge `cancel` works.
   - A tool that ignores abort is abandoned after the grace period, releases its scope queue slot,
     and emits `late_result`.
   - Inline confirmations are bounded by the signal and the expiry; deferred confirmations expire at
     600000 ms and are dropped on scope disposal.
   - No unbounded `await` exists (evidence: tests or file:line).
9. **Development vs production:** every misconfiguration class in `docs/reference/codes.md` throws in
   development and emits `error` in production (enumerated with evidence). The test hook is absent
   from production builds, and the tool budget is dev-only.
10. **Privacy:** password, `cc-*` and app-declared sensitive fields are excluded or `'[redacted]'` in
    `state()`, manifests, `fill` `changes`/`skipped`, confirmation payloads and telemetry. OTel
    records no inputs or results by default.
11. **Confirmation cannot be bypassed:**
    - Policy semantics hold, including `policy[c].tools` deny-wins.
    - `consequential`/`destructive` handling, the deferred and inline paths, and single-use
      `confirmId`.
    - `confirmPending` with edited input is re-validated, and expiry is enforced.
    - `invalid_confirm_mode` is raised; `ctx.confirm` returns `confirmation_unavailable`.
    - Navigation is GET-only; a submitting button is consequential; wizard submit validates every
      step.
12. **Tooling surfaces:**
    - `toolmark lint --judge <module>` loads only the explicitly named module, documented as code
      execution; `--url` uses a fresh browser context.
    - The TypeSafe judge sends only names, descriptions and schema keys (documented egress).
    - `@toolmark/mcp` has no install scripts and pins its `ws`/SDK ranges.
13. **CI and supply chain:**
    - `node scripts/check-workflows.mjs` passes, and no workflow executes PR code with secrets.
    - `release.yml` publishes only from `npm-release` behind the repo variable (reviewed again after
      Task 7a).
    - No package has lifecycle scripts except `prepack`, if any.
    - `pnpm audit --prod --audit-level high` and `composer audit` (in `examples/inertia-laravel`)
      are clean, or each finding is documented.
14. **D3 / non-goals:** `check-no-app-code` passes, and no runtime package imports an AI SDK.

Findings are classified Critical / Important / Minor, with ids `SEC-<n>`. They go in a findings
table (`id | severity | item | summary | evidence | resolution | commit | regression test`); Task 5
fills the last three columns. `threat-model.md` lists assets, trust boundaries (page ↔ agent, page ↔
MCP server, app ↔ server, CI ↔ npm) and the item that covers each.

**Tests:** `check_security_review_requires_all_items`: a fixture report missing item 8 → exit 1.
`check_security_review_rejects_open_finding`: a fixture with a Critical finding without resolution
→ exit 1 in `--resolved` mode, exit 0 in the default mode.

**Task gate:** `node --test scripts/check-security-review.test.mjs && node scripts/check-security-review.mjs docs/security/review-2026.md`.
All 14 items must have verdicts, and the controller ledgers the findings.

---

### Task 5: Security findings resolution   (Lane E, risk: high, security)

**Files:** whatever the findings name, plus a regression test per finding; the resolution columns of
`docs/security/review-2026.md`.

**Behaviour:**
- Every Critical and Important finding is fixed with a failing-first regression test named
  `sec_<n>_<short>`.
- Each Minor finding is fixed the same way, or `accepted` with a written rationale and a follow-up
  issue link.
- A new public export gets TSDoc in the same commit (strict TypeDoc is on).
- A dependency bump goes through the controller (`pnpm install`, then `pnpm audit --prod
  --audit-level high` again).
- There is a scoped re-review of every Critical and security fix (sdd-lanes rule) on the most
  capable model. The re-reviewer signs off in the report per finding.

**Tests:** one `sec_<n>_*` per fixed finding (written first; red before the fix).

**Task gate:** `pnpm test:all && pnpm docs:build && node scripts/check-security-review.mjs --resolved docs/security/review-2026.md`,
and every re-review is clean.

---

### Task 6: Spec-watch and weekly audit workflow   (Lane D, risk: normal)

**Files:** Create `.github/workflows/spec-watch.yml`, `scripts/spec-watch.mjs`,
`.spec-watch/state.json`; Test `scripts/spec-watch.test.mjs` (fixtures under `.spec-watch/fixtures/`).

**Exact values:**
- Triggers:
  - `schedule: cron '0 6 * * 1'` (Mondays 06:00 UTC)
  - `workflow_dispatch`
  - `pull_request` with
    `paths: ['.github/workflows/spec-watch.yml','scripts/spec-watch.mjs','.spec-watch/**']`
- Watched sources:
  - `https://raw.githubusercontent.com/webmachinelearning/webmcp/main/index.bs`
  - `https://raw.githubusercontent.com/webmachinelearning/webmcp/main/implementation-status.md`
  - `https://raw.githubusercontent.com/webmachinelearning/webmcp/main/declarative-api-explainer.md`
- Permissions: top-level `permissions: {}`. The `watch` job gets
  `{ contents: write, issues: write, pull-requests: write }`. The `canary` and `wpt` jobs get
  `{ contents: read, issues: write }`, and the `audit` job gets `{ contents: read, issues: write }`.
- `SPEC_WATCH_DRY_RUN=1` on `pull_request` runs, and until Task 7d flips the default.

**Behaviour:**
- `watch` job: `spec-watch.mjs` fetches each source and compares its SHA-256 with `state.json`.
  - On a change it opens, or updates, the issue `WebMCP spec changed: <file>` with a unified-diff
    excerpt (`gh issue create/edit`).
  - It then commits the new hashes on branch `spec-watch/<date>` and opens a PR.
  - In dry-run mode it prints the would-be issue and makes no `gh` writes.
- `canary` job (`continue-on-error: true`, never required): runs the M3 WebMCP suites and
  `e2e/webmcp.spec.ts` on the latest Chrome Canary.
  - It uses the switch behind `chrome://flags/#enable-webmcp-testing`. Look up the Chromium
    `about_flags` entry at execution and record it in the workflow.
  - **Fallback:** if no stable switch exists, it runs the polyfill suite on Canary and reports WPT
    as `skipped: no switch`.
  - On failure it opens the issue `WebMCP adapter failing on Chrome Canary`.
- `wpt` job (informational, `continue-on-error: true`): sparse checkout of `webmcp/` from
  `web-platform-tests/wpt`, then `./wpt run chrome_canary webmcp` with the same switch. It reports
  results and never blocks.
- `audit` job: `pnpm audit --prod --audit-level high`. On failure it opens or updates the issue
  `Dependency audit: high severity`.

**Tests:** `spec_watch_detects_change_and_formats_issue` (fixture files + stubbed `gh` on `PATH`);
`spec_watch_dry_run_makes_no_gh_writes`.

**Task gate:** `node --test scripts/spec-watch.test.mjs && node scripts/check-workflows.mjs .github/workflows/spec-watch.yml`,
and the PR-triggered dry-run run is green. **Lane exit (after merge to `main`):**
`gh workflow run spec-watch.yml --ref main` succeeds in dry-run mode.

---

### Task 7a: Release workflow and dry run   (Lane F, risk: high)

**Files:** Create `.github/workflows/release.yml`, `scripts/check-release-versions.mjs` +
`scripts/check-release-versions.test.mjs`; Modify `.changeset/config.json` (verify it has
`"fixed": [["@toolmark/*"]]`, `"privatePackages": { "version": false, "tag": false }`,
`"access": "public"`, and
`"changelog": ["@changesets/changelog-github", { "repo": "adams100111/toolmark" }]`).

**Exact values** (changesets split-job pattern, `changesets/action@v2` sub-actions, SHA-pinned):
- Triggers: `push` to `[main]`, `workflow_dispatch`, and `pull_request` to `[main]` (the
  `release-dry-run` job only).
- Top-level `permissions: {}`; `concurrency: release-${{ github.ref }}` (no cancel).
- Jobs (every job: checkout with `persist-credentials: false`, pnpm + setup-node, `pnpm install
  --frozen-lockfile`):
  - `select-mode` (`changesets/action/select-mode@v2`; `contents: read`).
  - `version`: runs when mode is `version` (`changesets/action/version@v2`; `contents: write`,
    `pull-requests: write`); opens the version PR for future releases.
  - `pack`: runs when mode is `publish`. It runs `pnpm build`, then `changesets/action/pack@v2`, and
    uploads the pack dir as an artifact.
  - `publish`:
    - Condition:
      `if: needs.select-mode.outputs.mode == 'publish' && vars.TOOLMARK_PUBLISH_ENABLED == 'true' && github.event_name != 'pull_request'`.
    - `environment: npm-release`; `runs-on: ubuntu-latest` (GitHub-hosted, required for OIDC).
    - Node `24.x`, `package-manager-cache: false`, `registry-url: 'https://registry.npmjs.org'`.
    - `permissions: { contents: write, id-token: write }`; env `NPM_CONFIG_PROVENANCE: 'true'`.
    - First step:
      `test ! -f .changeset/pre.json || { echo "pre mode: refusing to publish"; exit 1; }`.
    - Second step: `node scripts/check-release-versions.mjs --stable`.
    - Then the publish path from the rulings, with `create-github-releases: true`.
    - If the environment secret `NPM_BOOTSTRAP_TOKEN` is non-empty, the step exports
      `NODE_AUTH_TOKEN` from it; otherwise it relies on OIDC.
  - `release-dry-run` (on `pull_request` and `workflow_dispatch`): runs the steps under Tests.
- `check-release-versions.mjs` modes:
  - `--pre next`: all 8 `@toolmark/*` versions are equal and match `^1\.0\.0-next\.\d+$`.
  - `--exact 1.0.0`: all 8 are exactly `1.0.0`.
  - `--stable`: all 8 are equal, with no prerelease tag.
  - `--tarballs <dir>`: every `@toolmark/*` dependency inside the packed `package.json` files is a
    concrete version or range equal to the package version; no `workspace:`.

**Behaviour:**
- The publish path decision (ruling) is verified from changesets source/docs, not assumed, and
  goes in the ledger with the source link.
- Nothing in `release.yml` can publish from a pull request, in pre mode, with a prerelease version,
  or without the owner-set variable and the owner-approved environment.

**Tests:**
- `check_release_versions_rejects_mixed_versions`: fixture with core `1.0.0`, react
  `1.0.0-next.3` → `--stable` exits 1.
- `check_release_versions_rejects_workspace_ranges`: fixture tgz with `workspace:^` → exit 1.
- `release-dry-run` job:
  1. `pnpm build`.
  2. `pnpm changeset publish-plan --output publish-plan.json` (flags per pre-flight).
  3. `pnpm changeset pack --from-publish-plan publish-plan.json --out-dir dist-pack`.
  4. For each tgz, `npm publish <tgz> --dry-run --access public`.
  5. `node scripts/check-release-versions.mjs --tarballs dist-pack`.
  6. `node scripts/tarball-smoke.mjs dist-pack`.
  7. `publint run <tgz> --strict` and `attw <tgz> --profile esm-only` per tgz.

  On a pre-mode branch, the plan lists all 8 packages at the current `-next` version.

**Task gate:** `node --test scripts/check-release-versions.test.mjs && node scripts/check-workflows.mjs .github/workflows/release.yml`,
and the PR-triggered `release-dry-run` job is green. Task 4 item 13 is re-reviewed over
`release.yml` (security re-review, most capable model).

---

### Task 7b: Release candidate and in-repo evidence   (Lane F, risk: high)

**Files:** Create `.changeset/release-1-0.md`, `docs/release/checklist.md`,
`scripts/render-round-budget.mjs` (only if M1/M2 left no renderer); Modify
`docs/release/next-tarballs.md` (RC entry), `docs/release/round-budget.md` (regenerated),
`packages/*/package.json` versions and `packages/*/CHANGELOG.md` (through `changeset version` only).

**Exact values:** `.changeset/release-1-0.md` frontmatter sets `major` for `"@toolmark/core"`,
`"@toolmark/react"`, `"@toolmark/inertia"`, `"@toolmark/testing"`, `"@toolmark/tour"`,
`"@toolmark/mcp"`, `"@toolmark/lint"`, `"@toolmark/judge-typesafe"`; body `First stable release.`

**Behaviour** (each step's command and output pasted into `checklist.md`):
1. On `main` after waves 0–2: `pnpm test:all` green, CI green for the `main` SHA, all other §21
   gate rows green (see the gate table).
2. Add `release-1-0.md` and run `pnpm changeset version`, still in pre mode `next`. Then
   `node scripts/check-release-versions.mjs --pre next` → all 8 at the same `1.0.0-next.<n>`. Commit
   `chore(release): 1.0.0 release candidate`.
3. Pack and smoke:
   - `pnpm build && pnpm -r --filter "./packages/*" pack --pack-destination "$PWD/dist-tarballs"`
   - `node scripts/tarball-smoke.mjs dist-tarballs`
   - `node scripts/check-release-versions.mjs --tarballs dist-tarballs`

   Append the RC entry (version, filenames, SHA-256, smoke result) to `next-tarballs.md`.
4. Run the evidence on built `dist`:
   - `TOOLMARK_DIST=1 ROUND_BUDGET_REPORT=$PWD/.quality/round-budget.json pnpm -F @toolmark-examples/react-vite exec playwright test e2e/round-budget.spec.ts`
     → both tests green. Render `docs/release/round-budget.md` from the JSON: simple form ≤ 3
     rounds, wizard ≤ 5, zero `invalid`/`refused`, manifest and describe bytes, wall time, RC
     version, commit SHA.
   - `TOOLMARK_DIST=1 pnpm -F @toolmark-examples/react-vite exec playwright test e2e/same-tools.spec.ts e2e/tour.spec.ts --project=chromium --project=firefox --project=webkit`
     (same-tools' WebMCP leg on chromium) → green.
5. Review the pre-mode changesets listed in `.changeset/pre.json` `changesets`. Reword or remove
   entries that only fix earlier `-next` builds, so the 1.0.0 changelog reads as a first release.
   Commit `docs(changeset): tidy 1.0.0 changelog entries`.

Any failure in steps 2–4 stops the release. The fix goes back to the owning wave, and Task 7b
reruns from step 3.

**Tests:** the evidence runs above; `render_round_budget_fails_over_budget` (fixture JSON with 4
rounds for the simple form → exit 1), if the renderer is created here.

**Task gate:** every `checklist.md` row for §21 gates 1–7 (gate table below) has pasted evidence,
dated.

---

### Task 7c: Version 1.0.0, owner hand-off, stop   (Lane F, risk: high)

**Files:** Modify `.changeset/pre.json` (removed by `pre exit`), `packages/*/package.json`,
`packages/*/CHANGELOG.md`, `docs/release/checklist.md`, `docs/ROADMAP.md` (T-M5 status + log line).
Create `docs/release/owner-handoff.md`.

**Behaviour:**
1. Run `pnpm changeset pre exit && pnpm changeset version`, then
   `node scripts/check-release-versions.mjs --exact 1.0.0`, then rerun the Task 7b step 3 smoke on
   freshly packed 1.0.0 tarballs. Commit `chore(release): version packages 1.0.0`.
2. Open the M5 PR and merge it to `main` (`gh pr merge --merge --delete-branch`) after CI and the
   `release-dry-run` job are green on it. On `main`, `release.yml` runs `select-mode` → `publish`,
   and the publish job is **skipped** because `TOOLMARK_PUBLISH_ENABLED` is unset. Record that run's
   URL in `checklist.md` as proof that nothing published.
3. Write `docs/release/owner-handoff.md` with the `main` SHA, the exact job names for branch
   protection (read from the last green `ci.yml` run), and the owner steps O-a…O-l from the "Owner
   hand-off" section below, verbatim, each with a checkbox.
4. Set ROADMAP `T-M5` to `owner (publish)`, add a Log line, commit
   `docs(release): owner hand-off for 1.0.0`, push, and **stop**. The controller resumes only on the
   owner's message that step O-j finished. It approves nothing and sets no secret or variable.

**Tests:** n/a (process step). `check-release-versions --exact 1.0.0` and the smoke are the checks.

**Task gate:** `owner-handoff.md` exists on `main`; the `release.yml` run on the 1.0.0 SHA shows
`publish` skipped; ROADMAP says `owner (publish)`.

---

### Task 7d: Post-publish verification   (controller, after the owner; risk: high)

**Files:** Modify `docs/release/checklist.md`, `.github/workflows/spec-watch.yml` (drop the default
`SPEC_WATCH_DRY_RUN` for scheduled runs), `docs/ROADMAP.md`.

**Behaviour:**
- For each of the 8 packages, check:
  - `npm view @toolmark/<pkg>@1.0.0 version` → `1.0.0`
  - `npm view @toolmark/<pkg> dist-tags.latest` → `1.0.0`
  - `npm view @toolmark/<pkg>@1.0.0 dist.attestations.provenance.predicateType` →
    `https://slsa.dev/provenance/v1`
- In a fresh temp dir:
  `npm init -y && npm i @toolmark/{core,react,inertia,testing,tour,mcp,lint,judge-typesafe}@1.0.0 react@19.3.0 react-dom@19.3.0 && npm audit signatures`
  → verified registry signatures and attestations for all 8. Paste the outputs into `checklist.md`.
- Confirm that changesets pushed the tags `@toolmark/<pkg>@1.0.0` and created GitHub releases. With
  the owner's go-ahead in the same message, create the umbrella tag `v1.0.0` and a GitHub release
  linking the eight.
- Confirm the docs site is live (`curl -fsS https://adams100111.github.io/toolmark/policies/versioning`
  → 200) after the owner enabled Pages.
- Spec-watch goes live: switch scheduled runs to non-dry-run, then run
  `gh workflow run spec-watch.yml --ref main`.
- Confirm that the owner revoked the bootstrap token and deleted `NPM_BOOTSTRAP_TOKEN` (owner-handoff
  O-k ticked). Set ROADMAP `T-M5` to `done`.

**Task gate:** every row in `checklist.md` has pasted evidence; `npm audit signatures` is clean.

---

## §21 gate → task → runnable check

| §21 gate | Task | Runnable check |
| --- | --- | --- |
| 1. Unit/DOM/contract/E2E suites green on the matrix (Node 22/24; React 18.3/19 × Inertia 2/3 excl. 18.3 × 3; zod 4 + zod 3 converter axis; Chromium/Firefox/WebKit; WebMCP, Laravel, Next on Chromium) | T1 | `gh run list --workflow ci.yml --branch main --limit 1 --json conclusion,headSha` → `success` for the RC SHA, with every matrix job listed by `gh run view <id> --json jobs` |
| 2. Bundle budgets enforced; core zero runtime deps | T2 | `pnpm build && pnpm size-limit`; `node scripts/check-zero-deps.mjs`; `node --test scripts/check-zero-deps.test.mjs` |
| 3. Every public export documented; API reference; guides (React, Inertia, Next.js, Laravel reference, WebMCP, MCP, tours) | T3 (+T3b) | `pnpm docs:build` (TypeDoc strict, zero warnings) and `pnpm docs:check` |
| 4. Security review against §14 completed, findings resolved | T4, T5 | `node scripts/check-security-review.mjs --resolved docs/security/review-2026.md`; `pnpm test:all`; re-review sign-offs in the report |
| 5. §17 metadata (LICENSE, README, repository+directory, homepage, bugs, keywords, provenance; publint, `attw --profile esm-only`) | T2 | `pnpm quality` (`check-package-meta`, publint `--strict`, attw `esm-only` on packed tarballs) |
| 6. Changesets release with npm provenance via the §17 path; changelog and deprecation policy published | T7a, T7c, T7d, T3b | `release-dry-run` job green; publish job skipped until the owner acts; after the owner: `npm view … dist.attestations.provenance.predicateType`, `npm audit signatures`; `CHANGELOG.md` inside each tgz (`check-package-meta`); `curl` of the deployed `policies/versioning` and `policies/deprecation` pages |
| 7. In-repo RC evidence: tarball smoke on the RC; round budget meets SC1; same-tools + tours e2e green | T7b | `node scripts/tarball-smoke.mjs dist-tarballs`; `TOOLMARK_DIST=1 … playwright test e2e/round-budget.spec.ts` → `docs/release/round-budget.md`; `TOOLMARK_DIST=1 … playwright test e2e/same-tools.spec.ts e2e/tour.spec.ts` (3 browsers) |
| 8. WebMCP WPT informational; the adapter's own Chromium WebMCP suites gate | T1, T6 | chromium `webmcp` jobs in `ci.yml` (required); `wpt` job in `spec-watch.yml` (`continue-on-error`) |
| 9. Post-release weekly spec-watch | T6, T7d | `node --test scripts/spec-watch.test.mjs`; PR dry-run green; `gh workflow run spec-watch.yml --ref main` |
| SC4 / D3: no app-specific code | T2 | `node scripts/check-no-app-code.mjs` (in `pnpm quality`) |
| D28: WebMCP stays experimental | T3 | `pnpm docs:check` (experimental label check) |

## Owner hand-off (copied verbatim into `docs/release/owner-handoff.md` by Task 7c)

The controller stops before these steps. The owner runs them in order and messages the controller
after O-j. None of them may be run by an agent.

- **O-a · IP check:** confirm code ownership and employment IP terms (spec §22). If this fails,
  stop: nothing below runs.
- **O-b · npm org:** create the npm org `toolmark` on the owner's account, with account 2FA on.
- **O-c · Go public:** `gh repo edit adams100111/toolmark --visibility public --accept-visibility-change-consequences`.
  Provenance and required-reviewer environments need a public repo on the free plan.
- **O-d · Repo settings:**
  - Settings → Actions → General: enable "Allow GitHub Actions to create and approve pull
    requests", and set workflow permissions to "Read repository contents".
  - Settings → Code security: enable private vulnerability reporting, Dependabot alerts, and secret
    scanning with push protection.
  - Settings → Pages: source "GitHub Actions".
  - Then run `gh workflow run docs.yml --ref main`.
- **O-e · Branch protection on `main`:** require the `ci.yml` and `release.yml` job names listed in
  `owner-handoff.md`, require PRs, and block force-pushes.
- **O-f · Environment:** Settings → Environments → `npm-release`:
  - Required reviewer: the owner only. Do not enable "prevent self-review", because the owner
    account pushes the release commit.
  - Deployment branches: `main` only.
- **O-g · Bootstrap token:** on npmjs.com, create a granular access token with read/write on the
  `@toolmark` scope (all packages), "bypass 2FA" enabled, and the shortest available expiry. Add it
  as the **environment** secret: `gh secret set NPM_BOOTSTRAP_TOKEN --env npm-release --repo adams100111/toolmark`.
- **O-h · Enable publishing:** `gh variable set TOOLMARK_PUBLISH_ENABLED --body true --repo adams100111/toolmark`.
- **O-i · Publish:** `gh workflow run release.yml --ref main`, then approve the `npm-release`
  deployment in the Actions UI after checking that the run is on the SHA in `owner-handoff.md`.
- **O-j · Trusted publishing:** with npm ≥ 11.15, for each of `core react inertia testing tour mcp
  lint judge-typesafe` run:
  `npm trust github @toolmark/<pkg> --file release.yml --repo adams100111/toolmark --env npm-release --allow-publish`.
  Use the flags as re-checked with `npm trust --help` in pre-flight and recorded in
  `owner-handoff.md`. Then message the controller: "1.0.0 published".
- **O-k · Revoke:** `gh secret delete NPM_BOOTSTRAP_TOKEN --env npm-release --repo adams100111/toolmark`,
  and revoke the token on npmjs.com (`npm token revoke <id>`). Optional hardening: for each package,
  set npm "Require two-factor authentication and disallow tokens".
- **O-l · Actions budget (O6):** until the repo is public, the private-repo matrix needs Actions
  minutes or self-hosted runners. This is only relevant if going public is delayed.

## Self-review

- **Spec coverage:**
  - §21 gates 1–9, SC4 and D28 each map to a task and a runnable check (table above).
  - §14: every bullet is a Task 4 checklist item (1–10), plus confirmation, tooling, supply chain
    and D3 (11–14), with Task 5 resolving the findings.
  - §17 versioning path → T7b/T7c: `0.0.0` → pre `next` → all-major changeset → `1.0.0-next.<n>` →
    `pre exit` → `1.0.0`, checked by `check-release-versions`.
  - §17 publishing → T7a plus owner steps O-f…O-k: bootstrap token, `npm trust` per package,
    revoke; Node 24; `npm-release`; provenance.
  - §17 metadata → T2.
  - R5 TSDoc gap-fill then strict TypeDoc → T3.
  - §22 → owner hand-off.
  - SC1 in-repo round budget on the RC → T7b.
  - Post-release spec-watch → T6/T7d.
- **Stops cleanly:** after Task 7c, all work is done except O-a…O-l. No workflow can publish without
  the owner's variable, secret and environment approval.
- **Placeholders:** execution-time facts are named with how to resolve them:
  - the Chrome WebMCP switch (with a fallback);
  - the changesets publish client;
  - the Vitest instance filter;
  - action SHAs;
  - `npm trust` flags.

  Size numbers come from a defined measurement rule.
- **Ownership:** each file belongs to one lane. `ci.yml` is Lane A's. `docs.yml` is Lane B's.
  `spec-watch.yml` is Lane D's. `release.yml`, `.changeset/**` and `docs/release/**` are Lane F's.
  `packages/*/package.json` is split by field: A owns metadata; F owns versions through
  `changeset version`, in a later wave. The root `package.json` `docs:check` script is added by the
  controller at the wave-1 merge.
- **Names:** `tarball-smoke.mjs`, `round-budget.md`, `same-tools.spec.ts`, `@toolmark/source`,
  `toolmark/untrustedContent` and `createTestToolmark` match the overview and pass-1 rulings.
