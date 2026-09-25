import { describe, expect, it } from 'vitest'
import { ok, ToolmarkError, type ToolmarkErrorEvent } from '@toolmark/core'
import { createTestRegistry } from './helpers/create-test-registry.js'

describe('call pipeline: files', () => {
  it('custom_tool_file_rejection_is_refused', async () => {
    const tm = createTestRegistry({
      files: { resolve: () => Promise.resolve(new File(['0123456789'], 'a.txt')), maxBytes: 4 },
    })
    const errors: ToolmarkErrorEvent[] = []
    tm.events.on('error', (e) => errors.push(e))
    tm.register({
      name: 'upload',
      description: 'd',
      run: async (_i, ctx) => {
        await ctx.files.resolve({ ref: 'a' })
        return ok(null)
      },
    })
    expect(await tm.call('upload', {}, { caller: 'inapp' })).toEqual({
      status: 'refused',
      code: 'file_rejected',
      message: 'File rejected: exceeds the 4-byte limit',
    })
    // A `file_rejected` thrown by the tool itself is refused with its message too.
    tm.register({
      name: 'own',
      description: 'd',
      run: () => {
        throw new ToolmarkError('file_rejected', 'Only one attachment per message')
      },
    })
    expect(await tm.call('own', {}, { caller: 'inapp' })).toEqual({
      status: 'refused',
      code: 'file_rejected',
      message: 'Only one attachment per message',
    })
    expect(errors).toEqual([])
    // Any other throw is still `error` "Tool failed" with a `tool_threw` event.
    tm.register({
      name: 'boom',
      description: 'd',
      run: () => {
        throw new ToolmarkError('other', 'x')
      },
    })
    expect(await tm.call('boom', {}, { caller: 'inapp' })).toEqual({
      status: 'error',
      message: 'Tool failed',
    })
    expect(errors.map((e) => e.code)).toEqual(['tool_threw'])
  })

  it('ref_without_resolver_propagated_is_refused', async () => {
    const tm = createTestRegistry()
    tm.register({
      name: 'x',
      description: 'd',
      run: async (_i, ctx) => {
        await ctx.files.resolve({ ref: 'x' })
        return ok(null)
      },
    })
    expect(await tm.call('x', {}, { caller: 'inapp' })).toEqual({
      status: 'refused',
      code: 'file_rejected',
      message: 'File references are not configured',
    })
  })
})
