# Release checklist — 1.0.0

Evidence for the spec §21 release gates (plan `2026-09-24-toolmark-m5-release.md`, "§21 gate →
task → runnable check"). Each row names the command, the date it ran and a trimmed copy of its
output. Task 7b fills gates 1–7 on the release candidate; Task 7c adds the 1.0.0 version and the
`release.yml` run on `main`; Task 7d adds the post-publish checks.

## Release candidate

- **Version:** `1.0.0-next.4` for all eight `@toolmark/*` packages (fixed group, pre mode `next`).
- **Branch:** `m5/task-7b`, off `feat/m5-release` `599a3a9` (T7a release workflow, T5 security
  fixes).
- **Commits:** `f57494f` `feat(scripts): add --check round-budget gate to render-round-budget` ·
  `3aa8d2f` `chore(release): 1.0.0 release candidate` (RC tarballs packed here) · `98eafb0`
  `docs(changeset): tidy 1.0.0 changelog entries` (rewords `.changeset/pre/*.md` only; no packed
  file changes).
- **Environment:** macOS (Darwin 27.0.0), Node 22.23.2, pnpm 12.6.0, `npx npm@11.19.0`,
  `TOOLMARK_EXAMPLE_PORT=5174`.

## Rulings (controller, 2026-09-25)

- **Step 1 runs on the branch, not `main`.** `main` does not contain M5 yet. Step 1 ran against
  this branch's HEAD, and the CI evidence is the `feat/m5-release` run for `599a3a9`
  (run `36114346855`). That run is a branch push, so `ci.yml` ran the reduced push cell
  (`node 24 × react 19.3.0 × inertia 3.7.1`, Chromium). The full matrix (Node 22/24, React 18.3/19 ×
  Inertia 2/3, Firefox/WebKit `browser` jobs) and the PR-only `release-dry-run` job first run on
  the M5 PR to `main` (Task 7c), which must be green before merge.
- **Changelog token.** `pnpm changeset version` ran with `GITHUB_TOKEN=$(gh auth token)` for
  `@changesets/changelog-github`; the token never appears in a command line or log here.
- **Firefox cannot launch on this machine.** Playwright's Firefox (`firefox-1543`) exits at start
  with `Could not find profile folder.`, with and without the tool sandbox and with a different
  `TMPDIR`; WebKit and Chromium launch. Firefox evidence is cited from CI (see gates 1 and 7).
- **Step 5 before or after step 2.** Plan order was kept: version first, then tidy the pre-mode
  changesets. changesets 3.0.3 reads `.changeset/pre/*.md` back into the plan on `pre exit`
  (`@changesets/read` lists `pre/`; `assemble-release-plan` drops them only while
  `mode !== "exit"`), so the reworded texts are what the 1.0.0 changelog will contain.

## Gate 1 — suites green on the matrix

**Local `pnpm test:all` (2026-09-25, HEAD `f57494f`, sandbox disabled):**

```
$ TOOLMARK_EXAMPLE_PORT=5174 pnpm test:all
pnpm lint       → 8 packages: Done
pnpm typecheck  → 8 packages: Done
pnpm test       → Test Files  138 passed (173)
                       Tests  1082 passed (1082)
                      Errors  1 error
  Error: browserType.launch: Failed to launch the browser process.
  [err] Could not find profile folder.        (Firefox Vitest instances; see ruling)
rc=1
```

The only failure is Firefox failing to launch. The rest of the chain was run without the Firefox
instances:

```
$ pnpm vitest run --project '!*(firefox)'                 # 2026-09-25T08:55Z
 Test Files  1 failed | 137 passed (138)
      Tests  1 failed | 1081 passed (1082)
 FAIL |core-node| test/ssr-dom-entry.test.ts > ssr_dom_entry_imports_under_node
 Error: Test timed out in 5000ms.
$ pnpm vitest run --project core-node test/ssr-dom-entry.test.ts
 Test Files  1 passed (1)   Tests  2 passed (2)   Duration 229ms   rc=0
```

The SSR import test timed out under load (it passed in the first full run above, where all 1082
tests passed, and alone in 229 ms): load flake, not a product failure.

```
$ pnpm build && pnpm quality                               # 2026-09-25T08:56Z   rc=0
$ TOOLMARK_EXAMPLE_PORT=5174 pnpm -F @toolmark-examples/react-vite exec playwright test \
    --project=chromium --project=webkit                    # 2026-09-25
  46 passed (17.0s)                                        rc=0
```

**CI (2026-09-25):**

```
$ gh run view 36114346855 --json status,conclusion,headSha,event,jobs
completed success push 599a3a927a39b3cd5da8da5fca612fe843849dea
https://github.com/adams100111/toolmark/actions/runs/36114346855
success quality · success zod3 (node 24, zod 3.25.76) · success plan · success docs ·
success lint · success types-ts7 · success build · success example-laravel (bridge-cache database) ·
success typecheck · success example-nextjs · success example-laravel (bridge-cache redis) ·
success unit (node 24, react 19.3.0, inertia 3.7.1) · success browser (chromium)
$ gh run watch 36114346855 --exit-status   → rc=0
```

Firefox and WebKit last ran on CI in the `main` run for `b755b50` (M4, run `36109316593`, job
`e2e`, 64 passed, including all six `[firefox] tour.spec.ts` tests).

| Evidence (M5 PR to `main`, full matrix)                                                    | Status              | Run                    |
| ------------------------------------------------------------------------------------------ | ------------------- | ---------------------- |
| `ci.yml` full matrix (Node 22/24, React 18.3/19 × Inertia 2/3, zod3)                       | pending CI evidence | _fill with PR run URL_ |
| `ci.yml` `browser (firefox)`: Vitest DOM projects on Firefox and react-vite e2e on Firefox | pending CI evidence | _fill with PR run URL_ |
| `ci.yml` `browser (webkit)`                                                                | pending CI evidence | _fill with PR run URL_ |
| `release.yml` `release-dry-run`                                                            | pending CI evidence | _fill with PR run URL_ |

## Gate 2 — bundle budgets; core has zero runtime dependencies

```
$ pnpm build && pnpm size-limit                            # 2026-09-25T08:57Z   rc=0
  28 entries, each "Size: … with all dependencies, minified and gzipped" under its limit, e.g.
  @toolmark/tour/overlay  Size limit: 3.5 kB  Size: 3.17 kB
  @toolmark/tour/react    Size limit: 500 B   Size: 261 B
$ node scripts/check-zero-deps.mjs                                                   rc=0
PASS @toolmark/core: no dependencies; 10 entries import only optional peers
$ node --test scripts/check-zero-deps.test.mjs
# tests 5  # pass 5  # fail 0
```

## Gate 3 — public exports documented; API reference; guides

```
$ pnpm docs:api:strict                                     # 2026-09-25T08:58Z   rc=0
[info] markdown generated at ./docs/api                    (TYPEDOC_STRICT=1, zero warnings)
$ pnpm docs:build                                                                    rc=0
✓ rendering pages...  build complete in 6.44s.
$ node scripts/check-docs.mjs                                                        rc=0
check-docs: ok
```

The plan names `pnpm docs:check`; the root `package.json` has no such script, so the script ran
directly (see the Task 7b report).

## Gate 4 — security review completed, findings resolved

```
$ node scripts/check-security-review.mjs --resolved docs/security/review-2026.md    # 2026-09-25
check-security-review: docs/security/review-2026.md OK (14 items, every finding resolved)   rc=0
```

`pnpm test:all`: see gate 1. Re-review sign-offs are in `docs/security/review-2026.md`.

## Gate 5 — §17 metadata, publint, attw

```
$ pnpm quality                                             # 2026-09-25T09:01Z, HEAD 98eafb0
== .quality/toolmark-core-1.0.0-next.4.tgz
Running publint v0.3.24 … All good!
(attw esm-only: only the ignored NoResolution / CJSResolvesToESM rows)
… same for inertia, judge-typesafe, lint, mcp, react, testing, tour
PASS @toolmark/core: no dependencies; 10 entries import only optional peers
check-package-meta: 0 problem(s)
check-no-app-code: 141 file(s) scanned, 0 match(es)
check-workflows: 4 passed, 0 failed
rc=0
```

## Gate 6 — changesets release with provenance; changelog and deprecation policy

The `release-dry-run` job runs only on `pull_request`/`workflow_dispatch`: **pending CI evidence**
from the M5 PR run (gate 1 table; fill with the PR run URL). Since the M5 final review it also runs
the publish job's checks and its publish loop in `--dry-run`, on a synthetic plan when the publish
plan is empty (`docs/release/release-workflow.md`, "The dry run on every PR"). Its steps were run
locally on the RC (2026-09-25T08:59Z, HEAD `3aa8d2f`); nothing was published:

```
$ pnpm changeset publish-plan --output "$T/publish-plan.json"                        rc=0
$ pnpm changeset pack --from-publish-plan "$T/publish-plan.json" --out-dir "$T/dist-pack"   rc=0
plan: 8 × @toolmark/*@1.0.0-next.4, tag next
$ npx npm@11.19.0 publish "$T/dist-pack/<tgz>" --dry-run --access public --tag next --ignore-scripts
npm notice Publishing to https://registry.npmjs.org/ with tag next and public access (dry-run)  × 8
npm dry-run: 8 ok, 0 failed
$ node scripts/check-release-versions.mjs --tarballs "$T/dist-pack"
check-release-versions --tarballs: 8 passed, 0 failed
$ node scripts/tarball-smoke.mjs dist-tarballs "$T/dist-pack/packages"
tarball-smoke: 216 passed, 0 failed
$ cmp dist-pack/packages/<tgz> dist-tarballs/<tgz>   → identical × 8
```

`CHANGELOG.md` is inside every tarball (`check-package-meta`, gate 5). The deprecation and
versioning policies are in `docs/policies/` and built by `docs:build` (gate 3); the deployed-page
`curl` checks and provenance/`npm audit signatures` belong to Task 7d, after the owner publishes.

## Gate 7 — in-repo RC evidence

**RC versioning (step 2, 2026-09-25T08:58Z):**

```
$ GITHUB_TOKEN=<redacted> pnpm changeset version                                     rc=0
You are in prerelease mode! … All files have been updated.
$ node scripts/check-release-versions.mjs --pre next                                 rc=0
PASS --pre next: 8 @toolmark/* packages at 1.0.0-next.4
```

**Pack and smoke (step 3, 2026-09-25T08:58Z, HEAD `3aa8d2f`):**

```
$ pnpm build && pnpm -r --filter "./packages/*" pack --pack-destination "$PWD/dist-tarballs"   rc=0
$ node scripts/tarball-smoke.mjs dist-tarballs
PASS pnpm install (8 tarball(s))
PASS tsc 6.0.3 nodenext (23 entries) · PASS tsc 6.0.3 bundler · PASS tsc 7.0.2 nodenext · PASS tsc 7.0.2 bundler
PASS bin toolmark --help … PASS bin toolmark-mcp (symlink) --toolmark-smoke-bad-flag (exit 2)
tarball-smoke: 108 passed, 0 failed                                                  rc=0
$ node scripts/check-release-versions.mjs --tarballs dist-tarballs
PASS dist-tarballs/toolmark-core-1.0.0-next.4.tgz: @toolmark/core@1.0.0-next.4 … (× 8)   rc=0
```

Filenames, sizes and SHA-256 values: `docs/release/next-tarballs.md`, "M5 release candidate".

**Round budget on built `dist` (step 4, 2026-09-25T08:59Z):**

```
$ TOOLMARK_EXAMPLE_PORT=5174 TOOLMARK_DIST=1 ROUND_BUDGET_REPORT=$PWD/.quality/round-budget.json \
    pnpm -F @toolmark-examples/react-vite exec playwright test e2e/round-budget.spec.ts --project=chromium
  ✓ [chromium] › e2e/round-budget.spec.ts:10:1 › simple_form_within_3_rounds (260ms)
  ✓ [chromium] › e2e/round-budget.spec.ts:65:1 › wizard_within_5_rounds (245ms)
  2 passed (3.4s)                                                                    rc=0
$ node scripts/render-round-budget.mjs --check .quality/round-budget.json
PASS simple_form: 3 rounds <= budget 3
PASS wizard: 4 rounds <= budget 5
round budget written to docs/release/round-budget.md (2 row(s))                     rc=0
```

`docs/release/round-budget.md`: commit `3aa8d2f`, version `1.0.0-next.4`; simple form 3 rounds
(manifest 682 B, describe 1112 B, 54 ms), wizard 4 rounds (1366 B, 2223 B, 108 ms). Both specs
assert zero `invalid`/`refused` results.

**Same tools and tours on built `dist` (step 4, 2026-09-25T09:00Z):**

```
$ TOOLMARK_EXAMPLE_PORT=5174 TOOLMARK_DIST=1 pnpm -F @toolmark-examples/react-vite exec playwright test \
    e2e/same-tools.spec.ts e2e/tour.spec.ts --project=chromium --project=firefox --project=webkit
  6 failed (every [firefox] test, 0 ms: "Could not find profile folder.")
  13 passed                                                                          rc=1
$ … same command with --project=chromium --project=webkit
  ✓ [chromium] › e2e/same-tools.spec.ts:63:1 › same_declaration_all_surfaces (3.9s)
  ✓ [chromium] › e2e/tour.spec.ts › tour_show_mode, tour_guide_mode_waits_for_valid_input,
    tour_do_mode_fills_and_confirms, tour_planned_via_agent_planner (show, do), tour_overlay_axe_clean
  ✓ [webkit]   › e2e/tour.spec.ts › the same 6 tests
  13 passed (13.8s)                                                                  rc=0
```

`same-tools.spec.ts` runs on Chromium only (the Playwright config's `EVERY_BROWSER` list; its
WebMCP leg needs Chromium). Firefox: the tours ran green on CI in run `36109316593` (`main`, M4
source build). On built `dist`, the `ci.yml` `browser` job's step "Playwright on built dist
(react-vite, firefox)" runs `dist-resolution`, `same-tools` and `tour` with `TOOLMARK_DIST=1` on
Firefox (and WebKit); `dist-resolution.spec.ts` fails unless `@toolmark/core` was served from
`dist/`. **Pending CI evidence:** the M5 PR's `browser (firefox)` job (gate 1 table; fill with the
PR run URL). `release-dry-run` runs the same dist e2e on Chromium.

