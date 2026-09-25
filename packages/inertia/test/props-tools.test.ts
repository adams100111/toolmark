import { createToolmark, ok, type ToolmarkErrorEvent } from '@toolmark/core'
import { describe, expect, it, vi } from 'vitest'
import {
  MAX_PROPS_TOOL_DESCRIPTION_LENGTH,
  MAX_PROPS_TOOL_SCHEMA_LENGTH,
  MAX_PROPS_TOOL_TITLE_LENGTH,
  MAX_PROPS_TOOLS_PER_PAGE,
  propsTools,
} from '../src/props-tools.js'
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
    expect(v1.url).toBe(`${location.origin}/orders/7/approve`)
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
    const { tm, router } = setup([
      entry({ inputSchema: { type: 'string' }, visit: { url: '/orders/7', method: 'get' } }),
    ])
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

  it('props_non_get_requires_closed_object_schema', () => {
    const open = [
      entry({ name: 'o1', inputSchema: { type: 'object', properties: {} } }),
      entry({
        name: 'o2',
        inputSchema: { type: 'object', properties: {}, additionalProperties: true },
      }),
      entry({ name: 'o3', inputSchema: { properties: {}, additionalProperties: false } }),
      entry({
        name: 'o4',
        inputSchema: { type: 'object', additionalProperties: { type: 'string' } },
      }),
      entry({ name: 'o5', inputSchema: { type: ['object'], additionalProperties: false } }),
    ]
    const { tm, errors } = setup([
      ...open,
      // A get tool may keep an open schema (its data is a same-origin query string).
      entry({ name: 'g1', inputSchema: { type: 'object' }, visit: { url: '/x', method: 'get' } }),
    ])
    expect(tm.manifest().tools.map((t) => t.name)).toEqual(['g1'])
    expect(errors.map((e) => e.code)).toEqual(open.map(() => 'invalid_props_tool'))
    expect(errors.map((e) => e.tool)).toEqual(['o1', 'o2', 'o3', 'o4', 'o5'])
  })

  it('props_reserved_keys_in_input_refused', async () => {
    const { tm, router } = setup([
      entry({
        name: 'q.get',
        inputSchema: { type: 'object' },
        visit: { url: '/q', method: 'get' },
      }),
      entry({
        name: 'q.post',
        inputSchema: {
          type: 'object',
          properties: { meta: { type: 'object' } },
          additionalProperties: false,
        },
      }),
    ])
    for (const [name, data, path] of [
      ['q.get', { _method: 'delete' }, '_method'],
      ['q.get', { a: 1, _token: 'x' }, '_token'],
      ['q.post', { meta: { _method: 'delete' } }, 'meta._method'],
      ['q.post', { meta: { list: [{ _token: 't' }] } }, 'meta.list.0._token'],
    ] as const) {
      const r = await tm.call(name, data, { caller: 'human' })
      expect(r).toMatchObject({ status: 'invalid', issues: [{ path }] })
    }
    // A closed non-get schema already rejects a root `_method` as an unknown field.
    const root = await tm.call('q.post', { _method: 'delete' }, { caller: 'human' })
    expect(root.status).toBe('invalid')
    expect(router.visits).toHaveLength(0)
  })

  it('props_schema_declaring_reserved_key_skipped', () => {
    const declares = (key: string, nested: boolean): Record<string, unknown> => ({
      type: 'object',
      properties: nested
        ? { inner: { type: 'object', properties: { [key]: { type: 'string' } } } }
        : { [key]: { type: 'string' } },
      additionalProperties: false,
    })
    const { tm, errors } = setup([
      entry({ name: 'r1', inputSchema: declares('_method', false) }),
      entry({ name: 'r2', inputSchema: declares('_token', false) }),
      entry({ name: 'r3', inputSchema: declares('_method', true) }),
      entry({
        name: 'r4',
        inputSchema: declares('_token', false),
        visit: { url: '/x', method: 'get' },
      }),
      entry({ name: 'ok' }),
    ])
    expect(tm.manifest().tools.map((t) => t.name)).toEqual(['ok'])
    expect(errors.map((e) => e.code)).toEqual([
      'invalid_props_tool',
      'invalid_props_tool',
      'invalid_props_tool',
      'invalid_props_tool',
    ])
    expect(errors[0]?.message).toContain('_method')
  })

  it('props_visit_url_resolved_at_registration', async () => {
    const start = location.pathname + location.search
    history.pushState(null, '', '/orders/7/')
    try {
      const { tm, router } = setup([entry({ visit: { url: 'approve', method: 'post' } })])
      // An in-app navigation changes the base a relative URL would resolve against.
      history.pushState(null, '', '/elsewhere/deep/')
      void tm.call('orders.approve', { note: 'a' }, { caller: 'human' })
      const v = await visited(router)
      expect(v.url).toBe(`${location.origin}/orders/7/approve`)
    } finally {
      history.pushState(null, '', start)
    }
  })

  it('props_entry_caps', () => {
    const big = (n: number): Record<string, unknown> => ({
      type: 'object',
      properties: { note: { type: 'string', description: 'x'.repeat(n) } },
      additionalProperties: false,
    })
    const overhead = JSON.stringify(big(0)).length
    const { tm, errors } = setup([
      entry({ name: 'd.max', description: 'd'.repeat(MAX_PROPS_TOOL_DESCRIPTION_LENGTH) }),
      entry({ name: 'd.over', description: 'd'.repeat(MAX_PROPS_TOOL_DESCRIPTION_LENGTH + 1) }),
      entry({ name: 't.max', title: 't'.repeat(MAX_PROPS_TOOL_TITLE_LENGTH) }),
      entry({ name: 't.over', title: 't'.repeat(MAX_PROPS_TOOL_TITLE_LENGTH + 1) }),
      entry({ name: 's.max', inputSchema: big(MAX_PROPS_TOOL_SCHEMA_LENGTH - overhead) }),
      entry({ name: 's.over', inputSchema: big(MAX_PROPS_TOOL_SCHEMA_LENGTH - overhead + 1) }),
    ])
    expect(tm.manifest().tools.map((t) => t.name)).toEqual(['d.max', 's.max', 't.max'])
    expect(errors.map((e) => [e.code, e.tool])).toEqual([
      ['invalid_props_tool', 'd.over'],
      ['invalid_props_tool', 't.over'],
      ['invalid_props_tool', 's.over'],
    ])
  })

  it('props_entries_per_page_capped_with_one_event', () => {
    const n = MAX_PROPS_TOOLS_PER_PAGE + 5
    const { tm, errors } = setup(Array.from({ length: n }, (_, i) => entry({ name: `t${i}` })))
    expect(tm.manifest().tools).toHaveLength(MAX_PROPS_TOOLS_PER_PAGE)
    expect(tm.info(`t${MAX_PROPS_TOOLS_PER_PAGE - 1}`)).toBeDefined()
    expect(tm.info(`t${MAX_PROPS_TOOLS_PER_PAGE}`)).toBeUndefined()
    expect(errors.map((e) => e.code)).toEqual(['invalid_props_tool'])
    expect(errors[0]?.message).toContain('5 props tool entries skipped')
  })
})
