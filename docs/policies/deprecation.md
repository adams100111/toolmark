# Deprecation policy

Toolmark deprecates before it removes, with one exception: while `@toolmark/core/webmcp` is
[experimental](versioning.md#webmcp-is-experimental-outside-semver), it may change in a minor
release without going through this process.

## What a deprecation looks like

When a public export, option, CLI flag or protocol field is replaced or scheduled for removal:

1. It keeps working for **at least one minor version** before it is removed in the next major.
2. Its TSDoc gets an `@deprecated` tag naming the replacement, so editors surface the warning and
   the generated API reference marks it:

   ```ts
   /**
    * ...
    * @deprecated Use {@link newThing} instead. Removed in the next major.
    */
   export function oldThing(): void {}
   ```

3. In development builds, using it once emits a `console.warn` naming the replacement (never in
   production builds, so it never adds runtime cost or noise to an app's production console).
4. The changeset that introduces the deprecation calls it out explicitly (`patch` or `minor`, per
   semver — a deprecation is not itself a breaking change), and it appears in that release's
   changelog entry and GitHub release notes.
5. The next major version's changeset and changelog entry list every deprecation it removes.

## Protocol v1

Bridge protocol v1 (`@toolmark/core/protocol`) is versioned independently of the packages that
implement it. A **breaking** change to a v1 message shape — anything an already-deployed agent or
page could not tolerate — requires a **new protocol version** (v2), shipped alongside v1 rather
than mutating it in place; the two are negotiated, not silently swapped. Additive, backwards
compatible fields (new optional properties an old client can ignore) do not require a new protocol
version, but still follow the deprecation process above if they replace an existing field.

## What does not go through this process

- Fixes to bugs that make current behaviour match its documented contract are not deprecations,
  even when the corrected behaviour differs from what some code relied on.
- `@toolmark/source` and the shipped `src/` are internal and outside semver
  ([versioning](versioning.md#toolmarksource-and-src-are-internal)); nothing under them is
  deprecated in the sense above.
- `@internal`-tagged exports (present for cross-package wiring, excluded from the generated API
  reference) carry no stability promise and can change or disappear at any time.

See also: [Versioning](versioning.md), [Tool name stability](tool-names.md).
