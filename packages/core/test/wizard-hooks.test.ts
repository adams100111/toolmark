import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  createStepwiseWizardTools,
  createWizardTools,
  ok,
  setPath,
  type FieldInfo,
  type FormAdapter,
  type WizardStep,
} from '@toolmark/core'
import { createTestRegistry } from './helpers/create-test-registry.js'

type Data = Record<string, Record<string, unknown>>
type Interaction = { path: string; kind: 'input' | 'focus' | 'submit' }

function fakeElement(tag: string, attrs: Record<string, string> = {}, form: unknown = null) {
  return {
    tagName: tag.toUpperCase(),
    localName: tag,
    getAttribute: (name: string) => (Object.hasOwn(attrs, name) ? attrs[name] : null),
    closest: (sel: string) => (sel === 'form' ? form : null),
  } as unknown as Element
}

class StepForm implements FormAdapter {
  values: Record<string, unknown>
  fieldInfo: FieldInfo[] = []
  emit: ((e: Interaction) => void) | undefined
  subscriptions = 0
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
    return Promise.resolve(ok(null))
  }
  fields() {
    return this.fieldInfo
  }
  onUserInteraction(cb: (e: Interaction) => void) {
    this.subscriptions++
    this.emit = cb
    return () => {
      if (this.emit === cb) this.emit = undefined
    }
  }
}

const steps: WizardStep[] = [
  {
    name: 'account',
    input: z.object({ email: z.string().min(1, 'Email is required'), pin: z.string() }),
    sensitive: ['pin'],
  },
  { name: 'details', input: z.object({ budget: z.number(), card: z.string().optional() }) },
]

function setup() {
  const tm = createTestRegistry({ confirm: () => Promise.resolve({ approved: true }) })
  let data: Data = {
    account: { email: '', pin: '1234' },
    details: { budget: 5, card: '4111111111111111' },
  }
  let current = 'account'
  const form = new StepForm({ email: '', pin: '9999' })
  let mounted: FormAdapter | undefined = form
  createWizardTools(tm, {
    name: 'wiz',
    description: 'Wizard.',
    steps,
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
  return {
    tm,
    form,
    setCurrent: (s: string, adapter?: FormAdapter) => {
      current = s
      mounted = adapter
    },
  }
}

describe('wizard tour hooks', () => {
  it('state_for_wizard', () => {
    const { tm, form, setCurrent } = setup()
    const state = tm.state('wiz.fill')!
    expect(state.step).toBe('account')
    // The current step is read from its mounted form; sensitive paths are redacted.
    expect(state.values).toEqual({
      account: { email: '', pin: '[redacted]' },
      details: { budget: 5, card: '4111111111111111' },
    })
    expect(state.issues).toEqual([{ path: 'account.email', message: 'Email is required' }])
    expect(JSON.stringify(state)).not.toContain('9999')
    expect(JSON.stringify(state)).not.toContain('1234')
    expect(tm.state('wiz.submit')).toEqual(state)

    // A `cc-*` element on the current step is redacted too.
    const details = new StepForm({ budget: 7, card: '5500000000000004' })
    details.fieldInfo = [
      { path: 'card', element: fakeElement('input', { autocomplete: 'cc-number' }) },
    ]
    setCurrent('details', details)
    const next = tm.state('wiz.fill')!
    expect(next.step).toBe('details')
    expect(next.values).toEqual({
      account: { email: '', pin: '[redacted]' },
      details: { budget: 7, card: '[redacted]' },
    })
    expect(next.issues).toEqual([])
    expect(tm.info('wiz.fill')?.sensitivePaths.sort()).toEqual(['account.pin', 'details.card'])
    void form
  })

  it('wizard_anchor_current_step_only', () => {
    const { tm, form, setCurrent } = setup()
    const formEl = { tagName: 'FORM', localName: 'form' } as unknown as Element
    const email = fakeElement('input', { name: 'email' }, formEl)
    form.fieldInfo = [{ path: 'email', element: email }]
    expect(tm.anchor('wiz.fill', 'account.email')).toBe(email)
    expect(tm.anchor('wiz.fill')).toBe(formEl)
    expect(tm.anchor('wiz.fill', 'details.budget')).toBeNull()
    expect(tm.anchor('wiz.fill', 'account.nope')).toBeNull()
    setCurrent('details', undefined)
    expect(tm.anchor('wiz.fill', 'account.email')).toBeNull()
  })

  it('wizard_interaction_events_prefix_step', () => {
    const { tm, form, setCurrent } = setup()
    const events: unknown[] = []
    tm.events.on('interaction', (e) => events.push(e))
    form.emit!({ path: 'email', kind: 'input' })
    const details = new StepForm({ budget: 1 })
    setCurrent('details', details)
    // A hook read picks up the new current step's form.
    tm.state('wiz.fill')
    expect(form.emit).toBeUndefined()
    details.emit!({ path: 'budget', kind: 'focus' })
    expect(events).toEqual([
      { tool: 'wiz.fill', param: 'account.email', kind: 'input', caller: 'human' },
      { tool: 'wiz.fill', param: 'details.budget', kind: 'focus', caller: 'human' },
    ])
  })

  it('stepwise_anchor_under_step_fill', () => {
    const tm = createTestRegistry({ confirm: () => Promise.resolve({ approved: true }) })
    const form = new StepForm({ email: 'a@b.c' })
    const email = fakeElement('input', { name: 'email' })
    form.fieldInfo = [{ path: 'email', element: email }]
    createStepwiseWizardTools(tm, {
      name: 'sw',
      description: 'Stepwise.',
      currentAdapter: () => form,
      currentStep: () => ({ name: 'account', input: z.object({ email: z.string() }) }),
      next: () => Promise.resolve(ok(null)),
      previous: () => undefined,
      submit: () => Promise.resolve(ok(null)),
    })
    expect(tm.anchor('sw.step.fill', 'email')).toBe(email)
    expect(tm.state('sw.step.fill')).toEqual({ values: { email: 'a@b.c' }, issues: [] })
  })
})
