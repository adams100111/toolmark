# Toolmark M5 — Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `sdd-lanes` to implement this plan lane by lane.
> Plan-lite format. Requires M1–M4 merged. **Publishing to npm and making the repo public are
> outward actions: the controller stops and asks the owner before Task 7 runs them.**

**Goal:** Prove every §21 release gate, fix what the security review finds, set up the post-release
spec-watch, and publish `1.0.0`.

**Architecture:** Gates are automated in CI wherever possible (matrix, package quality, size,
docs completeness, types on TS 7); the security review is a structured, documented review plus a
fix wave; release uses changesets with npm provenance from GitHub Actions.

**Tech Stack:** as overview, plus `publint` 0.3.24, `@arethetypeswrong/cli` 0.18.5, `size-limit`
14.0.0 + `@size-limit/preset-small-lib` 14.0.0, `changesets/action` (GitHub Action, pin the latest
major at execution), GitHub OIDC for provenance.

**Spec:** §17, §18, §20 (M5), §21, §22; D15, D28, D32.

## Global constraints (M5 additions)

- CI matrix (exact): Node `20.19.x`, `22.x`, `24.x`; React `18.3.1`, `19.3.0`; `@inertiajs/react`
  `2.3.28`, `3.7.1`; zod `3.25.x` (converter path) and `4.6.5`; Playwright browsers `chromium`,
  `firefox`, `webkit` for DOM/e2e suites (WebMCP suites on `chromium` only).
- Size budgets: set in Task 2 as **measured gzip size of the first release build + 10 %, rounded up
  to the next 0.5 kB**, then enforced; `@toolmark/core`'s root entry must have **no** runtime
  `dependencies` (script-checked).
- Release version `1.0.0` for every `@toolmark/*` package; the WebMCP entry's JSDoc and docs page
  keep the **experimental** label (D28).
- npm publish uses `--provenance` (`NPM_CONFIG_PROVENANCE=true`) from GitHub Actions with
  `permissions: { id-token: write, contents: write }`.

## Rulings made while planning

- **Security fixes are their own wave** after the review so parallel lanes never race on arbitrary
  files.
- **Innovation evidence is a gate artifact**: `docs/release/innovation-results.md` must record the
  measured before/after numbers (rounds, time, input tokens, success rate) for the simple form and
  the wizard, produced by the Innovation adoption plan. Missing or below success criterion 1 → the
  release stops.

## Review focus

1. **Consumers on TypeScript 7** → every public entry type-checks (Task 1 `types-ts7` job over all
   eight packages).
2. **CommonJS-only or bundler-only consumers resolving exports wrong** → publint and
   are-the-types-wrong pass for every entry (Task 2).
3. **A future dependency sneaking into core** → the zero-deps script fails CI (Task 2
   `check-zero-deps`).
4. **Security regressions after review** → every review finding gets a regression test in the fix
   wave (Task 5).
5. **WebMCP spec drift after release** → the weekly job opens an issue with the diff (Task 6).

## Lanes

| Wave | Lane | Tasks | Owns files | Consumes |
| --- | --- | --- | --- | --- |
| 0 | A (normal) | 1–2 | `.github/workflows/ci.yml`, `scripts/check-zero-deps.mjs`, `.size-limit.json`, root `package.json` scripts | M4 |
| 1 | B (normal) | 3 | `README.md`, `SECURITY.md`, `CONTRIBUTING.md`, `docs/policies/**`, `packages/*/README.md` | A |
| 1 | C (high, security) | 4 | `docs/security/**` (review report only) | A |
| 1 | D (normal) | 6 | `.github/workflows/spec-watch.yml`, `.spec-watch/**`, `scripts/spec-watch.mjs` | A |
| 2 | E (high, security) | 5 | any source file named by a finding + its tests | C |
| 3 | F (high) | 7 | `.github/workflows/release.yml`, `.changeset/**`, `docs/release/**` | all |

### Task 1: Complete CI matrix   (Lane A, risk: normal)

