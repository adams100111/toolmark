# @toolmark/judge-typesafe

## 1.0.0

### Major Changes

- [`3aa8d2f`](https://github.com/adams100111/toolmark/commit/3aa8d2ff9231402345c244aadf2c2b31ff057a5c) Thanks [@adams100111](https://github.com/adams100111)! - First stable release.

### Minor Changes

- [#5](https://github.com/adams100111/toolmark/pull/5) [`dcaf0e5`](https://github.com/adams100111/toolmark/commit/dcaf0e5c5f6c2111701f1865af7b6b601576f9cb) Thanks [@adams100111](https://github.com/adams100111)! - Guided tours over the same tool declarations in the `@toolmark/tour` package (`startTour` in
  `show`, `guide` and `do` modes, authored steps or steps from an app-supplied `Planner`, the
  themeable vanilla-DOM overlay `mountTourOverlay` with `@toolmark/tour/styles.css`, and `useTour` in
  `@toolmark/tour/react`); the `toolmark lint` CLI and `lint` API in the `@toolmark/lint` package
  (manifest files or live pages via Playwright, rule ids from `name-format` to
  `options-without-hint`, `pretty`/`json` output, exit codes 0/1/2, and `manifest.schema.json`); and
  the optional TypeSafe description judge `@toolmark/judge-typesafe` (warnings only, disabled without
  an API key).

### Patch Changes

- [`238d1ef`](https://github.com/adams100111/toolmark/commit/238d1ef3edd0068554fa228d86ddee0c0a55a509) Thanks [@adams100111](https://github.com/adams100111)! - Security hardening from the 1.0 security review (docs/security/review-2026.md): a tool that
  declares only `jsonSchema` is validated against it; `fill` never writes a key an open schema does
  not declare (`"Undeclared field"`); confirmation expiry is checked against the clock at approval;
  the `callTimeoutMs` option (default 120000) bounds runs without a caller signal — signal-less calls,
  `confirmPending` runs and undo restorers; confirmation payloads redact sensitive input; form and
  wizard fills are marked `untrustedContent` in the manifest; the TypeSafe judge does not send DOM
  option lists.
- Updated dependencies [[`dcaf0e5`](https://github.com/adams100111/toolmark/commit/dcaf0e5c5f6c2111701f1865af7b6b601576f9cb), [`3aa8d2f`](https://github.com/adams100111/toolmark/commit/3aa8d2ff9231402345c244aadf2c2b31ff057a5c)]:
  - @toolmark/lint@1.0.0

## 1.0.0-next.4

### Major Changes

- First stable release.

### Patch Changes

- [`238d1ef`](https://github.com/adams100111/toolmark/commit/238d1ef3edd0068554fa228d86ddee0c0a55a509) Thanks [@adams100111](https://github.com/adams100111)! - Security review fixes (docs/security/review-2026.md): a tool that declares only `jsonSchema` is
  validated against it (SEC-1); `fill` never writes a key an open schema does not declare
  (`"Undeclared field"`, SEC-2); confirmation expiry is checked against the clock at approval
  (SEC-3); the new `callTimeoutMs` option (default 120000) bounds runs without a caller signal —
  signal-less calls, `confirmPending` runs and undo restorers (SEC-4); confirmation payloads redact
  sensitive input (SEC-5); form and wizard fills are marked `untrustedContent` in the manifest
  (SEC-6); the TypeSafe judge no longer sends DOM option lists (SEC-10).
- Updated dependencies []:
  - @toolmark/lint@1.0.0-next.4

## 0.1.0-next.3

### Minor Changes

- Fourth preview (M4, tours and tooling): guided tours over the same tool declarations in the new
  `@toolmark/tour` package (`startTour` in `show`, `guide` and `do` modes, authored steps or steps from
  an app-supplied `Planner`, the themeable vanilla-DOM overlay `mountTourOverlay` with
  `@toolmark/tour/styles.css`, and `useTour` in `@toolmark/tour/react`); the `toolmark lint` CLI and
  `lint` API in the new `@toolmark/lint` package (manifest files or live pages via Playwright, rule ids
  from `name-format` to `options-without-hint`, `pretty`/`json` output, exit codes 0/1/2, and
  `manifest.schema.json`); and the optional TypeSafe description judge `@toolmark/judge-typesafe`
  (warnings only, disabled without an API key). The existing packages only gain API-reference
  comments. Distributed as `-next` tarballs only; nothing is published to npm before 1.0.

### Patch Changes

- Updated dependencies
  - @toolmark/lint@0.1.0-next.3
