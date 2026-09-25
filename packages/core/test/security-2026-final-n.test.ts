// Regression tests for the M5 final re-review follow-ups of the 2026 security review
// (docs/security/review-2026.md, "Final review follow-ups": SEC-28 .. SEC-30).
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base'
import { ok, type Registration, type Toolmark } from '@toolmark/core'
import { otel } from '@toolmark/core/otel'
import { restoreRedacted } from '../src/input-redaction.js'
import { createTestRegistry } from './helpers/create-test-registry.js'

const cleanups: (() => void | Promise<void>)[] = []
afterEach(async () => {
  for (const fn of cleanups.splice(0)) await fn()
})

const R = '[redacted]'
const reenter = (path: string) => ({
  status: 'invalid',
  issues: [{ path, message: 'Re-enter sensitive field' }],
})

describe('SEC-28: an approval never runs the tool with a literal placeholder', () => {
  const flaky = (runs: unknown[], broken: { on: boolean }) => ({
    name: 'pay',
    description: 'd',
    hints: { consequential: true },
    input: z.object({ pw: z.string(), note: z.string().optional() }),
    sensitivePaths: (): string[] => {
      if (broken.on) throw new Error('boom')
      return ['pw']
    },
    run: (input: unknown) => {
      runs.push(input)
      return ok(true)
    },
  })

  it('sec_28_inline_edit_refuses_when_sensitive_paths_throw_at_restore', async () => {
    const broken = { on: false }
    const tm = createTestRegistry({
      dev: false,
      confirm: (req) => {
        broken.on = true
        return Promise.resolve({ approved: true, input: { ...(req.input as object), note: 'n' } })
      },
    })
    const runs: unknown[] = []
    tm.register(flaky(runs, broken))
    expect(await tm.call('pay', { pw: 'hunter2' }, { caller: 'mcp' })).toEqual(reenter('pw'))
    expect(runs).toEqual([])
  })

  it('sec_28_deferred_edit_refuses_when_sensitive_paths_throw_at_restore', async () => {
    const broken = { on: false }
    const tm = createTestRegistry({ dev: false })
    const runs: unknown[] = []
    tm.register(flaky(runs, broken))
    const r = await tm.call('pay', { pw: 'hunter2' }, { caller: 'inapp' })
    if (r.status !== 'needs_confirmation') throw new Error('expected needs_confirmation')
    const [pending] = tm.pendingConfirmations()
    expect(pending?.input).toEqual({ pw: R })
    broken.on = true
    const edited = { ...(pending?.input as object), note: 'n' }
    expect(await tm.confirmPending(r.confirmId, { approved: true, input: edited })).toEqual(
      reenter('pw'),
    )
    expect(runs).toEqual([])
  })

  it('sec_28_placeholder_outside_a_sensitive_path_refuses', async () => {
    const tm = createTestRegistry()
    const runs: unknown[] = []
    tm.register(flaky(runs, { on: false }))
    const r = await tm.call('pay', { pw: 'hunter2' }, { caller: 'inapp' })
    if (r.status !== 'needs_confirmation') throw new Error('expected needs_confirmation')
    const [pending] = tm.pendingConfirmations()
    const edited = { ...(pending?.input as object), note: R }
    expect(await tm.confirmPending(r.confirmId, { approved: true, input: edited })).toEqual(
      reenter('note'),
    )
    expect(runs).toEqual([])
  })

  it('sec_28_placeholder_the_caller_sent_is_kept', async () => {
    const tm = createTestRegistry()
    const runs: unknown[] = []
    tm.register(flaky(runs, { on: false }))
    const r = await tm.call('pay', { pw: 'hunter2', note: R }, { caller: 'inapp' })
    if (r.status !== 'needs_confirmation') throw new Error('expected needs_confirmation')
    const [pending] = tm.pendingConfirmations()
    const edited = { ...(pending?.input as object) }
    expect(await tm.confirmPending(r.confirmId, { approved: true, input: edited })).toEqual(
      ok(true),
    )
    expect(runs).toEqual([{ pw: 'hunter2', note: R }])
  })
})

describe('SEC-29: OTel result redaction stays fail-closed after the tool is gone', () => {
  function record(tm: Toolmark): InMemorySpanExporter {
    const exporter = new InMemorySpanExporter()
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    })
    cleanups.push(() => provider.shutdown())
    cleanups.push(tm.use(otel({ tracer: provider.getTracer('test'), recordPayloads: true })))
    return exporter
  }

  it('sec_29_otel_result_changes_fail_closed_after_unregister', async () => {
    const tm = createTestRegistry({ dev: false })
    const reg: Registration = tm.register({
      name: 'save',
      description: 'd',
      input: z.object({}),
      sensitivePaths: (): string[] => {
        throw new Error('boom')
      },
      run: () => {
        reg.dispose()
        return ok({ changes: [{ path: 'pin', before: '1111', after: '2222' }] })
      },
    })
    const exporter = record(tm)
    await tm.call('save', {}, { caller: 'inapp' })
    const span = exporter.getFinishedSpans()[0]!
    expect(String(span.attributes['toolmark.result'])).toContain('pin')
    expect(JSON.stringify(span.attributes)).not.toMatch(/1111|2222/)
  })
})

describe('SEC-30: a placeholder is never restored across an array/object switch', () => {
  const raw = {
    items: [
      { n: 'A', s: 'sA' },
      { n: 'B', s: 'sB' },
    ],
  }
  const paths = ['items[].s']

  it('sec_30_index_keyed_object_over_an_array_refuses', () => {
    const edited = { items: { '0': { n: 'B', s: R }, '1': { n: 'A', s: R } } }
    expect(restoreRedacted(edited, raw, paths)).toEqual({ ok: false, path: 'items.0.s' })
  })

  it('sec_30_array_over_an_index_keyed_object_refuses', () => {
    const objRaw = { items: { '0': { n: 'A', s: 'sA' } } }
    expect(restoreRedacted({ items: [{ n: 'A', s: R }] }, objRaw, paths)).toEqual({
      ok: false,
      path: 'items.0.s',
    })
  })
})
