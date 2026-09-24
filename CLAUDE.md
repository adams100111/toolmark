# Toolmark — project instructions

**Start every session by reading [`docs/ROADMAP.md`](docs/ROADMAP.md)** and follow its resume
protocol. It is the live status of Toolmark 1.0 (self-contained; no dependency on other repos) and
of the post-1.0 consumer track (Innovation's assistant page tools).

## Binding rules

- **Process:** superpowers flow. Specs in `docs/superpowers/specs/`, plans (plan-lite format) in
  `docs/superpowers/plans/`, executed with the `sdd-lanes` skill (parallel worktree lanes, tiered
  gates). Do not introduce Spec Kit here before 1.0.
- **Source of truth:** the spec `docs/superpowers/specs/2026-09-24-toolmark-design.md` (decisions
  D1–D32, §23 implementation rulings) and the plan being executed. If code and spec disagree, stop
  and record a ruling; never "fix" the code back to older text.
- **Stack currency:** before a milestone starts, re-check every version in the plans' overview with
  `npm view <pkg> version` and verify APIs against current docs (context7 / official docs); record
  bumps in the milestone ledger.
- **No app-specific (e.g. Innovation) code** in any package (D3). No Toolmark exit check or release
  gate may depend on another repository (spec §23, release independence).
- **TSDoc with every export:** a task that adds a public export writes its doc comment in the same
  task.
- **Security-tagged tasks** get the most capable model for implementation and review.
- **Git:** Conventional Commits; no AI attribution lines of any kind; no destructive git commands
  without the owner's explicit per-action confirmation; publishing to npm and making the repo public
  are owner-confirmed steps (M5).
- **Checkpoints:** update and commit `docs/ROADMAP.md` at the points listed in its "Checkpoint
  rules" section.
