# Contributing to Toolmark

Thanks for considering a contribution. Toolmark is a pnpm workspace with eight packages
(`packages/*`) and three runnable examples (`examples/*`); see the root [README](README.md) for
the project pitch and [`docs/`](docs/) for guides, concepts, protocol and API reference.

## Reporting a security issue

**Do not open a GitHub issue for a security vulnerability.** See [SECURITY.md](SECURITY.md) for
the private reporting channel.

## Setup

Requires Node `>= 22.12` and pnpm 12 (installed via [Corepack](https://nodejs.org/api/corepack.html)):

```sh
corepack enable
pnpm install
pnpm exec playwright install chromium   # once, for browser-mode tests and e2e
```

## Everyday commands

| Command             | Runs                                                                                         |
| ------------------- | -------------------------------------------------------------------------------------------- |
| `pnpm build`        | Builds every package (`packages/*`)                                                          |
| `pnpm typecheck`    | Type-checks every package                                                                    |
| `pnpm lint`         | ESLint over every package                                                                    |
| `pnpm test`         | The Vitest suite (unit + DOM/browser projects)                                               |
| `pnpm format:check` | Prettier, check-only                                                                         |
| `pnpm docs:build`   | Generates the API reference and builds the docs site                                         |
| `pnpm test:all`     | The full local gate: lint, typecheck, test, build, quality, and every example's `e2e` script |

Run `pnpm test:all` before opening a pull request; CI runs the same checks (and more, across the
full Node/React/Inertia/browser matrix) on every PR.

## Making a change

1. **Fork or branch**, then make your change. If it touches `packages/*/src/**`, write or update
   the TSDoc on every export you add or change (see below) — this is not optional, it's what keeps
   `pnpm docs:api:strict` green.
2. **Add tests first** for behaviour changes (this project follows test-driven development);
   Vitest for unit/DOM behaviour, Playwright (`@toolmark/testing`) for end-to-end behaviour in an
   example app.
3. **Add a changeset** for any user-facing change (a change to a published package's behaviour,
   API surface, or CLI):

   ```sh
   pnpm changeset
   ```

   Pick every affected package (the eight packages release together as one
   [Changesets](https://github.com/changesets/changesets) `fixed` group, so they always share a
   version number even when only one changed) and a semver bump appropriate to the change. Write
   the changeset summary as you'd want it to read in the changelog — it ends up there verbatim.
   Not every change needs one: docs-only, test-only and internal-tooling changes don't.

   The repository is currently in **changesets pre mode** (`next` tag, see
   [`docs/policies/versioning.md`](docs/policies/versioning.md)) ahead of the `1.0.0` release; pre
   mode is removed once `1.0.0` ships, after which every changeset targets a normal `1.x` release.

4. **Commit using [Conventional Commits](https://www.conventionalcommits.org/)**
   (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`, …), optionally scoped to the package
   you touched, e.g. `fix(core): reject prototype-pollution paths in fill`.
5. **Open a pull request** against `main` and fill in the PR template, including its changeset,
   TSDoc and security-relevance checkboxes.

## TSDoc

Every exported type, function, class member and React hook gets a TSDoc comment written in the
same change that adds or changes it — this is enforced in CI (`pnpm docs:api:strict`, TypeDoc's
`notDocumented`/`notExported` validation as errors). A comment needs at least a one-line summary,
and `@param`/`@returns` wherever the meaning isn't obvious from the signature. An export that
changes behaviour in a minor release while staying outside semver (currently only
`@toolmark/core/webmcp`, see [`docs/policies/versioning.md`](docs/policies/versioning.md)) carries
an `@experimental` tag; an export scheduled for removal carries `@deprecated` (see
[`docs/policies/deprecation.md`](docs/policies/deprecation.md)).

## Code style

Prettier and ESLint (with `typescript-eslint`, type-checked) are the source of truth; `pnpm lint`
and `pnpm format:check` must be clean. No package depends on another workspace package's `src`
directly at runtime except through its published export map; `@toolmark/core` has zero runtime
dependencies, and CI enforces that.

## License

By contributing, you agree that your contributions are licensed under the project's
[MIT license](LICENSE).
