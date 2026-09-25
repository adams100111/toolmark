// Regression tests for the 2026 release security review (docs/security/review-2026.md).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  createFormTools,
  createStepwiseWizardTools,
  createWizardTools,
  fromJsonSchema,
  ok,
  setPath,
  type FieldInfo,
  type StandardSchemaV1,
  type ToolmarkErrorEvent,
  type ToolResult,
} from '@toolmark/core'
import { createTestRegistry } from './helpers/create-test-registry.js'

describe('SEC-1: a tool with only jsonSchema validates its input', () => {
  const qtySchema = {
    type: 'object',
    properties: { qty: { type: 'integer', minimum: 1, maximum: 10 } },
    required: ['qty'],
    additionalProperties: false,
  }

  it('sec_1_json_schema_only_tool_validates_input', async () => {
    const tm = createTestRegistry()
    const seen: unknown[] = []
    tm.register({
      name: 'setQty',
      description: 'd',
      jsonSchema: qtySchema,
      run: (input) => {
        seen.push(input)
        return ok(true)
      },
    })
    for (const bad of [{ qty: -5 }, { qty: 3, extra: 'x' }, 'not an object', {}]) {
      const r = await tm.call('setQty', bad, { caller: 'inapp' })
      expect(r.status).toBe('invalid')
    }
    expect(seen).toEqual([])
    expect((await tm.call('setQty', { qty: 3 }, { caller: 'inapp' })).status).toBe('ok')
    expect(seen).toEqual([{ qty: 3 }])
    expect(tm.describe('setQty')?.inputSchema).toEqual(qtySchema)
  })

  it('sec_1_json_schema_only_unsupported_schema_dev_throws', () => {
    const tm = createTestRegistry()
    expect(() =>
      tm.register({
        name: 'bad',
        description: 'd',
        jsonSchema: { type: 'object', properties: { a: { type: 'string', pattern: '(a+)+' } } },
        run: () => ok(1),
      }),
    ).toThrow(expect.objectContaining({ code: 'schema_conversion_failed' }))
    expect(tm.manifest().tools).toEqual([])
  })

  it('sec_1_json_schema_only_unsupported_schema_prod_not_registered', async () => {
    const tm = createTestRegistry({ dev: false })
    const errs: ToolmarkErrorEvent[] = []
    tm.events.on('error', (e) => errs.push(e))
    let ran = false
    tm.register({
      name: 'bad',
      description: 'd',
      jsonSchema: { type: 'object', properties: { a: { $ref: 'https://example.com/x' } } },
      run: () => {
        ran = true
        return ok(1)
      },
    })
    expect(errs).toHaveLength(1)
    expect(errs[0]).toMatchObject({ code: 'schema_conversion_failed', tool: 'bad' })
    expect(tm.manifest().tools).toEqual([])
    expect((await tm.call('bad', { a: 'x' }, { caller: 'inapp' })).status).toBe('refused')
    expect(ran).toBe(false)
  })
})

/** In-memory form adapter. */
function memoryForm(values: Record<string, unknown> = {}) {
  return {
    values,
    getValues() {
      return this.values
    },
    setValues(next: Record<string, unknown>) {
      for (const [path, v] of Object.entries(next)) this.values = setPath(this.values, path, v)
    },
    dirtyPaths: (): string[] => [],
    submit: () => Promise.resolve(ok(null)),
    fields: (): FieldInfo[] => [],
  }
}

function formWith(input: StandardSchemaV1<unknown, Record<string, unknown>>) {
  const tm = createTestRegistry()
  const adapter = memoryForm({ name: '' })
  createFormTools(tm, adapter, { name: 'f', description: 'Form.', input })
  const fill = (values: unknown) => tm.call('f.fill', { values }, { caller: 'inapp' })
  return { adapter, fill }
}

const undeclared = (...paths: string[]) => ({
  status: 'invalid',
  issues: paths.map((path) => ({ path, message: 'Undeclared field' })),
})

