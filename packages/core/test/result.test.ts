import { describe, expect, it } from 'vitest'
import { cancelled, invalid, ok, refuse } from '@toolmark/core'

describe('result helpers', () => {
  it('result_helpers_shapes', () => {
    expect(ok({ a: 1 })).toEqual({ status: 'ok', data: { a: 1 } })
    expect(invalid([{ path: 'title', message: 'Required' }])).toEqual({
      status: 'invalid',
      issues: [{ path: 'title', message: 'Required' }],
    })
    expect(refuse('not_allowed', 'No')).toEqual({
      status: 'refused',
      code: 'not_allowed',
      message: 'No',
    })
    expect(refuse('not_allowed', 'No')).not.toHaveProperty('rev')
    expect(refuse('stale', 'x', { rev: 3 })).toEqual({
      status: 'refused',
      code: 'stale',
      message: 'x',
      rev: 3,
    })
    expect(cancelled('operator')).toEqual({ status: 'cancelled', by: 'operator' })
    expect(cancelled('signal')).toEqual({ status: 'cancelled', by: 'signal' })
    expect(cancelled('policy')).toEqual({ status: 'cancelled', by: 'policy' })
    expect(Object.isFrozen(ok(1))).toBe(true)
    expect(Object.isFrozen(refuse('x', 'y'))).toBe(true)
  })

  it('results_are_structured_cloneable', () => {
    const r = ok({ a: 1 })
    expect(structuredClone(r)).toEqual(r)
    const i = invalid([{ path: '', message: 'bad' }])
    expect(structuredClone(i)).toEqual(i)
  })
})
