import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  createStepwiseWizardTools,
  createToolmark,
  createWizardTools,
  fromJsonSchema,
  ok,
  setPath,
  ToolmarkError,
  type FieldInfo,
  type FormAdapter,
  type JsonSchema,
  type ToolmarkErrorEvent,
  type WizardStep,
} from '@toolmark/core'
import { createTestRegistry } from './helpers/create-test-registry.js'

/** The wizard's own submit in a registry without inline handler (dev event); no step tools. */
const MISSING_HANDLER = 'missing_confirm_handler'

type Data = Record<string, Record<string, unknown>>

/** In-memory step form (react-hook-form-like): records setValues calls and dirty paths. */
class StepForm implements FormAdapter {
  values: Record<string, unknown>
  dirty = new Set<string>()
  calls: { values: Record<string, unknown>; source: string }[] = []
  constructor(values: Record<string, unknown> = {}) {
    this.values = values
  }
  getValues(): Record<string, unknown> {
    return this.values
  }
  setValues(values: Record<string, unknown>, opts: { source: 'agent' | 'undo' }): void {
    this.calls.push({ values, source: opts.source })
    for (const [path, v] of Object.entries(values)) {
      this.values = setPath(this.values, path, v === null ? '' : v)
      this.dirty.add(path)
    }
  }
  dirtyPaths(): string[] {
    return [...this.dirty]
  }
  submit() {
    return Promise.resolve(ok(null))
  }
  fields(): FieldInfo[] {
    return []
  }
  userTypes(path: string, value: unknown): void {
    this.values = setPath(this.values, path, value)
    this.dirty.add(path)
  }
}

const basicInfo = z.object({ title: z.string().min(1), category: z.string().optional() })
const details = z.object({
  budget: z.number(),
  tags: z.array(z.object({ name: z.string() })).optional(),
})
const review = z.object({ notes: z.string().optional() })

function steps(): WizardStep[] {
  return [
    { name: 'basicInfo', input: basicInfo },
    { name: 'details', input: details },
    { name: 'review', input: review },
  ]
}

interface SetupOpts {
  adapter?: boolean
  resetCurrent?: boolean
  data?: Data
  current?: string
  steps?: WizardStep[]
  submitSummary?: (data: Data) => string
}

function setup(o: SetupOpts = {}) {
  const tm = createTestRegistry()
  const errors: ToolmarkErrorEvent[] = []
  tm.events.on('error', (e) => errors.push(e))
  const w = {
    data: o.data ?? {
      basicInfo: { title: 'Old title' },
      details: { budget: 10 },
      review: {},
    },
    current: o.current ?? 'basicInfo',
    forms: {} as Record<string, StepForm>,
  }
  const setData = vi.fn((next: Data) => {
    w.data = next
  })
  const resetCurrent = vi.fn()
  const goTo = vi.fn((step: string) => {
    w.current = step
  })
  const submit = vi.fn(() => Promise.resolve(ok({ id: 7 })))
  /** Mounts a step form for the current step, initialised from parent data. */
  const mount = (step: string) => (w.forms[step] = new StepForm({ ...(w.data[step] ?? {}) }))
  if (o.adapter) mount(w.current)
  const tools = createWizardTools(tm, {
    name: 'create',
    title: 'Create challenge',
    description: 'The new-challenge wizard.',
    steps: o.steps ?? steps(),
    getData: () => w.data,
    setData,
    getCurrent: () => w.current,
    goTo,
    ...(o.adapter ? { currentAdapter: () => w.forms[w.current] } : {}),
    ...(o.resetCurrent ? { resetCurrent } : {}),
    submit,
    ...(o.submitSummary ? { submitSummary: o.submitSummary } : {}),
  })
  let callId = ''
  tm.events.on('call', (e) => (callId = e.callId))
  const fill = (stepValues: unknown, overwrite?: boolean) =>
    tm.call(
      'create.fill',
      overwrite === undefined ? { steps: stepValues } : { steps: stepValues, overwrite },
      { caller: 'inapp' },
    )
  return {
    tm,
    w,
    errors,
    setData,
    resetCurrent,
    goTo,
    submit,
    mount,
    tools,
    fill,
    lastCallId: () => callId,
  }
}

