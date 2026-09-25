// Regression tests for the M5 final-review follow-ups of the 2026 security review
// (docs/security/review-2026.md, "Final review follow-ups": SEC-24 .. SEC-27).
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base'
import { ok, type FieldChange, type Toolmark } from '@toolmark/core'
import { otel } from '@toolmark/core/otel'
import { redactChanges, restoreRedacted } from '../src/input-redaction.js'
import { createTestRegistry } from './helpers/create-test-registry.js'

const cleanups: (() => void | Promise<void>)[] = []
afterEach(async () => {
  for (const fn of cleanups.splice(0)) await fn()
})

function record(tm: Toolmark): InMemorySpanExporter {
  const exporter = new InMemorySpanExporter()
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] })
  cleanups.push(() => provider.shutdown())
  cleanups.push(tm.use(otel({ tracer: provider.getTracer('test'), recordPayloads: true })))
  return exporter
}

const R = '[redacted]'
const cardChanges = (): FieldChange[] => [
  { path: 'cards.0.cvc', before: '111', after: '222' },
  {
    path: 'cards',
    before: [{ name: 'A', cvc: '111' }],
    after: [
      { name: 'A', cvc: '222' },
      { name: 'B', cvc: '333' },
    ],
  },
  { path: 'cards.1', before: undefined, after: { name: 'B', cvc: '333' } },
  { path: 'cards.0.name', before: 'A', after: 'Z' },
]
const redactedCardChanges = [
  { path: 'cards.0.cvc', before: R, after: R },
  {
    path: 'cards',
    before: [{ name: 'A', cvc: R }],
    after: [
      { name: 'A', cvc: R },
      { name: 'B', cvc: R },
    ],
  },
  { path: 'cards.1', before: undefined, after: { name: 'B', cvc: R } },
  { path: 'cards.0.name', before: 'A', after: 'Z' },
]

describe('SEC-24: field changes honour [] wildcard sensitive paths', () => {
  it('sec_24_redact_changes_matches_wildcards_at_under_and_over', () => {
    expect(redactChanges(cardChanges(), ['cards[].cvc'])).toEqual(redactedCardChanges)
  })

  it('sec_24_redact_changes_redacts_descendants_of_a_root_change', () => {
    expect(
      redactChanges([{ path: '', before: { pin: '1' }, after: { pin: '2', a: 1 } }], ['pin']),
    ).toEqual([{ path: '', before: { pin: R }, after: { pin: R, a: 1 } }])
  })

  it('sec_24_redact_changes_redacts_everything_without_paths', () => {
    expect(redactChanges([{ path: 'a', before: 1, after: 2 }], null)).toEqual([
      { path: 'a', before: R, after: R },
    ])
  })

  it('sec_24_ctx_confirm_changes_redact_wildcard_paths', async () => {
    const requests: { changes?: unknown }[] = []
    const tm = createTestRegistry({
      confirm: (req) => {
        requests.push(req)
        return Promise.resolve({ approved: true })
      },
    })
    tm.register({
      name: 'wallet',
      description: 'd',
      input: z.object({}),
      sensitivePaths: () => ['cards[].cvc'],
      run: async (_i, ctx) => {
        await ctx.confirm({ summary: 'Save?', changes: cardChanges() })
        return ok(true)
      },
    })
    expect((await tm.call('wallet', {}, { caller: 'mcp' })).status).toBe('ok')
    expect(requests[0]?.changes).toEqual(redactedCardChanges)
    for (const secret of ['111', '222', '333'])
      expect(JSON.stringify(requests)).not.toContain(secret)
  })

  it('sec_24_otel_result_changes_redact_wildcard_paths', async () => {
    const tm = createTestRegistry()
    tm.register({
      name: 'wallet',
      description: 'd',
      input: z.object({}),
      sensitivePaths: () => ['cards[].cvc'],
      run: () => ok({ changes: cardChanges() }),
    })
    const exporter = record(tm)
    expect((await tm.call('wallet', {}, { caller: 'inapp' })).status).toBe('ok')
    const span = exporter.getFinishedSpans()[0]!
    const result = JSON.parse(span.attributes['toolmark.result'] as string) as {
      data: { changes: unknown }
    }
    expect(result.data.changes).toEqual(JSON.parse(JSON.stringify(redactedCardChanges)) as unknown)
    expect(JSON.stringify(span.attributes)).not.toMatch(/111|222|333/)
  })
})

