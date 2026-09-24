# Toolmark roadmap & live status (1.0) + post-1.0 consumer track

**This file is the single source of truth for progress on Toolmark 1.0**; the Innovation consumer
track resumes after `1.0.0` is published. Any new session starts here (see
[Resume protocol](#resume-protocol)). Update it at every checkpoint listed in
[Checkpoint rules](#checkpoint-rules) and commit it (`docs(roadmap): …`) so the state survives
context compaction, new sessions and new machines.

- Toolmark repo: `~/repos/toolmark` — private `github.com/adams100111/toolmark`, branch `main`.
  Toolmark 1.0 is self-contained: no unit, exit check or gate depends on another repository.

## Documents

| What | Where |
| --- | --- |
| Toolmark spec (D1–D32, §23 rulings) | toolmark `docs/superpowers/specs/2026-09-24-toolmark-design.md` |
| Toolmark plans (overview + M1–M5) | toolmark `docs/superpowers/plans/2026-09-24-toolmark-*.md` |
| Release evidence | toolmark `docs/release/{round-budget,next-tarballs,checklist,owner-handoff}.md` |
| Lane ledgers (per plan, git-ignored) | `<repo>/.superpowers/sdd/<plan-basename>/progress.md` (created by `sdd-lanes`) |

## Status legend

`todo` · `ready` (all dependencies done) · `active` · `review` · `done` · `blocked (<reason>)` ·
`owner` (waiting on an owner decision/action)

## Work units and dependencies

```
Toolmark M1 ─► M2 ─► M3 ─► M4 ─► M5 (release 1.0.0)
                                  │
Post-1.0 consumer track:          └─► Innov P0 ─► P1 ─► P2 ─► P3   (npm ^1.0.0)
```

| Unit | Repo | Plan | Depends on | Exit check | Status | Branch | Updated |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T-M1 Core | toolmark | `…-m1-core.md` | — | CI green; round budget `simple_form_within_3_rounds`; tarball smoke | active | `feat/m1-core` | 2026-09-24 |
| T-M2 Forms | toolmark | `…-m2-forms.md` | T-M1 | round budget `wizard_within_5_rounds`; tarball smoke | todo | — | — |
| T-M3 Reach | toolmark | `…-m3-reach.md` | T-M2 | same tool via WebMCP + MCP + Playwright (`reach.spec.ts`); tarball smoke incl. `toolmark-mcp` | todo | — | — |
| T-M4 Tours & tooling | toolmark | `…-m4-tours-tooling.md` | T-M3 | authored + planned tours (3 browsers, axe-clean); Laravel authored tour; same-tools e2e; Laravel + Next.js suites; `docs:build`; lint clean; tarball smoke | todo | — | — |
| T-M5 Release | toolmark | `…-m5-release.md` | T-M4 | all §21 gates (incl. round budget + smoke on the RC); publish (owner) | todo | — | — |

**Current focus:** Toolmark M1 → M5 (release). Innovation is post-1.0. Within Toolmark, units are
sequential; parallelism is lane-level inside a unit (see
[Parallel execution](#parallel-execution-and-resource-limits)).

## Lane board

Tick a lane when it is merged into its unit branch and its lane gate is green; tick the unit when
its exit check passes. Task numbers refer to the unit's plan.

- [x] Pre-M1 housekeeping: `.gitignore` with `.superpowers/` and `.DS_Store` (commit `db12087`).

### T-M1 Core (toolmark)
- [x] Wave 0 · Lane A (T1–T7, high; T6 **security**) workspace, model, schema, registry, call pipeline, form tools, protocol
- [x] Wave 1 · Lane B (T8–T9, high, **security**) bridge + transports (incl. WebSocket hooks for M3)
- [ ] Wave 1 · Lane C (T10–T12) React + RHF
- [x] Wave 1 · Lane D (T13) Inertia adapter + visit-outcome mapping
- [x] Wave 1 · Lane E (T14) testing package
- [ ] Wave 2 · Lane F (T15–T16, high; T16 **security**) example + round-budget e2e, docs, Laravel reference, CI, tarballs + smoke → `docs/release/{round-budget,next-tarballs}.md`
- [ ] Unit exit: CI green on `main`; `simple_form_within_3_rounds`; tarball smoke logged

### T-M2 Forms (toolmark)
- [ ] W0 · A (T1–T4, high, **security**) arrays, `tm.info`, JSON-Schema subset + options, files, wizard
- [ ] W1 · B (T5–T6, **security**) DOM adapter + scanner · C (T7) `useWizardTool`, RHF arrays · D (T8, **security**) Inertia pages/props/navigation
- [ ] W2 · E (T9–T12; T11 **security**) Inertia `<Form>`, example pages + wizard round budget, guides + Laravel props builder, tarballs + smoke
- [ ] Unit exit: `wizard_within_5_rounds` (+ `simple_form_within_3_rounds`); tarball smoke logged

### T-M3 Reach (toolmark)
- [ ] W0 · A (T1, high, **security**) `@toolmark/mcp` skeleton, registry hooks (`tm.anchor`/`state`/`info`), bridge caller
- [ ] W1 · B (T2, **security**) tour hooks in adapters · C (T3) WebMCP · D (T4–T5, **security**) MCP server + pairing + CLI · E (T6) OTel
- [ ] W2 · F (T7) example, `reach.spec.ts`, guides, tarballs + smoke
- [ ] Unit exit: `same_declaration_webmcp_mcp_fixture`; tarball smoke incl. `toolmark-mcp`

### T-M4 Tours & tooling (toolmark)
- [ ] W0 · A (T0) skeletons + deps
- [ ] W1 · B (T1–T2) tours · C (T3–T4) lint + judge · D (T5, high, **security**) Laravel example (PHP/Composer via Docker when not on PATH) · E (T6) Next.js example
- [ ] W2 · F (T7–T8) docs site, CI, cross-cutting e2e + same-tools + planned tour, tarballs + smoke
- [ ] Unit exit: tours (3 browsers) + Laravel authored tour + same-tools + example suites + `docs:build` + lint clean + smoke

### T-M5 Release (toolmark)
- [ ] W0 · A (T1–T2) CI matrix + quality gates + package metadata
- [ ] W1 · B (T3, T3b) TSDoc gap-fill + strict TypeDoc, policies/community/docs deploy · C (T4, high, **security**) security review · D (T6) spec-watch
- [ ] W2 · E (T5, high, **security**) security fixes
- [ ] W3 · F (T7a–T7c, high) release workflow + dry run, RC + in-repo evidence, 1.0.0 + owner hand-off → **stop for owner**
- [ ] After owner: T7d (controller) post-publish verification
- [ ] Unit exit: `1.0.0` on npm with provenance (T7d)

## Owner actions and open decisions

| # | Item | Needed by | Status |
| --- | --- | --- | --- |
| O1 | npm org `toolmark` (account 2FA); first-publish bootstrap with a short-lived granular token; `npm trust` (OIDC) for each of the 8 packages after the first publish; revoke the token | T-M5 T7c hand-off (O-b, O-g…O-k) | open |
| O2 | Confirm code ownership / employment IP terms before going public | T-M5 | open |
| O6 | GitHub Actions budget for the private-repo CI matrix (3 browsers × Node × React/Inertia/zod), or self-hosted runners | T-M1 T16 / T-M5 T1 | open |
| O7 | Go public: make the repo public; create environment `npm-release` (owner the only reviewer); enable Pages (GitHub Actions), private vulnerability reporting, "Allow GitHub Actions to create and approve pull requests", branch protection on `main`; set `TOOLMARK_PUBLISH_ENABLED`; approve the publish run | T-M5 T7c hand-off (O-c…O-i) | open |

## Post-1.0 consumer track (Innovation)

Not blocking. Nothing here gates any Toolmark unit. Resumes after `@toolmark/*` `1.0.0` is published.

- Innovation repo: `~/projects/innovation` — the spec + plans are parked on local branch
  `docs/assistant-page-tools` (3 docs-only commits on top of `next`, not pushed). The owner's checkout
  stays on `next` for other work. When I-P0 starts, rebase that branch onto the current `next` (or
  cherry-pick its 3 commits) first, and re-point its plans from `-next` tarballs to npm `^1.0.0`.
- The baseline (I-P0 Lane B) must be recorded **before** any change to Innovation's assistant Entry
  Mode code; baseline and results live in the Innovation repo.

| What | Where |
| --- | --- |
| Innovation spec (C1–C3, A1–A4) | innovation `docs/superpowers/specs/2026-09-24-assistant-page-tools-design.md` (branch `docs/assistant-page-tools`, unpushed) |
| Innovation plans (Phase 0–3) | innovation `docs/superpowers/plans/2026-09-24-assistant-page-tools-phase{0,1,2,3}-*.md` (same branch) |

| Unit | Repo | Plan | Depends on | Exit check | Status | Branch | Updated |
| --- | --- | --- | --- | --- | --- | --- | --- |
| I-P0 Foundations | innovation | `…-phase0-foundations.md` | — (post-1.0 by owner) | 4 lanes merged; **baseline committed** | owner (post-1.0) | — | 2026-09-24 |
| I-P1 Simple form | innovation | `…-phase1-simple-form.md` | `@toolmark/*` 1.0.0 published, I-P0 | SC-001/003/004 met | todo | — | — |
| I-P2 Wizard & forms | innovation | `…-phase2-wizard-and-forms.md` | I-P1 | SC-002 met (T9 needs owner) | todo | — | — |
| I-P3 Tours | innovation | `…-phase3-tours.md` | 1.0.0, I-P2 T1–T8 | e2e green | todo | — | — |

### I-P0 Foundations (innovation)
- [ ] Wave 1 · Lane A (T1) browser-result endpoint auth + binding **(security)**
- [ ] Wave 1 · Lane B (T2) benchmark harness → **operator run: baseline 10×2** (Innovation repo)
- [ ] Wave 1 · Lane C (T3) `AiAssistantSettings` switches
- [ ] Wave 1 · Lane D (T4–T5) activity event + `CONTEXT.md`
- [ ] Unit exit: merged to the working branch; baseline committed

### I-P1 Simple form (innovation)
- [ ] W0 · A (T1) deps (`@toolmark/*` ^1.0.0) + provider
- [ ] W1 · B (T2–T4) bridge, `page_call`, confirmations **(security)** · C (T5–T6) chat bridge + approval card · D (T7) simple form tools
- [ ] W2 · E (T8–T9) e2e + measurement (Phase 1 section, Innovation repo)
- [ ] Unit exit: SC-001/003/004 met

### I-P2 Wizard & forms (innovation)
- [ ] W0 · A (T2) lookup options, file resolver
- [ ] W1 · B (T1) chat attachments **(security)** · C (T3) wizard · D (T4, T6) simple form extras, ideas, projects · E (T5) attachment picker
- [ ] W2 · F (T7–T8) e2e + measurement (SC-002)
- [ ] W3 · G (T9) legacy removal — **owner go-ahead required**
- [ ] Unit exit

### I-P3 Tours (innovation)
- [ ] W0 · A (T1) tour package + theming
- [ ] W1 · B (T2) pre-written tours · C (T3–T4) tour-plan endpoint + `start_tour` · D (T6) chat launcher
- [ ] W2 · E (T5) e2e
- [ ] Unit exit

| # | Item | Needed by | Status |
| --- | --- | --- | --- |
| O3 | Go-ahead for I-P2 Task 9 (remove legacy script/snapshot; every tenant has page actions on) | I-P2 W3 | open |
| O4 | Permission to push `docs/assistant-page-tools` / feature branches in Innovation | any Innovation merge | open |
| O5 | LLM credentials + a dev tenant for the baseline and measurement runs | I-P0 Lane B run | open |

Innovation resource notes (from Innovation experience): at most **2 heavy operations at once** (ddev
test runs, `npm run build`, image builds) across sessions; lane fan-out beyond 2 runs sequentially;
implementers run tests in the **foreground only**. Worktrees need one-time setup: copy `vendor/` and
`.env`, run `php artisan wayfinder:generate` (or copy `resources/js/{routes,actions,wayfinder}`), give
the worktree's ddev a unique `name`, remap the pgvector host port; `ddev poweroff` is global — use
`ddev stop` in the worktree. Per task: fast checks only; one full `npm run build` and one full
backend suite at the unit gate.

## Resume protocol

Every new session, before doing anything else:

1. `cd ~/repos/toolmark && git pull --ff-only` and read **this file** top to bottom (only this file).
2. Pick the work: the first unit whose status is `active` (resume it) — else the first `ready` unit
   the user wants; confirm the choice with the user in one line.
3. Open that unit's plan and its ledger `<repo>/.superpowers/sdd/<plan-basename>/progress.md`
   (if the ledger is missing but the board shows ticked lanes, rebuild the ledger from `git log`
   of the unit branch — lanes are merged with `--no-ff`, one commit per task).
4. Invoke the `sdd-lanes` skill with that plan and continue from the ledger (a `Task N: complete`
   line means done — never re-dispatch it).
5. Do **not** read other plans, old diffs or long files "for context": the plan + ledger + this
   board are sufficient by design.

## Checkpoint rules

The controller updates this file (and commits it in the toolmark repo) at each of these points —
and nowhere else:

- a unit starts → status `active`, branch name, date;
- a lane is merged and its lane gate is green → tick the lane;
- a lane is blocked or needs the owner → status `blocked (…)` / add a row to *Owner actions*;
- a unit's exit check passes → tick the unit, status `done`, set dependents to `ready`;
- release evidence lands (`round-budget.md`, tarball smoke) → link it.

One line per event in the ledger; the board holds only lane-level state. Post-1.0 Innovation units
also record progress in Innovation's own branch history.

## Parallel execution and resource limits

- **One controller session per active unit.** Toolmark units run in order (M1 → M5); never drive
  two units from one controller — the context fills with two ledgers.
- **Lanes inside a unit** run as parallel implementer subagents in their own git worktrees
  (`sdd-lanes`), one implementer per lane, file-disjoint by plan design.
- **Resource ceiling:** Toolmark (Node only) tolerates 3–4 lanes, but browser-mode/Playwright
  suites and the Laravel example count as heavy. Per task: fast checks only; full suites at the lane
  and unit gates.
- Subagents working in parallel never run destructive git commands, never `git stash`, and never
  commit into another lane's branch (global rule + sdd-lanes).

## Context in the loop

- The controller keeps only: this board, the current plan, the ledger, and one-line lane reports.
  Implementers receive task briefs (`sdd-lanes` `task-brief`) — not the whole plan.
- Reviews use `review-package` diffs, dispatched to reviewer subagents; the controller reads
  verdicts, not diffs.
- Long outputs (test logs, research) stay in subagents; they return summaries.
- Before context gets tight or at the end of a session: make sure the ledger and this board are
  current and committed. Compaction or a new session then loses nothing.
- Anything learned that a future session needs (a gotcha, a ruling) goes to: the ledger (`Ruling:`
  lines) for the unit, the spec's rulings appendix if it changes a contract, or project memory if
  it is a durable environment fact.

## Log

- 2026-09-24 — Specs and plans complete for both repos; roadmap created.
- 2026-09-24 — Owner deferred Innovation; Innovation checkout back on `next`; plans parked on
  `docs/assistant-page-tools`. Next: T-M1.
- 2026-09-24 — Owner decision: Toolmark 1.0 is self-contained; Innovation becomes a post-1.0
  consumer track; SC1 proven in-repo (round budget), SC2 by the same-tools e2e, packaging by the
  tarball smoke test. Plan audit pass 1 applied to spec/overview (rulings R1–R9 in spec §23).
- 2026-09-24 — Plan audit pass 3: pass-2 proposals applied to spec/overview; cross-plan consistency
  fixed (M1 owns Inertia visit outcomes and WebSocket hooks; shared-files table in the overview);
  lane board synced with the plans. T-M1 stays `ready`.
- 2026-09-24 — Plan audit complete (4 passes + independent blocker verification; PR #1 merged).
  Owner goal: execute M1→M5 autonomously to a complete 1.0, stopping only at owner actions.
  T-M1 started on `feat/m1-core` (worktree `~/repos/toolmark-wt/m1`).
