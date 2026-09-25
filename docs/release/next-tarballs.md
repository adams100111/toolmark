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
| `toolmark-core-0.1.0-next.0.tgz`    | 90209 | `840e74af1405fb2a7c66aa5c53d54211ff1d83f92402e699f65aeb9c0f3b7ba7` |
| `toolmark-inertia-0.1.0-next.0.tgz` | 6120  | `38444f66f0830e157d0903205e84fd3cba2b7ce9b1bc32244782405f85b5beca` |
| `toolmark-react-0.1.0-next.0.tgz`   | 13938 | `9b08166aa4dd61e1ff4986c3e08fffdb03ab8ecf8360778f41afd63d5032bf9e` |
| `toolmark-testing-0.1.0-next.0.tgz` | 8428  | `a0c8355694664423c8def987613bfd4bdac251eddc34cbc2a61ca229eeadd24d` |

**Smoke result: pass** — `tarball-smoke: 43 passed, 0 failed` (Node 22.23.2, pnpm 12.6.0, macOS):

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

## Consumer recipe (optional)

1. Vendor the tarballs into the consuming repo, e.g. `vendor/toolmark/*.tgz`, and check the SHA-256
   values above.
2. Reference every Toolmark package you use as a `file:` dependency:

   ```json
   {
     "dependencies": {
       "@toolmark/core": "file:vendor/toolmark/toolmark-core-0.1.0-next.0.tgz",
       "@toolmark/react": "file:vendor/toolmark/toolmark-react-0.1.0-next.0.tgz"
     }
   }
   ```

3. Map **every** `@toolmark/*` package to its tarball with overrides, so the tarballs' own
   dependencies (`"@toolmark/core": "0.1.0-next.0"`, which is not on npm) resolve to the vendored
   files too. pnpm ≥ 11 reads overrides from `pnpm-workspace.yaml` (it ignores the `pnpm` field in
   `package.json`):

   ```yaml
   # pnpm-workspace.yaml
   overrides:
     '@toolmark/core': file:vendor/toolmark/toolmark-core-0.1.0-next.0.tgz
     '@toolmark/react': file:vendor/toolmark/toolmark-react-0.1.0-next.0.tgz
     '@toolmark/inertia': file:vendor/toolmark/toolmark-inertia-0.1.0-next.0.tgz
     '@toolmark/testing': file:vendor/toolmark/toolmark-testing-0.1.0-next.0.tgz
   ```

   With pnpm ≤ 10 put the same map under `"pnpm": { "overrides": { … } }` in `package.json`; with
   npm use the top-level `"overrides"` field.

4. For local development against a Toolmark checkout instead, use `link:` (e.g.
   `"@toolmark/core": "link:../toolmark/packages/core"`) after `pnpm build` in the checkout.
