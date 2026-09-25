# Results

`tm.call()` never throws. Every outcome is a plain, frozen, structured-cloneable `ToolResult`
(spec §6):

```ts
type ToolResult<T> =
  | { status: 'ok'; data: T }
  | { status: 'invalid'; issues: { path: string; message: string }[] }
  | { status: 'refused'; code: string; message: string; rev?: number }
  | { status: 'needs_confirmation'; confirmId: string; summary: string; changes?: FieldChange[] }
  | { status: 'cancelled'; by: 'operator' | 'signal' | 'policy' }
  | { status: 'error'; message: string }
```

| Status               | Meaning for the agent                                                                              |
| -------------------- | -------------------------------------------------------------------------------------------------- |
| `ok`                 | Done; `data` is the tool's output (form fills return `{ changes, skipped }`).                      |
| `invalid`            | Input failed validation before `run`, or the tool reported issues; fix `issues[].path` and retry.  |
| `refused`            | The call did not run; `code` says why ([all codes](../reference/codes.md#refused-codes)).          |
| `needs_confirmation` | Deferred mode: the user must approve; the outcome arrives later ([confirmation](confirmation.md)). |
| `cancelled`          | Stopped by the user (`operator`), an aborted signal (`signal`) or policy (`policy`).               |
| `error`              | The tool failed. The message is generic: a thrown exception's details go to `error` events only.   |

Helpers from `@toolmark/core`: `ok(data)`, `invalid(issues)`, `refuse(code, message, { rev? })`,
`cancelled(by)` and `errorResult(message)`.

```ts
run: async (input, ctx) => {
  if (!canPublish(input.id)) return refuse('not_allowed', 'Only owners can publish')
  const saved = await api.publish(input.id, { signal: ctx.signal })
  return ok({ id: saved.id })
}
```

- **Output validation** runs in development only; a mismatch emits `output_invalid` and keeps the
  result.
- **Untrusted content.** Tools whose results carry page or user content declare
  `hints.untrustedContent`; the hint travels in every manifest (bridge, WebMCP), and the MCP
  server also marks such results, so the agent treats them as data, not instructions (spec §14).
- **Changes and redaction.** `FieldChange` (`{ path, before, after }`; `before`/`after` may be absent for "no value") lists what a fill
  wrote; sensitive fields (password, `cc-*`, app-declared) appear as `'[redacted]'`.
- **Over the bridge** results are serialized with JSON semantics (`toJSON`, `Date` → ISO string);
  a non-serializable result becomes an `error`.
- **Undo.** A tool can `ctx.registerUndo(restore)`; `tm.undo(callId)` runs it once, otherwise
  `refused` `undo_unavailable`. Form fills register undo automatically.

API: [`ToolResult`](../api/@toolmark/core/type-aliases/ToolResult.md),
[`FieldChange`](../api/@toolmark/core/interfaces/FieldChange.md).