## Gates 8–9, SC4, D28 (supporting)

- **8 (WebMCP):** the Chromium WebMCP suites ran in `unit (node 24, react 19.3.0, inertia 3.7.1)`
  and `browser (chromium)` of run `36114346855` (success).
- **9 (spec-watch):** `node --test scripts/spec-watch.test.mjs` → `# pass 4 # fail 0`
  (2026-09-25); the live run is Task 7d.
- **SC4 / D3:** `check-no-app-code: 141 file(s) scanned, 0 match(es)` (gate 5).
- **D28:** `check-docs: ok` (gate 3), which includes the experimental-label check.

## 1.0.0 (Task 7c step 1) — 2026-09-25T09:05Z

`pnpm changeset pre exit && pnpm changeset version` → `check-release-versions --exact 1.0.0`: PASS 8 @toolmark/* packages at 1.0.0.

Fresh pack → `tarball-smoke`: 108 passed, 0 failed; `check-release-versions --tarballs`: 8 passed, 0 failed.

Refreshed after the M5 final fixes (2026-09-25, `m5/final-fixes`): only `@toolmark/core` changed
(SEC-24..SEC-27); same smoke and range results.

```
f2fb0993debf932e9b8a42822f48ff27f25ba14349886d0ad012fd55498b1712  toolmark-core-1.0.0.tgz
451eb0f6042928d5eac64d42c85c31920b2189c9ffd8a246b81817ac075556ed  toolmark-inertia-1.0.0.tgz
a37a86726b3a0818d1cde78af7d6c146170a715b8f07d3ff87a977bcb9ec9466  toolmark-judge-typesafe-1.0.0.tgz
8680ac95245c5ddeae61df106e89ab9502a03035421b4dd335279c91a67cda81  toolmark-lint-1.0.0.tgz
d691a793fa9f6cb807fe97ddd3a084b55e1740ddf6b9e8961c690daf0ec79985  toolmark-mcp-1.0.0.tgz
35c2177b2719df26c6e95fa010a0d84364c7e3693bacc59f0abf7e8c40e1fa50  toolmark-react-1.0.0.tgz
02689eb70e7a44fde6d7bdc44f5638a18e334b7d074ab86e126044a85f1615f4  toolmark-testing-1.0.0.tgz
122e5877f2a9776620f30439dd5bc49e9c869d8319a6360bdc171c25e5a512ea  toolmark-tour-1.0.0.tgz
```
