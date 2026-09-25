import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base'
import {
  createFormTools,
  createWizardTools,
  ok,
  setPath,
  type FieldInfo,
  type FormAdapter,
  type Toolmark,
} from '@toolmark/core'
import { otel } from '@toolmark/core/otel'
import { createTestRegistry } from './helpers/create-test-registry.js'

/** A node-side element stand-in (type/autocomplete drive the built-in sensitive rule). */
function element(tag: string, attrs: Record<string, string>): Element {
  return {
    tagName: tag.toUpperCase(),
    localName: tag,
    getAttribute: (name: string) => (Object.hasOwn(attrs, name) ? attrs[name] : null),
    closest: () => null,
  } as unknown as Element
}

class FakeAdapter implements FormAdapter {
  values: Record<string, unknown>
  fieldInfo: FieldInfo[] = []
  constructor(values: Record<string, unknown>) {
    this.values = values
  }
  getValues() {
    return this.values
  }
  setValues(values: Record<string, unknown>) {
    for (const [p, v] of Object.entries(values)) this.values = setPath(this.values, p, v)
  }
  dirtyPaths() {
    return []
  }
  submit() {
    return Promise.resolve(ok({}))
  }
  fields() {
    return this.fieldInfo
  }
}

const cleanups: (() => void | Promise<void>)[] = []
afterEach(async () => {
  for (const fn of cleanups.splice(0)) await fn()
})

/** Attaches `otel({ recordPayloads: true })` and returns the exporter. */
function record(tm: Toolmark): InMemorySpanExporter {
  const exporter = new InMemorySpanExporter()
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] })
  cleanups.push(() => provider.shutdown())
  cleanups.push(tm.use(otel({ tracer: provider.getTracer('test'), recordPayloads: true })))
  return exporter
}

function spanInput(exporter: InMemorySpanExporter, tool: string): string {
  const span = exporter.getFinishedSpans().find((s) => s.attributes['toolmark.tool'] === tool)
  expect(span).toBeDefined()
  const input = span!.attributes['toolmark.input']
  expect(typeof input).toBe('string')
  return input as string
}

