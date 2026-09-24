import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  createFormTools,
  getPath,
  ok,
  setPath,
  type FieldInfo,
  type FormAdapter,
} from '@toolmark/core'
import { createTestRegistry } from './helpers/create-test-registry.js'

type Values = {
  title?: string
  pin: string
  password: string
  count?: number
  address: { city: string }
}

const schema = z.object({
  title: z.string().max(50).optional(),
  pin: z.string().min(4),
  password: z.string(),
  count: z.number().optional(),
  address: z.object({ city: z.string() }),
})

/** In-memory adapter emulating react-hook-form: agent writes mark fields dirty, null stores ''. */
class FakeAdapter implements FormAdapter<Values> {
  values: Values = { title: '', pin: '', password: '', address: { city: '' } }
  dirty = new Set<string>()
  submitted = 0
  fieldInfo: FieldInfo[] = []
  getValues(): Values {
    return this.values
  }
  setValues(values: Record<string, unknown>): void {
    for (const [path, v] of Object.entries(values)) {
      this.values = setPath(this.values, path, v === null ? '' : v)
      this.dirty.add(path)
    }
  }
  dirtyPaths(): string[] {
    return [...this.dirty]
  }
  submit() {
    this.submitted++
    return Promise.resolve(ok({ saved: true }))
  }
  fields(): FieldInfo[] {
    return this.fieldInfo
  }
  /** Simulates the user typing. */
  userTypes(path: string, value: unknown): void {
    this.values = setPath(this.values, path, value)
    this.dirty.add(path)
  }
}

function setup(opts: { sensitive?: string[] } = {}) {
  const tm = createTestRegistry()
  const adapter = new FakeAdapter()
  const tools = createFormTools(tm, adapter, {
    name: 'challenge',
    title: 'Challenge',
    description: 'The challenge form.',
    input: schema,
    ...opts,
  })
  const fill = (values: unknown, overwrite?: boolean) =>
    tm.call('challenge.fill', overwrite === undefined ? { values } : { values, overwrite }, {
      caller: 'inapp',
    })
  return { tm, adapter, tools, fill }
}

