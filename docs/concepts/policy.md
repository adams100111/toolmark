# Policy

A tool's **hints** put it in one hint class; **policy** decides, per [caller](callers.md), which
classes and names that caller can see and call (spec §7).

| Hint class      | Confirmation                          | Default exposure                                  |
| --------------- | ------------------------------------- | ------------------------------------------------- |
| `readOnly`      | never                                 | every caller                                      |
| (none)          | no                                    | every caller                                      |
| `consequential` | required unless the caller is `human` | `inapp`, `webmcp`, `mcp`, `tour`, `test`, `human` |
| `destructive`   | required; never auto-submitted        | `inapp`, `test`, `human`                          |

The class is the strongest hint present: `destructive` > `consequential` > `readOnly` > none.

```ts
const tm = createToolmark({
  policy: {
    // WebMCP may only read; replaces its default classes.
    webmcp: { allow: ['readOnly'] },
    // MCP keeps its default classes but never sees billing tools.
    mcp: { tools: { deny: ['billing.*'] } },
    // The in-app agent may use only the challenge tools (deny still wins).
    inapp: { tools: { allow: ['challenges.*'], deny: ['challenges.delete'] } },
  },
})
```

- `policy[caller].allow` (hint classes) **replaces** that caller's defaults; omitted, the defaults
  stay and `tools` still filters. Callers not listed keep their defaults.
- `policy[caller].tools` filters by full name or `prefix.*`; **deny wins** over allow.
- `human` is fixed and not configurable; `policy.human` or an unknown hint class is
  `invalid_policy` (development throw, production event).
- Policy filters both `manifest()`/`describe()` and `call()`: a hidden tool answers
  `refused` `not_allowed`.
- A caller in inline confirmation mode with no `confirm` handler does not see consequential or
  destructive tools at all (see [Confirmation modes](confirmation.md)).

Policy is agent UX and safety on the client. It is **not** authorization: the server authorizes
every mutation.

API: [`CallerPolicy`](../api/@toolmark/core/interfaces/CallerPolicy.md),
[`ToolmarkOptions`](../api/@toolmark/core/interfaces/ToolmarkOptions.md).
