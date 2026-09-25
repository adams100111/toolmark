# `-next` tarballs

Pre-1.0 builds are not published to npm (nothing is published before M5). The final lane of each
milestone versions the packages in changesets pre mode `next`, packs them and verifies the packed
tarballs with the tarball smoke test:

```sh
pnpm changeset version
pnpm build
pnpm -r --filter "./packages/*" pack --pack-destination "$PWD/dist-tarballs"
node scripts/tarball-smoke.mjs dist-tarballs
```

`dist-tarballs/` is git-ignored; this log records what was built. Handing tarballs to a consumer is
an optional courtesy, never a release gate.

## M1 — `0.1.0-next.0` (2026-09-25)

Packed from commit `c1b6e02` (`chore(release): version 0.1.0-next.0`) on branch `m1/lane-f`.

| Tarball                             | Bytes | SHA-256                                                            |
| ----------------------------------- | ----- | ------------------------------------------------------------------ |
| `toolmark-core-0.1.0-next.0.tgz`    | 95915 | `cd8cc5c66a64ac3498a663f8eae167957274dc5fc6fbb95fba9512ce072a1da9` |
| `toolmark-inertia-0.1.0-next.0.tgz` | 6769  | `6e8ec47ec512d484a0a5a2d375fba90e26728252d2bd94b47bd2668056343372` |
| `toolmark-react-0.1.0-next.0.tgz`   | 16578 | `e62565a5deae6e000c4292622fdbf5f2f11582abaac7052cd6a8dd4fe1c8ca12` |
| `toolmark-testing-0.1.0-next.0.tgz` | 8605  | `6d90ca8bcd154160df042ad4dbbbd0b1eca565820cc0ccc25eae29233658bccf` |

**Smoke result: pass** — `tarball-smoke: 56 passed, 0 failed` after the M1 final-review fixes (the added per-entry `types` checks raise the count; Node 22.23.2, pnpm 12.6.0, macOS):

- `pnpm install` of the four tarballs (`file:` dependencies + `overrides`) in a temp project
  outside the workspace, with the peers at the catalog versions (`react` 19.3.0,
  `react-hook-form` 7.88.0, `@inertiajs/react` 3.7.1, `@playwright/test` 1.63.0).
- `exports`: 19 entries, every target present (including the expanded
  `@toolmark/core/protocol/v1/*.json` wildcard: `agent-to-page.json`, `page-to-agent.json`); 13 JS
  entries dynamically imported by `node` without a DOM (browser-only list empty); 6 JSON entries
  parsed.
- Types: `tsc --noEmit` over all 13 JS entries with TypeScript 6.0.3
  (`node node_modules/typescript/bin/tsc`) and TypeScript 7.0.2
  (`node node_modules/typescript-7/bin/tsc`: `typescript@7.0.2` ships a `tsc` bin, not `tsgo`),
  each with `nodenext` and `preserve`/`bundler`, `strict`, `skipLibCheck: false`,
  `types: ['node']`, no `customConditions`: 4/4 pass.
- Bins: none declared in M1.

## M2 — `0.1.0-next.1` (2026-09-25)

Packed from commit `1f75289` (`chore(release): version 0.1.0-next.1`) on branch `m2/task-12`.

| Tarball                             | Bytes  | SHA-256                                                            |
| ----------------------------------- | ------ | ------------------------------------------------------------------ |
| `toolmark-core-0.1.0-next.1.tgz`    | 217852 | `99ef8d0bc899a049b7739feff705a0ebc03e22405ff38b33cf4e1c9a7e3b6f16` |
| `toolmark-inertia-0.1.0-next.1.tgz` | 29469  | `e6c7f93cd77eacb6c8dcc246d31a0a5b013eb101944d796a2d6f60910254fd1c` |
| `toolmark-react-0.1.0-next.1.tgz`   | 25736  | `628dcbcbca1d13a1338c8e5848028eaa52575bde7539886564b3f814c2bb9445` |
| `toolmark-testing-0.1.0-next.1.tgz` | 8605   | `df142a7acacad73cee27f018ebfeb1cab5ab55d94a2d26a6f14954dab75e7a39` |

**Smoke result: pass** — `tarball-smoke: 59 passed, 0 failed` (Node 22.23.2, pnpm 12.6.0, macOS):

- `pnpm install` of the four tarballs (`file:` dependencies + `overrides`) in a temp project
  outside the workspace, with the peers at the catalog versions (`react` 19.3.0,
  `react-hook-form` 7.88.0, `@inertiajs/react` 3.7.1, `@playwright/test` 1.63.0).
- `exports`: 20 entries, every target present — one more than M1: the new `@toolmark/core/dom`
  entry (`scanDom`, `synthesizeFormSchema`, `domFormAdapter`); 14 JS entries dynamically imported
  by `node` without a DOM, including `@toolmark/core/dom` itself (it has no top-level DOM access,
  so `BROWSER_ONLY` in `scripts/tarball-smoke.mjs` stays empty, unchanged from M1); 6 JSON entries
  parsed.
