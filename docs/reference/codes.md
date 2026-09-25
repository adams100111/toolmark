# Error, refusal and event codes

Every stable code Toolmark produces, with the milestone that introduced it. Codes are part of the
public contract: new codes may be added in minor releases, existing ones are never renamed.

- **`refused` codes** appear in a `ToolResult` (`{ status: 'refused', code, message, rev? }`), so
  agents see them. See [Results](../concepts/results.md).
- **`error` event codes** appear on `tm.events.on('error', (e) => …)` and
  `createToolmark({ onError })` as `{ code, message, tool?, cause? }`. They are for the app's
  developers and logs, never for the agent.
- **Thrown codes**: in development (`createToolmark({ dev: true })`) misconfiguration throws a
  `ToolmarkError` whose `code` is the same string as the production `error` event (spec §14).

## `refused` codes

| Code                   | Milestone | When                                                                                                                                                                                                                                             |
| ---------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `unknown_tool`         | M1        | No visible tool has that name (never registered, disposed, or its scope is hidden by `when: false`). Carries the current `rev`. A tool removed while its call waited in the scope queue also ends with this code.                                |
| `stale`                | M1        | The call named a `rev` older than the registry's and the tool no longer exists (carries `rev`); or a deferred form/wizard submit was approved after the values changed (`"Form changed since confirmation was requested"`, M1 execution ruling). |
| `not_allowed`          | M1        | Policy does not let this caller use the tool; an inline-mode caller has no `confirm` handler for a consequential tool; a DOM button is disabled or hidden (M2); a stepwise wizard fill with no mounted step form (M2).                           |
| `busy`                 | M1        | The tool's scope queue is full (calls run serially per scope, D22).                                                                                                                                                                              |
| `undo_unavailable`     | M1        | `tm.undo(callId)` found no restorer: the call registered none, it was already undone, it was evicted from the capped undo store, or its tool is gone.                                                                                            |
| `confirmation_expired` | M1        | `tm.confirmPending(confirmId, …)` with an unknown, expired, already-consumed or dropped (scope disposed) `confirmId`. A `confirmId` is single use.                                                                                               |
| `file_rejected`        | M2        | A file field value was refused: `{ ref }` with no `files.resolve` (with the `files_not_configured` event), a disallowed URL, size/type/count limit, or a resolver failure (spec §8.4; see [Files](../guides/files.md)).                          |
| `navigation_failed`    | M2        | The Inertia navigation tool could not complete the visit (see [Inertia](../guides/inertia.md)).                                                                                                                                                  |

Related statuses that are not `refused`: `cancelled` with `by: 'operator' | 'signal' | 'policy'`,
`invalid` with `issues`, and `error` with a generic `message` (a thrown tool never leaks its error
text to the agent). Over the bridge, an unknown `protocol` number is answered with
`{ status: 'error', message: 'unsupported protocol' }`; a missing result after the server's
deadline is mapped to a timeout **on the server** (spec §12.2).

## `error` event codes

