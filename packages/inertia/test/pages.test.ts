import { router as inertiaRouter } from '@inertiajs/react'
import { createToolmark, ok, type ToolmarkErrorEvent } from '@toolmark/core'
import { describe, expect, it, vi } from 'vitest'
import { inertiaPages } from '../src/pages.js'
import type { InertiaCommonEventName, RouterLike } from '../src/router-like.js'
import type { InertiaVisitCallbacks } from '../src/visit-outcome.js'

type VisitOpts = Parameters<RouterLike['visit']>[1] & InertiaVisitCallbacks

interface FakeRouter extends RouterLike {
  visits: { url: string; opts: VisitOpts }[]
  fire(event: InertiaCommonEventName, detail: unknown): void
  listenerCount(): number
}

function fakeRouter(): FakeRouter {
  const listeners = new Map<string, Set<(e: CustomEvent) => void>>()
  const visits: FakeRouter['visits'] = []
  return {
    visits,
    on(event, cb) {
      let set = listeners.get(event)
      if (!set) listeners.set(event, (set = new Set()))
      set.add(cb)
      return () => {
        set.delete(cb)
      }
    },
    visit(url, opts = {}) {
      visits.push({ url, opts })
    },
    fire(event, detail) {
      for (const cb of [...(listeners.get(event) ?? [])]) cb(new CustomEvent(event, { detail }))
    },
    listenerCount() {
      let n = 0
      for (const s of listeners.values()) n += s.size
      return n
    },
  }
}

function tool(name: string, method = 'post'): Record<string, unknown> {
  return {
    name,
    description: `Server tool ${name}`,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    visit: { url: `/${name}`, method },
  }
}

const page = (
  entries: unknown,
  key = 'toolmark',
): { page: { props: Record<string, unknown> } } => ({
  page: { props: { [key]: entries } },
})

const names = (tm: ReturnType<typeof createToolmark>): string[] =>
  tm.manifest().tools.map((t) => t.name)

