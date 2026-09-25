# Lint and the TypeSafe judge

`toolmark lint` (`@toolmark/lint`) checks the tools a page exposes for what makes agents fail:
bad names, missing descriptions, invalid schemas, name collisions, too many tools and consequential
actions without a confirmation hint. It reads **manifests**, not source code: static analysis of
TSX or Blade cannot see runtime tools (DOM-scanned, server-declared, wizards), so lint works for any
stack. Codes: [`reference/codes.md`](../reference/codes.md#toolmark-lint-m4).

```sh
pnpm add -D @toolmark/lint
pnpm exec toolmark lint --url http://localhost:5173/
# without installing:
npx -p @toolmark/lint toolmark lint --manifest tools.json
```

## Inputs

```text
toolmark lint [--manifest file]... [--url url]... [--storage-state file]
              [--judge spec]... [--budget n] [--format pretty|json]
```

- **`--manifest <file>`** (repeatable): a JSON file in one of three shapes, validated against
  `@toolmark/lint/manifest.schema.json`:
  - `{ "page": "checkout", "tools": [ToolManifest, …] }`
  - an array of those (several pages in one file)
  - the test hook's `{ "rev": 7, "tools": [ToolManifest, …] }` (page = the file's basename)

  Each tool needs `name`, `llmName`, `description`, `hints` and `inputSchema` (the full manifest,
  `tm.manifest({ detail: 'full' })`). Anything else exits `2` with `invalid manifest file: <path>`.

  ```json
  {
    "page": "challenges",
    "tools": [
      {
        "name": "challenges.search",
        "llmName": "challenges__search",
        "description": "Search challenges by keyword. Use before opening a challenge.",
        "hints": { "readOnly": true },
        "inputSchema": {
          "type": "object",
          "properties": { "query": { "type": "string", "description": "Keywords" } },
          "required": ["query"]
        }
      }
    ]
  }
  ```

- **`--url <url>`** (repeatable): opens the page in headless Chromium through Playwright and reads
  `manifest({ detail: 'full', caller: 'inapp' })` from the page's test hook
  (`installTestHook(tm)` from `@toolmark/testing/page`, installed only outside production builds).
  Needs `@playwright/test` (an optional peer; missing → exit `2`) and Chromium
  (`pnpm exec playwright install chromium`). A page without the hook exits `2` within 5 s. The
  collected manifest is validated against the same schema as `--manifest` (a malformed page tool
  exits `2` with `invalid manifest collected from <url>`).
- **`--storage-state <file>`**: a Playwright storage state for pages behind a login (the Laravel
  example saves one from a logged-in browser context).
- **`--budget <n>`**: the `tool-budget` threshold — the most tools a page may expose before
  `tool-budget` warns (positive integer, default `40`).

At least one `--manifest` or `--url` is required; with neither, lint prints the usage and exits
`2`. Tool names, titles and descriptions come from the page, so control characters (including
ESC) and bidi marks are stripped from every printed field in both formats.

- **`--format pretty|json`**: output format (default `pretty`).

## Rules

One finding per offending tool (or param). `error` findings fail the run; `warn` findings never do.

| Rule                         | Severity | Definition                                                                                                                                                                                                                                                                                       |
| ---------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `name-format`                | error    | The name fails `^[A-Za-z0-9_.-]{1,128}$` or has an empty segment (`..`, leading or trailing `.`), or `llmName` fails `^[a-zA-Z0-9_-]{1,64}$`.                                                                                                                                                    |
| `description-missing`        | warn     | `description` is empty or whitespace.                                                                                                                                                                                                                                                            |
| `description-short`          | warn     | The trimmed description is shorter than 20 characters (not also reported when missing).                                                                                                                                                                                                          |
| `param-description-missing`  | warn     | A leaf property of `inputSchema` has no `description`. For `.fill` tools the walk starts at `values` (forms) or `steps.<step>` (wizards); the message names the dot path.                                                                                                                        |
| `schema-invalid`             | error    | Ajv (draft 2020-12, formats enabled) cannot compile `inputSchema`, or its root `type` is not `object`.                                                                                                                                                                                           |
| `llm-name-collision`         | error    | Two tools on the same page share an `llmName`.                                                                                                                                                                                                                                                   |
| `tool-budget`                | warn     | The page has more tools than the budget.                                                                                                                                                                                                                                                         |
| `consequential-hint-missing` | error    | A name segment (split on `.`, `_`, `-`) or the first sentence of the description matches `delete, remove, archive, destroy, drop, cancel, refund, pay, charge, submit, send, publish, approve, reject`, and the tool has neither `consequential` nor `destructive`. `readOnly` tools are exempt. |
| `options-without-hint`       | warn     | A `<form>.options` tool exists and a field it serves lacks the `(use <form>.options to find valid values)` description suffix in `<form>.fill`, or the `.options` tool is not `readOnly`.                                                                                                        |
| `judge-failed`               | warn     | A `--judge` threw; the message names the judge and the error.                                                                                                                                                                                                                                    |

