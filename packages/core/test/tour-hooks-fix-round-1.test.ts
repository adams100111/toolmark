import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  createFormTools,
  createWizardTools,
  ok,
  setPath,
  type FieldInfo,
  type FormAdapter,
} from '@toolmark/core'
import { createTestRegistry } from './helpers/create-test-registry.js'

/** A node-side element stand-in whose attributes can change after creation. */
function mutableElement(tag: string, attrs: Record<string, string>): Element {
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

describe('tour hooks fix round 1', () => {
  it('wizard_step_sensitivity_survives_unmount', () => {
    const tm = createTestRegistry()
    let data: Record<string, Record<string, unknown>> = {
      pay: { card: '4111111111111111' },
      review: { note: '' },
    }
    let current = 'pay'
    const pay = new FakeAdapter({ card: '4111111111111111' })
    pay.fieldInfo = [
      { path: 'card', element: mutableElement('input', { autocomplete: 'cc-number' }) },
    ]
    let mounted: FormAdapter | undefined = pay
    createWizardTools(tm, {
      name: 'wiz',
      description: 'Wizard.',
      steps: [
        { name: 'pay', input: z.object({ card: z.string() }) },
        { name: 'review', input: z.object({ note: z.string() }) },
      ],
      getData: () => data,
      setData: (next) => {
        data = next
      },
      getCurrent: () => current,
      goTo: (s) => {
        current = s
      },
      currentAdapter: () => mounted,
      submit: () => Promise.resolve(ok(null)),
    })
    expect((tm.state('wiz.fill')!.values as typeof data).pay!.card).toBe('[redacted]')
    // goTo review: the pay step's form is unmounted, its value now comes from getData().
    current = 'review'
    mounted = new FakeAdapter({ note: '' })
    const state = tm.state('wiz.fill')!
    expect((state.values as typeof data).pay!.card).toBe('[redacted]')
    expect(JSON.stringify(state)).not.toContain('4111')
    expect(tm.info('wiz.fill')?.sensitivePaths).toContain('pay.card')
  })

  it('form_element_sensitivity_is_sticky_across_type_flip', () => {
    const tm = createTestRegistry()
    const attrs: Record<string, string> = { type: 'password' }
    const adapter = new FakeAdapter({ pw: 'hunter2' })
    adapter.fieldInfo = [{ path: 'pw', element: mutableElement('input', attrs) }]
    createFormTools(tm, adapter, {
      name: 'login',
      description: 'Login.',
      input: z.object({ pw: z.string() }),
    })
    expect(tm.state('login.fill')!.values).toEqual({ pw: '[redacted]' })
    // "Show password": the input becomes type=text; the value must stay redacted.
    attrs.type = 'text'
    expect(tm.state('login.fill')!.values).toEqual({ pw: '[redacted]' })
    expect(tm.info('login.fill')?.sensitivePaths).toEqual(['pw'])
  })

  it('declared_wildcard_sensitive_paths_are_redacted', async () => {
    const tm = createTestRegistry()
    const adapter = new FakeAdapter({
      cards: [
        { name: 'A', cvc: '123' },
        { name: 'B', cvc: '456' },
      ],
    })
    createFormTools(tm, adapter, {
      name: 'wallet',
      description: 'Wallet.',
      input: z.object({ cards: z.array(z.object({ name: z.string(), cvc: z.string() })) }),
      sensitive: ['cards[].cvc'],
    })
    const state = tm.state('wallet.fill')!
    expect(state.values).toEqual({
      cards: [
        { name: 'A', cvc: '[redacted]' },
        { name: 'B', cvc: '[redacted]' },
      ],
    })
    const paths = tm.info('wallet.fill')!.sensitivePaths
    expect(paths).toContain('cards[].cvc')
    expect(paths).toEqual(expect.arrayContaining(['cards.0.cvc', 'cards.1.cvc']))

    // Fill changes redact the wildcard too (whole-array and item-level writes).
    const r = await tm.call(
      'wallet.fill',
      { values: { cards: [{ name: 'C', cvc: '789' }] } },
      { caller: 'inapp' },
    )
    expect(r.status).toBe('ok')
    const text = JSON.stringify(r)
    for (const secret of ['123', '456', '789']) expect(text).not.toContain(secret)
    expect(text).toContain('"C"')
  })

  it('wizard_step_wildcard_sensitive', () => {
    const tm = createTestRegistry()
    let data: Record<string, Record<string, unknown>> = {
      pay: { cards: [{ cvc: '321' }] },
    }
    createWizardTools(tm, {
      name: 'wiz',
      description: 'Wizard.',
      steps: [
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
      getCurrent: () => 'pay',
      goTo: () => undefined,
      submit: () => Promise.resolve(ok(null)),
    })
    const state = tm.state('wiz.fill')!
    expect(state.values).toEqual({ pay: { cards: [{ cvc: '[redacted]' }] } })
    expect(tm.info('wiz.fill')?.sensitivePaths).toContain('pay.cards[].cvc')
  })
})
