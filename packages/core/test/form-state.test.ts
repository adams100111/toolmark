import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  createFormTools,
  ok,
  setPath,
  type FieldInfo,
  type FormAdapter,
  type StandardSchemaV1,
} from '@toolmark/core'
import { createTestRegistry } from './helpers/create-test-registry.js'

/** A node-side stand-in for a DOM element: attributes plus `closest('form')`. */
function fakeElement(
  tag: string,
  attrs: Record<string, string> = {},
  form: unknown = null,
): Element {
  return {
    tagName: tag.toUpperCase(),
    localName: tag,
    getAttribute: (name: string) => (Object.hasOwn(attrs, name) ? attrs[name] : null),
    closest: (sel: string) => (sel === 'form' ? form : null),
  } as unknown as Element
}

class FakeAdapter implements FormAdapter {
  values: Record<string, unknown>
  fieldInfo: FieldInfo[] = []
  setCalls = 0
  constructor(values: Record<string, unknown>) {
    this.values = values
  }
  getValues(): Record<string, unknown> {
    return this.values
  }
  setValues(values: Record<string, unknown>): void {
    this.setCalls++
    for (const [p, v] of Object.entries(values)) this.values = setPath(this.values, p, v)
  }
  dirtyPaths(): string[] {
    return []
  }
  submit() {
    return Promise.resolve(ok({}))
  }
  fields(): FieldInfo[] {
    return this.fieldInfo
  }
}

const schema = z.object({
  title: z.string().min(1, 'Title is required'),
  password: z.string().optional(),
  card: z.string().optional(),
  secret: z.string().optional(),
  address: z.object({ city: z.string() }),
})

