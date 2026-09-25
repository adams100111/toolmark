import { describe, expect, it } from 'vitest'
import type { ToolmarkErrorEvent } from '@toolmark/core'
import { createTestRegistry } from './helpers/create-test-registry.js'
import { tool } from './helpers/tools.js'

/** Distinct stand-ins for elements (node environment: no DOM). */
const el = (id: string): Element => ({ id }) as unknown as Element

describe('tm.anchor / tm.setAnchor / tm.state', () => {
  it('anchor_precedence', () => {
    const tm = createTestRegistry()
    const root = el('root')
    const paramEl = el('param-email')
    const resolved = el('resolved')
    const resolvedFor: string[] = []
    tm.register(
      tool('form', undefined, {
        anchors: {
          element: () => root,
          params: { email: () => paramEl, empty: () => null },
          resolve: (param) => {
            resolvedFor.push(param)
            return param.startsWith('items.') ? resolved : null
          },
        },
      }),
    )
    // No param: element().
    expect(tm.anchor('form')).toBe(root)
    // params[param] wins over resolve.
    expect(tm.anchor('form', 'email')).toBe(paramEl)
    expect(resolvedFor).toEqual([])
    // params[param] returning null falls through to resolve(param).
    expect(tm.anchor('form', 'empty')).toBeNull()
    expect(resolvedFor).toEqual(['empty'])
    // No params entry: resolve(param).
    expect(tm.anchor('form', 'items.0.qty')).toBe(resolved)
    // Nothing matches: null.
    expect(tm.anchor('form', 'nope')).toBeNull()
    // Inherited keys are not params entries (no Object.prototype lookups).
    expect(tm.anchor('form', 'constructor')).toBeNull()
    expect(tm.anchor('form', '__proto__')).toBeNull()

    // A setAnchor override wins for its (tool, param) pair only.
    const override = el('override')
    const overrideRoot = el('override-root')
    tm.setAnchor('form', 'email', override)
    expect(tm.anchor('form', 'email')).toBe(override)
    expect(tm.anchor('form')).toBe(root)
    tm.setAnchor('form', 'items.0.qty', override)
    expect(tm.anchor('form', 'items.0.qty')).toBe(override)
    tm.setAnchor('form', undefined, overrideRoot)
    expect(tm.anchor('form')).toBe(overrideRoot)
    expect(tm.anchor('form', 'email')).toBe(override)

    // A tool without anchors, and an unknown tool: null.
    tm.register(tool('bare'))
    expect(tm.anchor('bare')).toBeNull()
    expect(tm.anchor('bare', 'x')).toBeNull()
    expect(tm.anchor('missing')).toBeNull()
    expect(tm.anchor('missing', 'x')).toBeNull()
    tm.setAnchor('bare', undefined, root)
    expect(tm.anchor('bare')).toBe(root)
  })

  it('set_anchor_clears_with_null', () => {
    const tm = createTestRegistry()
    const root = el('root')
    const override = el('override')
    const reg = tm.register(tool('form', undefined, { anchors: { element: () => root } }))
    tm.setAnchor('form', undefined, override)
    tm.setAnchor('form', 'email', override)
    expect(tm.anchor('form')).toBe(override)
    tm.setAnchor('form', undefined, null)
    expect(tm.anchor('form')).toBe(root)
    expect(tm.anchor('form', 'email')).toBe(override)
    tm.setAnchor('form', 'email', null)
    expect(tm.anchor('form', 'email')).toBeNull()

    // Overrides are dropped when the tool is disposed; a re-registered tool starts clean.
    tm.setAnchor('form', 'email', override)
    reg.dispose()
    expect(tm.anchor('form', 'email')).toBeNull()
    tm.register(tool('form'))
    expect(tm.anchor('form', 'email')).toBeNull()
    expect(tm.anchor('form')).toBeNull()

    // Scope disposal drops the overrides of its tools too.
    const scope = tm.scope('page')
    tm.register(tool('x'), { scope })
    tm.setAnchor('page.x', undefined, override)
    expect(tm.anchor('page.x')).toBe(override)
    scope.dispose()
    tm.register(tool('x'), { scope: tm.scope('page') })
    expect(tm.anchor('page.x')).toBeNull()
  })

  it('anchor_throwing_spec_returns_null', () => {
    const tm = createTestRegistry()
    const errors: ToolmarkErrorEvent[] = []
    tm.events.on('error', (e) => errors.push(e))
    tm.register(
      tool('form', undefined, {
        anchors: {
          element: () => {
            throw new Error('boom')
          },
          params: {
            email: () => {
              throw new Error('boom')
            },
          },
          resolve: () => {
            throw new Error('boom')
          },
        },
      }),
    )
    expect(() => tm.anchor('form')).not.toThrow()
    expect(tm.anchor('form')).toBeNull()
    expect(tm.anchor('form', 'email')).toBeNull()
    expect(tm.anchor('form', 'other')).toBeNull()
    expect(errors.length).toBeGreaterThanOrEqual(3)
    for (const e of errors) expect(e).toMatchObject({ code: 'tool_threw', tool: 'form' })

    // Production: still null, never throws, no event noise.
    const prod = createTestRegistry({ dev: false })
    const prodErrors: ToolmarkErrorEvent[] = []
    prod.events.on('error', (e) => prodErrors.push(e))
    prod.register(
      tool('form', undefined, {
        anchors: {
          element: () => {
            throw new Error('boom')
          },
        },
      }),
    )
    expect(prod.anchor('form')).toBeNull()
    expect(prodErrors).toEqual([])
  })

  it('state_delegates_and_undefined_without_state', () => {
    const tm = createTestRegistry()
    const snapshot = { values: { email: 'a@b.c' }, issues: [], step: 'contact' }
    let calls = 0
    tm.register(
      tool('form', undefined, {
        state: () => {
          calls++
          return snapshot
        },
      }),
    )
    tm.register(tool('bare'))
    const revBefore = tm.rev
    expect(tm.state('form')).toBe(snapshot)
    expect(calls).toBe(1)
    expect(tm.state('bare')).toBeUndefined()
    expect(tm.state('missing')).toBeUndefined()
    // Synchronous, no mutation of the registry.
    expect(tm.state('form')).not.toBeInstanceOf(Promise)
    expect(tm.rev).toBe(revBefore)

    // A throwing state() → undefined (never throws).
    const errors: ToolmarkErrorEvent[] = []
    tm.events.on('error', (e) => errors.push(e))
    tm.register(
      tool('broken', undefined, {
        state: () => {
          throw new Error('boom')
        },
      }),
    )
    expect(tm.state('broken')).toBeUndefined()
    expect(errors).toMatchObject([{ code: 'tool_threw', tool: 'broken' }])
  })
})