describe('wizard tools', () => {
  it('wizard_fill_multiple_steps_one_call', async () => {
    const s = setup({ resetCurrent: true })
    const r = await s.fill({ details: { budget: 500 }, review: { notes: 'Looks good' } })
    expect(r).toEqual(
      ok({
        changes: [
          { path: 'details.budget', before: 10, after: 500 },
          { path: 'review.notes', before: undefined, after: 'Looks good' },
        ],
        skipped: [],
      }),
    )
    expect(s.setData).toHaveBeenCalledTimes(1)
    expect(s.w.data).toEqual({
      basicInfo: { title: 'Old title' },
      details: { budget: 500 },
      review: { notes: 'Looks good' },
    })
    // The current step was not touched.
    expect(s.resetCurrent).not.toHaveBeenCalled()
    expect(s.tm.manifest().tools.map((t) => t.name)).toEqual([
      'create.fill',
      'create.goTo',
      'create.submit',
    ])
  })

  it('wizard_fill_schema_shape', () => {
    const withDefs: WizardStep = {
      name: 'people',
      input: fromJsonSchema({
        type: 'object',
        properties: { lead: { $ref: '#/$defs/person' } },
        required: ['lead'],
        $defs: {
          person: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
        },
      }),
    }
    const s = setup({ steps: [...steps(), withDefs] })
    const schema = s.tm.describe('create.fill')!.inputSchema
    expect(schema).toMatchObject({
      type: 'object',
      properties: {
        steps: {
          type: 'object',
          properties: {
            basicInfo: { type: 'object', properties: { title: { type: 'string' } } },
            details: {
              type: 'object',
              properties: {
                budget: { type: 'number' },
                tags: {
                  anyOf: [
                    { type: 'array' },
                    { properties: { $append: { type: 'array' } }, required: ['$append'] },
                    { properties: { $remove: { type: 'array' } }, required: ['$remove'] },
                  ],
                },
              },
            },
            review: { type: 'object' },
            people: { properties: { lead: { $ref: '#/$defs/people.person' } } },
          },
          additionalProperties: false,
        },
        overwrite: { type: 'boolean' },
      },
      required: ['steps'],
    })
    const stepsNode = (schema.properties as Record<string, JsonSchema>).steps!
    const stepNodes = stepsNode.properties as Record<string, JsonSchema>
    expect(stepNodes.basicInfo!.required).toBeUndefined()
    expect(stepNodes.details!.required).toBeUndefined()
    expect(schema.$defs).toEqual({
      'people.person': { type: 'object', properties: { name: { type: 'string' } } },
    })
    expect(s.tm.describe('create.fill')!.description).toContain('basicInfo, details, review')
  })

  it('wizard_invalid_step_writes_nothing', async () => {
    const s = setup({ adapter: true })
    const form = s.w.forms.basicInfo!
    const r = await s.fill({
      basicInfo: { title: 'New title' },
      details: { budget: 'lots' },
      review: { notes: 'x' },
    })
    expect(r.status).toBe('invalid')
    if (r.status !== 'invalid') return
    expect(r.issues.map((i) => i.path)).toEqual(['details.budget'])
    expect(s.setData).not.toHaveBeenCalled()
    expect(form.calls).toEqual([])
    expect(form.values.title).toBe('Old title')
    // Unknown steps and non-object step values are invalid too, with nothing written.
    const unknown = await s.fill({ nope: { a: 1 }, review: 5 })
    expect(unknown).toEqual({
      status: 'invalid',
      issues: [
        { path: 'nope', message: 'Unknown step' },
        { path: 'review', message: 'Expected an object of field values' },
      ],
    })
    expect(s.setData).not.toHaveBeenCalled()
    const bad = await s.tm.call('create.fill', { steps: {}, extra: 1 }, { caller: 'inapp' })
    expect(bad.status).toBe('invalid')
  })

  it('wizard_current_step_respects_dirty', async () => {
    const s = setup({ adapter: true })
    const form = s.w.forms.basicInfo!
    form.userTypes('title', 'Typed by user')
    const r = await s.fill({
      basicInfo: { title: 'Agent title', category: 'health' },
      details: { budget: 20 },
    })
    expect(r).toEqual(
      ok({
        changes: [
          { path: 'basicInfo.category', before: undefined, after: 'health' },
          { path: 'details.budget', before: 10, after: 20 },
        ],
        skipped: ['basicInfo.title'],
      }),
    )
    // The mounted form shows the agent's value for the untouched field and keeps the user's.
    expect(form.values).toEqual({ title: 'Typed by user', category: 'health' })
    expect(form.calls).toEqual([{ values: { category: 'health' }, source: 'agent' }])
    // Parent data is written for the non-current step only.
    expect(s.setData).toHaveBeenCalledTimes(1)
    expect(s.w.data.basicInfo).toEqual({ title: 'Old title' })
    expect(s.w.data.details).toEqual({ budget: 20 })
    // overwrite: true replaces the user's value.
    const r2 = await s.fill({ basicInfo: { title: 'Agent title' } }, true)
    expect(r2).toMatchObject({ status: 'ok', data: { skipped: [] } })
    expect(form.values.title).toBe('Agent title')
  })

  it('wizard_current_step_without_adapter_calls_reset', async () => {
    const s = setup({ resetCurrent: true })
    const r = await s.fill({ basicInfo: { category: 'energy' }, review: { notes: 'n' } })
    expect(r.status).toBe('ok')
    expect(s.setData).toHaveBeenCalledTimes(1)
    expect(s.w.data.basicInfo).toEqual({ title: 'Old title', category: 'energy' })
    expect(s.resetCurrent).toHaveBeenCalledTimes(1)
    expect(s.resetCurrent).toHaveBeenCalledWith({ title: 'Old title', category: 'energy' })
    expect(s.errors.map((e) => e.code)).toEqual([MISSING_HANDLER])
  })

  it('wizard_unsynced_event_once', async () => {
    const s = setup()
    expect((await s.fill({ basicInfo: { category: 'a' } })).status).toBe('ok')
    expect((await s.fill({ basicInfo: { category: 'b' } })).status).toBe('ok')
    expect(s.w.data.basicInfo).toEqual({ title: 'Old title', category: 'b' })
    const unsynced = s.errors.filter((e) => e.code === 'wizard_current_step_unsynced')
    expect(unsynced).toHaveLength(1)
    expect(unsynced[0]!.tool).toBe('create.fill')
    // Filling only non-current steps never reports it.
    const t = setup()
    await t.fill({ review: { notes: 'x' } })
    expect(t.errors.map((e) => e.code)).toEqual([MISSING_HANDLER])
  })

  it('wizard_goto_and_submit_confirmation', async () => {
    const s = setup({ adapter: true })
    expect(s.tm.describe('create.goTo')!.inputSchema).toMatchObject({
      properties: { step: { type: 'string', enum: ['basicInfo', 'details', 'review'] } },
      required: ['step'],
    })
    expect(await s.tm.call('create.goTo', { step: 'details' }, { caller: 'inapp' })).toEqual(
      ok({ step: 'details' }),
    )
    expect(s.goTo).toHaveBeenCalledWith('details')
    expect(s.w.current).toBe('details')
    expect((await s.tm.call('create.goTo', { step: 'nope' }, { caller: 'inapp' })).status).toBe(
      'invalid',
    )
    expect(s.tm.describe('create.submit')!.hints).toEqual({ consequential: true })
    const r = await s.tm.call('create.submit', {}, { caller: 'inapp' })
    expect(r).toMatchObject({ status: 'needs_confirmation', summary: 'Submit Create challenge' })
    if (r.status !== 'needs_confirmation') return
    expect(s.submit).not.toHaveBeenCalled()
    expect(await s.tm.confirmPending(r.confirmId, { approved: true })).toEqual(ok({ id: 7 }))
    expect(s.submit).toHaveBeenCalledTimes(1)

    const t = setup({ submitSummary: (d) => `Create "${String(d.basicInfo?.title)}"` })
    const r2 = await t.tm.call('create.submit', undefined, { caller: 'inapp' })
    expect(r2).toMatchObject({ status: 'needs_confirmation', summary: 'Create "Old title"' })
    // A confirmation approved after the wizard data changed is refused as stale.
    if (r2.status !== 'needs_confirmation') return
    await t.fill({ review: { notes: 'changed' } })
    expect(await t.tm.confirmPending(r2.confirmId, { approved: true })).toMatchObject({
      status: 'refused',
      code: 'stale',
    })
    expect(t.submit).not.toHaveBeenCalled()
  })

  it('wizard_submit_summary_sees_the_mounted_step_live_values', async () => {
    const summaries: Data[] = []
    const s = setup({
      adapter: true,
      submitSummary: (d) => {
        summaries.push(d)
        return `Create "${String(d.basicInfo?.title)}"`
      },
    })
    // The user edits the mounted step; parent data still holds the old title.
    s.w.forms.basicInfo!.userTypes('title', 'Live title')
    expect(s.w.data.basicInfo).toEqual({ title: 'Old title' })
    const r = await s.tm.call('create.submit', {}, { caller: 'inapp' })
    expect(r).toMatchObject({ status: 'needs_confirmation', summary: 'Create "Live title"' })
    expect(summaries.at(-1)).toEqual({
      basicInfo: { title: 'Live title' },
      details: { budget: 10 },
      review: {},
    })
    // The summary view is a copy: parent data is untouched.
    expect(s.w.data.basicInfo).toEqual({ title: 'Old title' })
  })

  it('wizard_submit_validates_all_steps_before_confirmation', async () => {
    const s = setup({ data: { basicInfo: { title: 'T' }, details: {}, review: {} } })
    const r = await s.tm.call('create.submit', {}, { caller: 'inapp' })
    expect(r).toEqual({
      status: 'invalid',
      issues: [{ path: 'details.budget', message: expect.any(String) as string }],
    })
    expect(s.tm.pendingConfirmations()).toEqual([])
    expect(s.submit).not.toHaveBeenCalled()

    // The current step is read from its mounted form, not from parent data.
    const t = setup({ adapter: true })
    t.w.forms.basicInfo!.userTypes('title', '')
    const r2 = await t.tm.call('create.submit', {}, { caller: 'inapp' })
    expect(r2).toMatchObject({ status: 'invalid', issues: [{ path: 'basicInfo.title' }] })
    expect(t.tm.pendingConfirmations()).toEqual([])
    expect((await t.tm.call('create.submit', { x: 1 }, { caller: 'inapp' })).status).toBe('invalid')
  })

  it('wizard_undo_all_steps', async () => {
    const s = setup({ adapter: true })
    const form = s.w.forms.basicInfo!
    const r = await s.fill({
      basicInfo: { title: 'New title' },
      details: { budget: 99 },
      review: { notes: 'n' },
    })
    expect(r.status).toBe('ok')
    expect(s.setData).toHaveBeenCalledTimes(1)
    const u = await s.tm.undo(s.lastCallId())
    expect(u).toEqual(
      ok({
        changes: [
          { path: 'basicInfo.title', before: 'New title', after: 'Old title' },
          { path: 'details.budget', before: 99, after: 10 },
          { path: 'review.notes', before: 'n', after: undefined },
        ],
        skipped: [],
      }),
    )
    expect(form.values.title).toBe('Old title')
    expect(form.calls.at(-1)).toEqual({ values: { title: 'Old title' }, source: 'undo' })
    // One setData for the undo of every data-backed step.
    expect(s.setData).toHaveBeenCalledTimes(2)
    expect(s.w.data.details).toEqual({ budget: 10 })
    expect(s.w.data.review).toEqual({ notes: undefined })
    expect((await s.tm.undo(s.lastCallId())).status).toBe('refused')
  })

  it('wizard_undo_after_step_change', async () => {
    const s = setup({ adapter: true })
    const r = await s.fill({ details: { budget: 42 } })
    expect(r.status).toBe('ok')
    const fillId = s.lastCallId()
    expect(s.w.data.details).toEqual({ budget: 42 })
    // The user navigates: the details step form mounts from parent data.
    await s.tm.call('create.goTo', { step: 'details' }, { caller: 'inapp' })
    const detailsForm = s.mount('details')
    const setDataCalls = s.setData.mock.calls.length
    const u = await s.tm.undo(fillId)
    expect(u).toEqual(
      ok({ changes: [{ path: 'details.budget', before: 42, after: 10 }], skipped: [] }),
    )
    // Restored through the step that is current at undo time: its mounted form, not setData.
    expect(detailsForm.calls).toEqual([{ values: { budget: 10 }, source: 'undo' }])
    expect(s.setData).toHaveBeenCalledTimes(setDataCalls)
  })

  it('wizard_options_step_field_enum', async () => {
    const provider = vi.fn(() => Promise.resolve([{ value: 'ai', title: 'AI' }]))
    const s = setup({
      steps: [
        { name: 'basicInfo', input: basicInfo, options: { category: provider } },
        { name: 'details', input: details, options: { 'tags[].name': provider } },
        { name: 'review', input: review },
      ],
    })
    const opts = s.tm.describe('create.options')!
    expect(opts.hints).toMatchObject({ readOnly: true, untrustedContent: true })
    expect(opts.inputSchema).toMatchObject({
      properties: { field: { enum: ['basicInfo.category', 'details.tags[].name'] } },
    })
    expect(
      await s.tm.call(
        'create.options',
        { field: 'details.tags[].name', query: 'a' },
        { caller: 'inapp' },
      ),
    ).toEqual(ok({ options: [{ value: 'ai', title: 'AI' }] }))
    expect(provider).toHaveBeenCalledTimes(1)
    const fillSchema = JSON.stringify(s.tm.describe('create.fill')!.inputSchema)
    expect(fillSchema).toContain('use create.options to find valid values')
    // Without options no options tool is registered.
    expect(setup().tm.describe('create.options')).toBeUndefined()
  })

  it('wizard_duplicate_step_misconfigured', () => {
    const dup = [
      { name: 'a', input: review },
      { name: 'a', input: review },
    ]
    const base = {
      name: 'w',
      description: 'W.',
      getData: () => ({}),
      setData: () => undefined,
      getCurrent: () => 'a',
      goTo: () => undefined,
      submit: () => Promise.resolve(ok(null)),
    }
    for (const bad of [dup, [], [{ name: 'a.b', input: review }]]) {
      const tm = createTestRegistry()
      let thrown: unknown
      try {
        createWizardTools(tm, { ...base, steps: bad })
      } catch (e) {
        thrown = e
      }
      expect(thrown).toBeInstanceOf(ToolmarkError)
      expect((thrown as ToolmarkError).code).toBe('wizard_misconfigured')
      expect(tm.manifest().tools).toEqual([])
    }
    // Production: an event, nothing registered.
    const events: ToolmarkErrorEvent[] = []
    const prod = createToolmark({ __environment: 'browser', onError: (e) => events.push(e) })
    const handle = createWizardTools(prod, { ...base, steps: dup })
    expect(events.map((e) => e.code)).toEqual(['wizard_misconfigured'])
    expect(prod.manifest().tools).toEqual([])
    handle.dispose()
  })

  it('wizard_fill_reuses_form_fill_guards', async () => {
    const s = setup({ adapter: true })
    const form = s.w.forms.basicInfo!
    const polluted = JSON.parse('{"__proto__":{"x":1},"title":"T"}') as unknown
    const r = await s.fill({ basicInfo: polluted, details: { budget: 1, extra: 2 } })
    expect(r.status).toBe('invalid')
    if (r.status !== 'invalid') return
    expect(r.issues.map((i) => i.path)).toEqual(['basicInfo.__proto__', 'details.extra'])
    const dup = await s.fill({ review: { notes: 'a', 'notes.x': 'b' } })
    expect(dup.status).toBe('invalid')
    expect(s.setData).not.toHaveBeenCalled()
    expect(form.calls).toEqual([])
    expect(({} as Record<string, unknown>).x).toBeUndefined()
  })

  it('wizard_commit_throw_restores_data_and_registers_no_undo', async () => {
    const s = setup({ adapter: true })
    const form = s.w.forms.basicInfo!
    const before = structuredClone(s.w.data)
    form.setValues = () => {
      throw new Error('boom')
    }
    // basicInfo (current, mounted) throws in setValues; details is data-backed and would have
    // already been written via setData before the throw.
    const r = await s.fill({ basicInfo: { category: 'x' }, details: { budget: 20 } })
    expect(r).toEqual({ status: 'error', message: 'Tool failed' })
    // Parent data is restored to its pre-fill snapshot (the details write is rolled back).
    expect(s.w.data).toEqual(before)
    // Nothing is left to undo: the throw happened before the wizard's own registerUndo call.
    expect((await s.tm.undo(s.lastCallId())).status).toBe('refused')
  })

  it('wizard_commit_reset_current_throw_restores_data', async () => {
    const s = setup({ resetCurrent: true })
    const before = structuredClone(s.w.data)
    s.resetCurrent.mockImplementation(() => {
      throw new Error('boom')
    })
    const r = await s.fill({ basicInfo: { category: 'x' }, details: { budget: 20 } })
    expect(r).toEqual({ status: 'error', message: 'Tool failed' })
    expect(s.w.data).toEqual(before)
    expect((await s.tm.undo(s.lastCallId())).status).toBe('refused')
  })

  it('wizard_schema_defs_definitions_collision_prefixed_distinctly', () => {
    const collide: WizardStep = {
      name: 'mix',
      input: z.object({}).passthrough(),
      jsonSchema: {
        type: 'object',
        properties: { a: { $ref: '#/$defs/definitions.x' }, b: { $ref: '#/definitions/x' } },
        $defs: { 'definitions.x': { type: 'string', title: 'defs-entry' } },
        definitions: { x: { type: 'number', title: 'definitions-entry' } },
      },
    }
    const s = setup({ steps: [collide] })
    const schema = s.tm.describe('create.fill')!.inputSchema
    const stepsNode = (schema.properties as Record<string, JsonSchema>).steps!
    const mixNode = (stepsNode.properties as Record<string, JsonSchema>).mix!
    // Both entries land under distinct, non-colliding keys instead of one clobbering the other.
    expect(mixNode.properties).toMatchObject({
      a: { $ref: '#/$defs/mix.defs.definitions.x' },
      b: { $ref: '#/$defs/mix.definitions.x' },
    })
    expect(schema.$defs).toMatchObject({
      'mix.defs.definitions.x': { type: 'string', title: 'defs-entry' },
      'mix.definitions.x': { type: 'number', title: 'definitions-entry' },
    })
  })

  it('wizard_schema_does_not_rewrite_ref_inside_const_default_enum', () => {
    const trap: WizardStep = {
      name: 'trap',
      input: z.object({}).passthrough(),
      jsonSchema: {
        type: 'object',
        properties: {
          template: {
            type: 'object',
            default: { $ref: '#/definitions/x' },
            const: { $ref: '#/$defs/y' },
            enum: [{ $ref: '#/definitions/x' }],
          },
        },
      },
    }
    const s = setup({ steps: [trap] })
    const schema = s.tm.describe('create.fill')!.inputSchema
    const stepsNode = (schema.properties as Record<string, JsonSchema>).steps!
    const trapNode = (stepsNode.properties as Record<string, JsonSchema>).trap!
    const templateNode = (trapNode.properties as Record<string, JsonSchema>).template!
    // Data values are preserved verbatim: no attempt to rewrite a `$ref`-shaped key inside them.
    expect(templateNode.default).toEqual({ $ref: '#/definitions/x' })
    expect(templateNode.const).toEqual({ $ref: '#/$defs/y' })
    expect(templateNode.enum).toEqual([{ $ref: '#/definitions/x' }])
  })

  it('wizard_dispose_removes_tools', () => {
    const s = setup({
      steps: [
        { name: 'basicInfo', input: basicInfo, options: { category: () => Promise.resolve([]) } },
      ],
    })
    expect(s.tm.manifest().tools).toHaveLength(4)
    s.tools.dispose()
    expect(s.tm.manifest().tools).toEqual([])
  })
})