describe('form tool state', () => {
  it('state_for_form', () => {
    const tm = createTestRegistry()
    const adapter = new FakeAdapter({ title: '', address: { city: 'Riyadh' } })
    createFormTools(tm, adapter, { name: 'profile', description: 'Profile.', input: schema })
    const state = tm.state('profile.fill')
    expect(state).toEqual({
      values: { title: '', address: { city: 'Riyadh' } },
      issues: [{ path: 'title', message: 'Title is required' }],
    })
    // Submit exposes the same snapshot; state() never writes the form.
    expect(tm.state('profile.submit')).toEqual(state)
    expect(adapter.setCalls).toBe(0)
    // The snapshot is a copy: mutating it leaves the form untouched.
    ;(state!.values as { address: { city: string } }).address.city = 'X'
    expect(adapter.values).toEqual({ title: '', address: { city: 'Riyadh' } })
  })

  it('state_omits_password_and_cc', () => {
    const tm = createTestRegistry()
    const adapter = new FakeAdapter({
      title: 'T',
      password: 'hunter2',
      card: '4111111111111111',
      address: { city: 'Riyadh' },
    })
    adapter.fieldInfo = [
      { path: 'title', element: fakeElement('input', { type: 'text' }) },
      { path: 'password', element: fakeElement('input', { type: 'password' }) },
      { path: 'card', element: fakeElement('input', { autocomplete: 'cc-number' }) },
    ]
    createFormTools(tm, adapter, { name: 'profile', description: 'Profile.', input: schema })
    const state = tm.state('profile.fill')!
    expect(state.values).toEqual({
      title: 'T',
      password: '[redacted]',
      card: '[redacted]',
      address: { city: 'Riyadh' },
    })
    expect(JSON.stringify(state)).not.toContain('hunter2')
    expect(JSON.stringify(state)).not.toContain('4111')
    expect(tm.info('profile.fill')?.sensitivePaths.sort()).toEqual(['card', 'password'])
    expect(tm.info('profile.submit')?.sensitivePaths.sort()).toEqual(['card', 'password'])
  })

  it('state_omits_sensitive_without_elements', () => {
    const tm = createTestRegistry()
    const adapter = new FakeAdapter({
      title: 'T',
      secret: 's3cr3t',
      address: { city: 'Hidden City' },
    })
    adapter.fieldInfo = [{ path: 'title' }, { path: 'secret', sensitive: true }]
    createFormTools(tm, adapter, {
      name: 'profile',
      description: 'Profile.',
      input: schema,
      sensitive: ['address.city'],
    })
    const state = tm.state('profile.fill')!
    expect(state.values).toEqual({
      title: 'T',
      secret: '[redacted]',
      address: { city: '[redacted]' },
    })
    const text = JSON.stringify(state)
    expect(text).not.toContain('s3cr3t')
    expect(text).not.toContain('Hidden City')
    expect(tm.info('profile.fill')?.sensitivePaths.sort()).toEqual(['address.city', 'secret'])
  })

  it('state_async_schema_returns_last_issues', async () => {
    const tm = createTestRegistry()
    const adapter = new FakeAdapter({ title: '' })
    let calls = 0
    const asyncSchema: StandardSchemaV1<unknown, Record<string, unknown>> = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate(value) {
          calls++
          const v = value as { title?: string }
          return Promise.resolve(
            v.title ? { value: v } : { issues: [{ message: 'Required', path: ['title'] }] },
          )
        },
      },
    }
    const revs: number[] = []
    tm.subscribe((rev) => revs.push(rev))
    createFormTools(tm, adapter, {
      name: 'f',
      description: 'F.',
      input: asyncSchema,
      jsonSchema: { type: 'object', properties: { title: { type: 'string' } } },
    })
    await Promise.resolve()
    await Promise.resolve()
    const before = revs.length
    // First read: nothing settled yet.
    expect(tm.state('f.fill')?.issues).toEqual([])
    await new Promise((r) => setTimeout(r, 0))
    // Second read: the first validation settled and is returned.
    expect(tm.state('f.fill')?.issues).toEqual([{ path: 'title', message: 'Required' }])
    adapter.values = { title: 'ok' }
    // Still the last settled result until the new validation settles.
    expect(tm.state('f.fill')?.issues).toEqual([{ path: 'title', message: 'Required' }])
    await new Promise((r) => setTimeout(r, 0))
    expect(tm.state('f.fill')?.issues).toEqual([])
    expect(calls).toBeGreaterThanOrEqual(3)
    await new Promise((r) => setTimeout(r, 0))
    // Settling cached results emitted no revision change.
    expect(revs.length).toBe(before)
  })

  it('submit_anchor_is_form_owner', () => {
    const tm = createTestRegistry()
    const formEl = { tagName: 'FORM', localName: 'form' } as unknown as Element
    const title = fakeElement('input', { name: 'title' }, formEl)
    const city = fakeElement('input', { name: 'address.city' }, formEl)
    const adapter = new FakeAdapter({ title: '', address: { city: '' } })
    adapter.fieldInfo = [
      { path: 'title', element: title },
      { path: 'address.city', element: city },
    ]
    createFormTools(tm, adapter, { name: 'profile', description: 'Profile.', input: schema })
    expect(tm.anchor('profile.submit')).toBe(formEl)
    expect(tm.anchor('profile.fill')).toBe(formEl)
    expect(tm.anchor('profile.fill', 'address.city')).toBe(city)
    expect(tm.anchor('profile.fill', 'nope')).toBeNull()
    // No mounted elements → null.
    adapter.fieldInfo = [{ path: 'title' }]
    expect(tm.anchor('profile.submit')).toBeNull()
  })

  it('interaction_events_from_adapter', () => {
    const tm = createTestRegistry()
    const adapter = new FakeAdapter({ title: '' }) as FakeAdapter & {
      onUserInteraction: NonNullable<FormAdapter['onUserInteraction']>
    }
    let emit: ((e: { path: string; kind: 'input' | 'focus' | 'submit' }) => void) | undefined
    let unsubscribed = 0
    adapter.onUserInteraction = (cb) => {
      emit = cb
      return () => {
        unsubscribed++
      }
    }
    const events: unknown[] = []
    tm.events.on('interaction', (e) => events.push(e))
    const scope = tm.scope('page')
    const handle = createFormTools(tm, adapter, {
      name: 'profile',
      description: 'Profile.',
      input: schema,
      scope,
    })
    emit!({ path: 'title', kind: 'input' })
    emit!({ path: 'title', kind: 'focus' })
    emit!({ path: '', kind: 'submit' })
    expect(events).toEqual([
      { tool: 'page.profile.fill', param: 'title', kind: 'input', caller: 'human' },
      { tool: 'page.profile.fill', param: 'title', kind: 'focus', caller: 'human' },
      { tool: 'page.profile.submit', kind: 'submit', caller: 'human' },
    ])
    handle.dispose()
    expect(unsubscribed).toBe(1)
    emit!({ path: 'title', kind: 'input' })
    expect(events).toHaveLength(3)
  })
})