describe('SEC-25: change redaction fails closed when sensitivePaths() fails', () => {
  const throwing = (run: Parameters<Toolmark['register']>[0]['run']) => ({
    name: 'save',
    description: 'd',
    input: z.object({}),
    sensitivePaths: (): string[] => {
      throw new Error('boom')
    },
    run,
  })

  it('sec_25_ctx_confirm_changes_fail_closed', async () => {
    const requests: { changes?: unknown }[] = []
    const tm = createTestRegistry({
      dev: false,
      confirm: (req) => {
        requests.push(req)
        return Promise.resolve({ approved: true })
      },
    })
    tm.register(
      throwing(async (_i, ctx) => {
        await ctx.confirm({
          summary: 'Save?',
          changes: [{ path: 'pin', before: '1111', after: '2222' }],
        })
        return ok(true)
      }),
    )
    expect((await tm.call('save', {}, { caller: 'mcp' })).status).toBe('ok')
    expect(requests[0]?.changes).toEqual([{ path: 'pin', before: R, after: R }])
  })

  it('sec_25_otel_result_changes_fail_closed', async () => {
    const tm = createTestRegistry({ dev: false })
    tm.register(throwing(() => ok({ changes: [{ path: 'pin', before: '1111', after: '2222' }] })))
    const exporter = record(tm)
    await tm.call('save', {}, { caller: 'inapp' })
    const span = exporter.getFinishedSpans()[0]!
    expect(JSON.stringify(span.attributes)).not.toMatch(/1111|2222/)
  })
})

