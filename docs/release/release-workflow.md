# Release workflow

`.github/workflows/release.yml` is the only workflow that publishes to npm (spec §17, §21, §22).
It follows the changesets split-job pattern (`changesets/action` v2.1.2 sub-actions) and keeps the
publish step behind five gates, each controlled by the owner. This page records how the workflow
behaves, the publish-path ruling with its sources, and the local dry run (M5 Task 7a).

## Jobs

| Job               | Runs when                                                      | Permissions                               |
| ----------------- | -------------------------------------------------------------- | ----------------------------------------- |
| `select-mode`     | `push` to `main`, `workflow_dispatch`                          | `contents: read`                          |
| `version`         | mode `version` on `main`: opens or updates the version PR      | `contents: write`, `pull-requests: write` |
| `pack`            | mode `publish`: `pnpm build`, then `changesets/action/pack`    | `contents: read`                          |
| `publish`         | the five gates below; environment `npm-release`                | `contents: write`, `id-token: write`      |
| `release-dry-run` | `pull_request` to `main`, `workflow_dispatch`: never publishes | `contents: read`                          |

The top level sets `permissions: {}` and `concurrency: release-${{ github.ref }}` without
cancellation. Every checkout uses `persist-credentials: false`, and every action is pinned to a
commit SHA. Annotated tags are dereferenced to their commits: for example, `changesets/action` tag
`v2.1.2` is the tag object `66d7d1dd…`, which points to commit `ae32849d5ba541f9ae29e40e22a623bc13562f51`.

## What stops a publish

The `publish` job runs only if all of these hold:

1. The changesets mode is `publish`: no pending changesets, and at least one package version is
   not yet on npm.
2. The repository variable `TOOLMARK_PUBLISH_ENABLED` is `'true'`. Only the owner sets it, after
   creating `npm-release`. This gate is needed because GitHub creates a missing environment on its
   first reference, and that new environment has no protection rules ([GitHub: managing
   environments][gh-env]).
3. The event is not `pull_request`, the ref is `refs/heads/main`, and the repository is public
   (`!github.event.repository.private`, SEC-18). This `if:` is only a guard, not a control: for
   `push` and `workflow_dispatch` GitHub runs the workflow file from the triggering ref, so anyone
   who can push a branch can dispatch a copy of `release.yml` without it. Gate 5 is the control.
4. The owner approves the job in the protected `npm-release` environment, where the owner is the
   only required reviewer. Environment secrets such as `NPM_BOOTSTRAP_TOKEN` are not available to
   the job until a required reviewer approves it ([GitHub: deployments and environments][gh-deploy]).
   On the Free, Pro and Team plans, required reviewers work only in public repositories, so the
   repository must be public before this gate works.
5. **Required owner gate (SEC-17):** the `npm-release` environment's deployment branch policy
   allows **`main` only** (Settings → Environments → `npm-release` → Deployment branches and tags →
   "Selected branches and tags" → `main`). npm trusted publishing binds only the repository, the
   workflow file name and the environment, not the branch, so this policy and the reviewer are the
   only things that stop a modified `release.yml` dispatched from another branch. Verify it
   (read-only) before the first publish, and after any change to the environment:

   ```sh
   gh api repos/adams100111/toolmark/environments/npm-release \
     --jq '{policy: .deployment_branch_policy, rules: [.protection_rules[].type]}'
   gh api repos/adams100111/toolmark/environments/npm-release/deployment-branch-policies \
     --jq '[.branch_policies[] | {name, type}]'
   ```

   Expect `policy` = `{"protected_branches": false, "custom_branch_policies": true}`, `rules`
   containing `required_reviewers`, and exactly one branch policy `{"name": "main", "type":
"branch"}`. Do not set `TOOLMARK_PUBLISH_ENABLED` until both hold.

After approval, the job still refuses to publish if:

- `.changeset/pre.json` exists. This covers pre mode, and also `pre exit` before
  `changeset version` has run: `changeset pre exit` only sets `"mode": "exit"`, and
  `changeset version` deletes the file (`@changesets/pre`, `@changesets/apply-release-plan`
  source). `changeset publish --from-pack-dir` does not read the pre state at all, so this explicit
  check is the only pre-mode guard on the artifact path.
- `node scripts/check-release-versions.mjs --stable` fails: all eight `@toolmark/*` versions must be
  equal, with no prerelease tag.
- npm is older than 11.5.1.
- a packed manifest has a `workspace:` range, or an internal range that does not match the package
  version (`check-release-versions --tarballs`).
- a plan entry is not a `publish` of an `@toolmark/*` package, its dist-tag is not `latest`, its
  version differs from the checked-out `package.json`, or the tarball fails its `sha256` integrity
  check from the plan.
