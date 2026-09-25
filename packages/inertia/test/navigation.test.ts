import { createToolmark } from '@toolmark/core'
import { describe, expect, it, vi } from 'vitest'
import { navigationTool } from '../src/navigation.js'
import { inertiaPages } from '../src/pages.js'
import { resolveSameOriginUrl, type RouterLike } from '../src/router-like.js'

const routes = {
  'orders.index': () => ({ url: '/orders', method: 'get' }),
  'orders.show': (p?: Record<string, unknown>) => ({
    url: `/orders/${String(p?.id)}`,
    method: 'GET',
  }),
  'orders.destroy': (p?: Record<string, unknown>) => ({
    url: `/orders/${String(p?.id)}`,
    method: 'delete',
  }),
  'orders.broken': () => {
    throw new Error('missing parameter: id')
  },
  'evil.offsite': () => ({ url: 'https://evil.example/steal', method: 'get' }),
}

function setup(): {
  tm: ReturnType<typeof createToolmark>
  visit: ReturnType<typeof vi.fn<(url: string, opts: { method: 'get' }) => void>>
} {
  const tm = createToolmark()
  const visit = vi.fn<(url: string, opts: { method: 'get' }) => void>()
  tm.register(navigationTool({ routes, visit }))
  return { tm, visit }
}

