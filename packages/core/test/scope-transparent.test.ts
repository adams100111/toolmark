import { describe, expect, it } from 'vitest'
import { createTestRegistry } from './helpers/create-test-registry.js'
import { tool } from './helpers/tools.js'

const names = (tm: ReturnType<typeof createTestRegistry>) => tm.manifest().tools.map((t) => t.name)

describe('transparent scopes', () => {
  it('transparent_scope_keeps_names_and_disposes', async () => {
    const tm = createTestRegistry()
    const server = tm.scope('server', { transparent: true })
    expect(server.path).toBe('')
    tm.register(tool('orders.create'), { scope: server })

    // Nested transparent scope under a named scope keeps the parent's prefix only.
    const page = tm.scope('page')
    const props = page.scope('props', { transparent: true })
    expect(props.path).toBe('page')
    tm.register(tool('save'), { scope: props })
    // A named child of a transparent scope is prefixed by its own name only.
    const inner = server.scope('inner')
    expect(inner.path).toBe('inner')
    tm.register(tool('x'), { scope: inner })
    // Nested transparent scope under a transparent scope.
    const deep = server.scope('deep', { transparent: true })
    tm.register(tool('y'), { scope: deep })

    expect(names(tm)).toEqual(['inner.x', 'orders.create', 'page.save', 'y'])
    expect((await tm.call('orders.create', {}, { caller: 'inapp' })).status).toBe('ok')

    // `when` still applies (including to descendants).
    server.setWhen(false)
    expect(names(tm)).toEqual(['page.save'])
    server.setWhen(true)
    const hidden = tm.scope('hidden', { transparent: true, when: false })
    tm.register(tool('h'), { scope: hidden })
    expect(names(tm)).not.toContain('h')
    hidden.setWhen(true)
    expect(names(tm)).toContain('h')

    // Disposal removes the scope's tools and its descendants', not the parent's.
    props.dispose()
    expect(names(tm)).toEqual(['h', 'inner.x', 'orders.create', 'y'])
    tm.register(tool('still'), { scope: page })
    expect(names(tm)).toContain('page.still')
    server.dispose()
    expect(names(tm)).toEqual(['h', 'page.still'])
    expect(server.disposed && deep.disposed && inner.disposed).toBe(true)
  })
})
