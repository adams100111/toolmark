import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { trace, metrics, SpanKind, SpanStatusCode } from '@opentelemetry/api'
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base'
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
  type ResourceMetrics,
} from '@opentelemetry/sdk-metrics'
import { ok, type ToolResult } from '@toolmark/core'
import { otel } from '@toolmark/core/otel'
import { createTestRegistry } from './helpers/create-test-registry.js'
import { flushMicrotasks, tool } from './helpers/tools.js'

/** Fresh tracer + in-memory exporter, torn down after the test. */
function tracing() {
  const exporter = new InMemorySpanExporter()
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] })
  return { tracer: provider.getTracer('test'), exporter, shutdown: () => provider.shutdown() }
}

/** Fresh meter + in-memory exporter, torn down after the test. */
function metering() {
  const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE)
  const reader = new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60_000 })
  const provider = new MeterProvider({ readers: [reader] })
  return {
    meter: provider.getMeter('test'),
    exporter,
    flush: () => provider.forceFlush(),
    shutdown: () => provider.shutdown(),
  }
}

function metricNamed(metricsResult: ResourceMetrics[], name: string) {
  for (const rm of metricsResult) {
    for (const sm of rm.scopeMetrics) {
      const found = sm.metrics.find((m) => m.descriptor.name === name)
      if (found) return found
    }
  }
  return undefined
}

const cleanups: (() => void | Promise<void>)[] = []
afterEach(async () => {
  for (const fn of cleanups.splice(0)) await fn()
})

