<!--
Thanks for the contribution! Please fill this in — see CONTRIBUTING.md for the full process.
-->

## What does this change

<!-- A short description of the change and why it's needed. Link any related issue. -->

## Checklist

- [ ] I added a [changeset](https://github.com/changesets/changesets) (`pnpm changeset`) for every
      user-facing change, or this PR doesn't need one (docs-only / test-only / internal tooling).
- [ ] Every export I added or changed in `packages/*/src/**` has TSDoc (`pnpm docs:api:strict`
      passes locally), or this PR touches no package exports.
- [ ] **Security-relevant?** This PR touches input validation, policy/confirmation, the bridge or
      MCP pairing protocol, redaction of sensitive fields, or file/URL fetching (§14). If checked,
      please say what changed and why it's still safe in the description above.

## Test plan

<!-- How did you verify this? Which commands did you run (pnpm test, pnpm test:all, a specific
     e2e spec, ...)? -->