describe('navigationTool', () => {
  it('navigation_route_enum_and_failure', async () => {
    const { tm, visit } = setup()
    const def = tm.describe('navigate')
    expect(def?.description).toBe('Navigate to a page in this app. Use route names from the enum.')
    expect(def?.hints).toEqual({})
    const props = (def?.inputSchema as { properties: { route: { enum: string[] } } }).properties
    expect(props.route.enum).toEqual(Object.keys(routes))

    const r = await tm.call(
      'navigate',
      { route: 'orders.show', params: { id: 7 } },
      { caller: 'inapp' },
    )
    expect(r).toMatchObject({ status: 'ok', data: { url: '/orders/7' } })
    expect(visit).toHaveBeenCalledWith(`${location.origin}/orders/7`, { method: 'get' })

    const unknown = await tm.call('navigate', { route: 'nope' }, { caller: 'inapp' })
    expect(unknown.status).toBe('invalid')

    const broken = await tm.call('navigate', { route: 'orders.broken' }, { caller: 'inapp' })
    expect(broken).toMatchObject({ status: 'refused', code: 'navigation_failed' })

    const offsite = await tm.call('navigate', { route: 'evil.offsite' }, { caller: 'inapp' })
    expect(offsite).toMatchObject({ status: 'refused', code: 'navigation_failed' })
    expect(visit).toHaveBeenCalledTimes(1)
  })

  it('navigation_custom_name_and_description', () => {
    const def = navigationTool({ routes, visit: () => {}, name: 'go', description: 'Go somewhere' })
    expect(def.name).toBe('go')
    expect(def.description).toBe('Go somewhere')
    expect(def.hints).toBeUndefined()
  })

  it('navigation_rejects_non_get_route', async () => {
    const { tm, visit } = setup()
    const r = await tm.call(
      'navigate',
      { route: 'orders.destroy', params: { id: 1 } },
      { caller: 'inapp' },
    )
    expect(r).toMatchObject({
      status: 'refused',
      code: 'navigation_failed',
      message: 'Only GET routes can be navigated; declare a server tool for mutations',
    })
    expect(visit).not.toHaveBeenCalled()
  })

  it('navigation_ok_then_old_props_tools_gone', async () => {
    const tm = createToolmark()
    const listeners = new Set<(e: CustomEvent) => void>()
    const order: string[] = []
    const router: RouterLike = {
      on(_event, cb) {
        listeners.add(cb)
        return () => listeners.delete(cb)
      },
      visit(url) {
        order.push(`visit ${url}`)
        // The page swap arrives asynchronously, after the visit was started.
        setTimeout(() => {
          order.push('navigate')
          const detail = { page: { props: { toolmark: [] } } }
          for (const cb of [...listeners]) cb(new CustomEvent('navigate', { detail }))
        }, 0)
      },
    }
    tm.use(
      inertiaPages({
        router,
        initialPage: {
          props: {
            toolmark: [
              {
                name: 'orders.approve',
                description: 'Approve the order',
                inputSchema: { type: 'object', additionalProperties: false },
                visit: { url: '/orders/7/approve', method: 'post' },
              },
            ],
          },
        },
      }),
    )
    tm.register(navigationTool({ routes, visit: (url, opts) => router.visit(url, opts) }))
    expect(tm.info('orders.approve')).toEqual({ origin: 'server', sensitivePaths: [] })

    const r = await tm.call('navigate', { route: 'orders.index' }, { caller: 'inapp' })
    order.push(`result ${r.status}`)
    expect(r).toMatchObject({ status: 'ok', data: { url: '/orders' } })
    expect(tm.info('orders.approve')).toBeDefined()

    await vi.waitFor(() => expect(order).toContain('navigate'))
    expect(order).toEqual([`visit ${location.origin}/orders`, 'result ok', 'navigate'])
    const old = await tm.call('orders.approve', {}, { caller: 'human' })
    expect(old).toMatchObject({ status: 'refused', code: 'unknown_tool' })
    // The navigation tool lives at the root scope and survives the page swap.
    expect(tm.info('navigate')).toBeDefined()
  })

  it('navigation_rejects_prototype_keys_in_params', async () => {
    const { tm, visit } = setup()
    for (const [params, path] of [
      [JSON.parse('{"__proto__": {"polluted": true}}') as unknown, 'params.__proto__'],
      [{ constructor: 'x' }, 'params.constructor'],
      [{ id: 1, nested: { prototype: {} } }, 'params.nested.prototype'],
    ] as const) {
      const r = await tm.call('navigate', { route: 'orders.show', params }, { caller: 'inapp' })
      expect(r).toMatchObject({ status: 'invalid', issues: [{ path }] })
    }
    expect(visit).not.toHaveBeenCalled()
  })

  it('navigation_visits_canonical_url', async () => {
    const tm = createToolmark()
    const visit = vi.fn<(url: string, opts: { method: 'get' }) => void>()
    tm.register(
      navigationTool({ routes: { rel: () => ({ url: 'a/../b?x=1', method: 'get' }) }, visit }),
    )
    const r = await tm.call('navigate', { route: 'rel' }, { caller: 'inapp' })
    expect(r.status).toBe('ok')
    expect(visit).toHaveBeenCalledWith(new URL('b?x=1', location.href).href, { method: 'get' })
  })

  it('navigation_empty_routes_every_call_invalid', async () => {
    const tm = createToolmark()
    const visit = vi.fn<(url: string, opts: { method: 'get' }) => void>()
    // fromJsonSchema accepts `enum: []`; no route name can then validate.
    tm.register(navigationTool({ routes: {}, visit }))
    const props = (tm.describe('navigate')?.inputSchema as { properties: { route: { enum: [] } } })
      .properties
    expect(props.route.enum).toEqual([])
    const r = await tm.call('navigate', { route: 'anything' }, { caller: 'inapp' })
    expect(r.status).toBe('invalid')
    expect(visit).not.toHaveBeenCalled()
  })
})

describe('resolveSameOriginUrl', () => {
  const host = location.host
  const sameScheme = location.protocol === 'https:'
  it.each([
    ['//evil.example/x', null],
    ['/\\evil.example/x', null],
    ['\\\\evil.example/x', null],
    ['https:/\\evil.example/x', null],
    [`https://${host}@evil.example/x`, null],
    [`${location.protocol}//evil@${host}/x`, null],
    [`${location.protocol}//u:p@${host}/x`, null],
    [' javascript:alert(1)', null],
    ['\tjava\nscript:alert(1)', null],
    ['data:text/html,x', null],
    // A scheme-relative `https:evil.com` is a path on the same origin only under an https base.
    ['https:evil.com', sameScheme ? `${location.origin}/evil.com` : null],
    ['/orders/7', `${location.origin}/orders/7`],
    ['orders/7', new URL('orders/7', location.href).href],
    ['../orders?x=1#h', new URL('../orders?x=1#h', location.href).href],
    [`${location.origin}/a`, `${location.origin}/a`],
  ])('%j -> %j', (input, expected) => {
    expect(resolveSameOriginUrl(input)).toBe(expected)
  })
})
