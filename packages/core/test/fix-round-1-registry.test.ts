import { describe, expect, it, vi } from 'vitest'
import { ok, type Scope, type ToolDefinition, type ToolmarkErrorEvent } from '@toolmark/core'
import { createTestRegistry } from './helpers/create-test-registry.js'
import { tool } from './helpers/tools.js'

function errorsOf(tm: ReturnType<typeof createTestRegistry>): ToolmarkErrorEvent[] {
  const out: ToolmarkErrorEvent[] = []
  tm.events.on('error', (e) => out.push(e))
  return out
}

describe('fix round 1 — registry', () => {
  it('confirm_rule_ignores_tools_no_caller_may_use', () => {
    const policy = { inapp: { tools: { deny: ['drop'] } }, test: { tools: { deny: ['drop'] } } }
    const dev = createTestRegistry({ policy })
    expect(() => dev.register(tool('drop', { destructive: true }))).not.toThrow()
    expect(dev.manifest({ caller: 'inapp' }).tools).toEqual([])
    expect(dev.manifest().tools.map((t) => t.name)).toEqual(['drop'])
    const prod = createTestRegistry({ dev: false, policy })
    const errs = errorsOf(prod)
    prod.register(tool('drop', { destructive: true }))
    expect(errs).toEqual([])
  })

  it('dispose_removes_abort_listener', () => {
    const tm = createTestRegistry()
    const ac = new AbortController()
    const add = vi.spyOn(ac.signal, 'addEventListener')
    const remove = vi.spyOn(ac.signal, 'removeEventListener')
    const reg = tm.register(tool('x'), { signal: ac.signal })
    expect(add).toHaveBeenCalledTimes(1)
    reg.dispose()
    expect(remove).toHaveBeenCalledWith('abort', add.mock.calls[0]![1])
  })

  it('llm_name_collision_is_duplicate_name', () => {
    const dev = createTestRegistry()
    dev.register(tool('x.y'))
    expect(() => dev.register(tool('x__y'))).toThrow(
      expect.objectContaining({ code: 'duplicate_name' }),
    )
    const prod = createTestRegistry({ dev: false })
    const errs = errorsOf(prod)
    const first = prod.register(tool('x__y'))
    prod.register(tool('x.y'))
    expect(errs.map((e) => e.code)).toEqual(['duplicate_name'])
    expect(prod.manifest().tools.map((t) => t.name)).toEqual(['x__y'])
    first.dispose()
    prod.register(tool('x.y'))
    expect(prod.manifest().tools.map((t) => t.name)).toEqual(['x.y'])
  })

  it('foreign_or_fake_scope_is_invalid_scope', () => {
    const dev = createTestRegistry()
    const other = createTestRegistry().scope('s')
    const fake = { path: 's', disposed: false } as unknown as Scope
    for (const scope of [other, fake]) {
      expect(() => dev.register(tool('x'), { scope })).toThrow(
        expect.objectContaining({ code: 'invalid_scope' }),
      )
    }
    const prod = createTestRegistry({ dev: false })
    const errs = errorsOf(prod)
    prod.register(tool('x'), { scope: other })
    prod.register(tool('y'), { scope: fake })
    expect(errs.map((e) => e.code)).toEqual(['invalid_scope', 'invalid_scope'])
    expect(prod.manifest().tools).toEqual([])
  })

  it('input_without_standard_is_schema_conversion_failure', async () => {
    const bogus = {
      name: 'x',
      description: 'd',
      input: {},
      run: () => ok(1),
    } as unknown as ToolDefinition
    const dev = createTestRegistry()
    expect(() => dev.register(bogus)).toThrow(
      expect.objectContaining({ code: 'schema_conversion_failed' }),
    )
    const prod = createTestRegistry({ dev: false })
    const errs = errorsOf(prod)
    expect(() => prod.register(bogus)).not.toThrow()
    expect(errs.map((e) => e.code)).toEqual(['schema_conversion_failed'])
    expect(await prod.call('x', {}, { caller: 'inapp' })).toEqual({
      status: 'error',
      message: 'Tool failed',
    })
  })
})
