# @toolmark/judge-typesafe

Optional `toolmark lint` judge backed by [TypeSafe](https://typesafe.ai)'s Jev models: probabilistic
checks for description quality, missing consequential/destructive hints, and tool pairs an agent
could confuse for one another — on top of `@toolmark/lint`'s built-in static rules.

```sh
pnpm add -D @toolmark/judge-typesafe
```

Install it as a **devDependency**: it's a lint-time judge, run by `toolmark lint --judge`, and is
never bundled into an app. ESM, Node-only (its `node` export condition dynamic-imports the
`@typesafe-ai/sdk`); Node ≥ 22.12.

It sends only **tool names, titles, descriptions and JSON Schema parameter paths/descriptions**
from the page's manifest to `api.typesafe.ai` — never parameter values, `default`, `enum`,
`examples`, `const`, or any other application data.

Requires a `TYPESAFE_API_KEY` environment variable (or `apiKey` below). Without one, the judge
prints a one-line warning to stderr, returns no findings, and makes no network calls or SDK client
construction at all.

```sh
TYPESAFE_API_KEY=... pnpm toolmark lint --manifest tools.json --judge @toolmark/judge-typesafe
```

`--judge` loads and runs the named module's code (here, this package) as part of the lint run —
only pass `--judge` specs you trust.

```ts
// or configure it programmatically and pass the Judge to `lint({ judges: [...] })`
import { typesafeJudge } from '@toolmark/judge-typesafe'

const judge = typesafeJudge({
  qualityThreshold: 1.5, // default
  hintThreshold: 0.85, // default
  overlapThreshold: 0.8, // default
  maxPairs: 200, // default
  strictHints: false, // default; `true` makes judge/consequential-hint an error
})
```

Findings: `judge/description-quality`, `judge/consequential-hint`, `judge/overlap`,
`judge/overlap-truncated` (warn; all `warn` except `judge/consequential-hint` under
`strictHints`), and `judge/unavailable` (warn, on an SDK/network error — the judge never throws).

## License

MIT