**Files:** Modify `.github/workflows/ci.yml`, root `package.json`.

**Behaviour:** jobs per the constraints matrix (only meaningful combinations: React/Inertia/zod axes
run the react+inertia+core-forms projects; browser axis runs DOM + e2e; Node axis runs node
projects + CLI tests); `types-ts7` installs `typescript@7.0.2` and type-checks a generated file
importing every public entry of all eight packages; `concurrency` cancels superseded runs; Playwright
browsers cached.

**Tests:** CI green on the branch for every job.

**Task gate:** push branch → all CI jobs green.

---

### Task 2: Package quality gates   (Lane A, risk: normal)

**Files:** Create `scripts/check-zero-deps.mjs`, `.size-limit.json`; Modify `ci.yml`, root
`package.json` (`quality` script).

**Behaviour:**
- `pnpm quality` runs `publint` and `attw --pack` for each package, `size-limit`, and
  `check-zero-deps` (fails if `packages/core/package.json` has any `dependencies` entry or the built
  core root entry imports a bare specifier).
- `.size-limit.json` has one entry per public entry point (e.g. `@toolmark/core`,
  `@toolmark/core/bridge`, `@toolmark/react`, `@toolmark/tour/overlay`…) with limits set by the
  measurement rule, and `ignore` for peer dependencies.

**Tests:** `check_zero_deps_fails_on_added_dependency` (script self-test with a temp fixture).

**Task gate:** `pnpm build && pnpm quality`

---

### Task 3: Documentation and policies complete   (Lane B, risk: normal)

**Files:** Create/complete `README.md`, `SECURITY.md` (private reporting via GitHub Security
Advisories, supported versions), `CONTRIBUTING.md`, `docs/policies/versioning.md` (semver scope per
§17, experimental WebMCP, deprecation ≥ one minor with warning), `docs/policies/tool-names.md` (tool
names are a public contract), every `packages/*/README.md` (install, minimal example, link to docs).

**Tests:** `pnpm docs:build` with TypeDoc `notDocumented` validation → zero warnings (every public
export documented).

**Task gate:** `pnpm docs:build`

---

### Task 4: Security review   (Lane C, risk: high, security)

**Files:** Create `docs/security/threat-model.md`, `docs/security/review-2026.md`.

**Behaviour:** a reviewer on the most capable model audits the code against this checklist and
writes each item's verdict with file:line evidence:
1. Bridge §12.2 MUSTs (addressing, id binding, duplicates, deadlines) — page side, and the Laravel
   reference in `examples/inertia-laravel`.
2. `postMessage` origin + source checks; WebSocket pairing (origin allow-list, loopback, code
   entropy/expiry/rotation, stdout purity).
3. Files: disabled URLs by default, allow-list, `credentials: 'omit'`, `redirect: 'error'`, size/MIME
   limits.
4. No `eval`/`new Function`/string timers anywhere (ESLint + grep across `packages/*/src` and built
   `dist`).
5. `untrustedContent` propagation to WebMCP, MCP and bridge results; descriptions never sourced from
   page text except explicit `tooldescription`/`data-tool-description` attributes (documented risk).
6. Privacy: password/`cc-*` exclusions in DOM synthesis, `state()`, manifests; OTel payloads off.
7. Confirmation cannot be bypassed: policy + consequential/destructive + deferred/inline paths,
   `confirmPending` with edited input re-validated, expiry.
8. Dependency audit: `pnpm audit --prod` clean or findings documented.
Findings are classified Critical / Important / Minor and handed to Task 5.

**Tests:** n/a (review artifact); the checklist must have a verdict for all 8 items.

**Task gate:** report exists with all verdicts; controller ledgers findings.

---

### Task 5: Security fix wave   (Lane E, risk: high, security)

**Files:** whatever the findings name, plus a regression test per finding.

**Behaviour:** fix every Critical and Important finding; Minor ones fixed or documented in
`docs/security/review-2026.md` with rationale. Each fix lands with a failing-first regression test.
Scoped re-review of Critical/security fixes (sdd-lanes rule).