| Code                           | Milestone | When                                                                                                                                                                            | Development / production                                            |
| ------------------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `duplicate_name`               | M1        | A second tool with the same full name or the same `llmName`; M2: server-declared props tool collisions and a second `inertiaPages`                                              | Throws / event, second registration rejected (props: event in both) |
| `invalid_name`                 | M1        | A tool or scope name outside `A–Z a–z 0–9 _ - .`, or with an empty segment; M2: invalid DOM tool, group, column or field names and buttons without a description                | Throws / event, not registered                                      |
| `invalid_scope`                | M1        | `register(tool, { scope })` with a scope object from another registry                                                                                                           | Throws / event, not registered                                      |
| `scope_disposed`               | M1        | Registering into a disposed scope                                                                                                                                               | Throws / event, not registered                                      |
| `invalid_policy`               | M1        | A malformed `policy`: an entry for `human`, an unknown caller or hint class                                                                                                     | Throws / event                                                      |
| `invalid_confirm_mode`         | M1        | `confirmMode` sets anything other than `'inline'` for `webmcp`, `mcp` or `tour`                                                                                                 | Throws / event                                                      |
| `missing_confirm_handler`      | M1        | A consequential/destructive tool that no allowed caller can confirm (thrown/rejected); or, as a development-only warning, one hidden from inline-mode callers without a handler | Throws / event; warning variant dev only                            |
| `schema_conversion_failed`     | M1        | No JSON Schema could be derived for a tool's input; M2: `fromJsonSchema` rejected a schema, or a DOM field's `pattern` was dropped                                              | Throws / event (`fromJsonSchema` always throws)                     |
| `tool_budget_exceeded`         | M1        | More visible tools than `ToolmarkOptions.budget` (default 40, D21)                                                                                                              | Event, development only                                             |
| `tool_threw`                   | M1        | A tool's `run` threw (the caller gets a generic `error` result); M2: an options provider failed, or registering a DOM tool threw                                                | Event in both                                                       |
| `output_invalid`               | M1        | A tool's `ok` data fails its `output` schema (the result is kept)                                                                                                               | Event, development only                                             |
| `late_result`                  | M1        | A tool settled after its call was abandoned (abort grace period); the result is dropped                                                                                         | Event in both                                                       |
| `ctx_confirm_unavailable`      | M1        | `ctx.confirm()` ran for a caller with no inline confirmation path (it resolved `{ approved: false, reason: 'confirmation_unavailable' }`)                                       | Event, development only                                             |
| `transport_failed`             | M1        | A bridge transport failed to send, a result was not serializable, or a call rejected unexpectedly                                                                               | Event in both                                                       |
| `invalid_message`              | M1        | An inbound bridge message was dropped: too large (`maxMessageBytes`), not serializable, or failing the protocol v1 schema                                                       | Event in both                                                       |
| `invalid_path`                 | M1        | A form path with a forbidden segment (`__proto__`, `prototype`, `constructor`) reached the path helpers                                                                         | Thrown `ToolmarkError` only                                         |
| `files_not_configured`         | M1 / M2   | A `{ ref }` file value arrived and no `files.resolve` exists. M1 threw a `ToolmarkError`; since M2 it is an event next to `refused` `file_rejected`                             | Event, development only                                             |
| `wizard_misconfigured`         | M2        | A wizard with no steps, an invalid or duplicate step name, or missing callbacks                                                                                                 | Throws / event, nothing registered                                  |
| `files_misconfigured`          | M2        | Invalid `files` options or `FileFieldSpec`                                                                                                                                      | Throws / event                                                      |
| `invalid_props_tool`           | M2        | A server-declared props entry is malformed or exceeds a limit; the entry is skipped                                                                                             | Event in both, never thrown                                         |
| `options_url_rejected`         | M2        | A `data-tool-options-url` is invalid, too long, not same-origin http(s), or has credentials                                                                                     | Event in both, never thrown                                         |
| `wizard_current_step_unsynced` | M2        | A wizard wrote the current step into parent data with no way to show it                                                                                                         | Event in both (once per wizard)                                     |
| `webmcp_unavailable`           | M3        | Informational, once per consumer: no model context (no native API and no polyfill installed one)                                                                                | Event in both                                                       |
| `webmcp_register_failed`       | M3        | `registerTool` rejected or a `filter` threw; reported once per tool version, retried when the tool changes                                                                      | Event in both                                                       |

`confirmation_unavailable`, `signal` and `expired` are `reason` values of a rejected
`ConfirmOutcome` (`{ approved: false, reason }`), not event codes.

## Desktop MCP (M3)

WebSocket close codes between `toolmark-mcp` and the page: `4400` (invalid pairing frame), `4401`
(wrong code or unknown token), `4408` (no pairing frame within 3000 ms) and `4409` (superseded) are
terminal; `4429` (handshake busy), `1001` (CLI shutting down) and `1009` (frame too large) are
transient. Details: [Desktop MCP](../guides/mcp.md#websocket-close-codes-server-page).

## Tour events (M4)

Delivered to `tour.on((e) => …)` (see [Tours](../guides/tours.md)):

| Event            | `reason`                                          | When                                                                                                                                            |
| ---------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `step_entered`   | —                                                 | The tour moved to a step (`index` is set)                                                                                                       |
| `step_invalid`   | `unknown_tool`, `unknown_param`, `malformed_step` | A planned step was dropped: its tool is not visible to caller `tour`, its `param` is not in the tool's input schema, or it is not a step object |
| `anchor_missing` | `anchor_missing`                                  | The step's element is not rendered; the step was skipped                                                                                        |
| `step_skipped`   | `tool_removed`                                    | The step's tool disappeared mid-tour                                                                                                            |
| `done`           | —                                                 | Every step completed                                                                                                                            |

`startTour` rejects with a `TypeError` for invalid options, and with the planner's own error when
the planner rejects.

## `toolmark lint` (M4)

Exit codes: `0` no errors, `1` errors found, `2` usage or runtime failure (bad arguments, an
invalid manifest file, `--url` without `@playwright/test` or without the page test hook, a judge
module that cannot be found).

| Rule id                      | Severity                        | Source                     |
| ---------------------------- | ------------------------------- | -------------------------- |
| `name-format`                | error                           | built-in                   |
| `description-missing`        | warn                            | built-in                   |
| `description-short`          | warn                            | built-in                   |
| `param-description-missing`  | warn                            | built-in                   |
| `schema-invalid`             | error                           | built-in                   |
| `llm-name-collision`         | error                           | built-in                   |
| `tool-budget`                | warn                            | built-in                   |
| `consequential-hint-missing` | error                           | built-in                   |
| `options-without-hint`       | warn                            | built-in                   |
| `judge-failed`               | warn                            | any `--judge` that threw   |
| `judge/description-quality`  | warn                            | `@toolmark/judge-typesafe` |
| `judge/consequential-hint`   | warn (error with `strictHints`) | `@toolmark/judge-typesafe` |
| `judge/overlap`              | warn                            | `@toolmark/judge-typesafe` |
| `judge/overlap-truncated`    | warn                            | `@toolmark/judge-typesafe` |
| `judge/unavailable`          | warn                            | `@toolmark/judge-typesafe` |

Rule definitions: [Lint](../guides/lint.md#rules).
