# Tool name stability

A tool's **name** and its derived **`llmName`** are a public contract of your app, not an
implementation detail — every agent surface (in-app bridge, WebMCP, desktop MCP, tours, lint,
tests) addresses a tool by these strings, and an agent, a saved tour, a test suite or an external
integration may reference them outside your source tree. Treat a tool rename the same way you'd
treat a public URL or API-endpoint rename.

## The name regex

A full tool name (including any scope prefix) must match:

```
^[A-Za-z0-9_.-]{1,128}$
```

ASCII letters, digits, `_`, `.` and `-`, 1–128 characters. This is the MCP tool-name rule, and it
is enforced at registration (`invalid_name` / a thrown error in development, an `error` event in
production for a name that fails it).

## `llmName`

`llmName` is the name an LLM actually calls, derived deterministically from the full name:

1. Every `.` becomes `__` (scope separators become double underscores).
2. If that result is 64 characters or fewer, it **is** `llmName`.
3. Otherwise it is truncated to the first 55 characters, followed by `_` and the 8-hex-digit
   FNV-1a hash of the **full original name** — so two long names that share a 55-character prefix
   never collide.

The result always matches `^[a-zA-Z0-9_-]{1,64}$` (MCP's LLM-name limit). A collision between two
tools' `llmName`s is a registration error (`duplicate_name`), not a silent rename.

## Rename guidance

Because `llmName` is derived from the name, **renaming a tool changes its `llmName` too** — any
agent memory, saved tour, external MCP client config or documentation that references the old
`llmName` breaks. Before renaming a shipped tool:

- Treat it as a breaking change to your app's own agent-facing contract, on your own release
  cadence (Toolmark's [deprecation policy](deprecation.md) governs the _library's_ exports, not
  the tool names your app declares with them).
- Where practical, keep the old name registered as a thin alias that forwards to the new
  implementation for at least one release, so in-flight agent context and saved tours referencing
  the old `llmName` keep working.
- Update any tour steps, lint manifests, or MCP client configuration that name the tool explicitly.
- If the rename crosses a scope boundary (moving a tool into or out of a `tm.scope(...)`), remember
  that the prefix is part of the full name and therefore part of `llmName`'s input — a scope move
  is a rename even if the tool's own local name is unchanged, unless the scope is
  `{ transparent: true }`.

See also: [Versioning](versioning.md), [Deprecation policy](deprecation.md).