**Task gate:** full suite + `pnpm quality` green; re-review clean.

---

### Task 6: Spec-watch workflow   (Lane D, risk: normal)

**Files:** Create `.github/workflows/spec-watch.yml`, `scripts/spec-watch.mjs`,
`.spec-watch/state.json`.

**Exact values:** schedule `cron: '0 6 * * 1'` (Mondays 06:00 UTC) plus `workflow_dispatch`;
watched sources `https://raw.githubusercontent.com/webmachinelearning/webmcp/main/index.bs`,
`https://raw.githubusercontent.com/webmachinelearning/webmcp/main/implementation-status.md`,
`https://raw.githubusercontent.com/webmachinelearning/webmcp/main/declarative-api-explainer.md`.

**Behaviour:**
- `spec-watch.mjs` fetches each source, compares SHA-256 with `state.json`; on change opens (or
  updates) a GitHub issue titled `WebMCP spec changed: <file>` with a unified diff excerpt (via
  `gh issue create/edit`), then commits the new hashes on a branch and opens a PR.
- A second job runs the WebMCP suites (M3 Task 2 tests + `e2e/webmcp.spec.ts`) against the latest
  Chrome Canary with WebMCP testing enabled. At execution, confirm the current switch that
  `chrome://flags/#enable-webmcp-testing` maps to (Chromium's `about:flags` entry) and record it in the
  workflow; on failure the job opens an issue `WebMCP adapter failing on Chrome Canary`.
- Also runs the WPT `webmcp/` directory from `web-platform-tests/wpt` (sparse checkout) with
  `./wpt run chrome_canary webmcp` and the same switch; failures are reported, never block releases.

**Tests:** `spec_watch_detects_change_and_formats_issue` (script unit test with fixture files and a
stubbed `gh`).

**Task gate:** `node --test scripts/spec-watch.test.mjs` and a manual `workflow_dispatch` run on the
branch.

---

### Task 7: Release 1.0.0   (Lane F, risk: high)

**Files:** Create `.github/workflows/release.yml`, `.changeset/release-1-0.md`,
`docs/release/checklist.md`; Verify `docs/release/innovation-results.md` (produced by the
Innovation adoption plan).

**Behaviour:**
- `release.yml`: on push to `main`, `changesets/action` opens the version PR; merging it publishes
  with provenance.
- Steps before publish (controller verifies each, recorded in `docs/release/checklist.md`):
  1. Every §21 gate green on `main` (CI, quality, docs, security review closed).
  2. `innovation-results.md` meets success criterion 1.
  3. `changeset pre exit`; versions set to `1.0.0`.
  4. **Owner confirmation** for: making `github.com/adams100111/toolmark` public, the npm org
     `toolmark` existing with 2FA and an automation token / trusted publishing configured, and
     code-ownership confirmation (spec §22). The controller asks and waits.
  5. Merge the version PR → publish → verify each package on npm shows the provenance badge.
- Post-release: tag `v1.0.0`, GitHub release notes from changesets, spec-watch enabled.

**Tests:** dry run `pnpm changeset publish --dry-run` (or `pnpm -r publish --dry-run`) in CI before
the real publish.

**Task gate:** all checklist items ticked with evidence; packages visible on npm.

---

## Self-review

- **Spec coverage:** §21 gates → T1 (matrix, TS7), T2 (size, zero deps, package quality), T3 (docs
  completeness), T4/T5 (security), T7 (changesets, provenance, Innovation evidence); §17 → T3;
  post-release spec-watch → T6; §22 owner actions → T7 step 4.
- **Placeholders:** two execution-time facts are named with how to resolve them (the Chrome switch
  for WebMCP testing; the latest `changesets/action` major). Size numbers come from a defined
  measurement rule.
- **Ownership:** `ci.yml` is Lane A's here; the release workflow is Lane F's; fixes in Lane E are
  serialized after the review.