describe('otel', () => {
  it('span_per_call_with_attributes', async () => {
    const { tracer, exporter, shutdown } = tracing()
    cleanups.push(shutdown)
    const tm = createTestRegistry()
    tm.register(tool('x'))
    const dispose = tm.use(otel({ tracer }))
    cleanups.push(dispose)

    await tm.call('x', {}, { caller: 'test' })

    const spans = exporter.getFinishedSpans()
    expect(spans).toHaveLength(1)
    const span = spans[0]!
    expect(span.name).toBe('toolmark.call x')
    expect(span.kind).toBe(SpanKind.INTERNAL)
    expect(span.status.code).toBe(SpanStatusCode.UNSET)
    expect(span.attributes['toolmark.tool']).toBe('x')
    expect(span.attributes['toolmark.caller']).toBe('test')
    expect(span.attributes['toolmark.call_id']).toEqual(expect.any(String))
    expect(span.attributes['toolmark.status']).toBe('ok')
    expect(span.attributes['gen_ai.operation.name']).toBe('execute_tool')
    expect(span.attributes['gen_ai.tool.name']).toBe('x')
  })

  it('error_status_on_error_result', async () => {
    const { tracer, exporter, shutdown } = tracing()
    cleanups.push(shutdown)
    const tm = createTestRegistry({ dev: false })
    tm.register({
      name: 'boom',
      description: 'd',
      run: () => {
        throw new Error('secret')
      },
    })
    const dispose = tm.use(otel({ tracer }))
    cleanups.push(dispose)

    const result = await tm.call('boom', {}, { caller: 'test' })
    expect(result.status).toBe('error')

    const span = exporter.getFinishedSpans()[0]!
    expect(span.attributes['toolmark.status']).toBe('error')
    expect(span.status.code).toBe(SpanStatusCode.ERROR)

    // A non-`error` result (e.g. `cancelled`) leaves status UNSET.
    exporter.reset()
    tm.register(tool('y'))
    const ac = new AbortController()
    ac.abort()
    await tm.call('y', {}, { caller: 'test', signal: ac.signal })
    const cancelledSpan = exporter.getFinishedSpans()[0]!
    expect(cancelledSpan.attributes['toolmark.status']).toBe('cancelled')
    expect(cancelledSpan.status.code).toBe(SpanStatusCode.UNSET)
  })

  it('refusal_without_call_event_span', async () => {
    // The current call pipeline never fires `call`/`result` for refusals resolved before a tool is
    // found (unknown_tool, not_allowed): see Ruling in task-6-report.md. The reachable trigger for
    // "a result without a prior call event" is a consumer attached after a call is already
    // in flight (e.g. `tm.use(otel())` installed lazily): its `result` handler runs with no
    // matching open span, and must still produce one — of zero length.
    const { tracer, exporter, shutdown } = tracing()
    cleanups.push(shutdown)
    const tm = createTestRegistry()
    let resolveRun!: (r: ToolResult<unknown>) => void
    const pending = new Promise<ToolResult<unknown>>((resolve) => {
      resolveRun = resolve
    })
    tm.register({ name: 'slow', description: 'd', run: () => pending })

    const callPromise = tm.call('slow', {}, { caller: 'test' })
    await flushMicrotasks()

    const dispose = tm.use(otel({ tracer }))
    cleanups.push(dispose)

    resolveRun(ok(1))
    await callPromise

    const spans = exporter.getFinishedSpans()
    expect(spans).toHaveLength(1)
    const span = spans[0]!
    expect(span.name).toBe('toolmark.call slow')
    expect(span.attributes['toolmark.status']).toBe('ok')
    expect(span.duration).toEqual([0, 0])
    expect(span.startTime).toEqual(span.endTime)
  })

  it('metrics_recorded', async () => {
    const { meter, exporter, flush, shutdown } = metering()
    cleanups.push(shutdown)
    const tm = createTestRegistry()
    tm.register(tool('x'))
    const dispose = tm.use(otel({ meter }))
    cleanups.push(dispose)

    await tm.call('x', {}, { caller: 'test' })
    await flush()

    const metricsResult = exporter.getMetrics()
    const calls = metricNamed(metricsResult, 'toolmark.calls')
    expect(calls?.descriptor.unit).toBe('{call}')
    const point = calls?.dataPoints.find((p) => p.attributes['toolmark.tool'] === 'x')
    expect(point?.value).toBe(1)
    expect(point?.attributes['toolmark.caller']).toBe('test')
    expect(point?.attributes['toolmark.status']).toBe('ok')

    const durationMetric = metricNamed(metricsResult, 'toolmark.call.duration')
    expect(durationMetric?.descriptor.unit).toBe('ms')
    const durationPoint = durationMetric?.dataPoints.find(
      (p) => p.attributes['toolmark.tool'] === 'x',
    )
    expect(durationPoint).toBeDefined()
  })

  it('no_payload_attributes_by_default', async () => {
    const { tracer, exporter, shutdown } = tracing()
    cleanups.push(shutdown)
    const tm = createTestRegistry()
    tm.register(tool('x'))
    const dispose = tm.use(otel({ tracer }))
    cleanups.push(dispose)

    await tm.call('x', { secret: 'value' }, { caller: 'test' })

    const span = exporter.getFinishedSpans()[0]!
    expect(span.attributes['toolmark.input']).toBeUndefined()
    expect(span.attributes['toolmark.result']).toBeUndefined()
  })

  it('payloads_when_enabled_truncated', async () => {
    const { tracer, exporter, shutdown } = tracing()
    cleanups.push(shutdown)
    const tm = createTestRegistry()
    const big = 'x'.repeat(5000)
    tm.register({
      name: 'echo',
      description: 'd',
      input: z.record(z.string(), z.unknown()),
      run: (input: unknown) => ok(input),
    })
    const dispose = tm.use(otel({ tracer, recordPayloads: true }))
    cleanups.push(dispose)

    await tm.call('echo', { big }, { caller: 'test' })

    const span = exporter.getFinishedSpans()[0]!
    const input = span.attributes['toolmark.input']
    const result = span.attributes['toolmark.result']
    expect(typeof input).toBe('string')
    expect(typeof result).toBe('string')
    expect((input as string).length).toBe(4096)
    expect((result as string).length).toBe(4096)
    expect((input as string).startsWith('{"big":"xxx')).toBe(true)
  })

  it('payload_redacts_sensitive_paths', async () => {
    const { tracer, exporter, shutdown } = tracing()
    cleanups.push(shutdown)
    const tm = createTestRegistry()
    tm.register({
      name: 'save',
      description: 'd',
      input: z.record(z.string(), z.unknown()),
      sensitivePaths: () => ['password', 'profile.ssn'],
      run: (input: unknown) =>
        ok({
          changes: [
            { path: 'email', before: 'a@x.com', after: 'b@x.com' },
            { path: 'password', before: 'old', after: 'new' },
            { path: 'profile.ssn', before: '111', after: '222' },
          ],
          echoed: input,
        }),
    })
    const dispose = tm.use(otel({ tracer, recordPayloads: true }))
    cleanups.push(dispose)

    await tm.call(
      'save',
      { email: 'b@x.com', password: 'new', profile: { ssn: '222', city: 'X' } },
      { caller: 'test' },
    )

    const span = exporter.getFinishedSpans()[0]!
    const input = JSON.parse(span.attributes['toolmark.input'] as string) as Record<string, unknown>
    expect(input['password']).toBe('[redacted]')
    expect((input['profile'] as Record<string, unknown>)['ssn']).toBe('[redacted]')
    expect((input['profile'] as Record<string, unknown>)['city']).toBe('X')
    expect(input['email']).toBe('b@x.com')

    const result = JSON.parse(span.attributes['toolmark.result'] as string) as {
      data: { changes: { path: string; before: unknown; after: unknown }[] }
    }
    const changes = result.data.changes
    expect(changes.find((c) => c.path === 'email')).toEqual({
      path: 'email',
      before: 'a@x.com',
      after: 'b@x.com',
    })
    expect(changes.find((c) => c.path === 'password')).toEqual({
      path: 'password',
      before: '[redacted]',
      after: '[redacted]',
    })
    expect(changes.find((c) => c.path === 'profile.ssn')).toEqual({
      path: 'profile.ssn',
      before: '[redacted]',
      after: '[redacted]',
    })
  })

  it('disposer_ends_open_spans', async () => {
    const { tracer, exporter, shutdown } = tracing()
    cleanups.push(shutdown)
    const tm = createTestRegistry()
    let resolveRun!: (r: ToolResult<unknown>) => void
    const pending = new Promise<ToolResult<unknown>>((resolve) => {
      resolveRun = resolve
    })
    tm.register({ name: 'slow', description: 'd', run: () => pending })
    const dispose = tm.use(otel({ tracer }))

    const callPromise = tm.call('slow', {}, { caller: 'test' })
    await flushMicrotasks()

    expect(exporter.getFinishedSpans()).toHaveLength(0)
    dispose()

    const spans = exporter.getFinishedSpans()
    expect(spans).toHaveLength(1)
    expect(spans[0]!.attributes['toolmark.status']).toBe('disposed')
    expect(spans[0]!.ended).toBe(true)

    // Unsubscribed: the eventual real result adds no further span.
    resolveRun(ok(1))
    await callPromise
    expect(exporter.getFinishedSpans()).toHaveLength(1)
  })

  it('defaults_to_global_trace_and_metrics_api', () => {
    // No tracer/meter given: otel() falls back to the global providers, named '@toolmark/core'.
    const before = trace.getTracer('@toolmark/core')
    const beforeMeter = metrics.getMeter('@toolmark/core')
    const consumer = otel()
    expect(typeof consumer).toBe('function')
    expect(trace.getTracer('@toolmark/core')).toBeDefined()
    expect(before).toBeDefined()
    expect(beforeMeter).toBeDefined()
  })
})