describe('SEC-2: fill never writes an undeclared path, even under an open schema', () => {
  it('sec_2_fill_open_json_schema_rejects_undeclared_key', async () => {
    for (const addl of [undefined, true, {}]) {
      const { adapter, fill } = formWith(
        fromJsonSchema({
          type: 'object',
          properties: { name: { type: 'string' } },
          ...(addl !== undefined ? { additionalProperties: addl } : {}),
        }),
      )
      expect(await fill({ name: 'x', isAdmin: true })).toEqual(undeclared('isAdmin'))
      expect(adapter.values).toEqual({ name: '' })
    }
  })

  it('sec_2_fill_loose_standard_schema_rejects_undeclared_key', async () => {
    const { adapter, fill } = formWith(z.looseObject({ name: z.string() }))
    expect(await fill({ name: 'x', isAdmin: true })).toEqual(undeclared('isAdmin'))
    expect(adapter.values).toEqual({ name: '' })
  })

  it('sec_2_fill_loose_nested_array_item_rejects_undeclared_key', async () => {
    const { adapter, fill } = formWith(
      z.object({ name: z.string(), tags: z.array(z.looseObject({ label: z.string() })) }),
    )
    const r = await fill({ tags: [{ label: 'a', isAdmin: true }] })
    expect(r).toEqual(undeclared('tags.0.isAdmin'))
    expect(adapter.values).toEqual({ name: '' })
  })

  it('sec_2_fill_records_still_accept_entries', async () => {
    const { adapter, fill } = formWith(
      z.object({ name: z.string(), meta: z.record(z.string(), z.string()) }),
    )
    expect((await fill({ meta: { anyKey: 'v' } })).status).toBe('ok')
    expect(adapter.values).toEqual({ name: '', meta: { anyKey: 'v' } })
  })

  it('sec_2_wizard_fill_open_step_schema_rejects_undeclared_key', async () => {
    const tm = createTestRegistry()
    let data: Record<string, Record<string, unknown>> = { one: { name: '' } }
    createWizardTools(tm, {
      name: 'w',
      description: 'Wizard.',
      steps: [{ name: 'one', input: z.looseObject({ name: z.string() }) }],
      getData: () => data,
      setData: (next) => {
        data = next
      },
      getCurrent: () => 'one',
      goTo: () => undefined,
      submit: () => Promise.resolve(ok(null)),
    })
    const r = await tm.call(
      'w.fill',
      { steps: { one: { name: 'x', isAdmin: true } } },
      { caller: 'inapp' },
    )
    expect(r.status).toBe('invalid')
    expect(JSON.stringify(r)).toContain('isAdmin')
    expect(data).toEqual({ one: { name: '' } })
  })
})

describe('SEC-3: confirmation expiry does not depend on timers alone', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  const saveTool = (run: () => void) => ({
    name: 'save',
    description: 'd',
    hints: { consequential: true },
    run: () => {
      run()
      return ok(true)
    },
  })

  it('sec_3_confirm_pending_after_expires_at_refused_even_if_timer_late', async () => {
    // Only `Date` is faked: the expiry timer never fires, as in a frozen background tab.
    vi.useFakeTimers({ toFake: ['Date'] })
    const tm = createTestRegistry({ confirmExpiryMs: 1000 })
    const stages: string[] = []
    tm.events.on('confirm', (e) => stages.push(e.stage))
    let ran = 0
    tm.register(saveTool(() => ran++))
    const r = await tm.call('save', {}, { caller: 'inapp' })
    if (r.status !== 'needs_confirmation') throw new Error('expected needs_confirmation')
    vi.setSystemTime(Date.now() + 1000)
    expect(tm.pendingConfirmations()).toEqual([])
    expect(await tm.confirmPending(r.confirmId, { approved: true })).toMatchObject({
      status: 'refused',
      code: 'confirmation_expired',
    })
    expect(ran).toBe(0)
    expect(stages).toEqual(['pending', 'expired'])
  })

  it('sec_3_inline_approval_after_deadline_is_expired', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const stages: string[] = []
    const tm = createTestRegistry({
      confirmExpiryMs: 1000,
      confirm: () => {
        vi.setSystemTime(Date.now() + 1000)
        return Promise.resolve({ approved: true })
      },
    })
    tm.events.on('confirm', (e) => stages.push(e.stage))
    let ran = 0
    tm.register(saveTool(() => ran++))
    const r = await tm.call('save', {}, { caller: 'mcp' })
    expect(r).toEqual({ status: 'cancelled', by: 'operator' })
    expect(ran).toBe(0)
    expect(stages).toEqual(['pending', 'expired'])
  })
})