describe('wizard tools: total file references per fill (final review I2)', () => {
  it('wizard_fill_caps_file_refs_across_steps_before_any_resolution', async () => {
    const resolve = vi.fn(() => Promise.resolve(new File(['x'], 'a.txt', { type: 'text/plain' })))
    const tm = createTestRegistry({ files: { resolve } })
    const withFiles = z.object({
      items: z.array(z.object({ file: z.instanceof(File) })).optional(),
    })
    let data: Data = { a: {}, b: {} }
    createWizardTools(tm, {
      name: 'up',
      description: 'Upload wizard.',
      steps: [
        { name: 'a', input: withFiles, files: { 'items[].file': {} } },
        { name: 'b', input: withFiles, files: { 'items[].file': {} } },
      ],
      getData: () => data,
      setData: (next) => {
        data = next
      },
      getCurrent: () => 'a',
      goTo: () => {},
      submit: () => Promise.resolve(ok(null)),
    })
    const items = (n: number) => Array.from({ length: n }, () => ({ file: { ref: 'r' } }))
    // Each step alone is under the cap; together they are over it → nothing resolved.
    const r = await tm.call(
      'up.fill',
      { steps: { a: { items: items(60) }, b: { items: items(60) } } },
      { caller: 'inapp' },
    )
    expect(r).toEqual({
      status: 'invalid',
      issues: [{ path: '', message: expect.stringContaining('Too many files') as string }],
    })
    expect(resolve).not.toHaveBeenCalled()
    expect(data).toEqual({ a: {}, b: {} })
    // 4000 items in one step: refused up front too.
    const big = await tm.call(
      'up.fill',
      { steps: { a: { items: items(4000) } } },
      { caller: 'inapp' },
    )
    expect(big.status).toBe('invalid')
    expect(resolve).not.toHaveBeenCalled()
    // Within the cap: resolved.
    const fine = await tm.call(
      'up.fill',
      { steps: { a: { items: items(2) }, b: { items: items(3) } } },
      { caller: 'inapp' },
    )
    expect(fine.status).toBe('ok')
    expect(resolve).toHaveBeenCalledTimes(5)
  })
})

