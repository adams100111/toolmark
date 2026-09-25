import { createToolmark, ok, type ToolmarkErrorEvent } from '@toolmark/core'
import { describe, expect, it, vi } from 'vitest'
import { propsTools } from '../src/props-tools.js'
import type { InertiaVisitCallbacks } from '../src/visit-outcome.js'

interface Visit {
  url: string
  opts: { method?: string; data?: unknown; preserveState?: boolean } & InertiaVisitCallbacks
}

function fakeRouter(): { visit: (url: string, opts?: Visit['opts']) => void; visits: Visit[] } {
  const visits: Visit[] = []
  return {
    visits,
    visit(url, opts = {}) {
      visits.push({ url, opts })
    },
  }
}

const schema = {
  type: 'object',
  properties: { note: { type: 'string', minLength: 1 } },
  required: ['note'],
  additionalProperties: false,
}

function entry(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'orders.approve',
    title: 'Approve order',
    description: 'Approves the order shown on this page.',
    inputSchema: schema,
    visit: { url: '/orders/7/approve', method: 'post' },
    ...over,
  }
}

function setup(entries: unknown[]): {
  tm: ReturnType<typeof createToolmark>
  router: ReturnType<typeof fakeRouter>
  errors: ToolmarkErrorEvent[]
} {
  const errors: ToolmarkErrorEvent[] = []
  const tm = createToolmark({ onError: (e) => errors.push(e) })
  const router = fakeRouter()
  propsTools(tm, entries, tm.scope('page', { transparent: true }), { router })
  return { tm, router, errors }
}

async function visited(router: ReturnType<typeof fakeRouter>, n = 1): Promise<Visit> {
  await vi.waitFor(() => expect(router.visits).toHaveLength(n))
  return router.visits[n - 1] as Visit
}

