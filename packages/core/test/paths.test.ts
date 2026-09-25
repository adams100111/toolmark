import { describe, expect, it } from 'vitest'
import { flatten, getPath, setPath } from '@toolmark/core'
import { flattenWithRejected } from '../src/forms/paths.js'

describe('paths', () => {
  it('paths_flatten_get_set_immutable', () => {
    const obj = { a: { b: 1, c: [1, 2] }, d: 'x', e: null, f: undefined, g: {} }
    expect(flatten(obj)).toEqual({ 'a.b': 1, 'a.c': [1, 2], d: 'x', e: null, f: undefined })
    expect(getPath(obj, 'a.b')).toBe(1)
    expect(getPath(obj, 'a.c')).toEqual([1, 2])
    expect(getPath(obj, 'a.c.1')).toBe(2)
    expect(getPath(obj, 'missing.deep')).toBeUndefined()
    expect(getPath(obj, 'a.toString')).toBeUndefined()

    const next = setPath(obj, 'a.b', 2)
    expect(next).not.toBe(obj)
    expect(next.a).not.toBe(obj.a)
    expect(next.a.c).toBe(obj.a.c)
    expect(obj.a.b).toBe(1)
    expect(getPath(next, 'a.b')).toBe(2)
    const created = setPath({}, 'x.y.z', 1)
    expect(created).toEqual({ x: { y: { z: 1 } } })
    expect(flatten(new Date(0))).toEqual({})
    expect(flatten({ when: new Date(0) })).toEqual({ when: new Date(0) })
  })

  it('paths_reject_prototype_keys', () => {
    for (const bad of [
      '__proto__',
      'a.__proto__',
      'constructor.prototype.x',
      'a.prototype',
      '',
      'a..b',
    ]) {
      expect(() => getPath({}, bad), bad).toThrow(expect.objectContaining({ code: 'invalid_path' }))
      expect(() => setPath({}, bad, 1), bad).toThrow(
        expect.objectContaining({ code: 'invalid_path' }),
      )
    }
    const parsed: unknown = JSON.parse('{"ok":1,"__proto__":{"x":1},"a":{"constructor":{"y":2}}}')
    const { values, rejected } = flattenWithRejected(parsed)
    expect(values).toEqual({ ok: 1 })
    expect(rejected.sort()).toEqual(['__proto__', 'a.constructor'])
    expect(flatten(parsed)).toEqual({ ok: 1 })
    expect(flattenWithRejected({ 'constructor.prototype.x': 1 }).rejected).toEqual([
      'constructor.prototype.x',
    ])
    expect(({} as Record<string, unknown>).x).toBeUndefined()
    expect(({} as Record<string, unknown>).y).toBeUndefined()
  })
})