describe('stepwise wizard tools', () => {
  function stepwise() {
    const tm = createTestRegistry()
    const stepList = steps()
    const w = { index: 0, form: new StepForm({ title: '' }) as StepForm | undefined }
    const next = vi.fn(() => {
      w.index++
      w.form = new StepForm({})
      return Promise.resolve(ok({ step: stepList[w.index]!.name }))
    })
    const previous = vi.fn(() => {
      w.index--
      w.form = new StepForm({})
    })
    const submit = vi.fn(() => Promise.resolve(ok({ done: true })))
    const tools = createStepwiseWizardTools(tm, {
      name: 'create',
      description: 'The new-challenge wizard.',
      currentAdapter: () => w.form,
      currentStep: () => stepList[w.index]!,
      next,
      previous,
      submit,
    })
    return { tm, w, tools, next, previous, submit }
  }

  it('stepwise_tools_and_mode', async () => {
    const s = stepwise()
    const tools = s.tm.manifest().tools
    expect(tools.map((t) => t.name)).toEqual([
      'create.next',
      'create.previous',
      'create.step.fill',
      'create.submit',
    ])
    for (const t of tools) expect(t.mode).toBe('stepwise')
    expect(s.tm.describe('create.submit')!.hints).toEqual({ consequential: true })
    expect(await s.tm.call('create.next', {}, { caller: 'inapp' })).toEqual(ok({ step: 'details' }))
    expect(await s.tm.call('create.previous', {}, { caller: 'inapp' })).toEqual(
      ok({ step: 'basicInfo' }),
    )
    expect(s.previous).toHaveBeenCalledTimes(1)
    const r = await s.tm.call('create.submit', {}, { caller: 'inapp' })
    expect(r).toMatchObject({ status: 'needs_confirmation', summary: 'Submit create' })
    if (r.status !== 'needs_confirmation') return
    expect(await s.tm.confirmPending(r.confirmId, { approved: true })).toEqual(ok({ done: true }))
    // No mounted step form → the step fill is refused, nothing written.
    s.w.form = undefined
    const none = await s.tm.call(
      'create.step.fill',
      { values: { title: 'x' } },
      { caller: 'inapp' },
    )
    expect(none.status).toBe('refused')
    s.tools.dispose()
    expect(s.tm.manifest().tools).toEqual([])
  })

  it('stepwise_fill_schema_follows_current_step', async () => {
    const s = stepwise()
    const d1 = s.tm.describe('create.step.fill')!
    expect(d1.description.endsWith(' (current step: basicInfo)')).toBe(true)
    expect(d1.inputSchema).toMatchObject({
      properties: { values: { properties: { title: { type: 'string' } } } },
    })
    expect(
      await s.tm.call('create.step.fill', { values: { title: 'Hi' } }, { caller: 'inapp' }),
    ).toEqual(ok({ changes: [{ path: 'title', before: '', after: 'Hi' }], skipped: [] }))
    expect(s.w.form!.values).toEqual({ title: 'Hi' })

    // Unchanged step → refresh() is a no-op.
    const rev0 = s.tm.rev
    s.tools.refresh()
    expect(s.tm.rev).toBe(rev0)

    await s.tm.call('create.next', {}, { caller: 'inapp' })
    const rev1 = s.tm.rev
    s.tools.refresh()
    expect(s.tm.rev).toBe(rev1 + 1)
    const d2 = s.tm.describe('create.step.fill')!
    expect(d2.description.endsWith(' (current step: details)')).toBe(true)
    expect(d2.mode).toBe('stepwise')
    expect(d2.inputSchema).toMatchObject({
      properties: { values: { properties: { budget: { type: 'number' } } } },
    })
    const bad = await s.tm.call(
      'create.step.fill',
      { values: { budget: 'x' } },
      { caller: 'inapp' },
    )
    expect(bad).toMatchObject({ status: 'invalid', issues: [{ path: 'budget' }] })
    expect(
      await s.tm.call('create.step.fill', { values: { budget: 5 } }, { caller: 'inapp' }),
    ).toMatchObject({ status: 'ok' })
    expect(s.w.form!.values).toEqual({ budget: 5 })
  })

  it('stepwise_refresh_retries_after_failed_registration', async () => {
    // Production registry: a failed registration reports an event instead of throwing.
    const tm = createToolmark({ __environment: 'browser' })
    const stepList = steps()
    const w = { index: 0, form: new StepForm({ title: '' }) as StepForm | undefined }
    const next = vi.fn(() => {
      w.index++
      w.form = new StepForm({})
      return Promise.resolve(ok({ step: stepList[w.index]!.name }))
    })
    // A scope the test can dispose on demand, to force the next registration to fail.
    const scope = tm.scope('w')
    const wizardOpts = {
      name: 'create',
      description: 'The new-challenge wizard.',
      currentAdapter: () => w.form,
      currentStep: () => stepList[w.index]!,
      next,
      previous: () => undefined,
      submit: () => Promise.resolve(ok({ done: true })),
      scope,
    }
    const tools = createStepwiseWizardTools(tm, wizardOpts)
    expect(tm.describe('w.create.step.fill')!.description).toContain('(current step: basicInfo)')

    await tm.call('w.create.next', {}, { caller: 'inapp' })
    // The step advanced to "details", but its registration will fail: the scope is disposed.
    scope.dispose()
    tools.refresh()
    // Nothing is registered for the failed attempt...
    expect(tm.describe('w.create.step.fill')).toBeUndefined()

    // ...and because `currentStep` only follows a *successful* registration, a later refresh()
    // for the same target step ("details") is not treated as a no-op: it retries.
    const scope2 = tm.scope('w2')
    wizardOpts.scope = scope2
    tools.refresh()
    expect(tm.describe('w2.create.step.fill')!.description).toContain('(current step: details)')
  })
})
