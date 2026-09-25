# OpenTelemetry (`@toolmark/core/otel`)

`otel()` records a span and metrics for every tool call, from every caller (in-app agent, WebMCP,
desktop MCP, tests, humans through confirm cards). `@opentelemetry/api` (`^1.9.0`) is an optional
peer: install it, and an SDK, only when you use this entry.

```ts
import { otel } from '@toolmark/core/otel'

tm.use(otel()) // global tracer/meter named '@toolmark/core'
tm.use(otel({ tracer, meter })) // or your own
```

`examples/react-vite/src/telemetry.ts` registers a `BasicTracerProvider` with a
`ConsoleSpanExporter` in development; a real app exports with OTLP.

## Names

| Kind          | Name                                | Details                                                                                                                              |
| ------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Tracer, meter | `@toolmark/core`                    | Defaults: `trace.getTracer('@toolmark/core')`, `metrics.getMeter('@toolmark/core')`.                                                 |
| Span          | `toolmark.call <tool>`              | Kind `INTERNAL`, from the `call` event to the `result` event.                                                                        |
| Attributes    | `toolmark.tool`                     | Full tool name.                                                                                                                      |
|               | `toolmark.caller`                   | The caller, e.g. `inapp`, `webmcp`, `mcp` or `test`.                                                                                 |
|               | `toolmark.call_id`                  | The call id.                                                                                                                         |
|               | `toolmark.status`                   | The `ToolResult` status (`disposed` when the consumer is disposed with the call open).                                               |
|               | `gen_ai.operation.name`             | `execute_tool`.                                                                                                                      |
|               | `gen_ai.tool.name`                  | Full tool name.                                                                                                                      |
| Counter       | `toolmark.calls`                    | Unit `{call}`; attributes `toolmark.tool`, `toolmark.caller`, `toolmark.status`.                                                     |
| Histogram     | `toolmark.call.duration`            | Unit `ms` (semantic conventions prefer `s`; kept in ms by design); attributes `toolmark.tool`, `toolmark.caller`, `toolmark.status`. |
| Payloads      | `toolmark.input`, `toolmark.result` | Only with `recordPayloads: true`; JSON, truncated to 4096 characters.                                                                |

The span status is `ERROR` only for `status: 'error'` results, with the fixed message
`Tool failed`: a thrown error's text never reaches telemetry. Every other status leaves the span
status `UNSET`.

## Payloads are opt-in

By default no input or result value is recorded, only the names, ids, statuses and durations above
(spec §14). `otel({ recordPayloads: true })` adds `toolmark.input` and `toolmark.result`:

- Values at the tool's sensitive paths (`tm.info(tool).sensitivePaths`: the form's declared
  `sensitive` list, fields the adapter reports as sensitive, and password / `cc-*` / secret
  `autocomplete` inputs) are replaced with `'[redacted]'` in the input, in an `ok` result's
  `data.changes` and in a `needs_confirmation` result's `changes`.
- Redaction works on a copy; other consumers see the original values.
- Truncation is by UTF-16 code unit, so a truncated attribute may not be valid JSON.

Hand-written tools with sensitive input declare `sensitivePaths()` themselves; otherwise their
payloads are recorded as-is when `recordPayloads` is on.