- a tarball's own `package/package.json` names a different `name` or `version` than its plan entry,
  or declares a `preinstall`/`install`/`postinstall` script, or the plan's `tarball.path` is not a
  plain `packages/<name>-<version>.tgz` (`check-release-versions --plan`, SEC-16). npm publishes
  what the tarball says, not what the plan says.
- an existing `<name>@<version>` git tag points at a commit other than `$GITHUB_SHA` (checked
  before and after `gh release create`, which would otherwise attach the release to the existing
  tag and ignore `--target`; SEC-15).

No job that feeds `publish` (`select-mode`, `pack`) restores a package-manager or `actions/cache`
cache (`package-manager-cache: false`, SEC-14): a cache entry written by any other default-branch
job could plant a trojaned pnpm store that `pnpm build` would ship with valid provenance.
`scripts/check-workflows.mjs` enforces this for every privileged job and every job it needs.

The `publish` job runs no `pnpm install`. It holds `id-token: write` and possibly the bootstrap
token, so it runs no dependency code: only the Node built-ins, npm and `gh`.

## Publish path (ruling, 2026-09-25)

The plan's primary path was `changesets/action/publish@v2` from the `pack` artifact
(`changeset publish --from-pack-dir`). It was checked against source and docs, and it was **not
adopted**. The job uses the plan's fallback instead: it runs
`npm publish <tgz> --access public --tag latest --provenance` for each packed tarball, in the order
of the publish plan. Then `gh release create` makes each `<name>@<version>` tag and GitHub release
at `$GITHUB_SHA`. This replaces `create-github-releases: true`, and it needs no git push, so
checkout keeps `persist-credentials: false`. A package whose version is already on npm is skipped,
so a failed run can be re-run.

Reasons:

- In a pnpm workspace, `@changesets/cli` 3.0.3 publishes through `pnpm publish <tgz> --json --access
<a> --tag <t> --no-git-checks`, not through npm (`dist/getPublishPlan.mjs`: `getPublishTool`
  selects the pnpm tool; the npm tool is used only in npm workspaces). No `--provenance` is passed.