describe('form tools', () => {
  it('registers_fill_and_submit_with_fill_schema', () => {
    const { tm, tools } = setup()
    const fill = tm.describe('challenge.fill')!
    const submit = tm.describe('challenge.submit')!
    expect(fill.hints).toEqual({})
    expect(submit.hints).toEqual({ consequential: true })
    expect(fill.inputSchema).toMatchObject({
      type: 'object',
      properties: {
        values: { type: 'object', properties: { title: { type: 'string' } } },
        overwrite: { type: 'boolean' },
      },
      required: ['values'],
    })
    expect(
      JSON.stringify((fill.inputSchema.properties as Record<string, unknown>).values),
    ).not.toContain('"required"')
    tools.dispose()
    expect(tm.manifest().tools).toEqual([])
  })

  it('fill_sets_values_and_reports_changes', async () => {
    const { adapter, fill } = setup()
    const r = await fill({ title: 'Hello', address: { city: 'Riyadh' } })
    expect(r).toEqual({
      status: 'ok',
      data: {
        changes: [
          { path: 'address.city', before: '', after: 'Riyadh' },
          { path: 'title', before: '', after: 'Hello' },
        ],
        skipped: [],
      },
    })
    expect(adapter.values.title).toBe('Hello')
    expect(adapter.values.address.city).toBe('Riyadh')
  })

  it('fill_null_clear_of_required_field_invalid', async () => {
    const { adapter, fill } = setup()
    adapter.values = { ...adapter.values, pin: '1234' }
    expect((await fill({ pin: null })).status).toBe('invalid')
    expect(adapter.values.pin).toBe('1234')
  })

  it('fill_null_clears_undefined_leaves', async () => {
    const { adapter, fill } = setup()
    adapter.values = { ...adapter.values, title: 'Old', pin: '1234' }
    const r = await fill({ title: null, pin: undefined })
    expect(r).toEqual(ok({ changes: [{ path: 'title', before: 'Old', after: '' }], skipped: [] }))
    expect(adapter.values.pin).toBe('1234')
    expect(adapter.values.title).toBe('')
  })

  it('fill_skips_user_edited_field', async () => {
    const { adapter, fill } = setup()
    adapter.userTypes('title', 'Mine')
    const r = await fill({ title: 'Agent', address: { city: 'Jeddah' } })
    expect(r).toEqual(
      ok({ changes: [{ path: 'address.city', before: '', after: 'Jeddah' }], skipped: ['title'] }),
    )
    expect(adapter.values.title).toBe('Mine')
  })

  it('fill_overwrite_true_replaces_user_value', async () => {
    const { adapter, fill } = setup()
    adapter.userTypes('title', 'Mine')
    const r = await fill({ title: 'Agent' }, true)
    expect(r).toEqual(
      ok({ changes: [{ path: 'title', before: 'Mine', after: 'Agent' }], skipped: [] }),
    )
    expect(adapter.values.title).toBe('Agent')
  })

  it('agent_can_refine_own_value', async () => {
    const { adapter, fill } = setup()
    await fill({ title: 'First' })
    expect(adapter.dirty.has('title')).toBe(true)
    const r = await fill({ title: 'Second' })
    expect(r).toEqual(
      ok({ changes: [{ path: 'title', before: 'First', after: 'Second' }], skipped: [] }),
    )
    adapter.userTypes('title', 'User')
    expect(await fill({ title: 'Third' })).toEqual(ok({ changes: [], skipped: ['title'] }))
  })

  it('agent_refine_after_null_clear', async () => {
    const { adapter, fill } = setup()
    adapter.userTypes('title', 'User')
    await fill({ title: null }, true)
    expect(adapter.values.title).toBe('')
    const r = await fill({ title: 'Again' })
    expect(r).toEqual(ok({ changes: [{ path: 'title', before: '', after: 'Again' }], skipped: [] }))
  })

  it('fill_invalid_touched_path_sets_nothing', async () => {
    const { adapter, fill } = setup()
    const r = await fill({ title: 'x'.repeat(51), address: { city: 'Ok' } })
    expect(r.status).toBe('invalid')
    if (r.status === 'invalid') expect(r.issues.map((i) => i.path)).toEqual(['title'])
    expect(adapter.values.title).toBe('')
    expect(adapter.values.address.city).toBe('')
    expect((await fill({ count: 'three' })).status).toBe('invalid')
  })

  it('fill_ignores_issues_on_untouched_paths', async () => {
    const { adapter, fill } = setup()
    // pin needs 4+ characters and is still empty: untouched, so its issue is ignored.
    expect((await fill({ title: 'Only title' })).status).toBe('ok')
    expect(adapter.values.title).toBe('Only title')
    expect((await fill({ pin: '42' })).status).toBe('invalid')
  })

  it('fill_rejects_proto_path_no_pollution', async () => {
    const { adapter, fill, tm } = setup()
    const before = structuredClone(adapter.values)
    const parsed: unknown = JSON.parse('{"values":{"__proto__":{"x":1}}}')
    const r = await tm.call('challenge.fill', parsed, { caller: 'inapp' })
    expect(r).toEqual({
      status: 'invalid',
      issues: [{ path: '__proto__', message: 'Invalid field path' }],
    })
    const r2 = await fill({ 'constructor.prototype.x': 1, title: 'ok' })
    expect(r2).toEqual({
      status: 'invalid',
      issues: [{ path: 'constructor.prototype.x', message: 'Invalid field path' }],
    })
    const r3 = await fill({ constructor: { prototype: { x: 1 } } })
    expect(r3.status).toBe('invalid')
    expect(adapter.values).toEqual(before)
    expect(({} as Record<string, unknown>).x).toBeUndefined()
    expect(Object.prototype).not.toHaveProperty('x')
  })

  it('fill_unknown_field_invalid', async () => {
    const { adapter, fill } = setup()
    const r = await fill({ title: 'Ok', organization_id: 7 })
    expect(r).toEqual({
      status: 'invalid',
      issues: [{ path: 'organization_id', message: 'Unknown field' }],
    })
    expect(adapter.values.title).toBe('')
    expect(getPath(adapter.values, 'organization_id')).toBeUndefined()
  })

  it('fill_input_shape_validated', async () => {
    const { tm } = setup()
    for (const bad of [
      {},
      { values: [] },
      { values: 1 },
      { values: {}, overwrite: 'yes' },
      { values: {}, extra: 1 },
    ]) {
      expect((await tm.call('challenge.fill', bad, { caller: 'inapp' })).status).toBe('invalid')
    }
  })

  it('fill_redacts_sensitive_paths', async () => {
    const { adapter, fill } = setup({ sensitive: ['pin'] })
    const passwordEl = {
      tagName: 'INPUT',
      type: 'password',
      getAttribute: (n: string) => (n === 'type' ? 'password' : null),
    } as unknown as Element
    adapter.fieldInfo = [
      { path: 'password', element: passwordEl },
      { path: 'title', element: null },
    ]
    const r = await fill({ pin: '1234', password: 'hunter2', title: 'Visible' })
    expect(r).toEqual(
      ok({
        changes: [
          { path: 'password', before: '[redacted]', after: '[redacted]' },
          { path: 'pin', before: '[redacted]', after: '[redacted]' },
          { path: 'title', before: '', after: 'Visible' },
        ],
        skipped: [],
      }),
    )
    expect(adapter.values.pin).toBe('1234')
    adapter.fieldInfo = [{ path: 'title', sensitive: true }]
    const r2 = await fill({ title: 'Secret' })
    expect(r2).toEqual(
      ok({ changes: [{ path: 'title', before: '[redacted]', after: '[redacted]' }], skipped: [] }),
    )
    const ccEl = {
      tagName: 'INPUT',
      getAttribute: (n: string) => (n === 'autocomplete' ? 'cc-number' : null),
    }
    adapter.fieldInfo = [{ path: 'address.city', element: ccEl as unknown as Element }]
    const r3 = await fill({ address: { city: 'X' } })
    expect(r3).toMatchObject({
      data: { changes: [{ path: 'address.city', before: '[redacted]' }] },
    })
  })

  it('undo_restores_before_values', async () => {
    const { tm, adapter } = setup()
    adapter.values = { ...adapter.values, title: 'Orig' }
    let callId = ''
    tm.events.on('call', (e) => (callId = e.callId))
    await tm.call('challenge.fill', { values: { title: 'New', pin: '9999' } }, { caller: 'inapp' })
    const r = await tm.undo(callId)
    expect(r).toEqual(
      ok({
        changes: [
          { path: 'pin', before: '9999', after: '' },
          { path: 'title', before: 'New', after: 'Orig' },
        ],
        skipped: [],
      }),
    )
    expect(adapter.values.title).toBe('Orig')
    expect((await tm.undo(callId)).status).toBe('refused')
  })

  it('undo_skips_user_edited_since', async () => {
    const { tm, adapter } = setup()
    let callId = ''
    tm.events.on('call', (e) => (callId = e.callId))
    await tm.call(
      'challenge.fill',
      { values: { title: 'Agent', pin: '1111' } },
      { caller: 'inapp' },
    )
    adapter.userTypes('title', 'User changed')
    const r = await tm.undo(callId)
    expect(r).toEqual(
      ok({ changes: [{ path: 'pin', before: '1111', after: '' }], skipped: ['title'] }),
    )
    expect(adapter.values.title).toBe('User changed')
  })

  it('submit_is_consequential_deferred_for_inapp', async () => {
    const { tm, adapter } = setup()
    adapter.values = { ...adapter.values, title: 'T' }
    const r = await tm.call('challenge.submit', {}, { caller: 'inapp' })
    expect(r).toMatchObject({ status: 'needs_confirmation', summary: 'Submit Challenge' })
    expect(adapter.submitted).toBe(0)
    if (r.status !== 'needs_confirmation') return
    expect(await tm.confirmPending(r.confirmId, { approved: true })).toEqual(ok({ saved: true }))
    expect(adapter.submitted).toBe(1)
  })

  it('submit_summary_uses_values', async () => {
    const tm = createTestRegistry()
    const adapter = new FakeAdapter()
    adapter.values = { ...adapter.values, title: 'Launch' }
    createFormTools(tm, adapter, {
      name: 'c',
      description: 'd',
      input: schema,
      submitSummary: (v) => `Create "${v.title}"`,
    })
    expect(await tm.call('c.submit', {}, { caller: 'test' })).toMatchObject({
      summary: 'Create "Launch"',
    })
  })

  it('registers_into_scope', () => {
    const tm = createTestRegistry()
    const s = tm.scope('page')
    createFormTools(tm, new FakeAdapter(), {
      name: 'form',
      description: 'd',
      input: schema,
      scope: s,
    })
    expect(tm.manifest().tools.map((t) => t.name)).toEqual(['page.form.fill', 'page.form.submit'])
  })
})
