# Toolmark + Innovation adoption — Roadmap & live status

**This file is the single source of truth for progress across both repos.** Any new session starts
here (see [Resume protocol](#resume-protocol)). Update it at every checkpoint listed in
[Checkpoint rules](#checkpoint-rules) and commit it (`docs(roadmap): …`) so the state survives
context compaction, new sessions and new machines.

- Toolmark repo: `~/repos/toolmark` — private `github.com/adams100111/toolmark`, branch `main`.
- Innovation repo: `~/projects/innovation` — planning branch `docs/assistant-page-tools` (from
  `next`, **local only**; push only when the owner asks — Innovation constitution).

## Documents

| What | Where |
| --- | --- |
| Toolmark spec (D1–D32, §23 rulings) | toolmark `docs/superpowers/specs/2026-09-24-toolmark-design.md` |
| Toolmark plans (overview + M1–M5) | toolmark `docs/superpowers/plans/2026-09-24-toolmark-*.md` |
| Innovation spec (C1–C3, A1–A4) | innovation `docs/superpowers/specs/2026-09-24-assistant-page-tools-design.md` |
| Innovation plans (Phase 0–3) | innovation `docs/superpowers/plans/2026-09-24-assistant-page-tools-phase{0,1,2,3}-*.md` |
| Release evidence | toolmark `docs/release/{innovation-baseline,innovation-results,next-tarballs}.md` |
| Lane ledgers (per plan, git-ignored) | `<repo>/.superpowers/sdd/<plan-basename>/progress.md` (created by `sdd-lanes`) |

## Status legend

`todo` · `ready` (all dependencies done) · `active` · `review` · `done` · `blocked (<reason>)` ·
`owner` (waiting on an owner decision/action)

## Work units and dependencies

```
Toolmark M1 ─┬─► Toolmark M2 ─┬─► Toolmark M3 ─► Toolmark M4 ─┬─► Toolmark M5 (release 1.0)
             │                │                                │
Innov P0 ────┴─► Innov P1 ────┴─► Innov P2 ──────────────────┴─► Innov P3
(P0 also needs nothing; P1 needs M1 tarballs + P0; P2 needs M2 tarballs + P1;
 P3 needs M4 tarballs + P2 T1–T8; M5 needs Innovation results for P1+P2)
```

| Unit | Repo | Plan | Depends on | Exit check | Status | Branch | Updated |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T-M1 Core | toolmark | `…-m1-core.md` | — | lane gates green + CI green + `-next` tarballs packed | ready | — | 2026-09-24 |
| I-P0 Foundations | innovation | `…-phase0-foundations.md` | — | 4 lanes merged; **baseline committed** | ready | — | 2026-09-24 |
| T-M2 Forms | toolmark | `…-m2-forms.md` | T-M1 | tarballs packed | todo | — | — |
| I-P1 Simple form | innovation | `…-phase1-simple-form.md` | T-M1, I-P0 | SC-001/003/004 met | todo | — | — |
| T-M3 Reach | toolmark | `…-m3-reach.md` | T-M2 | tarballs packed | todo | — | — |
| I-P2 Wizard & forms | innovation | `…-phase2-wizard-and-forms.md` | T-M2, I-P1 | SC-002 met (T9 needs owner) | todo | — | — |
| T-M4 Tours & tooling | toolmark | `…-m4-tours-tooling.md` | T-M3 | tarballs packed | todo | — | — |
| I-P3 Tours | innovation | `…-phase3-tours.md` | T-M4, I-P2 T1–T8 | e2e green | todo | — | — |
| T-M5 Release | toolmark | `…-m5-release.md` | T-M4, I-P1, I-P2 | all §21 gates; publish (owner) | todo | — | — |

**What can run at the same time:** T-M1 ∥ I-P0 now. Later: T-M2 ∥ I-P1, T-M3 ∥ I-P2,
T-M4 ∥ (I-P2 Task 9 if approved). Each unit is driven by **its own controller session** (see
[Parallel execution](#parallel-execution-and-resource-limits)).

## Lane board

Tick a lane when it is merged into its unit branch and its lane gate is green; tick the unit when
its exit check passes. Task numbers refer to the unit's plan.

### T-M1 Core (toolmark)
- [ ] Wave 0 · Lane A (T1–T7) workspace, model, schema, registry, call pipeline, form tools, protocol
- [ ] Wave 1 · Lane B (T8–T9) bridge + transports
- [ ] Wave 1 · Lane C (T10–T12) React + RHF
- [ ] Wave 1 · Lane D (T13) Inertia adapter
- [ ] Wave 1 · Lane E (T14) testing package
- [ ] Wave 2 · Lane F (T15–T16) example, docs, CI, tarballs → `docs/release/next-tarballs.md`
- [ ] Unit exit: CI green on `main`, tarballs logged

### I-P0 Foundations (innovation)
- [ ] Wave 1 · Lane A (T1) browser-result endpoint auth + binding **(security)**
- [ ] Wave 1 · Lane B (T2) benchmark harness → **operator run: baseline 10×2** → toolmark `docs/release/innovation-baseline.md`
- [ ] Wave 1 · Lane C (T3) `AiAssistantSettings` switches
- [ ] Wave 1 · Lane D (T4–T5) activity event + `CONTEXT.md`
- [ ] Unit exit: merged to the working branch; baseline committed

### T-M2 Forms (toolmark)
- [ ] W0 · A (T1–T4) arrays, JSON-Schema subset, files, wizard
- [ ] W1 · B (T5–T6) DOM adapter + scanner · C (T7) `useWizardTool` · D (T8) Inertia pages/props/navigation
- [ ] W2 · E (T9–T10) Inertia `<Form>`, examples, guides, tarballs
- [ ] Unit exit

### I-P1 Simple form (innovation)
- [ ] W0 · A (T1) deps + tarballs + provider
- [ ] W1 · B (T2–T4) bridge, `page_call`, confirmations **(security)** · C (T5–T6) chat bridge + approval card · D (T7) simple form tools
- [ ] W2 · E (T8–T9) e2e + measurement → `innovation-results.md` (Phase 1 section)
- [ ] Unit exit: SC-001/003/004 met

### T-M3 Reach (toolmark)
- [ ] W0 · A (T1) tour hooks + mcp skeleton
- [ ] W1 · B (T2) WebMCP · C (T3–T4) `@toolmark/mcp` **(security)** · D (T5) OTel
- [ ] W2 · E (T6) examples, guides, tarballs
- [ ] Unit exit

### I-P2 Wizard & forms (innovation)
- [ ] W0 · A (T2) M2 tarballs, lookup options, file resolver
- [ ] W1 · B (T1) chat attachments **(security)** · C (T3) wizard · D (T4, T6) simple form extras, ideas, projects · E (T5) attachment picker
- [ ] W2 · F (T7–T8) e2e + measurement (SC-002)
- [ ] W3 · G (T9) legacy removal — **owner go-ahead required**
- [ ] Unit exit

### T-M4 Tours & tooling (toolmark)
- [ ] W0 · A (T0) skeletons
- [ ] W1 · B (T1–T2) tours · C (T3–T4) lint + judge · D (T5) Laravel example · E (T6) Next.js example
- [ ] W2 · F (T7–T8) docs site, CI, cross-cutting e2e, tarballs
- [ ] Unit exit

### I-P3 Tours (innovation)
- [ ] W0 · A (T1) tour package + theming
- [ ] W1 · B (T2) pre-written tours · C (T3–T4) tour-plan endpoint + `start_tour` · D (T6) chat launcher
- [ ] W2 · E (T5) e2e
- [ ] Unit exit

### T-M5 Release (toolmark)
- [ ] W0 · A (T1–T2) CI matrix + quality gates
- [ ] W1 · B (T3) docs/policies · C (T4) security review · D (T6) spec-watch
- [ ] W2 · E (T5) security fixes
- [ ] W3 · F (T7) release — **owner confirmations required**
- [ ] Unit exit: `1.0.0` on npm with provenance

## Owner actions and open decisions

| # | Item | Needed by | Status |
| --- | --- | --- | --- |
| O1 | Reserve npm org `toolmark` (2FA, trusted publishing) | T-M5 | open |
| O2 | Confirm code ownership / employment IP terms before going public | T-M5 | open |
| O3 | Go-ahead for I-P2 Task 9 (remove legacy script/snapshot; every tenant has page actions on) | I-P2 W3 | open |
| O4 | Permission to push `docs/assistant-page-tools` / feature branches in Innovation | any Innovation merge | open |
| O5 | LLM credentials + a dev tenant for the baseline and measurement runs | I-P0 Lane B run | open |

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
- a measurement lands → link the evidence section.

Innovation units also record progress in Innovation's own branch history; the board here is the
cross-repo view. One line per event in the ledger; the board holds only lane-level state.

## Parallel execution and resource limits

- **One controller session per active unit.** Two units in parallel (e.g. T-M1 and I-P0) = two
  sessions (two terminals, or two aui sessions), each running `sdd-lanes` on its own plan in its
  own repo. Never drive two units from one controller — the context fills with two ledgers.
- **Lanes inside a unit** run as parallel implementer subagents in their own git worktrees
  (`sdd-lanes`), one implementer per lane, file-disjoint by plan design.
- **Resource ceiling on this machine (from Innovation experience):**
  - Innovation: at most **2 heavy operations at once** (ddev test runs, `npm run build`, image
    builds) across **both** sessions; lane fan-out beyond 2 must run sequentially. Implementers run
    tests in the **foreground only** — never `run_in_background` or `&` (backgrounded tests under
    load stall uncommitted).
  - Innovation worktrees need one-time setup: copy `vendor/` and `.env`, run
    `php artisan wayfinder:generate` (or copy `resources/js/{routes,actions,wayfinder}`), give the
    worktree's ddev a unique `name`, remap the pgvector host port. `ddev poweroff` is global — use
    `ddev stop` in the worktree.
  - Per task: fast checks only (targeted tests, eslint on touched files). One full `npm run build`
    and one full backend suite at the **unit** gate, not per task.
  - Toolmark (Node only) tolerates 3–4 lanes, but browser-mode/Playwright suites count as heavy.
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

- 2026-09-24 — Specs and plans complete for both repos; roadmap created. Next: T-M1 ∥ I-P0.