describe('otel input redaction matches the tool input shape (C1)', () => {
  it('form_fill_redacts_values_paths', async () => {
    const tm = createTestRegistry()
    const adapter = new FakeAdapter({ user: '', pw: '', pin: '' })
    adapter.fieldInfo = [
      { path: 'user', element: element('input', { type: 'text' }) },
      { path: 'pw', element: element('input', { type: 'password' }) },
      { path: 'pin', element: element('input', { type: 'text' }) },
    ]
    createFormTools(tm, adapter, {
      name: 'login',
      description: 'Login.',
      input: z.object({ user: z.string(), pw: z.string(), pin: z.string() }),
      sensitive: ['pin'],
    })
    const exporter = record(tm)
    const r = await tm.call(
      'login.fill',
      { values: { user: 'bob', pw: 'hunter2', pin: '4242' } },
      { caller: 'inapp' },
    )
    expect(r.status).toBe('ok')
    const input = JSON.parse(spanInput(exporter, 'login.fill')) as {
      values: Record<string, unknown>
    }
    expect(input.values).toEqual({ user: 'bob', pw: '[redacted]', pin: '[redacted]' })
    const span = exporter.getFinishedSpans()[0]!
    const all = JSON.stringify(span.attributes)
    expect(all).not.toContain('hunter2')
    expect(all).not.toContain('4242')
  })

  it('form_fill_redacts_wildcard_paths_expanded_against_the_input', async () => {
    const tm = createTestRegistry()
    const adapter = new FakeAdapter({ cards: [] })
    createFormTools(tm, adapter, {
      name: 'wallet',
      description: 'Wallet.',
      input: z.object({ cards: z.array(z.object({ name: z.string(), cvc: z.string() })) }),
      sensitive: ['cards[].cvc'],
    })
    const exporter = record(tm)
    const r = await tm.call(
      'wallet.fill',
      {
        values: {
          cards: [
            { name: 'A', cvc: '123' },
            { name: 'B', cvc: '456' },
          ],
        },
      },
      { caller: 'inapp' },
    )
    expect(r.status).toBe('ok')
    const text = spanInput(exporter, 'wallet.fill')
    expect(JSON.parse(text)).toEqual({
      values: {
        cards: [
          { name: 'A', cvc: '[redacted]' },
          { name: 'B', cvc: '[redacted]' },
        ],
      },
    })
    const all = JSON.stringify(exporter.getFinishedSpans()[0]!.attributes)
    expect(all).not.toContain('123')
    expect(all).not.toContain('456')
  })

  it('form_fill_redacts_dotted_keys_and_append_ops', async () => {
    const tm = createTestRegistry()
    const adapter = new FakeAdapter({ cards: [], profile: { ssn: '' } })
    createFormTools(tm, adapter, {
      name: 'wallet',
      description: 'Wallet.',
      input: z.object({
        cards: z.array(z.object({ cvc: z.string() })),
        profile: z.object({ ssn: z.string() }),
      }),
      sensitive: ['cards[].cvc', 'profile.ssn'],
    })
    const exporter = record(tm)
    await tm.call(
      'wallet.fill',
      { values: { 'profile.ssn': '111-22', cards: { $append: [{ cvc: '999' }] } } },
      { caller: 'inapp' },
    )
    const text = spanInput(exporter, 'wallet.fill')
    expect(text).not.toContain('111-22')
    expect(text).not.toContain('999')
    expect(JSON.parse(text)).toEqual({
      values: { 'profile.ssn': '[redacted]', cards: { $append: [{ cvc: '[redacted]' }] } },
    })
  })

  function wizard(tm: Toolmark) {
    let data: Record<string, Record<string, unknown>> = {
      account: { email: '', pw: '' },
      pay: { cards: [] },
    }
    const account = new FakeAdapter({ email: '', pw: '' })
    account.fieldInfo = [
      { path: 'email', element: element('input', { type: 'email' }) },
      { path: 'pw', element: element('input', { type: 'password' }) },
    ]
    createWizardTools(tm, {
      name: 'wiz',
      description: 'Wizard.',
      steps: [
        { name: 'account', input: z.object({ email: z.string(), pw: z.string() }) },
        {
          name: 'pay',
          input: z.object({ cards: z.array(z.object({ cvc: z.string() })) }),
          sensitive: ['cards[].cvc'],
        },
      ],
      getData: () => data,
      setData: (next) => {
        data = next
      },
      getCurrent: () => 'account',
      goTo: () => undefined,
      currentAdapter: () => account,
      submit: () => Promise.resolve(ok(null)),
    })
  }

  it('wizard_fill_redacts_steps_paths', async () => {
    const tm = createTestRegistry()
    wizard(tm)
    const exporter = record(tm)
    const r = await tm.call(
      'wiz.fill',
      { steps: { account: { email: 'a@x.com', pw: 'hunter2' } } },
      { caller: 'inapp' },
    )
    expect(r.status).toBe('ok')
    const input = JSON.parse(spanInput(exporter, 'wiz.fill')) as unknown
    expect(input).toEqual({ steps: { account: { email: 'a@x.com', pw: '[redacted]' } } })
    expect(JSON.stringify(exporter.getFinishedSpans()[0]!.attributes)).not.toContain('hunter2')
  })

  it('wizard_fill_redacts_wildcard_steps_paths', async () => {
    const tm = createTestRegistry()
    wizard(tm)
    const exporter = record(tm)
    const r = await tm.call(
      'wiz.fill',
      { steps: { pay: { cards: [{ cvc: '321' }, { cvc: '654' }] } } },
      { caller: 'inapp' },
    )
    expect(r.status).toBe('ok')
    const input = JSON.parse(spanInput(exporter, 'wiz.fill')) as unknown
    expect(input).toEqual({
      steps: { pay: { cards: [{ cvc: '[redacted]' }, { cvc: '[redacted]' }] } },
    })
    const all = JSON.stringify(exporter.getFinishedSpans()[0]!.attributes)
    expect(all).not.toContain('321')
    expect(all).not.toContain('654')
  })

  it('plain_tool_wildcard_sensitive_paths_expand_against_the_input', async () => {
    const tm = createTestRegistry()
    tm.register({
      name: 'save',
      description: 'd',
      input: z.record(z.string(), z.unknown()),
      sensitivePaths: () => ['secrets[].value'],
      run: () => ok(null),
    })
    const exporter = record(tm)
    await tm.call('save', { secrets: [{ value: 's1' }, { value: 's2' }] }, { caller: 'test' })
    expect(JSON.parse(spanInput(exporter, 'save'))).toEqual({
      secrets: [{ value: '[redacted]' }, { value: '[redacted]' }],
    })
  })
})
