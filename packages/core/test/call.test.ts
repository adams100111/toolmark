import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { ok, type ToolContext, type ToolmarkErrorEvent, type ToolResult } from '@toolmark/core'
import { createTestRegistry } from './helpers/create-test-registry.js'
import { deferred, settle } from './helpers/deferred.js'
import { flushMicrotasks, tool } from './helpers/tools.js'

function errorsOf(tm: ReturnType<typeof createTestRegistry>): ToolmarkErrorEvent[] {
  const out: ToolmarkErrorEvent[] = []
  tm.events.on('error', (e) => out.push(e))
  return out
}

afterEach(() => {
  vi.useRealTimers()
})

describe('call pipeline', () => {
  it('unknown_tool_refused_with_rev', async () => {
    const tm = createTestRegistry()
    tm.register(tool('x'))
    expect(await tm.call('nope', {}, { caller: 'inapp' })).toEqual({
      status: 'refused',
      code: 'unknown_tool',
      message: expect.any(String) as string,
      rev: 1,
    })
  })

  it('stale_rev_missing_tool_refused_stale', async () => {
    const tm = createTestRegistry()
    const r = tm.register(tool('x'))
    await flushMicrotasks()
    r.dispose()
    expect(await tm.call('x', {}, { caller: 'inapp', rev: 1 })).toMatchObject({
      status: 'refused',
      code: 'stale',
      rev: 2,
    })
    expect(await tm.call('x', {}, { caller: 'inapp', rev: 2 })).toMatchObject({
      code: 'unknown_tool',
      rev: 2,
    })
  })

  it('stale_rev_existing_tool_runs', async () => {
    const tm = createTestRegistry()
    tm.register(tool('x'))
    expect(await tm.call('x', {}, { caller: 'inapp', rev: 99 })).toEqual(ok({ name: 'x' }))
  })

  it('invalid_input_returns_issues', async () => {
    const tm = createTestRegistry()
    const run = vi.fn(() => ok(1))
    tm.register({ name: 'x', description: 'd', input: z.object({ n: z.number() }), run })
    const r = await tm.call('x', { n: 'no' }, { caller: 'inapp' })
    expect(r.status).toBe('invalid')
    if (r.status === 'invalid') expect(r.issues[0]!.path).toBe('n')
    expect(run).not.toHaveBeenCalled()
  })

  it('emits_call_and_result_events', async () => {
    const tm = createTestRegistry()
    tm.register(tool('x'))
    const seen: string[] = []
    tm.events.on('call', (e) => seen.push(`call:${e.tool}:${e.caller}`))
    tm.events.on('result', (e) => {
      seen.push(`result:${e.result.status}`)
      expect(e.durationMs).toBeGreaterThanOrEqual(0)
    })
    await tm.call('x', { a: 1 }, { caller: 'test' })
    expect(seen).toEqual(['call:x:test', 'result:ok'])
  })

  it('human_caller_skips_confirmation', async () => {
    const tm = createTestRegistry()
    tm.register(tool('save', { consequential: true }))
    tm.register(tool('drop', { destructive: true }))
    expect((await tm.call('save', {}, { caller: 'human' })).status).toBe('ok')
    expect((await tm.call('drop', {}, { caller: 'human' })).status).toBe('ok')
  })

  it('inline_caller_without_handler_not_allowed', async () => {
    const tm = createTestRegistry()
    const run = vi.fn(() => ok(1))
    tm.register({ name: 'save', description: 'd', hints: { consequential: true }, run })
    expect(await tm.call('save', {}, { caller: 'webmcp' })).toMatchObject({
      status: 'refused',
      code: 'not_allowed',
    })
    expect(run).not.toHaveBeenCalled()
  })

  it('thrown_error_becomes_error_result_and_event', async () => {
    const tm = createTestRegistry({ dev: false })
    const errs = errorsOf(tm)
    const boom = new Error('secret details')
    tm.register({
      name: 'x',
      description: 'd',
      run: () => {
        throw boom
      },
    })
    expect(await tm.call('x', {}, { caller: 'inapp' })).toEqual({
      status: 'error',
      message: 'Tool failed',
    })
    expect(errs).toEqual([expect.objectContaining({ code: 'tool_threw', tool: 'x', cause: boom })])
    tm.register({ name: 'y', description: 'd', run: () => Promise.reject(boom) })
    expect((await tm.call('y', {}, { caller: 'inapp' })).status).toBe('error')
  })

  it('output_invalid_dev_event_result_kept', async () => {
    const tm = createTestRegistry()
    const errs = errorsOf(tm)
    tm.register({
      name: 'x',
      description: 'd',
      output: z.object({ id: z.number() }),
      run: () => ok({ id: 'nope' }) as unknown as ToolResult<{ id: number }>,
    })
    expect(await tm.call('x', {}, { caller: 'inapp' })).toEqual(ok({ id: 'nope' }))
    expect(errs.map((e) => e.code)).toEqual(['output_invalid'])
  })

  it('output_not_validated_in_prod', async () => {
    const tm = createTestRegistry({ dev: false })
    const errs = errorsOf(tm)
    const validate = vi.fn()
    tm.register({
      name: 'x',
      description: 'd',
      output: { '~standard': { version: 1, vendor: 'spy', validate } },
      run: () => ok({ id: 'nope' }),
    })
    expect(await tm.call('x', {}, { caller: 'inapp' })).toEqual(ok({ id: 'nope' }))
    expect(validate).not.toHaveBeenCalled()
    expect(errs).toEqual([])
  })

  it('ctx_files_not_configured', async () => {
    const tm = createTestRegistry()
    let caught: unknown
    tm.register({
      name: 'x',
      description: 'd',
      run: async (_i, ctx) => {
        try {
          await ctx.files.resolve({ ref: 'x' })
        } catch (e) {
          caught = e
        }
        return ok(1)
      },
    })
    await tm.call('x', {}, { caller: 'inapp' })
    expect(caught).toMatchObject({ name: 'ToolmarkError', code: 'files_not_configured' })
  })

  it('abort_before_run_cancelled_signal', async () => {
    const tm = createTestRegistry()
    const run = vi.fn(() => ok(1))
    tm.register({ name: 'x', description: 'd', run })
    const r = await tm.call('x', {}, { caller: 'inapp', signal: AbortSignal.abort() })
    expect(r).toEqual({ status: 'cancelled', by: 'signal' })
    expect(run).not.toHaveBeenCalled()
  })

  it('abort_during_run_returns_tool_result_within_grace', async () => {
    const tm = createTestRegistry()
    tm.register({
      name: 'x',
      description: 'd',
      run: (_i, ctx: ToolContext) =>
        new Promise<ToolResult<unknown>>((resolve) => {
          ctx.signal.addEventListener('abort', () => resolve(ok('stopped')))
        }),
    })
    const ac = new AbortController()
    const p = tm.call('x', {}, { caller: 'inapp', signal: ac.signal })
    await settle()
    ac.abort()
    expect(await p).toEqual(ok('stopped'))
  })

  it('abort_releases_queue_after_grace', async () => {
    vi.useFakeTimers()
    const tm = createTestRegistry({ abortGraceMs: 100 })
    const errs = errorsOf(tm)
    const s = tm.scope('s')
    const stuck = deferred<ToolResult<unknown>>()
    let sawAbort = false
    tm.register(
      {
        name: 'stubborn',
        description: 'ignores its signal',
        run: (_i, ctx) => {
          ctx.signal.addEventListener('abort', () => (sawAbort = true))
          return stuck.promise
        },
      },
      { scope: s },
    )
    tm.register(tool('next'), { scope: s })
    const ac = new AbortController()
    const first = tm.call('s.stubborn', {}, { caller: 'inapp', signal: ac.signal })
    const second = tm.call('s.next', {}, { caller: 'inapp' })
    await vi.advanceTimersByTimeAsync(0)
    ac.abort()
    await vi.advanceTimersByTimeAsync(99)
    let firstDone = false
    void first.then(() => (firstDone = true))
    await vi.advanceTimersByTimeAsync(0)
    expect(firstDone).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await first).toEqual({ status: 'cancelled', by: 'signal' })
    expect(sawAbort).toBe(true)
    expect(await second).toEqual(ok({ name: 'next' }))
    stuck.resolve(ok('late'))
    await vi.advanceTimersByTimeAsync(0)
    expect(errs.map((e) => e.code)).toEqual(['late_result'])
  })

  it('dispose_during_call_resolves', async () => {
    const tm = createTestRegistry()
    const s = tm.scope('s')
    const gate = deferred()
    tm.register(
      {
        name: 'slow',
        description: 'd',
        run: async () => {
          await gate.promise
          return ok('done')
        },
      },
      { scope: s },
    )
    tm.register(tool('queued'), { scope: s })
    const first = tm.call('s.slow', {}, { caller: 'inapp' })
    const second = tm.call('s.queued', {}, { caller: 'inapp' })
    await settle()
    s.dispose()
    gate.resolve()
    expect(await first).toEqual(ok('done'))
    expect(await second).toMatchObject({ status: 'refused', code: 'unknown_tool' })
  })
})