## Output and exit codes

`pretty` prints one line per finding, grouped by page, then a summary:

```text
error consequential-hint-missing challenges challenges.archive: …
warn description-short challenges challenges.search: …
1 error(s), 1 warning(s)
```

`json` prints `{ "findings": Finding[], "summary": { "errors": n, "warnings": m } }` where
`Finding` is `{ rule, severity, tool?, page?, message, score? }`.

| Exit | Meaning                                                                                                                |
| ---- | ---------------------------------------------------------------------------------------------------------------------- |
| `0`  | No `error` findings                                                                                                    |
| `1`  | At least one `error` finding                                                                                           |
| `2`  | Usage or runtime failure (bad arguments, no input, invalid manifest, missing Playwright or test hook, judge not found) |

In CI, run it against the running app in your e2e job (each Toolmark example has a `lint_clean`
spec that spawns the CLI with `--url` and expects exit `0` and the `0 error(s)` summary line).

## Judges

`--judge <spec>` (repeatable) loads a lint plugin. A spec starting with `.` or `/` resolves
against the current directory; a bare specifier resolves like `require` from the current
directory's `package.json`. The module's default export is either a `Judge` or a function that
returns one. **`--judge` executes the named module's code**: only pass modules you trust.

```ts
// my-judge.mjs — a custom judge
export default {
  name: 'house-style',
  async judge({ page, tools }) {
    return tools
      .filter((t) => !t.description.endsWith('.'))
      .map((t) => ({
        rule: 'house-style/period',
        severity: 'warn',
        page,
        tool: t.name,
        message: 'End descriptions with a period',
      }))
  },
}
```

The programmatic API is `lint({ manifests, judges?, budget? })` and
`formatFindings(findings, format)` from `@toolmark/lint`.

## The TypeSafe judge

`@toolmark/judge-typesafe` adds probabilistic checks with [TypeSafe](https://typesafe.ai)'s
models. Install it as a **devDependency** only: it is Node-only (its export has a `node` condition
and nothing for browsers) and is never bundled into an app.

```sh
pnpm add -D @toolmark/lint @toolmark/judge-typesafe
TYPESAFE_API_KEY=… pnpm exec toolmark lint --url http://localhost:5173/ --judge @toolmark/judge-typesafe
```

- **Key.** `TYPESAFE_API_KEY` (or the `apiKey` option). Without a key the judge prints
  `toolmark lint: TYPESAFE_API_KEY not set; judge-typesafe disabled` to stderr once, returns no
  findings and makes no network call; lint still runs. Keep the key in CI secrets.
- **Data sent to `api.typesafe.ai`:** the page's origin and path (for `--url` pages; the query
  string, hash and any `user:pass@` are stripped) or the manifest file's `page` name; tool names,
  titles, descriptions; and the paths and descriptions of schema properties. Never values,
  `default`, `enum`, `examples`, `const` or any other application data.
- **Time bound.** Each page's requests are bounded by `pageTimeoutMs` (default 120 s) and each
  request is retried at most once; a page that runs out of time gets one `judge/timeout` warning,
  so the judge never hangs a lint run.
- **Findings** (all `warn` by default — a probabilistic model never fails CI on its own):

| Finding                     | When                                                                                                                                   | Option (default)           |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `judge/description-quality` | The expected score (0–4 rubric: no usable guidance … precise with when-to-use and when-not-to-use) is below the threshold; `score` set | `qualityThreshold` (`1.5`) |
| `judge/consequential-hint`  | A tool without `readOnly`/`consequential`/`destructive` likely has effects the user must approve. `error` with `strictHints: true`     | `hintThreshold` (`0.85`)   |
| `judge/overlap`             | Two tools in the same scope (form/wizard siblings excluded) are likely to be confused                                                  | `overlapThreshold` (`0.8`) |
| `judge/overlap-truncated`   | More pairs than `maxPairs` on a page; the rest were skipped                                                                            | `maxPairs` (`200`)         |
| `judge/unavailable`         | The API failed (error, connection, timeout); names the error class                                                                     | —                          |
| `judge/timeout`             | The page's requests did not finish within the overall per-page bound; the page is skipped                                              | `pageTimeoutMs` (`120000`) |

To change options from the CLI, point `--judge` at a small local module:

```ts
// toolmark-judge.mjs
import { typesafeJudge } from '@toolmark/judge-typesafe'
export default () => typesafeJudge({ strictHints: true, qualityThreshold: 2 })
```

```sh
pnpm exec toolmark lint --url http://localhost:5173/ --judge ./toolmark-judge.mjs
```

API: [`@toolmark/lint`](../api/@toolmark/lint/index.md),
[`@toolmark/judge-typesafe`](../api/@toolmark/judge-typesafe/index.md).
