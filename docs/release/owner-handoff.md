# Toolmark 1.0.0 — owner hand-off

Everything an agent may do for 1.0.0 is done. The steps below are the owner's alone; no agent runs
them. Run them in order, then tell the controller **"1.0.0 published"** (after O-j) so it can run
Task 7d (post-publish verification).

## The release commit

- **Release commit on `main`:** `ffeb8c7667e48fec8a4f7035d828905e6c2e6a24` (merge of PR #6). All eight
  `@toolmark/*` packages are at `1.0.0`; pre mode is exited.
- Commits after it on `main` may only touch `docs/` or `scripts/owner-publish-wizard.sh`; the
  wizard refuses otherwise.
- **Proof nothing published on merge:** `release.yml` run on `ffeb8c7` —
  https://github.com/adams100111/toolmark/actions/runs/36121368743 (select-mode ✓, pack ✓,
  **publish skipped** because `TOOLMARK_PUBLISH_ENABLED` is unset).
- **Last green CI (full matrix, PR #6 head `af98d4d`):** 33 checks passed, 8 publish-side jobs
  skipped, including `browser (firefox)`, `browser (webkit)` and `release-dry-run`.

## The easy way: the wizard

```bash
git checkout main && git pull
bash scripts/owner-publish-wizard.sh
```

It walks O-a … O-k one screen at a time, opens each page, applies the GitHub settings through
`gh` after a y/N gate (with the manual UI path if an API call fails), puts the bootstrap token
straight into the `npm-release` environment (never on disk), dispatches the publish, checks npm,
sets up trusted publishing and revokes the token. You can stop with Ctrl-C and re-run it.

## Required status checks for branch protection (O-e)

Job names from the last green `ci.yml` run on PR #6, plus `release.yml`'s `release-dry-run`. Only
jobs that run on every PR are listed (path-filtered `spec-watch.yml` `validate` is not).

```text
plan
lint
typecheck
types-ts7
build
quality
docs
unit (node 22, react 19.3.0, inertia 3.7.1)
unit (node 24, react 18.3.1, inertia 2.3.28)
unit (node 24, react 19.3.0, inertia 2.3.28)
unit (node 24, react 19.3.0, inertia 3.7.1)
zod3 (node 24, zod 3.25.76)
browser (chromium)
browser (firefox)
browser (webkit)
example-nextjs
example-laravel (bridge-cache database)
example-laravel (bridge-cache redis)
release-dry-run
```

## `npm trust` flags (O-j), re-checked

`npm trust github --help` with npm 12.1.0 (2026-09-25):
`npm trust github [package] --file [--repo|--repository] [--env|--environment] [--allow-publish] [--allow-stage-publish] [-y|--yes]`.
The O-j command below is correct as written. Your local npm is 10.9.8, which has no `trust`; use
`npx -y npm@12 trust …` (the wizard does).

## Owner steps

The controller stops before these steps. The owner runs them in order and messages the controller
after O-j. None of them may be run by an agent.

- [ ] **O-a · IP check:** confirm code ownership and employment IP terms (spec §22). If this fails,
      stop: nothing below runs.
- [ ] **O-b · npm org:** create the npm org `toolmark` on the owner's account, with account 2FA on.
- [ ] **O-c · Go public:** `gh repo edit adams100111/toolmark --visibility public --accept-visibility-change-consequences`.
      Provenance and required-reviewer environments need a public repo on the free plan.
- [ ] **O-d · Repo settings:**
  - Settings → Actions → General: enable "Allow GitHub Actions to create and approve pull
    requests", and set workflow permissions to "Read repository contents".
  - Settings → Code security: enable private vulnerability reporting, Dependabot alerts, and secret
    scanning with push protection.
  - Settings → Pages: source "GitHub Actions".
  - Then run `gh workflow run docs-deploy.yml --ref main`.
- [ ] **O-e · Branch protection on `main`:** require the `ci.yml` and `release.yml` job names listed in
      `owner-handoff.md`, require PRs, and block force-pushes. Only jobs that run on every PR may be
      required: from `release.yml` that is `release-dry-run` alone (final review I-3).
- [ ] **O-f · Environment:** Settings → Environments → `npm-release`:
  - Required reviewer: the owner only. Do not enable "prevent self-review", because the owner
    account pushes the release commit.
  - Deployment branches: `main` only.
- [ ] **O-g · Bootstrap token:** on npmjs.com, create a granular access token with read/write on the
      `@toolmark` scope (all packages), "bypass 2FA" enabled, and the shortest available expiry. Add it
      as the **environment** secret: `gh secret set NPM_BOOTSTRAP_TOKEN --env npm-release --repo adams100111/toolmark`.
- [ ] **O-h · Enable publishing:** `gh variable set TOOLMARK_PUBLISH_ENABLED --body true --repo adams100111/toolmark`.
- [ ] **O-i · Publish:** `gh workflow run release.yml --ref main`, then approve the `npm-release`
      deployment in the Actions UI after checking that the run is on the SHA in `owner-handoff.md` and
      that `ci.yml` and `release-dry-run` are green for that SHA (final review m-5). If the publish
      fails part-way, use "Re-run failed jobs" on the same run, not a new dispatch (m-3).
- [ ] **O-j · Trusted publishing:** with npm ≥ 11.15, for each of `core react inertia testing tour mcp
lint judge-typesafe` run:
      `npm trust github @toolmark/<pkg> --file release.yml --repo adams100111/toolmark --env npm-release --allow-publish`.
      Use the flags as re-checked with `npm trust --help` in pre-flight and recorded in
      `owner-handoff.md`. Then message the controller: "1.0.0 published".
- [ ] **O-k · Revoke:** `gh secret delete NPM_BOOTSTRAP_TOKEN --env npm-release --repo adams100111/toolmark`,
      and revoke the token on npmjs.com (`npm token revoke <id>`). Optional hardening: for each package,
      set npm "Require two-factor authentication and disallow tokens".
- [ ] **O-l · Actions budget (O6):** until the repo is public, the private-repo matrix needs Actions
      minutes or self-hosted runners. This is only relevant if going public is delayed.