describe('SEC-26: an edited approval never restores a secret onto another array item', () => {
  const rowsTool = (runs: unknown[]) => ({
    name: 'accounts',
    description: 'd',
    hints: { consequential: true },
    input: z.object({
      note: z.string().optional(),
      items: z.array(z.object({ n: z.string(), s: z.string() })),
    }),
    sensitivePaths: () => ['items[].s'],
    run: (input: unknown) => {
      runs.push(input)
      return ok(true)
    },
  })
  const raw = {
    items: [
      { n: 'A', s: 'sA' },
      { n: 'B', s: 'sB' },
    ],
  }
  const reenter = (path: string) => ({
    status: 'invalid',
    issues: [{ path, message: 'Re-enter sensitive field' }],
  })

  async function deferred(edit: (pub: typeof raw) => unknown) {
    const tm = createTestRegistry()
    const runs: unknown[] = []
    tm.register(rowsTool(runs))
    const r = await tm.call('accounts', raw, { caller: 'inapp' })
    if (r.status !== 'needs_confirmation') throw new Error('expected needs_confirmation')
    const pub = tm.pendingConfirmations()[0]!.input as typeof raw
    expect(JSON.stringify(pub)).not.toMatch(/sA|sB/)
    const result = await tm.confirmPending(r.confirmId, { approved: true, input: edit(pub) })
    return { result, runs }
  }

  it('sec_26_deferred_unchanged_rows_restore', async () => {
    const { result, runs } = await deferred((pub) => ({ ...pub, note: 'x' }))
    expect(result).toEqual(ok(true))
    expect(runs).toEqual([{ ...raw, note: 'x' }])
  })

  it('sec_26_deferred_delete_row_refuses', async () => {
    const { result, runs } = await deferred((pub) => ({ items: [pub.items[1]] }))
    expect(result).toEqual(reenter('items.0.s'))
    expect(runs).toEqual([])
  })

  it('sec_26_deferred_insert_row_refuses', async () => {
    const { result, runs } = await deferred((pub) => ({
      items: [{ n: 'C', s: 'sC' }, ...pub.items],
    }))
    expect(result).toEqual(reenter('items.1.s'))
    expect(runs).toEqual([])
  })

  it('sec_26_deferred_reorder_rows_refuses', async () => {
    const { result, runs } = await deferred((pub) => ({ items: [pub.items[1], pub.items[0]] }))
    expect(result).toEqual(reenter('items.0.s'))
    expect(runs).toEqual([])
  })

  it('sec_26_deferred_changed_row_content_refuses', async () => {
    const { result } = await deferred((pub) => ({
      items: [{ ...pub.items[0], n: 'A2' }, pub.items[1]],
    }))
    expect(result).toEqual(reenter('items.0.s'))
  })

  it('sec_26_deferred_reentered_secrets_are_accepted', async () => {
    const { result, runs } = await deferred(() => ({ items: [{ n: 'B', s: 'new' }] }))
    expect(result).toEqual(ok(true))
    expect(runs).toEqual([{ items: [{ n: 'B', s: 'new' }] }])
  })

  it('sec_26_inline_delete_row_refuses', async () => {
    const tm = createTestRegistry({
      confirm: (req) => {
        const pub = req.input as typeof raw
        return Promise.resolve({ approved: true, input: { items: [pub.items[1]] } })
      },
    })
    const runs: unknown[] = []
    tm.register(rowsTool(runs))
    expect(await tm.call('accounts', raw, { caller: 'mcp' })).toEqual(reenter('items.0.s'))
    expect(runs).toEqual([])
  })

  it('sec_26_inline_ctx_confirm_delete_row_is_not_approved', async () => {
    const outcomes: unknown[] = []
    const tm = createTestRegistry({
      confirm: (req) => {
        const pub = req.input as typeof raw
        return Promise.resolve({ approved: true, input: { items: [pub.items[1]] } })
      },
    })
    tm.register({
      ...rowsTool([]),
      hints: {},
      run: async (_i: unknown, ctx: { confirm: (r: { summary: string }) => Promise<unknown> }) => {
        outcomes.push(await ctx.confirm({ summary: 'Save?' }))
        return ok(true)
      },
    })
    await tm.call('accounts', raw, { caller: 'mcp' })
    expect(outcomes).toEqual([{ approved: false, reason: 'invalid' }])
  })

  it('sec_26_nested_arrays_refuse_on_inner_delete', () => {
    const paths = ['groups[].members[].pin']
    const nested = {
      groups: [
        {
          g: 'x',
          members: [
            { m: 'a', pin: '1' },
            { m: 'b', pin: '2' },
          ],
        },
      ],
    }
    const pub = {
      groups: [
        {
          g: 'x',
          members: [
            { m: 'a', pin: R },
            { m: 'b', pin: R },
          ],
        },
      ],
    }
    expect(restoreRedacted(pub, nested, paths)).toEqual({ ok: true, value: nested })
    const deleted = { groups: [{ g: 'x', members: [pub.groups[0]!.members[1]] }] }
    expect(restoreRedacted(deleted, nested, paths)).toEqual({
      ok: false,
      path: 'groups.0.members.0.pin',
    })
    const swapped = {
      groups: [{ g: 'x', members: [pub.groups[0]!.members[1], pub.groups[0]!.members[0]] }],
    }
    expect(restoreRedacted(swapped, nested, paths).ok).toBe(false)
  })
})

describe('SEC-27: a placeholder with no stored source is refused', () => {
  const secretTool = (runs: unknown[]) => ({
    name: 'pay',
    description: 'd',
    hints: { consequential: true },
    input: z.object({ card: z.object({ number: z.string(), name: z.string() }) }).passthrough(),
    sensitivePaths: () => ['card.number'],
    run: (input: unknown) => {
      runs.push(input)
      return ok(true)
    },
  })

  it('sec_27_restructured_placeholder_refuses', async () => {
    const tm = createTestRegistry()
    const runs: unknown[] = []
    tm.register(secretTool(runs))
    const r = await tm.call('pay', { card: { number: '4111', name: 'Ann' } }, { caller: 'inapp' })
    if (r.status !== 'needs_confirmation') throw new Error('expected needs_confirmation')
    const edited = { 'card.number': R, card: { name: 'Ann', number: 'x' } }
    expect(await tm.confirmPending(r.confirmId, { approved: true, input: edited })).toEqual({
      status: 'invalid',
      issues: [{ path: 'card.number', message: 'Re-enter sensitive field' }],
    })
    expect(runs).toEqual([])
  })

  it('sec_27_placeholder_without_raw_value_refuses', () => {
    expect(restoreRedacted({ card: { number: R } }, { card: {} }, ['card.number'])).toEqual({
      ok: false,
      path: 'card.number',
    })
  })
})
