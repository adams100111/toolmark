import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  createFormTools,
  createToolmark,
  getPath,
  ok,
  setPath,
  type FieldInfo,
  type FormAdapter,
  type JsonSchema,
  type StandardSchemaV1,
} from '@toolmark/core'
import { createTestRegistry } from './helpers/create-test-registry.js'

type Values = {
  title?: string
  pin: string
  password: string
  count?: number
  address: { city: string }
  tags?: { name: string }[]
  pay?: { number?: string; name?: string } | null
}

const schema = z.object({
  title: z.string().max(50).optional(),
  pin: z.string().min(4),
  password: z.string(),
  count: z.number().optional(),
  address: z.object({ city: z.string() }),
  tags: z.array(z.object({ name: z.string() })).optional(),
  pay: z.object({ number: z.string().optional(), name: z.string().optional() }).nullish(),
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
    // M2: array-op branches keep their own `required` (pass-2 ruling); nothing else does.
    const values = (fill.inputSchema.properties as Record<string, JsonSchema>).values!
    const isOpBranch = (b: unknown): boolean => {
      const props = (b as { properties?: Record<string, unknown> } | null)?.properties
      return props !== undefined && ('$append' in props || '$remove' in props)
    }
    const withoutOps = JSON.stringify(values, (key, v: unknown) =>
      key === 'anyOf' && Array.isArray(v) ? v.filter((b) => !isOpBranch(b)) : v,
    )
    expect(withoutOps).not.toContain('"required"')
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

    // C2: prototype keys hidden inside array / object leaves.
    const nested: unknown = JSON.parse(
      '{"values":{"tags":[{"name":"a","__proto__":{"polluted":1}}]}}',
    )
    expect(await tm.call('challenge.fill', nested, { caller: 'inapp' })).toEqual({
      status: 'invalid',
      issues: [{ path: 'tags.0.__proto__', message: 'Invalid field path' }],
    })
    const deepCtor: unknown = JSON.parse(
      '{"values":{"tags":[{"name":"a","x":[{"constructor":1}]}]}}',
    )
    expect(await tm.call('challenge.fill', deepCtor, { caller: 'inapp' })).toMatchObject({
      status: 'invalid',
      issues: [{ path: 'tags.0.x.0.constructor', message: 'Invalid field path' }],
    })
    let deep: Record<string, unknown> = { name: 'leaf' }
    for (let i = 0; i < 80; i++) deep = { n: deep }
    expect((await fill({ tags: [deep] })).status).toBe('invalid')
    expect(adapter.values).toEqual(before)
    expect(Object.prototype).not.toHaveProperty('polluted')
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
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

    // C2: undeclared keys nested in an array leaf never reach the adapter.
    const r2 = await fill({ tags: [{ name: 'a', organization_id: 7 }] })
    expect(r2.status).toBe('ok')
    expect(adapter.values.tags).toEqual([{ name: 'a' }])
    expect(Object.prototype.hasOwnProperty.call(adapter.values.tags![0], 'organization_id')).toBe(
      false,
    )
    // Also when unrelated untouched paths are invalid (no validated value available).
    adapter.values = { ...adapter.values, pin: '' }
    const r3 = await fill({ tags: [{ name: 'b', organization_id: 8 }] })
    expect(r3.status).toBe('ok')
    expect(adapter.values.tags).toEqual([{ name: 'b' }])
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
    for (const token of ['current-password', 'section-a NEW-PASSWORD', 'one-time-code']) {
      const pwEl = {
        tagName: 'INPUT',
        getAttribute: (n: string) => (n === 'autocomplete' ? token : null),
      }
      adapter.fieldInfo = [{ path: 'title', element: pwEl as unknown as Element }]
      const r4 = await fill({ title: `T-${token}` })
      expect(r4).toMatchObject({
        data: { changes: [{ path: 'title', before: '[redacted]', after: '[redacted]' }] },
      })
    }
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

  it('fill_redacts_ancestor_of_sensitive_path', async () => {
    const { adapter, fill, tm } = setup({ sensitive: ['pay.number'] })
    adapter.values = { ...adapter.values, pay: { number: '4111111111111111', name: 'Ann' } }
    let callId = ''
    tm.events.on('call', (e) => (callId = e.callId))
    const r = await fill({ pay: null })
    expect(r).toEqual(
      ok({
        changes: [{ path: 'pay', before: { number: '[redacted]', name: 'Ann' }, after: '' }],
        skipped: [],
      }),
    )
    expect(JSON.stringify(r)).not.toContain('4111')
    const u = await tm.undo(callId)
    expect(JSON.stringify(u)).not.toContain('4111')
    expect(u).toMatchObject({
      data: { changes: [{ path: 'pay', after: { number: '[redacted]', name: 'Ann' } }] },
    })
    expect(adapter.values.pay).toEqual({ number: '4111111111111111', name: 'Ann' })
  })

  it('user_edited_detection_is_two_way', async () => {
    const { adapter, fill } = setup()
    adapter.userTypes('address.city', 'Mine')
    expect(await fill({ address: null })).toEqual(ok({ changes: [], skipped: ['address'] }))
    expect(adapter.values.address.city).toBe('Mine')
    // The agent's own nested write does not count as a user edit of the ancestor.
    const second = setup()
    await second.fill({ address: { city: 'Agent' } })
    expect((await second.fill({ address: { city: 'Agent 2' } })).status).toBe('ok')
    expect(second.adapter.values.address.city).toBe('Agent 2')
  })

  it('undo_skips_when_descendant_user_edited', async () => {
    const { tm, adapter } = setup()
    adapter.values = { ...adapter.values, pay: { number: '1', name: 'A' } }
    let callId = ''
    tm.events.on('call', (e) => (callId = e.callId))
    await tm.call(
      'challenge.fill',
      { values: { pay: { number: '2', name: 'B' } } },
      { caller: 'inapp' },
    )
    adapter.userTypes('pay.name', 'User')
    const r = await tm.undo(callId)
    expect(r).toMatchObject({ status: 'ok', data: { skipped: ['pay.name'] } })
    expect(adapter.values.pay).toEqual({ number: '1', name: 'User' })
  })

  it('submit_refused_stale_when_form_changed_after_confirmation_request', async () => {
    const { tm, adapter, fill } = setup()
    adapter.values = { ...adapter.values, title: 'T' }
    const r = await tm.call('challenge.submit', {}, { caller: 'inapp' })
    if (r.status !== 'needs_confirmation') throw new Error('expected needs_confirmation')
    await fill({ title: 'Changed by agent' }, true)
    expect(await tm.confirmPending(r.confirmId, { approved: true })).toMatchObject({
      status: 'refused',
      code: 'stale',
      message: 'Form changed since confirmation was requested',
    })
    expect(adapter.submitted).toBe(0)
    // Unchanged form still submits.
    const r2 = await tm.call('challenge.submit', {}, { caller: 'inapp' })
    if (r2.status !== 'needs_confirmation') throw new Error('expected needs_confirmation')
    expect((await tm.confirmPending(r2.confirmId, { approved: true })).status).toBe('ok')
    expect(adapter.submitted).toBe(1)
  })

  it('fill_schema_hoists_definitions_and_defs', () => {
    const tm = createTestRegistry()
    for (const key of ['$defs', 'definitions'] as const) {
      createFormTools(tm, new FakeAdapter(), {
        name: `f_${key.replace('$', '')}`,
        description: 'd',
        input: schema,
        jsonSchema: {
          type: 'object',
          properties: { title: { $ref: `#/${key}/T` } },
          [key]: { T: { type: 'string' } },
        },
      })
      const fillSchema = tm.describe(`f_${key.replace('$', '')}.fill`)!.inputSchema
      expect(fillSchema[key]).toEqual({ T: { type: 'string' } })
      expect(
        (fillSchema.properties as { values: Record<string, unknown> }).values,
      ).not.toHaveProperty(key)
    }
  })

  it('fallback_sanitizes_through_nullish_and_ref_parents', async () => {
    const tm = createTestRegistry()
    const grpSchema = z.object({
      pin: z.string().min(4),
      grp: z.object({ tags: z.array(z.object({ name: z.string() })).optional() }).nullish(),
    })
    let values: Record<string, unknown> = { pin: '' }
    const writes: Record<string, unknown>[] = []
    const adapter: FormAdapter<Record<string, unknown>> = {
      getValues: () => values,
      setValues: (v) => {
        writes.push(v)
        for (const [p, x] of Object.entries(v)) values = setPath(values, p, x)
      },
      dirtyPaths: () => [],
      submit: () => Promise.resolve(ok(null)),
      fields: () => [],
    }
    createFormTools(tm, adapter, { name: 'n', description: 'd', input: grpSchema })
    // pin is invalid and untouched → no validated value → schema fallback path.
    const r = await tm.call(
      'n.fill',
      { values: { grp: { tags: [{ name: 'a', organization_id: 7 }] } } },
      { caller: 'inapp' },
    )
    expect(r.status).toBe('ok')
    expect(writes.at(-1)).toEqual({ 'grp.tags': [{ name: 'a' }] })

    // $ref parent
    const refTm = createTestRegistry()
    values = { pin: '' }
    createFormTools(refTm, adapter, {
      name: 'r',
      description: 'd',
      input: grpSchema,
      jsonSchema: {
        type: 'object',
        properties: { pin: { type: 'string', minLength: 4 }, grp: { $ref: '#/$defs/Grp' } },
        $defs: {
          Grp: {
            type: 'object',
            properties: {
              tags: {
                type: 'array',
                items: { $ref: '#/definitions/Tag' },
              },
            },
          },
        },
        definitions: { Tag: { type: 'object', properties: { name: { type: 'string' } } } },
      },
    })
    const r2 = await refTm.call(
      'r.fill',
      { values: { grp: { tags: [{ name: 'b', organization_id: 8 }] } } },
      { caller: 'inapp' },
    )
    expect(r2.status).toBe('ok')
    expect(writes.at(-1)).toEqual({ 'grp.tags': [{ name: 'b' }] })
  })

  it('fallback_unresolvable_schema_node_is_undeclared_field', async () => {
    const tm = createTestRegistry()
    const input = z.object({ pin: z.string().min(4), blob: z.unknown().optional() })
    let values: Record<string, unknown> = { pin: '' }
    const setValues = vi.fn((v: Record<string, unknown>) => {
      for (const [p, x] of Object.entries(v)) values = setPath(values, p, x)
    })
    createFormTools(
      tm,
      {
        getValues: () => values,
        setValues,
        dirtyPaths: () => [],
        submit: () => Promise.resolve(ok(null)),
        fields: () => [],
      },
      {
        name: 'u',
        description: 'd',
        input,
        // `blob` declared only through an unresolvable $ref.
        jsonSchema: {
          type: 'object',
          properties: { pin: { type: 'string' }, blob: { $ref: '#/$defs/Missing' } },
        },
      },
    )
    const r = await tm.call(
      'u.fill',
      { values: { blob: [{ secret: 1 }], pin: undefined } },
      { caller: 'inapp' },
    )
    expect(r).toEqual({
      status: 'invalid',
      issues: [{ path: 'blob', message: 'Undeclared field' }],
    })
    expect(setValues).not.toHaveBeenCalled()
  })

  it('ancestor_write_forgets_descendant_agent_values', async () => {
    const { adapter, fill } = setup()
    expect((await fill({ pay: { number: 'A' } })).status).toBe('ok')
    expect((await fill({ pay: null })).status).toBe('ok')
    // RHF-like adapters keep reporting the leaf dirty after the agent's writes.
    expect(adapter.dirty.has('pay.number')).toBe(true)
    const r = await fill({ pay: { number: 'C' } })
    expect(r).toMatchObject({ status: 'ok', data: { skipped: [] } })
    expect(adapter.values.pay).toEqual({ number: 'C' })
  })

  it('submit_refused_stale_on_inline_confirmation_path', async () => {
    const adapter = new FakeAdapter()
    adapter.values = { ...adapter.values, title: 'T' }
    const tm = createTestRegistry({
      confirm: () => {
        adapter.userTypes('title', 'Changed while confirming')
        return Promise.resolve({ approved: true })
      },
    })
    createFormTools(tm, adapter, { name: 'challenge', description: 'd', input: schema })
    expect(await tm.call('challenge.submit', {}, { caller: 'webmcp' })).toMatchObject({
      status: 'refused',
      code: 'stale',
      message: 'Form changed since confirmation was requested',
    })
    expect(adapter.submitted).toBe(0)
  })

  describe('fix round 3 — fallback sanitize semantics', () => {
    /** A form whose `pin` is invalid and untouched, so fill takes the schema-sanitize fallback. */
    function fallbackForm(
      input: StandardSchemaV1<unknown, Record<string, unknown>>,
      jsonSchema?: JsonSchema,
    ) {
      const tm = createTestRegistry()
      let values: Record<string, unknown> = { pin: '' }
      const writes: Record<string, unknown>[] = []
      createFormTools(
        tm,
        {
          getValues: () => values,
          setValues: (v) => {
            writes.push(v)
            for (const [p, x] of Object.entries(v)) values = setPath(values, p, x)
          },
          dirtyPaths: () => [],
          submit: () => Promise.resolve(ok(null)),
          fields: () => [],
        },
        { name: 'f', description: 'd', input, ...(jsonSchema ? { jsonSchema } : {}) },
      )
      return {
        writes,
        fill: (v: Record<string, unknown>) => tm.call('f.fill', { values: v }, { caller: 'inapp' }),
      }
    }
    const Tag = z.object({ name: z.string() })
    const undeclared = (path: string) => ({
      status: 'invalid',
      issues: [{ path, message: 'Undeclared field' }],
    })

    it('anyof_with_no_branch_matching_kind_is_undeclared', async () => {
      const f = fallbackForm(
        z.object({ pin: z.string().min(4), blob: z.array(z.unknown()).nullish() }),
        {
          type: 'object',
          properties: {
            pin: { type: 'string' },
            blob: { anyOf: [{ $ref: '#/$defs/Missing' }, { type: 'null' }] },
          },
        },
      )
      expect(await f.fill({ blob: [{ s: 1 }] })).toEqual(undeclared('blob'))
      expect(f.writes).toEqual([])
    })

    it('array_items_anyof_without_object_branch_is_undeclared', async () => {
      const f = fallbackForm(z.object({ pin: z.string().min(4), rows: z.array(Tag) }), {
        type: 'object',
        properties: {
          pin: { type: 'string' },
          rows: {
            type: 'array',
            items: { anyOf: [{ $ref: '#/$defs/Missing' }, { type: 'string' }] },
          },
        },
      })
      expect(await f.fill({ rows: [{ name: 'a', secret: 1 }] })).toEqual(undeclared('rows.0'))
      expect(f.writes).toEqual([])
    })

    it('record_of_objects_is_sanitized_through_additional_properties', async () => {
      const f = fallbackForm(
        z.object({ pin: z.string().min(4), rows: z.array(z.record(z.string(), Tag)) }),
      )
      expect((await f.fill({ rows: [{ k: { name: 'a', secret: 1 } }] })).status).toBe('ok')
      expect(f.writes.at(-1)).toEqual({ rows: [{ k: { name: 'a' } }] })
    })

    it('clean_record_of_objects_is_written', async () => {
      const f = fallbackForm(
        z.object({ pin: z.string().min(4), rows: z.array(z.record(z.string(), Tag)) }),
      )
      expect((await f.fill({ rows: [{ k: { name: 'a' }, j: { name: 'b' } }] })).status).toBe('ok')
      expect(f.writes.at(-1)).toEqual({ rows: [{ k: { name: 'a' }, j: { name: 'b' } }] })
    })

    it('type_mismatch_is_undeclared', async () => {
      const f = fallbackForm(z.object({ pin: z.string().min(4), blob: z.unknown() }), {
        type: 'object',
        properties: { pin: { type: 'string' }, blob: { type: 'string' } },
      })
      expect(await f.fill({ blob: [{ s: 1 }] })).toEqual(undeclared('blob'))
      expect(await f.fill({ blob: { s: 1 } })).toMatchObject({ status: 'invalid' })
      expect(f.writes).toEqual([])
    })

    it('open_nodes_keep_values_and_closed_objects_drop_extras', async () => {
      const f = fallbackForm(
        z.object({ pin: z.string().min(4), blob: z.array(z.unknown()), grp: Tag.optional() }),
      )
      expect((await f.fill({ blob: [{ anything: 1 }] })).status).toBe('ok')
      expect(f.writes.at(-1)).toEqual({ blob: [{ anything: 1 }] })
      const g = fallbackForm(z.object({ pin: z.string().min(4), list: z.array(z.unknown()) }), {
        type: 'object',
        properties: { pin: { type: 'string' }, list: { type: 'array' } },
      })
      expect((await g.fill({ list: ['a', 'b'] })).status).toBe('ok')
      expect(await g.fill({ list: [{ a: 1 }] })).toEqual(undeclared('list.0'))
    })
  })

  describe('final review fixes', () => {
    /** A record-field form that is either valid (`title` set) or incomplete (`title` empty). */
    function recordForm(title: string) {
      const tm = createTestRegistry()
      let values: Record<string, unknown> = { title, meta: {} }
      const writes: Record<string, unknown>[] = []
      createFormTools(
        tm,
        {
          getValues: () => values,
          setValues: (v) => {
            writes.push(v)
            for (const [p, x] of Object.entries(v)) values = setPath(values, p, x)
          },
          dirtyPaths: () => [],
          submit: () => Promise.resolve(ok(null)),
          fields: () => [],
        },
        {
          name: 'f',
          description: 'd',
          input: z.object({
            title: z.string().min(1),
            meta: z.record(z.string(), z.string()),
            nested: z.record(z.string(), z.object({ name: z.string() })).optional(),
          }),
        },
      )
      return {
        writes,
        values: () => values,
        fill: (v: Record<string, unknown>) => tm.call('f.fill', { values: v }, { caller: 'inapp' }),
      }
    }

    it('record_field_fill_same_on_valid_and_incomplete_form', async () => {
      const valid = recordForm('filled')
      const incomplete = recordForm('')
      const a = await valid.fill({ meta: { color: 'red' } })
      const b = await incomplete.fill({ meta: { color: 'red' } })
      expect(a.status).toBe('ok')
      expect(b).toEqual(a)
      expect(incomplete.values()).toEqual({ title: '', meta: { color: 'red' } })
      // Record entries resolve through additionalProperties; closed entry objects stay closed.
      for (const form of [valid, incomplete]) {
        expect((await form.fill({ nested: { k: { name: 'n' } } })).status).toBe('ok')
        expect(form.writes.at(-1)).toEqual({ 'nested.k.name': 'n' })
        expect(await form.fill({ nested: { k: { secret: 1 } } })).toEqual({
          status: 'invalid',
          issues: [{ path: 'nested.k.secret', message: 'Unknown field' }],
        })
      }
    })

    it('union_fallback_sanitizes_against_matching_branch_only', async () => {
      const tm = createTestRegistry()
      let values: Record<string, unknown> = { title: '' }
      const writes: Record<string, unknown>[] = []
      createFormTools(
        tm,
        {
          getValues: () => values,
          setValues: (v) => {
            writes.push(v)
            for (const [p, x] of Object.entries(v)) values = setPath(values, p, x)
          },
          dirtyPaths: () => [],
          submit: () => Promise.resolve(ok(null)),
          fields: () => [],
        },
        {
          name: 'f',
          description: 'd',
          input: z.object({
            title: z.string().min(1),
            either: z
              .union([
                z.object({ kind: z.literal('x'), x: z.string() }),
                z.object({ kind: z.literal('y'), y: z.string() }),
              ])
              .optional(),
            plain: z.union([z.object({ a: z.string() }), z.object({ b: z.string() })]).optional(),
            list: z
              .array(
                z.union([
                  z.object({ kind: z.literal('x'), x: z.string() }),
                  z.object({ kind: z.literal('y'), y: z.string() }),
                ]),
              )
              .optional(),
          }),
        },
      )
      const fill = (v: Record<string, unknown>) =>
        tm.call('f.fill', { values: v }, { caller: 'inapp' })
      // `values` flattens to leaf paths (`either.kind`, `either.x`, `either.y`); `either.y` is
      // declared only by the other branch, so it is unknown for this value and nothing is written.
      const unknownY = {
        status: 'invalid',
        issues: [{ path: 'either.y', message: 'Unknown field' }],
      }
      expect(await fill({ either: { kind: 'x', x: 'q', y: 'smuggled' } })).toEqual(unknownY)
      expect(writes).toEqual([])
      // Same on a valid form (title filled in the same call).
      expect(await fill({ title: 't', either: { kind: 'x', x: 'q', y: 'smuggled' } })).toEqual(
        unknownY,
      )
      expect(writes).toEqual([])
      expect(await fill({ either: { kind: 'y', y: 'ok', x: 'smuggled' } })).toEqual({
        status: 'invalid',
        issues: [{ path: 'either.x', message: 'Unknown field' }],
      })
      expect((await fill({ either: { kind: 'x', x: 'q' } })).status).toBe('ok')
      expect(values.either).toEqual({ kind: 'x', x: 'q' })
      // Inside an array the fallback sanitize keeps only the matching branch's keys.
      expect((await fill({ list: [{ kind: 'x', x: 'q', y: 'smuggled' }] })).status).toBe('ok')
      expect(values.list).toEqual([{ kind: 'x', x: 'q' }])
      expect(JSON.stringify(writes)).not.toContain('smuggled')
      // Undiscriminated union: the branch declaring the value's keys wins.
      expect((await fill({ plain: { b: 'kept' } })).status).toBe('ok')
      expect(values.plain).toEqual({ b: 'kept' })
    })

    it('production_half_pair_is_disposed_when_one_registration_fails', () => {
      const errors: string[] = []
      const tm = createToolmark({
        __environment: 'browser',
        onError: (e) => errors.push(e.code),
      })
      const adapter = new FakeAdapter()
      // `submit` is taken: the form's fill must not stay behind alone.
      tm.register({ name: 'a.submit', description: 'x', run: () => ok(null) })
      createFormTools(tm, adapter, { name: 'a', description: 'd', input: schema })
      expect(errors).toContain('duplicate_name')
      expect(tm.describe('a.fill', { caller: 'inapp' })).toBeUndefined()
      // `fill` is taken: submit must not be registered either.
      tm.register({ name: 'b.fill', description: 'x', run: () => ok(null) })
      createFormTools(tm, adapter, { name: 'b', description: 'd', input: schema })
      expect(tm.describe('b.submit', { caller: 'inapp' })).toBeUndefined()
    })
  })
})