describe('SEC-4: runs without a caller signal have a deadline (callTimeoutMs)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  const never = () => new Promise<never>(() => undefined)

  it('sec_4_confirm_pending_hung_tool_releases_scope_after_deadline', async () => {
    vi.useFakeTimers()
    const tm = createTestRegistry({ callTimeoutMs: 1000, abortGraceMs: 100 })
    const errs: string[] = []
    tm.events.on('error', (e) => errs.push(e.code))
    let signal: AbortSignal | undefined
    tm.register({
      name: 'hang',
      description: 'd',
      hints: { consequential: true },
      run: (_i, ctx) => {
        signal = ctx.signal
        return never()
      },
    })
    tm.register({ name: 'next', description: 'd', run: () => ok('ran') })
    const r = await tm.call('hang', {}, { caller: 'inapp' })
    if (r.status !== 'needs_confirmation') throw new Error('expected needs_confirmation')
    const approved = tm.confirmPending(r.confirmId, { approved: true })
    const second = tm.call('next', {}, { caller: 'inapp' })
    await vi.advanceTimersByTimeAsync(999)
    expect(signal?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(signal?.aborted).toBe(true)
    await vi.advanceTimersByTimeAsync(100)
    expect(await approved).toEqual({ status: 'cancelled', by: 'signal' })
    expect(await second).toEqual(ok('ran'))
  })

  it('sec_4_signal_less_call_times_out_and_releases_queue', async () => {
    vi.useFakeTimers()
    const tm = createTestRegistry({ callTimeoutMs: 500, abortGraceMs: 50 })
    tm.register({ name: 'hang', description: 'd', run: never })
    tm.register({ name: 'next', description: 'd', run: () => ok('ran') })
    const first = tm.call('hang', {}, { caller: 'inapp' })
    const second = tm.call('next', {}, { caller: 'inapp' })
    await vi.advanceTimersByTimeAsync(550)
    expect(await first).toEqual({ status: 'cancelled', by: 'signal' })
    expect(await second).toEqual(ok('ran'))
  })

  it('sec_4_default_call_timeout_is_120000_ms', async () => {
    vi.useFakeTimers()
    const tm = createTestRegistry({ abortGraceMs: 0 })
    let signal: AbortSignal | undefined
    tm.register({
      name: 'hang',
      description: 'd',
      run: (_i, ctx) => {
        signal = ctx.signal
        return never()
      },
    })
    const first = tm.call('hang', {}, { caller: 'inapp' })
    await vi.advanceTimersByTimeAsync(119_999)
    expect(signal?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(signal?.aborted).toBe(true)
    await vi.advanceTimersByTimeAsync(1)
    expect(await first).toEqual({ status: 'cancelled', by: 'signal' })
  })

  it('sec_4_caller_signal_is_not_given_a_deadline', async () => {
    vi.useFakeTimers()
    const tm = createTestRegistry({ callTimeoutMs: 100, abortGraceMs: 0 })
    let signal: AbortSignal | undefined
    let release!: () => void
    tm.register({
      name: 'slow',
      description: 'd',
      run: (_i, ctx) => {
        signal = ctx.signal
        return new Promise<ToolResult<string>>((r) => (release = () => r(ok('done'))))
      },
    })
    const p = tm.call('slow', {}, { caller: 'inapp', signal: new AbortController().signal })
    await vi.advanceTimersByTimeAsync(1000)
    expect(signal?.aborted).toBe(false)
    release()
    expect(await p).toEqual(ok('done'))
  })

  it('sec_4_hung_undo_restorer_releases_scope_after_deadline', async () => {
    vi.useFakeTimers()
    const tm = createTestRegistry({ callTimeoutMs: 1000, abortGraceMs: 100 })
    let callId = ''
    tm.events.on('call', (e) => (callId = e.callId))
    tm.register({
      name: 'edit',
      description: 'd',
      run: (_i, ctx) => {
        ctx.registerUndo(never)
        return ok(true)
      },
    })
    tm.register({ name: 'next', description: 'd', run: () => ok('ran') })
    await tm.call('edit', {}, { caller: 'inapp' })
    const undone = tm.undo(callId)
    const second = tm.call('next', {}, { caller: 'inapp' })
    await vi.advanceTimersByTimeAsync(1100)
    expect(await undone).toEqual({ status: 'cancelled', by: 'signal' })
    expect(await second).toEqual(ok('ran'))
  })
})

describe('SEC-5: confirmation payloads redact sensitive input', () => {
  const secretTool = (runs: unknown[]) => ({
    name: 'pay',
    description: 'd',
    hints: { consequential: true },
    input: z.object({
      amount: z.number(),
      card: z.object({ number: z.string(), name: z.string() }),
    }),
    sensitivePaths: () => ['card.number'],
    run: (
      input: unknown,
      ctx: { confirm: (r: { summary: string; changes?: never[] }) => unknown },
    ) => {
      void ctx
      runs.push(input)
      return ok(true)
    },
  })
  const input = { amount: 5, card: { number: '4111111111111111', name: 'Ann' } }

  it('sec_5_pending_confirmation_redacts_sensitive_input', async () => {
    const tm = createTestRegistry()
    const runs: unknown[] = []
    tm.register(secretTool(runs))
    const r = await tm.call('pay', input, { caller: 'inapp' })
    if (r.status !== 'needs_confirmation') throw new Error('expected needs_confirmation')
    const [pending] = tm.pendingConfirmations()
    expect(pending?.input).toEqual({ amount: 5, card: { number: '[redacted]', name: 'Ann' } })
    expect(JSON.stringify(tm.pendingConfirmations())).not.toContain('4111')
    // The approved run still gets the real, validated input.
    expect((await tm.confirmPending(r.confirmId, { approved: true })).status).toBe('ok')
    expect(runs).toEqual([input])
  })

  it('sec_5_inline_confirm_request_redacts_sensitive_input', async () => {
    const requests: unknown[] = []
    const tm = createTestRegistry({
      confirm: (req) => {
        requests.push(req)
        return Promise.resolve({ approved: true })
      },
    })
    const runs: unknown[] = []
    tm.register(secretTool(runs))
    expect((await tm.call('pay', input, { caller: 'mcp' })).status).toBe('ok')
    expect(requests).toHaveLength(1)
    expect((requests[0] as { input: unknown }).input).toEqual({
      amount: 5,
      card: { number: '[redacted]', name: 'Ann' },
    })
    expect(runs).toEqual([input])
  })

  it('sec_5_ctx_confirm_changes_redact_sensitive_paths', async () => {
    const requests: { changes?: unknown; input: unknown }[] = []
    const tm = createTestRegistry({
      confirm: (req) => {
        requests.push(req)
        return Promise.resolve({ approved: true })
      },
    })
    tm.register({
      name: 'save',
      description: 'd',
      input: z.object({ pin: z.string() }),
      sensitivePaths: () => ['pin'],
      run: async (_i, ctx) => {
        await ctx.confirm({
          summary: 'Save?',
          changes: [{ path: 'pin', before: '1111', after: '2222' }],
        })
        return ok(true)
      },
    })
    expect((await tm.call('save', { pin: '2222' }, { caller: 'mcp' })).status).toBe('ok')
    expect(requests[0]?.changes).toEqual([
      { path: 'pin', before: '[redacted]', after: '[redacted]' },
    ])
    expect(requests[0]?.input).toEqual({ pin: '[redacted]' })
  })

  it('sec_5_failing_redaction_hides_the_whole_input', async () => {
    const tm = createTestRegistry({ dev: false })
    tm.register({
      ...secretTool([]),
      sensitivePaths: () => {
        throw new Error('boom')
      },
    })
    const r = await tm.call('pay', input, { caller: 'inapp' })
    expect(r.status).toBe('needs_confirmation')
    expect(JSON.stringify(tm.pendingConfirmations())).not.toContain('4111')
  })
})

describe('SEC-6: fills that return page/user values are marked untrustedContent', () => {
  it('sec_6_form_fill_is_untrusted_content_by_default', () => {
    const tm = createTestRegistry()
    createFormTools(tm, memoryForm(), {
      name: 'f',
      description: 'Form.',
      input: z.object({ name: z.string() }),
      hints: { fill: { untrustedContent: false } },
    })
    expect(tm.describe('f.fill')?.hints).toMatchObject({ untrustedContent: true })
  })

  it('sec_6_wizard_fill_is_untrusted_content', () => {
    const tm = createTestRegistry()
    createWizardTools(tm, {
      name: 'w',
      description: 'Wizard.',
      steps: [{ name: 'one', input: z.object({ name: z.string() }) }],
      getData: () => ({ one: {} }),
      setData: () => undefined,
      getCurrent: () => 'one',
      goTo: () => undefined,
      submit: () => Promise.resolve(ok(null)),
    })
    expect(tm.describe('w.fill')?.hints).toMatchObject({ untrustedContent: true })
  })

  it('sec_6_stepwise_step_fill_is_untrusted_content', () => {
    const tm = createTestRegistry()
    const form = memoryForm()
    createStepwiseWizardTools(tm, {
      name: 'w',
      description: 'Wizard.',
      currentAdapter: () => form,
      currentStep: () => ({ name: 'one', input: z.object({ name: z.string() }) }),
      next: () => Promise.resolve(ok({ step: 'one' })),
      previous: () => undefined,
      submit: () => Promise.resolve(ok(null)),
    })
    expect(tm.describe('w.step.fill')?.hints).toMatchObject({ untrustedContent: true })
  })
})
