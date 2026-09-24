import { describe, expect, it, vi } from 'vitest'
import {
  createToolmark,
  ToolmarkError,
  type ToolmarkErrorEvent,
  type ToolmarkOptions,
} from '@toolmark/core'
import { createTestRegistry } from './helpers/create-test-registry.js'
import { flushMicrotasks, tool } from './helpers/tools.js'

function errors(tm: ReturnType<typeof createTestRegistry>): ToolmarkErrorEvent[] {
  const out: ToolmarkErrorEvent[] = []
  tm.events.on('error', (e) => out.push(e))
  return out
}

describe('registry', () => {
  it('register_and_manifest_sorted', () => {
    const tm = createTestRegistry()
    const b = tm.scope('b')
    const a = tm.scope('a')
    tm.register(tool('zeta'), { scope: b })
    tm.register(tool('fill'), { scope: a.scope('form') })
    tm.register(tool('alpha'))
    const m = tm.manifest()
    expect(m.tools.map((t) => t.name)).toEqual(['a.form.fill', 'alpha', 'b.zeta'])
    expect(m.tools[0]).toEqual({
      name: 'a.form.fill',
      llmName: 'a__form__fill',
      description: 'Tool fill',
      hints: {},
    })
  })

  it('duplicate_name_dev_throws_prod_event', () => {
    const dev = createTestRegistry()
    dev.register(tool('x'))
    expect(() => dev.register(tool('x'))).toThrow(ToolmarkError)
    try {
      dev.register(tool('x'))
    } catch (e) {
      expect((e as ToolmarkError).code).toBe('duplicate_name')
    }

    const prod = createTestRegistry({ dev: false })
    const errs = errors(prod)
    const first = { ...tool('x'), description: 'first' }
    prod.register(first)
    const reg = prod.register({ ...tool('x'), description: 'second' })
    expect(reg.name).toBe('x')
    expect(errs.map((e) => e.code)).toEqual(['duplicate_name'])
    expect(errs[0]!.tool).toBe('x')
    expect(prod.describe('x')?.description).toBe('first')
  })

  it('invalid_name_rejected', () => {
    const dev = createTestRegistry()
    expect(() => dev.register(tool('a b'))).toThrow(/invalid_name|Invalid tool name/)
    const prod = createTestRegistry({ dev: false })
    const errs = errors(prod)
    prod.register(tool('a/b'))
    expect(errs.map((e) => e.code)).toEqual(['invalid_name'])
    expect(prod.manifest().tools).toEqual([])
  })

  it('dispose_then_register_same_name_ok', () => {
    const tm = createTestRegistry()
    const r = tm.register(tool('x'))
    r.dispose()
    r.dispose()
    expect(() => tm.register(tool('x'))).not.toThrow()
    expect(tm.manifest().tools.map((t) => t.name)).toEqual(['x'])
  })

  it('register_into_disposed_scope_rejected', () => {
    const dev = createTestRegistry()
    const s = dev.scope('s')
    s.dispose()
    expect(s.disposed).toBe(true)
    expect(() => dev.register(tool('x'), { scope: s })).toThrow(
      expect.objectContaining({ code: 'scope_disposed' }),
    )

    const prod = createTestRegistry({ dev: false })
    const errs = errors(prod)
    const ps = prod.scope('s')
    ps.dispose()
    prod.register(tool('x'), { scope: ps })
    expect(errs.map((e) => e.code)).toEqual(['scope_disposed'])
    expect(prod.manifest().tools).toEqual([])
  })

  it('scope_dispose_removes_descendants', async () => {
    const tm = createTestRegistry()
    const outer = tm.scope('outer')
    const inner = outer.scope('inner')
    const deepest = inner.scope('deepest')
    tm.register(tool('a'), { scope: outer })
    tm.register(tool('b'), { scope: inner })
    tm.register(tool('c'), { scope: deepest })
    tm.register(tool('keep'))
    await flushMicrotasks()
    const before = tm.rev
    outer.dispose()
    expect(inner.disposed).toBe(true)
    expect(deepest.disposed).toBe(true)
    expect(tm.manifest().tools.map((t) => t.name)).toEqual(['keep'])
    expect(tm.rev).toBe(before + 1)
  })

  it('signal_abort_unregisters', () => {
    const tm = createTestRegistry()
    const ac = new AbortController()
    tm.register(tool('x'), { signal: ac.signal })
    expect(tm.manifest().tools).toHaveLength(1)
    ac.abort()
    expect(tm.manifest().tools).toHaveLength(0)
    const aborted = AbortSignal.abort()
    tm.register(tool('y'), { signal: aborted })
    expect(tm.manifest().tools).toHaveLength(0)
  })

  it('when_false_hides_tools_and_refuses_call', async () => {
    const tm = createTestRegistry()
    const s = tm.scope('s', { when: false })
    const child = s.scope('c')
    tm.register(tool('x'), { scope: child })
    expect(tm.manifest().tools).toEqual([])
    expect(tm.describe('s.c.x')).toBeUndefined()
    const r = await tm.call('s.c.x', {}, { caller: 'inapp' })
    expect(r).toEqual({
      status: 'refused',
      code: 'unknown_tool',
      message: expect.any(String) as string,
      rev: tm.rev,
    })
    s.setWhen(true)
    expect(tm.manifest().tools.map((t) => t.name)).toEqual(['s.c.x'])
    expect((await tm.call('s.c.x', {}, { caller: 'inapp' })).status).toBe('ok')
  })

  it('rev_increments_synchronously', async () => {
    const tm = createTestRegistry()
    expect(tm.rev).toBe(0)
    tm.register(tool('a'))
    expect(tm.manifest().rev).toBe(1)
    for (const n of ['b', 'c', 'd', 'e']) tm.register(tool(n))
    expect(tm.rev).toBe(1)
    await flushMicrotasks()
    for (const n of ['f', 'g', 'h', 'i', 'j']) tm.register(tool(n))
    expect(tm.rev).toBe(2)
    tm.scope('empty')
    await flushMicrotasks()
    expect(tm.rev).toBe(2)
  })

  it('subscribe_batches_per_microtask', async () => {
    const tm = createTestRegistry()
    const seen: number[] = []
    const changes: number[] = []
    const off = tm.subscribe((rev) => seen.push(rev))
    tm.events.on('change', (e) => changes.push(e.rev))
    for (const n of ['a', 'b', 'c', 'd', 'e']) tm.register(tool(n))
    expect(seen).toEqual([])
    await flushMicrotasks()
    expect(seen).toEqual([tm.rev])
    expect(changes).toEqual([tm.rev])
    off()
    tm.register(tool('f'))
    await flushMicrotasks()
    expect(seen).toHaveLength(1)
  })

  it('ssr_is_inert', async () => {
    const tm = createToolmark({ dev: true, __environment: 'server' })
    const consumer = vi.fn(() => () => {})
    expect(() => {
      const reg = tm.register(tool('x'))
      expect(reg.name).toBe('x')
      reg.dispose()
      tm.use(consumer)()
    }).not.toThrow()
    expect(consumer).not.toHaveBeenCalled()
    expect(tm.manifest()).toEqual({ rev: 0, tools: [] })
    expect(tm.describe('x')).toBeUndefined()
    expect(await tm.call('x', {}, { caller: 'inapp' })).toMatchObject({
      status: 'refused',
      code: 'unknown_tool',
    })
  })

  it('budget_exceeded_dev_event_only', async () => {
    for (const dev of [true, false]) {
      const tm = createTestRegistry({ dev })
      const errs = errors(tm)
      for (let i = 0; i < 41; i++) tm.register(tool(`t${i}`))
      await flushMicrotasks()
      expect(errs.filter((e) => e.code === 'tool_budget_exceeded')).toHaveLength(dev ? 1 : 0)
    }
    const small = createTestRegistry({ budget: 2 })
    const errs = errors(small)
    for (const n of ['a', 'b']) small.register(tool(n))
    await flushMicrotasks()
    expect(errs).toEqual([])
  })

  it('no_confirmation_path_dev_throws', () => {
    const policy = (): NonNullable<ToolmarkOptions['policy']> => ({
      inapp: { allow: ['readOnly', 'default'] },
      test: { allow: ['readOnly', 'default'] },
    })
    const dev = createTestRegistry({ policy: policy() })
    expect(() => dev.register(tool('save', { consequential: true }))).toThrow(
      expect.objectContaining({ code: 'missing_confirm_handler' }),
    )
    const prod = createTestRegistry({ dev: false, policy: policy() })
    const errs = errors(prod)
    prod.register(tool('save', { consequential: true }))
    expect(prod.manifest().tools).toEqual([])
    expect(errs.map((e) => e.code)).toEqual(['missing_confirm_handler'])
    // With an inline handler, the inline callers provide the path.
    const withHandler = createTestRegistry({
      confirm: () => Promise.resolve({ approved: true }),
      policy: policy(),
    })
    expect(() => withHandler.register(tool('save', { consequential: true }))).not.toThrow()
  })

  it('inline_callers_hidden_without_handler', () => {
    for (const dev of [true, false]) {
      const tm = createTestRegistry({ dev })
      const errs = errors(tm)
      tm.register(tool('save', { consequential: true }))
      tm.register(tool('read', { readOnly: true }))
      expect(tm.manifest({ caller: 'webmcp' }).tools.map((t) => t.name)).toEqual(['read'])
      expect(tm.describe('save', { caller: 'mcp' })).toBeUndefined()
      expect(tm.manifest({ caller: 'inapp' }).tools.map((t) => t.name)).toEqual(['read', 'save'])
      expect(errs.filter((e) => e.code === 'missing_confirm_handler')).toHaveLength(dev ? 1 : 0)
      if (dev) expect(errs[0]!.tool).toBe('save')
    }
  })

  it('use_calls_consumer_and_returns_idempotent_disposer', () => {
    const tm = createTestRegistry()
    const cleanup = vi.fn()
    const consumer = vi.fn(() => cleanup)
    const dispose = tm.use(consumer)
    expect(consumer).toHaveBeenCalledWith(tm)
    dispose()
    dispose()
    expect(cleanup).toHaveBeenCalledTimes(1)
  })

  it('client_id_is_uuid', () => {
    expect(createTestRegistry().clientId).toMatch(/^[0-9a-f-]{36}$/)
  })
})
