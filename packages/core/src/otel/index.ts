/**
 * `@toolmark/core/otel` — an OpenTelemetry consumer (spec §11.4, §14): `tm.use(otel())` records one
 * span per call and per-result counters/histograms. `@opentelemetry/api` is an optional peer; this
 * is the only module of the package that imports it.
 * @packageDocumentation
 */
import type { Meter, Span, Tracer } from '@opentelemetry/api'
import { SpanKind, SpanStatusCode, metrics, trace } from '@opentelemetry/api'
import { getPath, isPlainObject, isSafePath, setPath } from '../forms/paths.js'
import type { Toolmark } from '../registry.js'
import type { FieldChange, ToolResult } from '../result.js'

/** Options for {@link otel}. */
export interface OtelOptions {
  /** Tracer to record spans on (default `trace.getTracer('@toolmark/core')`). */
  tracer?: Tracer
  /** Meter to record `toolmark.calls`/`toolmark.call.duration` on (default `metrics.getMeter('@toolmark/core')`). */
  meter?: Meter
  /**
   * Record `toolmark.input`/`toolmark.result` span attributes (JSON, truncated to 4096 chars,
   * with `tm.info(tool).sensitivePaths` redacted in the input and in `data.changes`). Off by
   * default (spec §14): OTel never records inputs or results unless explicitly opted in.
   */
  recordPayloads?: boolean
}

const INSTRUMENTATION_NAME = '@toolmark/core'
const REDACTED = '[redacted]'
const MAX_PAYLOAD_CHARS = 4096

/** A span kept open between the `call` event and its matching `result`. */
interface OpenSpan {
  span: Span
  input: unknown
}

function isFieldChangeArray(v: unknown): v is FieldChange[] {
  return Array.isArray(v) && v.every((c) => isPlainObject(c) && typeof c['path'] === 'string')
}

/** JSON-serializes `value`, truncated to {@link MAX_PAYLOAD_CHARS} chars; `undefined` if it has no JSON form. */
function truncatedJson(value: unknown): string | undefined {
  let json: string | undefined
  try {
    json = JSON.stringify(value)
  } catch {
    return undefined
  }
  if (json === undefined) return undefined
  return json.length > MAX_PAYLOAD_CHARS ? json.slice(0, MAX_PAYLOAD_CHARS) : json
}

/** Replaces the value at each of `paths` inside `input` with `'[redacted]'` (own copy; no mutation). */
function redactInput(input: unknown, paths: readonly string[]): unknown {
  let out = input
  for (const path of paths) {
    if (!isSafePath(path) || typeof out !== 'object' || out === null) continue
    if (getPath(out, path) !== undefined) out = setPath(out, path, REDACTED)
  }
  return out
}

/** Redacts `before`/`after` of every change at, under, or over one of `paths`. */
function redactChanges(changes: FieldChange[], paths: readonly string[]): FieldChange[] {
  return changes.map((c) =>
    paths.some((p) => c.path === p || c.path.startsWith(`${p}.`) || p.startsWith(`${c.path}.`))
      ? { path: c.path, before: REDACTED, after: REDACTED }
      : c,
  )
}

/** Redacts `data.changes` of an `ok` result carrying form-style changes; other results pass through. */
function redactResult(result: ToolResult<unknown>, paths: readonly string[]): ToolResult<unknown> {
  if (result.status !== 'ok' || paths.length === 0) return result
  const data = result.data
  if (!isPlainObject(data) || !isFieldChangeArray(data['changes'])) return result
  return { ...result, data: { ...data, changes: redactChanges(data['changes'], paths) } }
}

