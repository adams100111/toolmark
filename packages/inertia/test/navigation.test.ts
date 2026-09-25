import { createToolmark } from '@toolmark/core'
import { describe, expect, it, vi } from 'vitest'
import { navigationTool } from '../src/navigation.js'
import { inertiaPages } from '../src/pages.js'
import type { RouterLike } from '../src/router-like.js'

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
    expect(visit).toHaveBeenCalledWith('/orders/7', { method: 'get' })

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
                inputSchema: { type: 'object' },
                visit: { url: '/orders/7/approve', method: 'post' },
              },
            ],
          },
        },
      }),
    )
    tm.register(navigationTool({ routes, visit: (url, opts) => router.visit(url, opts) }))
    expect(tm.info('orders.approve')).toEqual({ origin: 'server' })

    const r = await tm.call('navigate', { route: 'orders.index' }, { caller: 'inapp' })
    order.push(`result ${r.status}`)
    expect(r).toMatchObject({ status: 'ok', data: { url: '/orders' } })
    expect(tm.info('orders.approve')).toBeDefined()

    await vi.waitFor(() => expect(order).toContain('navigate'))
    expect(order).toEqual(['visit /orders', 'result ok', 'navigate'])
    const old = await tm.call('orders.approve', {}, { caller: 'human' })
    expect(old).toMatchObject({ status: 'refused', code: 'unknown_tool' })
    // The navigation tool lives at the root scope and survives the page swap.
    expect(tm.info('navigate')).toBeDefined()
  })
})
