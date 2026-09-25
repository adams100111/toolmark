/**
 * `@toolmark/core/otel` — an OpenTelemetry consumer (spec §11.4, §14): `tm.use(otel())` records one
 * span per call and per-result counters/histograms. `@opentelemetry/api` is an optional peer; this
 * is the only module of the package that imports it.
 * @packageDocumentation
 * @module @toolmark/core/otel
 */
import type { Meter, Span, Tracer } from '@opentelemetry/api'
import { SpanKind, SpanStatusCode, metrics, trace } from '@opentelemetry/api'
import { redactChanges, redactInput } from '../input-redaction.js'
import { isPlainObject } from '../forms/paths.js'
import { inputSensitivePaths, type Toolmark } from '../registry.js'
import type { FieldChange, ToolResult } from '../result.js'

/** Options for {@link otel}. */
export interface OtelOptions {
  /** Tracer to record spans on (default `trace.getTracer('@toolmark/core')`). */
  tracer?: Tracer
  /** Meter to record `toolmark.calls`/`toolmark.call.duration` on (default `metrics.getMeter('@toolmark/core')`). */
  meter?: Meter
  /**
   * Record `toolmark.input`/`toolmark.result` span attributes (JSON, truncated to 4096 chars,
   * with the tool's sensitive paths redacted in the input — mapped onto the input's shape, e.g.
   * `values.<path>` for a form fill and `steps.<step>.<path>` for a wizard fill — and
   * `tm.info(tool).sensitivePaths` redacted in the result's field changes). Off by default
   * (spec §14): OTel never records inputs or results unless explicitly opted in.
   */
  recordPayloads?: boolean
}

const INSTRUMENTATION_NAME = '@toolmark/core'
const MAX_PAYLOAD_CHARS = 4096
/**
 * Fixed span-status message for every `error` result. `result.message` is never forwarded
 * verbatim (see {@link otel}'s TSDoc): this is the simplest safe rule that guarantees a
 * thrown-cause string can never reach an exported span, even if a future `errorResult` call
 * site accidentally embeds one.
 */
const GENERIC_ERROR_MESSAGE = 'Tool failed'

/** A span kept open between the `call` event and its matching `result`. */
interface OpenSpan {
  span: Span
  /** The redacted input JSON (only with `recordPayloads`; `undefined` = not recorded). */
  inputJson: string | undefined
  /** The tool's `sensitivePaths` when the call started (result fallback if it is gone by then). */
  sensitive: string[]
}

function isFieldChangeArray(v: unknown): v is FieldChange[] {
  return Array.isArray(v) && v.every((c) => isPlainObject(c) && typeof c['path'] === 'string')
}

/**
 * JSON-serializes `value`, truncated to {@link MAX_PAYLOAD_CHARS} chars; `undefined` if it has no
 * JSON form. This attribute is best-effort truncated JSON, not guaranteed-valid JSON: `slice` cuts
 * by UTF-16 code unit, so a truncation point that falls inside a surrogate pair (e.g. an emoji)
 * can split it, leaving a lone surrogate in the resulting string.
 */
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

/**
 * Redacts field changes carried by a result: `data.changes` of an `ok` result carrying
 * form-style changes, or the top-level `changes` of a `needs_confirmation` result (spec §6's
 * confirmation card can carry the same sensitive-path field values as a completed form save).
 * Other results pass through.
 */
function redactResult(result: ToolResult<unknown>, paths: readonly string[]): ToolResult<unknown> {
  if (paths.length === 0) return result
  if (result.status === 'needs_confirmation') {
    return result.changes === undefined
      ? result
      : { ...result, changes: redactChanges(result.changes, paths) }
  }
  if (result.status !== 'ok') return result
  const data = result.data
  if (!isPlainObject(data) || !isFieldChangeArray(data['changes'])) return result
  return { ...result, data: { ...data, changes: redactChanges(data['changes'], paths) } }
}

/**
 * An OpenTelemetry consumer (spec §11.4): `tm.use(otel())`. Starts a span named
 * `toolmark.call <tool>` (kind `INTERNAL`) on the registry's `call` event and ends it on the matching `result`
 * event, with `toolmark.tool`, `toolmark.caller`, `toolmark.call_id` and (at the end)
 * `toolmark.status`, plus `gen_ai.operation.name: 'execute_tool'` and `gen_ai.tool.name`. The span
 * status is `ERROR` only for an `error` result; every other status leaves it `UNSET`. The status
 * message for an `error` result is always the fixed text `'Tool failed'` — never
 * `result.message` — so a tool's thrown-cause text (e.g. `Error('secret')`, which core already
 * normalizes to a generic `errorResult` before it ever reaches a consumer) can never leak into an
 * exported span even if a future call site regresses that normalization. A `result`
 * with no matching open span (e.g. a consumer attached after the call already started) still
 * produces a span, of zero length. Every result also records a `toolmark.calls` counter (unit
 * `{call}`) and a `toolmark.call.duration` histogram (unit `ms`, from the event's `durationMs`),
 * both tagged with `toolmark.tool`/`toolmark.caller`/`toolmark.status`.
 *
 * Inputs and results are never recorded unless `recordPayloads` is `true` (spec §14); when it is,
 * `toolmark.input`/`toolmark.result` carry JSON truncated to 4096 chars. The input is redacted when
 * the call starts, at the tool's sensitive paths mapped onto its input shape (a form fill's
 * `values.<path>`, a wizard fill's `steps.<step>.<path>`, any other tool's
 * `tm.info(tool).sensitivePaths` as-is; `[]` matches every array index, dotted keys and `$append`
 * array ops are followed); every value at or under such a path becomes `'[redacted]'`. When a
 * tool's input redaction fails, `toolmark.input` is omitted. The result's field changes at
 * `tm.info(tool).sensitivePaths` are redacted the same way.
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

    /** The redacted input JSON; `undefined` when the tool's input redaction is unavailable. */
    const inputJsonOf = (tool: string, input: unknown): string | undefined => {
      const paths = inputSensitivePaths(tm, tool)
      if (paths === null) return undefined
      try {
        return truncatedJson(redactInput(input, paths))
      } catch {
        return undefined
      }
    }

    const offCall = tm.events.on('call', (e) => {
      // Redacted at call time, while the tool (and its current sensitivity) is surely registered.
      open.set(e.callId, {
        span: startCallSpan(e.tool, e.caller, e.callId),
        inputJson: recordPayloads ? inputJsonOf(e.tool, e.input) : undefined,
        sensitive: recordPayloads ? (tm.info(e.tool)?.sensitivePaths ?? []) : [],
      })
    })

    const offResult = tm.events.on('result', (e) => {
      const opened = open.get(e.callId)
      open.delete(e.callId)
      // No matching `call`: synthesize a zero-length span, started and ended at the same instant.
      const orphanNow = opened ? undefined : Date.now()
      const span = opened?.span ?? startCallSpan(e.tool, e.caller, e.callId, orphanNow)

      span.setAttribute('toolmark.status', e.result.status)
      if (e.result.status === 'error') {
        span.setStatus({ code: SpanStatusCode.ERROR, message: GENERIC_ERROR_MESSAGE })
      }

      if (recordPayloads) {
        const sensitivePaths = tm.info(e.tool)?.sensitivePaths ?? opened?.sensitive ?? []
        if (opened?.inputJson !== undefined) span.setAttribute('toolmark.input', opened.inputJson)
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