/**
 * An OpenTelemetry consumer (spec §11.4): `tm.use(otel())`. Starts a span named `toolmark.call
 * <tool>` (kind `INTERNAL`) on the registry's `call` event and ends it on the matching `result`
 * event, with `toolmark.tool`, `toolmark.caller`, `toolmark.call_id` and (at the end)
 * `toolmark.status`, plus `gen_ai.operation.name: 'execute_tool'` and `gen_ai.tool.name`. The span
 * status is `ERROR` only for an `error` result; every other status leaves it `UNSET`. A `result`
 * with no matching open span (e.g. a consumer attached after the call already started) still
 * produces a span, of zero length. Every result also records a `toolmark.calls` counter (unit
 * `{call}`) and a `toolmark.call.duration` histogram (unit `ms`, from the event's `durationMs`),
 * both tagged with `toolmark.tool`/`toolmark.caller`/`toolmark.status`.
 *
 * Inputs and results are never recorded unless `recordPayloads` is `true` (spec §14); when it is,
 * `toolmark.input`/`toolmark.result` carry JSON truncated to 4096 chars, with
 * `tm.info(tool).sensitivePaths` replaced by `'[redacted]'` (in the input and in `data.changes`).
 *
 * @param o - {@link OtelOptions}.
 * @returns A `tm.use` consumer. Its disposer ends every still-open span with
 * `toolmark.status: 'disposed'` and unsubscribes.
 */
export function otel(o?: OtelOptions): (tm: Toolmark) => () => void {
  const tracer = o?.tracer ?? trace.getTracer(INSTRUMENTATION_NAME)
  const meter = o?.meter ?? metrics.getMeter(INSTRUMENTATION_NAME)
  const recordPayloads = o?.recordPayloads === true
  const calls = meter.createCounter('toolmark.calls', { unit: '{call}' })
  const duration = meter.createHistogram('toolmark.call.duration', { unit: 'ms' })

  return (tm) => {
    const open = new Map<string, OpenSpan>()

    function startCallSpan(tool: string, caller: string, callId: string, startTime?: number): Span {
      return tracer.startSpan(`toolmark.call ${tool}`, {
        kind: SpanKind.INTERNAL,
        ...(startTime !== undefined ? { startTime } : {}),
        attributes: {
          'toolmark.tool': tool,
          'toolmark.caller': caller,
          'toolmark.call_id': callId,
          'gen_ai.operation.name': 'execute_tool',
          'gen_ai.tool.name': tool,
        },
      })
    }

    const offCall = tm.events.on('call', (e) => {
      open.set(e.callId, { span: startCallSpan(e.tool, e.caller, e.callId), input: e.input })
    })

    const offResult = tm.events.on('result', (e) => {
      const opened = open.get(e.callId)
      open.delete(e.callId)
      // No matching `call`: synthesize a zero-length span, started and ended at the same instant.
      const orphanNow = opened ? undefined : Date.now()
      const span = opened?.span ?? startCallSpan(e.tool, e.caller, e.callId, orphanNow)

      span.setAttribute('toolmark.status', e.result.status)
      if (e.result.status === 'error') {
        span.setStatus({ code: SpanStatusCode.ERROR, message: e.result.message })
      }

      if (recordPayloads) {
        const sensitivePaths = tm.info(e.tool)?.sensitivePaths ?? []
        if (opened) {
          const inputJson = truncatedJson(redactInput(opened.input, sensitivePaths))
          if (inputJson !== undefined) span.setAttribute('toolmark.input', inputJson)
        }
        const resultJson = truncatedJson(redactResult(e.result, sensitivePaths))
        if (resultJson !== undefined) span.setAttribute('toolmark.result', resultJson)
      }

      span.end(orphanNow)

      const attrs = {
        'toolmark.tool': e.tool,
        'toolmark.caller': e.caller,
        'toolmark.status': e.result.status,
      }
      calls.add(1, attrs)
      duration.record(e.durationMs, attrs)
    })

    return () => {
      offCall()
      offResult()
      const now = Date.now()
      for (const { span } of open.values()) {
        span.setAttribute('toolmark.status', 'disposed')
        span.end(now)
      }
      open.clear()
    }
  }
}
