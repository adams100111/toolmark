import { describe, expect, it } from 'vitest'
import { ok } from '@toolmark/core'
import { createTestRegistry } from './helpers/create-test-registry.js'
import { deferred, settle } from './helpers/deferred.js'

describe('scope queue', () => {
  it('scope_calls_serialized', async () => {
    const tm = createTestRegistry()
    const log: string[] = []
    const gates = { a: deferred(), b: deferred(), c: deferred() }
    const slow = (name: 'a' | 'b' | 'c') => ({
      name,
      description: 'd',
      run: async () => {
        log.push(`${name}:start`)
        await gates[name].promise
        log.push(`${name}:end`)
        return ok(name)
      },
    })
    const s1 = tm.scope('one')
    const s2 = tm.scope('two')
    tm.register(slow('a'), { scope: s1 })
    tm.register(slow('b'), { scope: s1 })
    tm.register(slow('c'), { scope: s2 })
    const pa = tm.call('one.a', {}, { caller: 'inapp' })
    const pb = tm.call('one.b', {}, { caller: 'inapp' })
    const pc = tm.call('two.c', {}, { caller: 'inapp' })
    await settle()
    expect(log).toEqual(['a:start', 'c:start'])
    gates.b.resolve()
    gates.c.resolve()
    await settle()
    expect(log).toEqual(['a:start', 'c:start', 'c:end'])
    gates.a.resolve()
    await Promise.all([pa, pb, pc])
    expect(log).toEqual(['a:start', 'c:start', 'c:end', 'a:end', 'b:start', 'b:end'])
  })

  it('queue_limit_busy', async () => {
    const tm = createTestRegistry()
    const gate = deferred()
    tm.register({
      name: 'slow',
      description: 'd',
      run: async () => {
        await gate.promise
        return ok(1)
      },
    })
    const calls = Array.from({ length: 32 }, () => tm.call('slow', {}, { caller: 'inapp' }))
    await settle()
    expect(await tm.call('slow', {}, { caller: 'inapp' })).toMatchObject({
      status: 'refused',
      code: 'busy',
    })
    gate.resolve()
    const results = await Promise.all(calls)
    expect(results.every((r) => r.status === 'ok')).toBe(true)
    expect((await tm.call('slow', {}, { caller: 'inapp' })).status).toBe('ok')
  })

  it('aborted_queued_call_resolves_immediately', async () => {
    const tm = createTestRegistry()
    const gate = deferred()
    tm.register({
      name: 'slow',
      description: 'd',
      run: async () => {
        await gate.promise
        return ok(1)
      },
    })
    const first = tm.call('slow', {}, { caller: 'inapp' })
    const ac = new AbortController()
    const second = tm.call('slow', {}, { caller: 'inapp', signal: ac.signal })
    await settle()
    ac.abort()
    expect(await second).toEqual({ status: 'cancelled', by: 'signal' })
    gate.resolve()
    expect(await first).toEqual(ok(1))
  })
})
