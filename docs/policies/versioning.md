# Versioning

Toolmark follows [Semantic Versioning](https://semver.org/) for its public API, with one
experimental carve-out.

## What semver covers

The public API is:

- Every exported type and function from a package's published entry points (the `exports` map in
  each `packages/*/package.json`, excluding `@toolmark/source`).
- React hooks (`useTool`, `useFormTool`, `useWizardTool`, the confirmation hooks, …).
- The `data-tool-*` DOM attributes the DOM adapter reads.
- Bridge protocol v1 (the message shapes in `@toolmark/core/protocol` and
  [`/protocol-v1`](../protocol-v1.md)).
- The `toolmark` Inertia page-props shape (`inertiaPages`, the Laravel props builder).
- CLI flags (`toolmark lint`, `toolmark-mcp`).

A breaking change to any of the above — a removed or renamed export, a changed function signature,
a changed protocol message shape, a changed CLI flag's meaning — requires a **major** version.

## WebMCP is experimental, outside semver

`@toolmark/core/webmcp` is **experimental** (D28): WebMCP is an origin-trial browser API whose
shape still changes between Chrome releases. Every export of that entry carries an `@experimental`
TSDoc tag. Its behaviour, option shapes and exports **may change in a minor release** while
Toolmark is on `1.x`, without a major bump. Pin an exact version, or a narrow range, if that
instability matters to you. The rest of `@toolmark/core` (and every other package) is fully
covered by semver from `1.0.0`.

## `@toolmark/source` and `src/` are internal

Every package ships its `src/` directory and a package-unique `@toolmark/source` export
condition, so a workspace or an app that explicitly opts into that condition compiles Toolmark's
TypeScript directly (used inside this monorepo and by consumers who want to debug into source).
That condition, and the shape of the files under `src/`, are **internal and outside semver** — they
can change in any release, including a patch. Only the `types`/`import` targets in `exports` (the
built `dist/` output) are the public, semver-covered surface. No package sets a generic `source`
condition in `publishConfig.exports`, so a consumer that merely sets its own `source` resolution
condition never accidentally compiles Toolmark's `.ts`.

## Release train

All eight packages (`@toolmark/core`, `@toolmark/react`, `@toolmark/inertia`, `@toolmark/testing`,
`@toolmark/tour`, `@toolmark/mcp`, `@toolmark/lint`, `@toolmark/judge-typesafe`) version and
release together as one [Changesets](https://github.com/changesets/changesets) **`fixed`** group:
every package gets the same version number on every release, even when only some of them changed.

- Every user-facing change ships with a changeset (`pnpm changeset`).
- Changesets are consumed into each package's own `CHANGELOG.md` on release.
- A GitHub release is also published for every version, summarising the same changes across all
  eight packages.

## Supported versions

| Dependency | Supported range                                                                    |
| ---------- | ---------------------------------------------------------------------------------- |
| Node.js    | `>= 22.12`                                                                         |
| React      | `>= 18.3` (`@toolmark/react`, `@toolmark/tour/react`; Inertia 3 requires React 19) |
| TypeScript | `6.0` and `7.0`                                                                    |

The CI matrix runs Node 22.x and 24.x, React 18.3.1 and 19.3.0, and `@inertiajs/react` 2 and 3
(excluding React 18.3 × Inertia 3, which cannot exist). The tarball smoke test type-checks every
public entry point under both TypeScript 6.0 and 7.0.

See also: [Deprecation policy](deprecation.md), [Tool name stability](tool-names.md).
