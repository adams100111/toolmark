# @toolmark/lint

Static lint for Toolmark tool manifests: the `toolmark lint` CLI (and a programmatic `lint()`)
checks what makes agents fail — bad names, missing or short descriptions, invalid input schemas,
LLM-name collisions, too many tools per page, consequential actions without a hint. It reads
**manifests** (a JSON file, or a live page's test hook through Playwright), not source code, so it
works for any stack.

```sh
pnpm add -D @toolmark/lint
```

ESM only; Node ≥ 22.12. `@playwright/test` ≥ 1.63 is an optional peer (only for `--url`, which
also needs Chromium: `pnpm exec playwright install chromium`).

```sh
pnpm exec toolmark lint --url http://localhost:5173/
pnpm exec toolmark lint --manifest tools.json --format json
# without installing:
npx -p @toolmark/lint toolmark lint --manifest tools.json
```

```text
Usage: toolmark lint [options]

  --manifest <file>        Lint a manifest file (repeatable)
  --url <url>              Lint tools collected from a live page (repeatable)
  --storage-state <file>   Playwright storage state for --url
  --judge <spec>           Load a judge module (repeatable)
  --budget <n>             Tool-budget threshold (default: 40)
  --format <pretty|json>   Output format (default: pretty)
```

At least one `--manifest` or `--url` is required. Manifests (files and `--url` pages alike) are
validated against `@toolmark/lint/manifest.schema.json`.

| Exit | Meaning                                                                                   |
| ---- | ----------------------------------------------------------------------------------------- |
| `0`  | No `error` findings                                                                       |
| `1`  | At least one `error` finding                                                              |
| `2`  | Usage or runtime failure (bad arguments, no input, invalid manifest, missing Playwright…) |

**`--judge <spec>` loads and runs code**: the named module (a path, or a package resolved from the
current directory) is imported and executed as part of the lint run. Only pass modules you trust.
[`@toolmark/judge-typesafe`](https://www.npmjs.com/package/@toolmark/judge-typesafe) is the
optional TypeSafe judge.

Guide (manifest shapes, rules, judges): [docs/guides/lint.md](https://github.com/adams100111/toolmark/blob/main/docs/guides/lint.md).

Docs: [Lint guide](https://adams100111.github.io/toolmark/guides/lint) ·
[API reference](https://adams100111.github.io/toolmark/api/@toolmark/lint/).

## License

MIT