- pnpm 12 publishes natively (since pnpm 11, "The publish flow is now native to pnpm, removing the
  dependency on the npm CLI", [pnpm 11.0 release notes][pnpm11]). It runs the OIDC exchange itself
  (`pnpm/crates/publish/src/oidc.rs`). Provenance is attached only when `--provenance` is passed, or
  when an OIDC exchange succeeds for a public repository (`oidc/provenance.rs`,
  `cli_args/publish/options.rs`: "An absent `--provenance` leaves the decision to the OIDC flow").
  `NPM_CONFIG_PROVENANCE` and `publishConfig.provenance` are not read.
- So the first publish, an owner bootstrap with a token (spec §17), would ship **without
  provenance** on the changesets path. npm ≥ 11.5.1 with `--provenance` signs the bootstrap publish,
  and it also signs every later OIDC publish.
- npm trusted publishing needs npm CLI ≥ 11.5.1, Node ≥ 22.14.0, `id-token: write` and a
  GitHub-hosted runner. It generates provenance automatically. Provenance is not supported from
  private repositories, even for public packages ([npm: trusted publishers][npm-tp]). Node 24.21.0
  (current `24.x`) bundles npm 11.19.0 ([nodejs.org/dist/index.json][node-index]).
- `npm publish` of a prerelease version needs an explicit `--tag` (npm 11 error "You must specify a
  tag using --tag when publishing a prerelease version"). The dry run passes the plan's tag, and the
  publish job accepts only `latest`.

Auth: if the environment secret `NPM_BOOTSTRAP_TOKEN` is not empty, the step exports it as
`NODE_AUTH_TOKEN` (the first publish). Otherwise it relies on OIDC trusted publishing. The npm CLI
"automatically detects OIDC environments and uses them for authentication before falling back to
traditional tokens" ([npm: trusted publishers][npm-tp]).

Owner configuration used after the bootstrap (npm 11.19.0 `npm trust --help`):
`npm trust github [package] --file [--repo|--repository] [--env|--environment] [--allow-publish]`,
plus `npm trust list [package]` and `npm trust revoke [package] --id=<trust-id>`. The `--file`
value is `release.yml`, and `--environment` is `npm-release`.

## Changelog

`.changeset/config.json` uses `["@changesets/changelog-github", { "repo": "adams100111/toolmark" }]`
(root devDependency `@changesets/changelog-github` 1.0.1). It reads `GITHUB_TOKEN`. The `version`
job gets it from the action. For a local `changeset version`, run
`GITHUB_TOKEN=$(gh auth token) pnpm changeset version`.

## Local dry run (2026-09-25)

These are the same steps as the `release-dry-run` job. They were run on `m5/task-7a` (base
`1d87162`), in pre mode `next`, with all eight packages at `0.1.0-next.3`, on Node 22.23.2, pnpm
12.6.0 and `npx npm@11.19.0`. Nothing was published.

```sh
pnpm build
pnpm changeset publish-plan --output "$T/publish-plan.json"
pnpm changeset pack --from-publish-plan "$T/publish-plan.json" --out-dir "$T/dist-pack"
# per plan entry: sha256 integrity check, then
npm publish "$T/dist-pack/<path>" --dry-run --access public --tag <plan tag> --ignore-scripts
node scripts/check-release-versions.mjs --tarballs "$T/dist-pack"
pnpm -r --filter "./packages/*" pack --pack-destination "$T/dist-tarballs"
node scripts/tarball-smoke.mjs "$T/dist-tarballs" "$T/dist-pack/packages"
publint run <tgz> --strict && attw <tgz> --profile esm-only --exclude-entrypoints ./styles.css
TOOLMARK_DIST=1 pnpm -F @toolmark-examples/react-vite exec playwright test \
  e2e/round-budget.spec.ts e2e/same-tools.spec.ts e2e/tour.spec.ts --project=chromium
```

Results:

- **Publish plan:** 8 packages, none on the registry. Every package is at `0.1.0-next.3` with
  dist-tag `next`, in 3 chunks: `core`, then `inertia`, `lint`, `mcp`, `react`, `testing` and
  `tour`, then `judge-typesafe`.
- **npm dry run:** 8 of 8 exit 0. Each prints "Publishing to https://registry.npmjs.org/ with tag
  next and public access (dry-run)". The integrity of all 8 tarballs matches the plan. No npm
  warnings. Without the plan's `--tag`, all 8 fail on the prerelease-tag rule, and this is why the
  job passes the tag.
- **Internal ranges:** `check-release-versions --tarballs`: 8 passed, 0 failed.
- **Tarball smoke** (both sets): `tarball-smoke: 216 passed, 0 failed`.
- **publint `--strict` and attw `esm-only`:** exit 0 on all 8 changesets tarballs.
- **RC e2e on dist** (chromium): 9 passed (round budget, same tools, tours).
- The changesets-packed tarballs are byte-identical to the `pnpm pack` tarballs:

| Tarball                                    | Bytes  | SHA-256                                                            |
| ------------------------------------------ | ------ | ------------------------------------------------------------------ |
| `toolmark-core-0.1.0-next.3.tgz`           | 269120 | `cd00f49164ff067aa6ef9eb3472d59c14350ba69884af5efc57230a8c69024cb` |
| `toolmark-inertia-0.1.0-next.3.tgz`        | 30699  | `50c39275e271cde5acae65fe8b2ece75539f846a9e8332aa999e515b9fb39fcb` |
| `toolmark-judge-typesafe-0.1.0-next.3.tgz` | 11457  | `4adaa4e15e859cdc4c9be26292551bca8c7618b4ac8ee2f2cdc8c6560df3c3ec` |
| `toolmark-lint-0.1.0-next.3.tgz`           | 22898  | `ecf3c61da9c49675e96767de4ad82094c33aa4bb5b58a5cc6cd1383509ae43ac` |
| `toolmark-mcp-0.1.0-next.3.tgz`            | 55490  | `6a857ba5c06009d19e23f7b9e6c44145e2dbe6be624ddf7321a50d286d50a4e4` |
| `toolmark-react-0.1.0-next.3.tgz`          | 33970  | `5c45f703714d476bbe2892c69edcca399a9ae1636098bf478d413f02945affec` |
| `toolmark-testing-0.1.0-next.3.tgz`        | 9160   | `ba8222455a5b4f85fd331692121990486e3e366e79fa6e929c98bc9a92db8a40` |
| `toolmark-tour-0.1.0-next.3.tgz`           | 33256  | `6405fcbe0c330dd05f7bd47f4a3aab6c70f5785f44e14ad6014307f14b28b942` |

The version gates behaved as expected in this pre-mode state. `--stable` failed for all 8
(prerelease tag `-next.3`), and `--pre next` failed for all 8 (not `1.0.0-next.<n>`, because the
major changeset is Task 7b). This shows that `publish` would refuse to run on this tree even
without the `pre.json` check.

The PR-triggered `release-dry-run` job has not run yet: agents do not push. It runs on the first PR
to `main` that contains this workflow.

[gh-env]: https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments
[gh-deploy]: https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments
[npm-tp]: https://docs.npmjs.com/trusted-publishers
[pnpm11]: https://github.com/pnpm/pnpm.io/blob/main/blog/releases/11.0.md
[node-index]: https://nodejs.org/dist/index.json