- Types: `tsc --noEmit` over all 14 JS entries with TypeScript 6.0.3
  (`node node_modules/typescript/bin/tsc`) and TypeScript 7.0.2
  (`node node_modules/typescript-7/bin/tsc`), each with `nodenext` and `preserve`/`bundler`,
  `strict`, `skipLibCheck: false`, `types: ['node']`, no `customConditions`: 4/4 pass.
- Bins: none declared in M2.

## M3 — `0.1.0-next.2` (2026-09-25)

Packed from commit `68a6cee` (`chore(release): version 0.1.0-next.2`) on branch `feat/m3-reach`,
after merging `main` (M2, `0.1.0-next.1`). M3's own earlier `0.1.0-next.1` tarballs (branch
`m3/task-7`, before the merge) are superseded: the M3 changeset was re-applied on top of M2's
versions, so the fixed group moves to `0.1.0-next.2`. `@toolmark/mcp` joins the fixed group.

| Tarball                             | Bytes  | SHA-256                                                            |
| ----------------------------------- | ------ | ------------------------------------------------------------------ |
| `toolmark-core-0.1.0-next.2.tgz`    | 263777 | `8f71fdd6541c99ee58e241618ec7cf0687cf2db91084a45527cb7e21bc29c7e7` |
| `toolmark-inertia-0.1.0-next.2.tgz` | 29634  | `a5c8289f4b3876a4d96a6ce00c10b6d5cd8c6f184d216cdc13da315cade73954` |
| `toolmark-mcp-0.1.0-next.2.tgz`     | 53542  | `e7bc34bf319f7963944fdd2a2b9bf6c60173668c916cf630746f5d8c22d93b8b` |
| `toolmark-react-0.1.0-next.2.tgz`   | 31184  | `04ab7c03a94d4debe2da1837da94c7af8d6967ad0da8307ec3b30a74899236a5` |
| `toolmark-testing-0.1.0-next.2.tgz` | 8607   | `40c505beb9766e2c6895b865e388dbd6fb7d5a4ed87e892c9b683a651b8ea44d` |

**Smoke result: pass** — `tarball-smoke: 74 passed, 0 failed` (Node 22.23.2, pnpm 12.6.0, macOS):

- `pnpm install` of the five tarballs in a temp project outside the workspace.
- `exports`: 25 entries, every target present; 18 JS entries (M2's `@toolmark/core/dom` plus M3's
  `@toolmark/core/webmcp`, `@toolmark/core/otel`, `@toolmark/mcp` and `@toolmark/mcp/client`)
  dynamically imported by `node` without a DOM (browser-only list still empty); 7 JSON entries
  parsed.
- Types: `tsc --noEmit` over all 18 JS entries with TypeScript 6.0.3 and 7.0.2, each with
  `nodenext` and `preserve`/`bundler`: 4/4 pass.
- Bins: `toolmark-mcp --help` passes.

## Consumer recipe (optional)

1. Vendor the tarballs into the consuming repo, e.g. `vendor/toolmark/*.tgz`, and check the SHA-256
   values above.
2. Reference every Toolmark package you use as a `file:` dependency:

   ```json
   {
     "dependencies": {
       "@toolmark/core": "file:vendor/toolmark/toolmark-core-0.1.0-next.1.tgz",
       "@toolmark/react": "file:vendor/toolmark/toolmark-react-0.1.0-next.1.tgz"
     }
   }
   ```

3. Map **every** `@toolmark/*` package to its tarball with overrides, so the tarballs' own
   dependencies (`"@toolmark/core": "0.1.0-next.1"`, which is not on npm) resolve to the vendored
   files too. pnpm ≥ 11 reads overrides from `pnpm-workspace.yaml` (it ignores the `pnpm` field in
   `package.json`):

   ```yaml
   # pnpm-workspace.yaml
   overrides:
     '@toolmark/core': file:vendor/toolmark/toolmark-core-0.1.0-next.1.tgz
     '@toolmark/react': file:vendor/toolmark/toolmark-react-0.1.0-next.1.tgz
     '@toolmark/inertia': file:vendor/toolmark/toolmark-inertia-0.1.0-next.1.tgz
     '@toolmark/testing': file:vendor/toolmark/toolmark-testing-0.1.0-next.1.tgz
     '@toolmark/mcp': file:vendor/toolmark/toolmark-mcp-0.1.0-next.1.tgz
   ```

   With pnpm ≤ 10 put the same map under `"pnpm": { "overrides": { … } }` in `package.json`; with
   npm use the top-level `"overrides"` field.

4. For local development against a Toolmark checkout instead, use `link:` (e.g.
   `"@toolmark/core": "link:../toolmark/packages/core"`) after `pnpm build` in the checkout.
