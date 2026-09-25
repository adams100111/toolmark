import { describe, expect, it, vi } from 'vitest'
import { ok } from '@toolmark/core'
import { createTestRegistry } from './helpers/create-test-registry.js'

function undoable(
  tm: ReturnType<typeof createTestRegistry>,
  restore = vi.fn(() => ok({ changes: [] })),
) {
  const callIds: string[] = []
  tm.register({
    name: 'edit',
    description: 'd',
    run: (_i, ctx) => {
      callIds.push(ctx.callId)
      ctx.registerUndo(restore)
      return ok(ctx.callId)
    },
  })
  return { callIds, restore }
}

describe('undo', () => {
  it('undo_runs_once_then_unavailable', async () => {
    const tm = createTestRegistry()
    const { callIds, restore } = undoable(tm)
    await tm.call('edit', {}, { caller: 'inapp' })
    expect(await tm.undo(callIds[0]!)).toEqual(ok({ changes: [] }))
    expect(restore).toHaveBeenCalledTimes(1)
    expect(await tm.undo(callIds[0]!)).toMatchObject({
      status: 'refused',
      code: 'undo_unavailable',
    })
    expect(await tm.undo('never')).toMatchObject({ code: 'undo_unavailable' })
  })

  it('undo_store_capped', async () => {
    const tm = createTestRegistry()
    const { callIds } = undoable(tm)
    for (let i = 0; i < 101; i++) await tm.call('edit', {}, { caller: 'inapp' })
    expect(await tm.undo(callIds[0]!)).toMatchObject({ code: 'undo_unavailable' })
    expect((await tm.undo(callIds[1]!)).status).toBe('ok')
    expect((await tm.undo(callIds[100]!)).status).toBe('ok')
  })

  it('undo_unavailable_after_registration_disposed', async () => {
    const tm = createTestRegistry()
    const restore = vi.fn(() => ok({ changes: [] }))
    const callIds: string[] = []
    const reg = tm.register({
      name: 'edit',
      description: 'd',
      run: (_i, ctx) => {
        callIds.push(ctx.callId)
        ctx.registerUndo(restore)
        return ok(1)
      },
    })
    await tm.call('edit', {}, { caller: 'inapp' })
    reg.dispose()
    expect(await tm.undo(callIds[0]!)).toMatchObject({ code: 'undo_unavailable' })
    expect(restore).not.toHaveBeenCalled()
  })

  it('throwing_restore_becomes_error', async () => {
    const tm = createTestRegistry({ dev: false })
    const { callIds } = undoable(
      tm,
      vi.fn(() => {
        throw new Error('x')
      }),
    )
    await tm.call('edit', {}, { caller: 'inapp' })
    expect(await tm.undo(callIds[0]!)).toEqual({ status: 'error', message: 'Tool failed' })
  })
})