describe('propsTools', () => {
  it('props_tools_registered_with_server_names', () => {
    const { tm } = setup([
      entry(),
      entry({ name: 'orders.show', visit: { url: '/orders/7', method: 'get' } }),
    ])
    const names = tm.manifest().tools.map((t) => t.name)
    expect(names).toEqual(['orders.approve', 'orders.show'])
    expect(tm.info('orders.approve')).toEqual({ origin: 'server' })
    const full = tm.describe('orders.approve')
    expect(full?.title).toBe('Approve order')
    expect(full?.inputSchema).toEqual(schema)
  })

  it('props_tool_success_and_error_mapping', async () => {
    const { tm, router } = setup([entry()])
    const p1 = tm.call('orders.approve', { note: 'ok' }, { caller: 'human' })
    const v1 = await visited(router)
    expect(v1.url).toBe('/orders/7/approve')
    expect(v1.opts.method).toBe('post')
    expect(v1.opts.data).toEqual({ note: 'ok' })
    expect(v1.opts.preserveState).toBe(true)
    v1.opts.onSuccess?.()
    v1.opts.onFinish?.({})
    expect(await p1).toMatchObject({ status: 'ok', data: {} })

    const p2 = tm.call('orders.approve', { note: 'x' }, { caller: 'human' })
    const v2 = await visited(router, 2)
    v2.opts.onError?.({ note: 'Too short' })
    expect(await p2).toMatchObject({
      status: 'invalid',
      issues: [{ path: 'note', message: 'Too short' }],
    })

    // Input is validated against the server's schema before any visit.
    const bad = await tm.call('orders.approve', { note: '' }, { caller: 'human' })
    expect(bad.status).toBe('invalid')
    expect(router.visits).toHaveLength(2)
  })

  it('props_tool_http_exception_is_error', async () => {
    for (const fire of [
      (o: Visit['opts']) => o.onHttpException?.({ status: 500 }),
      (o: Visit['opts']) => o.onInvalid?.({ status: 500 }),
    ]) {
      const { tm, router } = setup([entry()])
      const p = tm.call('orders.approve', { note: 'a' }, { caller: 'human' })
      const v = await visited(router)
      fire(v.opts)
      v.opts.onFinish?.({})
      expect(await p).toMatchObject({ status: 'error', message: 'Request failed' })
    }
  })

  it('props_tool_network_error_is_error', async () => {
    for (const fire of [
      (o: Visit['opts']) => o.onNetworkError?.(new Error('offline')),
      (o: Visit['opts']) => o.onException?.(new Error('boom')),
    ]) {
      const { tm, router } = setup([entry()])
      const p = tm.call('orders.approve', { note: 'a' }, { caller: 'human' })
      const v = await visited(router)
      fire(v.opts)
      expect(await p).toMatchObject({ status: 'error', message: 'Network error' })
    }
  })

  it('props_tool_finish_only_is_error', async () => {
    const { tm, router } = setup([entry()])
    const p = tm.call('orders.approve', { note: 'a' }, { caller: 'human' })
    const v = await visited(router)
    v.opts.onFinish?.({})
    const r = await p
    expect(r).toMatchObject({ status: 'error', message: 'Visit did not complete' })
    expect(r.status).not.toBe('ok')
  })

  it('props_tool_abort_cancels_visit', async () => {
    const { tm, router } = setup([entry()])
    const ac = new AbortController()
    const p = tm.call('orders.approve', { note: 'a' }, { caller: 'human', signal: ac.signal })
    const v = await visited(router)
    const cancel = vi.fn(() => v.opts.onCancel?.())
    v.opts.onCancelToken?.({ cancel })
    ac.abort()
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(await p).toMatchObject({ status: 'cancelled', by: 'signal' })
  })

  it('props_non_get_forced_consequential', () => {
    const { tm } = setup([
      entry({ name: 'a.post', hints: { readOnly: true } }),
      entry({
        name: 'a.del',
        hints: { destructive: true },
        visit: { url: '/x', method: 'delete' },
      }),
      entry({ name: 'a.get', hints: { readOnly: true }, visit: { url: '/x', method: 'get' } }),
      entry({ name: 'a.put', visit: { url: '/x', method: 'put' } }),
    ])
    expect(tm.describe('a.post')?.hints).toEqual({ consequential: true })
    expect(tm.describe('a.del')?.hints).toEqual({ consequential: true, destructive: true })
    expect(tm.describe('a.get')?.hints).toEqual({ readOnly: true })
    expect(tm.describe('a.put')?.hints).toEqual({ consequential: true })
  })

  it('props_non_get_needs_confirmation_for_agents', async () => {
    const { tm, router } = setup([entry()])
    const r = await tm.call('orders.approve', { note: 'a' }, { caller: 'inapp' })
    expect(r.status).toBe('needs_confirmation')
    expect(router.visits).toHaveLength(0)
  })

  it('props_tool_non_object_input_never_visits', async () => {
    const { tm, router } = setup([entry({ inputSchema: { type: 'string' } })])
    const r = await tm.call('orders.approve', 'x', { caller: 'human' })
    expect(r.status).toBe('invalid')
    expect(router.visits).toHaveLength(0)
  })

  it('invalid_props_entry_skipped_with_event', () => {
    const invalid: unknown[] = [
      null,
      'orders.approve',
      entry({ name: 'bad name!' }),
      entry({ name: 'x1', description: '' }),
      entry({ name: 'x2', description: 42 }),
      entry({ name: 'x3', inputSchema: 'nope' }),
      entry({ name: 'x4', inputSchema: { $ref: 'https://evil.example/schema' } }),
      entry({ name: 'x5', visit: { url: '/x', method: 'trace' } }),
      entry({ name: 'x6', visit: { url: 7, method: 'get' } }),
      entry({ name: 'x7', visit: { url: 'https://evil.example/x', method: 'post' } }),
      entry({ name: 'x8', visit: { url: 'javascript:alert(1)', method: 'get' } }),
      entry({ name: 'x9', title: 5 }),
      entry({ name: 'x10', hints: { readOnly: 'yes' } }),
      entry({ name: 'x11', visit: null }),
      entry({ name: 'x12', inputSchema: [] }),
    ]
    const { tm, errors } = setup([...invalid, entry({ name: 'good' })])
    expect(tm.manifest().tools.map((t) => t.name)).toEqual(['good'])
    const codes = errors.map((e) => e.code)
    expect(codes).toHaveLength(invalid.length)
    expect(new Set(codes)).toEqual(new Set(['invalid_props_tool']))
  })

  it('invalid_props_entry_never_throws_in_dev', () => {
    const errors: ToolmarkErrorEvent[] = []
    const tm = createToolmark({ dev: true, onError: (e) => errors.push(e) })
    expect(() => {
      propsTools(tm, [entry({ name: '' })], tm.scope('p', { transparent: true }), {
        router: fakeRouter(),
      })
    }).not.toThrow()
    expect(errors.map((e) => e.code)).toEqual(['invalid_props_tool'])
  })

  it('props_collision_does_not_throw', () => {
    for (const dev of [true, false]) {
      const errors: ToolmarkErrorEvent[] = []
      const tm = createToolmark({ dev, onError: (e) => errors.push(e) })
      tm.register({ name: 'orders.approve', description: 'app tool', run: () => ok({}) })
      expect(() => {
        propsTools(
          tm,
          [entry(), entry({ name: 'dup' }), entry({ name: 'dup' }), entry({ name: 'dup_x' })],
          tm.scope('p', { transparent: true }),
          { router: fakeRouter() },
        )
      }).not.toThrow()
      expect(tm.info('orders.approve')).toEqual({ origin: 'code' })
      expect(tm.manifest().tools.map((t) => t.name)).toEqual(['dup', 'dup_x', 'orders.approve'])
      // (dev also reports `missing_confirm_handler` for the consequential tools: no inline handler)
      const codes = errors.map((e) => e.code).filter((c) => c !== 'missing_confirm_handler')
      expect(codes).toEqual(['duplicate_name', 'duplicate_name'])
    }
  })

  it('props_llm_name_collision_reported_not_thrown', () => {
    const errors: ToolmarkErrorEvent[] = []
    const tm = createToolmark({ dev: true, onError: (e) => errors.push(e) })
    tm.register({ name: 'a__b', description: 'app tool', run: () => ok({}) })
    expect(() => {
      propsTools(tm, [entry({ name: 'a.b' })], tm.scope('p', { transparent: true }), {
        router: fakeRouter(),
      })
    }).not.toThrow()
    expect(errors.map((e) => e.code)).toEqual(['duplicate_name'])
    expect(errors[0]?.tool).toBe('a.b')
    expect(tm.info('a.b')).toBeUndefined()
  })
})
