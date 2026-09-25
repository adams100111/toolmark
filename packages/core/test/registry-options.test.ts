import { describe, expect, it, vi } from 'vitest'
import { ok, type ToolmarkErrorEvent, type ToolmarkOptions } from '@toolmark/core'
import { createTestRegistry } from './helpers/create-test-registry.js'
import { tool } from './helpers/tools.js'

describe('registry options', () => {
  it('policy_override_replaces_defaults', async () => {
    const tm = createTestRegistry({
      confirm: () => Promise.resolve({ approved: true }),
      policy: { webmcp: { allow: ['readOnly'] } },
    })
    tm.register(tool('plain'))
    tm.register(tool('read', { readOnly: true }))
    expect(tm.manifest({ caller: 'webmcp' }).tools.map((t) => t.name)).toEqual(['read'])
    expect(tm.manifest({ caller: 'mcp' }).tools.map((t) => t.name)).toEqual(['plain', 'read'])
    expect((await tm.call('plain', {}, { caller: 'webmcp' })).status).toBe('refused')

    const wide = createTestRegistry({
      confirm: () => Promise.resolve({ approved: true }),
      policy: { webmcp: { allow: ['readOnly', 'default', 'consequential', 'destructive'] } },
    })
    wide.register(tool('drop', { destructive: true }))
    expect(wide.manifest({ caller: 'webmcp' }).tools.map((t) => t.name)).toEqual(['drop'])
    expect(wide.manifest({ caller: 'mcp' }).tools).toEqual([])
  })

  it('policy_tool_name_deny', () => {
    const tm = createTestRegistry({
      policy: { inapp: { tools: { allow: ['admin.list', 'users.*'], deny: ['admin.*'] } } },
    })
    const admin = tm.scope('admin')
    const users = tm.scope('users')
    tm.register(tool('list'), { scope: admin })
    tm.register(tool('find'), { scope: users })
    tm.register(tool('other'))
    expect(tm.manifest({ caller: 'inapp' }).tools.map((t) => t.name)).toEqual(['users.find'])
    // `allow` omitted keeps the default hint classes.
    expect(tm.manifest({ caller: 'test' }).tools.map((t) => t.name)).toEqual([
      'admin.list',
      'other',
      'users.find',
    ])
  })

  it('no_caller_manifest_unfiltered', () => {
    const tm = createTestRegistry({ policy: { inapp: { tools: { deny: ['x'] } } } })
    tm.register(tool('x'))
    tm.register(tool('drop', { destructive: true }))
    expect(tm.manifest().tools.map((t) => t.name)).toEqual(['drop', 'x'])
    expect(tm.describe('drop')).toBeDefined()
    expect(tm.manifest({ caller: 'inapp' }).tools.map((t) => t.name)).toEqual(['drop'])
    expect(tm.manifest({ caller: 'webmcp' }).tools.map((t) => t.name)).toEqual(['x'])
  })

  it('invalid_confirm_mode_rejected', () => {
    const bad = { webmcp: 'deferred' } as unknown as ToolmarkOptions['confirmMode']
    expect(() => createTestRegistry({ confirmMode: bad! })).toThrow(
      expect.objectContaining({ code: 'invalid_confirm_mode' }),
    )
    const onError = vi.fn()
    const tm = createTestRegistry({
      dev: false,
      confirmMode: { human: 'inline' } as unknown as NonNullable<ToolmarkOptions['confirmMode']>,
      onError,
    })
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'invalid_confirm_mode' }))
    expect(tm.manifest().tools).toEqual([])
    const tm2 = createTestRegistry({ dev: false, confirmMode: bad!, onError })
    // The invalid value is ignored: webmcp stays inline (no handler → consequential hidden).
    tm2.register(tool('save', { consequential: true }))
    expect(tm2.manifest({ caller: 'webmcp' }).tools).toEqual([])
  })

  it('policy_human_rejected', () => {
    const human = { human: { allow: ['readOnly'] } } as unknown as ToolmarkOptions['policy']
    expect(() => createTestRegistry({ policy: human! })).toThrow(
      expect.objectContaining({ code: 'invalid_policy' }),
    )
    const unknownClass = {
      inapp: { allow: ['everything'] },
    } as unknown as ToolmarkOptions['policy']
    expect(() => createTestRegistry({ policy: unknownClass! })).toThrow(
      expect.objectContaining({ code: 'invalid_policy' }),
    )
    const onError = vi.fn()
    const tm = createTestRegistry({ dev: false, policy: unknownClass!, onError })
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'invalid_policy' }))
    // Entry ignored: inapp keeps its defaults.
    tm.register(tool('x'))
    expect(tm.manifest({ caller: 'inapp' }).tools.map((t) => t.name)).toEqual(['x'])
  })

  it('on_error_receives_error_events', () => {
    const order: string[] = []
    const tm = createTestRegistry({
      dev: false,
      onError: (e) => order.push(`onError:${e.code}`),
    })
    tm.events.on('error', (e) => order.push(`listener:${e.code}`))
    tm.register(tool('x'))
    tm.register(tool('x'))
    expect(order).toEqual(['listener:duplicate_name', 'onError:duplicate_name'])
  })

  it('throwing_listener_does_not_break_call', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const errs: ToolmarkErrorEvent[] = []
    const tm = createTestRegistry({
      dev: false,
      onError: () => {
        throw new Error('onError boom')
      },
    })
    tm.events.on('call', () => {
      throw new Error('call listener boom')
    })
    tm.events.on('result', () => {
      throw new Error('result listener boom')
    })
    tm.events.on('error', (e) => errs.push(e))
    tm.register({ name: 'x', description: 'd', run: () => ok(42) })
    expect(await tm.call('x', {}, { caller: 'inapp' })).toEqual({ status: 'ok', data: 42 })
    tm.register(tool('x'))
    expect(errs.map((e) => e.code)).toEqual(['duplicate_name'])
    expect(consoleError).toHaveBeenCalledTimes(3)
    consoleError.mockRestore()
  })
})