describe('inertiaPages', () => {
  it('real_inertia_router_is_router_like', () => {
    // Type-level: the installed major's router satisfies RouterLike without a cast.
    const r: RouterLike = inertiaRouter
    expect(typeof r.on).toBe('function')
    expect(typeof r.visit).toBe('function')
  })

  it('registers_initial_props_and_swaps_on_navigate', async () => {
    const tm = createToolmark()
    const router = fakeRouter()
    const detach = tm.use(
      inertiaPages({
        router,
        initialPage: { props: { toolmark: [tool('a.one'), tool('a.two')] } },
      }),
    )
    expect(names(tm)).toEqual(['a.one', 'a.two'])
    router.fire('navigate', page([tool('b.one')]))
    expect(names(tm)).toEqual(['b.one'])
    router.fire('navigate', { page: { props: {} } })
    expect(names(tm)).toEqual([])
    detach()
    expect(router.listenerCount()).toBe(0)
    await Promise.resolve()
  })

  it('custom_props_key_and_root_tools_untouched', () => {
    const tm = createToolmark()
    tm.register({ name: 'app.root', description: 'root tool', run: () => ok({}) })
    const router = fakeRouter()
    tm.use(
      inertiaPages({
        router,
        initialPage: { props: { tools: [tool('p.x')], toolmark: [tool('ignored')] } },
        propsKey: 'tools',
      }),
    )
    expect(names(tm)).toEqual(['app.root', 'p.x'])
    router.fire('navigate', page([], 'tools'))
    expect(names(tm)).toEqual(['app.root'])
  })

  it('invalid_props_value_reported_never_thrown', () => {
    const errors: ToolmarkErrorEvent[] = []
    const tm = createToolmark({ dev: true, onError: (e) => errors.push(e) })
    const router = fakeRouter()
    expect(() =>
      tm.use(inertiaPages({ router, initialPage: { props: { toolmark: 'not-a-list' } } })),
    ).not.toThrow()
    expect(errors.map((e) => e.code)).toEqual(['invalid_props_tool'])
    expect(() => {
      router.fire('navigate', { page: null })
      router.fire('navigate', null)
    }).not.toThrow()
    expect(names(tm)).toEqual([])
  })

  it('initial_navigate_does_not_duplicate', async () => {
    const tm = createToolmark()
    const router = fakeRouter()
    const entries = [tool('a.one'), tool('a.two', 'get')]
    tm.use(inertiaPages({ router, initialPage: { props: { toolmark: entries } } }))
    await Promise.resolve()
    const rev = tm.rev
    const changes = vi.fn()
    tm.subscribe(changes)
    // Inertia 2 and 3 both fire `navigate` for the initial page (and after preserveState visits).
    router.fire('navigate', page(structuredClone(entries)))
    router.fire('navigate', page(structuredClone(entries)))
    await Promise.resolve()
    expect(names(tm)).toEqual(['a.one', 'a.two'])
    expect(tm.rev - rev).toBeLessThanOrEqual(1)
    expect(changes.mock.calls.length).toBeLessThanOrEqual(1)
  })

  it('changed_entries_bump_rev_once', async () => {
    const tm = createToolmark()
    const router = fakeRouter()
    tm.use(inertiaPages({ router, initialPage: { props: { toolmark: [tool('a.one')] } } }))
    await Promise.resolve()
    const rev = tm.rev
    router.fire('navigate', page([tool('b.one'), tool('b.two')]))
    await Promise.resolve()
    expect(tm.rev - rev).toBe(1)
  })

  it('dispose_resolves_inflight_props_call', async () => {
    const tm = createToolmark()
    const router = fakeRouter()
    const detach = tm.use(
      inertiaPages({ router, initialPage: { props: { toolmark: [tool('a.one')] } } }),
    )
    const p = tm.call('a.one', {}, { caller: 'human' })
    await vi.waitFor(() => expect(router.visits).toHaveLength(1))
    const cancel = vi.fn()
    router.visits[0]?.opts.onCancelToken?.({ cancel })
    detach()
    expect(await p).toMatchObject({ status: 'cancelled', by: 'signal' })
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(names(tm)).toEqual([])
    expect(router.listenerCount()).toBe(0)
  })

  it('navigate_keeps_inflight_call_alive', async () => {
    const tm = createToolmark()
    const router = fakeRouter()
    tm.use(inertiaPages({ router, initialPage: { props: { toolmark: [tool('a.one')] } } }))
    const p = tm.call('a.one', {}, { caller: 'human' })
    await vi.waitFor(() => expect(router.visits).toHaveLength(1))
    // The visit's own response swaps the page (new tool list) before onSuccess fires.
    router.fire('navigate', page([tool('b.one')]))
    router.visits[0]?.opts.onSuccess?.()
    expect(await p).toMatchObject({ status: 'ok' })
  })

  it('ssr_registry_is_inert', () => {
    const tm = createToolmark({ __environment: 'server' })
    const router = fakeRouter()
    const detach = tm.use(
      inertiaPages({ router, initialPage: { props: { toolmark: [tool('a.one')] } } }),
    )
    router.fire('navigate', page([tool('b.one')]))
    expect(names(tm)).toEqual([])
    detach()
  })

  it('second_consumer_reports_duplicate_and_is_ignored', () => {
    for (const dev of [true, false]) {
      const errors: ToolmarkErrorEvent[] = []
      const tm = createToolmark({ dev, onError: (e) => errors.push(e) })
      const r1 = fakeRouter()
      const r2 = fakeRouter()
      const detach1 = tm.use(
        inertiaPages({ router: r1, initialPage: { props: { toolmark: [tool('a.one')] } } }),
      )
      let detach2: () => void = () => {}
      expect(() => {
        detach2 = tm.use(
          inertiaPages({ router: r2, initialPage: { props: { toolmark: [tool('b.one')] } } }),
        )
      }).not.toThrow()
      const dup = errors.filter((e) => e.code === 'duplicate_name')
      expect(dup).toHaveLength(1)
      expect(dup[0]?.message).toContain('inertiaPages already attached')
      expect(names(tm)).toEqual(['a.one'])
      expect(r2.listenerCount()).toBe(0)
      detach2()
      expect(names(tm)).toEqual(['a.one'])
      // After the first detaches, a new consumer may attach.
      detach1()
      tm.use(inertiaPages({ router: r2, initialPage: { props: { toolmark: [tool('b.one')] } } }))
      expect(names(tm)).toEqual(['b.one'])
    }
  })

  it('relative_visit_url_survives_same_list_navigation', async () => {
    const start = location.pathname + location.search
    history.pushState(null, '', '/orders/7/')
    try {
      const tm = createToolmark()
      const router = fakeRouter()
      const entries = [{ ...tool('a.one'), visit: { url: 'approve', method: 'post' } }]
      tm.use(inertiaPages({ router, initialPage: { props: { toolmark: entries } } }))
      // In-app navigation to another path, re-rendering the same entry list.
      history.pushState(null, '', '/customers/9/')
      router.fire('navigate', page(structuredClone(entries)))
      void tm.call('a.one', {}, { caller: 'human' })
      await vi.waitFor(() => expect(router.visits).toHaveLength(1))
      expect(router.visits[0]?.url).toBe(`${location.origin}/orders/7/approve`)
    } finally {
      history.pushState(null, '', start)
    }
  })
})
