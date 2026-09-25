# Registry and tools

A **tool** is a named, described, schema-typed action the page can perform. The **registry**
(`createToolmark`) holds every tool the page currently offers and is the single place that
validates input, applies policy, asks for confirmation and runs the tool, whoever the caller is
(an in-app agent, WebMCP, desktop MCP, a tour or a test). Declare a tool once; every consumer sees
the same declaration (spec §5).

```ts
import { createToolmark, ok } from '@toolmark/core'
import { z } from 'zod'

const tm = createToolmark({ dev: import.meta.env.DEV })

const handle = tm.register({
  name: 'search',
  description: 'Search challenges by keyword. Use before opening or editing a challenge.',
  input: z.object({ query: z.string().describe('Keywords') }),
  hints: { readOnly: true },
  run: async ({ query }, ctx) => ok(await searchChallenges(query, ctx.signal)),
})

const result = await tm.call('search', { query: 'robotics' }, { caller: 'inapp' })
handle.dispose()
```

## The tool definition

| Field              | Purpose                                                                                                                                  |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `name`             | Local name; the full name is the scope path + `.` + `name`. A public contract: renaming breaks agents.                                   |
| `description`      | For the LLM: says **when** to use the tool (English recommended).                                                                        |
| `title`, `summary` | User-facing and app-localized (confirmation cards, tours).                                                                               |
| `input`, `output`  | Standard Schema v1 (zod, valibot, ArkType, … or `fromJsonSchema`). Input is validated before `run`; output only in development.          |
| `jsonSchema`       | Per-tool JSON Schema override when the schema library cannot produce one.                                                                |
| `hints`            | `readOnly`, `consequential`, `destructive`, `untrustedContent` — drive [policy](policy.md) and [confirmation](confirmation.md).          |
| `anchors`, `state` | Tour hooks: where the tool lives on the page and its current values (see [Anchors and state](../guides/anchors.md)).                     |
| `sensitivePaths`   | Input paths redacted from `state()`, telemetry and confirmation payloads.                                                                |
| `run(input, ctx)`  | Does the work and returns a [result](results.md). `ctx` carries `signal`, `callId`, `caller`, `confirm()`, `files` and `registerUndo()`. |

Names use `A–Z a–z 0–9 _ - .` (the MCP tool-name alphabet), at most 128 characters, with no empty
segment. Every manifest entry also carries an `llmName` (`.` → `__`; names longer than 64
characters are shortened with a stable hash) for LLM APIs that forbid dots.

## Registry API at a glance

```ts
tm.register(tool, { scope?, signal? })         // → { name, dispose() }
tm.scope(name, { when?, transparent? })         // → Scope (nest with scope.scope(...))
tm.manifest({ caller?, detail?: 'summary' | 'full' })   // sorted by name, carries rev
tm.describe(name, { caller? })                  // full entry incl. inputSchema
tm.call(name, input, { caller, rev?, signal? }) // Promise<ToolResult>, never throws
tm.confirmPending(confirmId, outcome)           // completes a deferred confirmation
tm.undo(callId)                                 // runs the restorer a call registered
tm.subscribe(listener)                          // manifest changes (debounced, carries rev)
tm.events.on('call' | 'result' | 'confirm' | 'interaction' | 'change' | 'error', fn)
tm.use(consumer)                                // bridge, webmcp, otel, mcpPairing → dispose()
tm.anchor(name, param?) · tm.state(name) · tm.info(name)
```

- **Revisions.** Every registration change bumps `rev`. A caller that passes the `rev` it last saw
  gets `refused` `stale` when the tool it named has since disappeared, instead of a confusing
  `unknown_tool`.
- **Collisions** throw in development and are rejected with an `error` event
  (`duplicate_name`) in production.
- **Removal** happens only through the handle, the registration `signal` or scope disposal.
- **Concurrency (D22).** Calls are queued per scope in arrival order; different scopes run in
  parallel. A full queue answers `refused` `busy`.
- **SSR (D24).** Without `document` (server rendering), registration and consumers are inert
  no-ops, so the same component code renders on the server. See [Next.js](../guides/nextjs.md).
- **Development vs production.** `createToolmark({ dev: true })` throws on misconfiguration; in
  production the same problem is an `error` event (codes: [reference](../reference/codes.md)).
- **Tool budget.** In development, more than `budget` (default 40) visible tools emits
  `tool_budget_exceeded`: large tool lists degrade agent accuracy.

Form tools (`<name>.fill` / `<name>.submit`), wizards, DOM-scanned forms and server-declared tools
are all ordinary registry tools built by helpers; see the [guides](../guides/forms.md).

API: [`createToolmark`](../api/@toolmark/core/functions/createToolmark.md),
[`ToolDefinition`](../api/@toolmark/core/interfaces/ToolDefinition.md),
[`Toolmark`](../api/@toolmark/core/interfaces/Toolmark.md).
