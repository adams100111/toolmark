# @toolmark/lint

## 1.0.0-next.4

### Major Changes

- First stable release.

### Patch Changes

- Updated dependencies [[`238d1ef`](https://github.com/adams100111/toolmark/commit/238d1ef3edd0068554fa228d86ddee0c0a55a509)]:
  - @toolmark/core@1.0.0-next.4

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

- @toolmark/core@0.1.0-next.3
