import { describe, expect, it, vi } from 'vitest'
import { createConfirmQueue, ok, type ConfirmRequest } from '@toolmark/core'
import { createTestRegistry } from './helpers/create-test-registry.js'
import { settle } from './helpers/deferred.js'

function req(id: string): ConfirmRequest {
  return { confirmId: id, tool: 't', caller: 'webmcp', input: {}, hints: {}, summary: id }
}

describe('createConfirmQueue', () => {
  it('confirm_queue_fifo_approve_reject', async () => {
    const q = createConfirmQueue()
    const onChange = vi.fn()
    const off = q.subscribe(onChange)
    expect(q.getPending()).toBeNull()
    const a = q.handler(req('a'))
    const b = q.handler(req('b'))
    const c = q.handler(req('c'))
    expect(onChange).toHaveBeenCalledTimes(3)
    expect(q.getPending()?.confirmId).toBe('a')
    q.approve()
    expect(await a).toEqual({ approved: true })
    expect(q.getPending()?.confirmId).toBe('b')
    q.reject('nope')
    expect(await b).toEqual({ approved: false, reason: 'nope' })
    q.approve({ edited: true })
    expect(await c).toEqual({ approved: true, input: { edited: true } })
    expect(q.getPending()).toBeNull()
    expect(onChange).toHaveBeenCalledTimes(6)
    off()
    q.approve()
    void q.handler(req('d'))
    expect(onChange).toHaveBeenCalledTimes(6)
  })

  it('aborted_call_removes_request', async () => {
    const q = createConfirmQueue()
    const tm = createTestRegistry({ confirm: q.handler })
    tm.register({
      name: 'save',
      description: 'd',
      hints: { consequential: true },
      run: () => ok(1),
    })
    const ac = new AbortController()
    const call = tm.call('save', {}, { caller: 'webmcp', signal: ac.signal })
    await settle()
    expect(q.getPending()?.tool).toBe('save')
    ac.abort()
    expect(await call).toEqual({ status: 'cancelled', by: 'signal' })
    expect(q.getPending()).toBeNull()

    const second = tm.call('save', {}, { caller: 'mcp' })
    await settle()
    q.approve()
    expect(await second).toEqual(ok(1))
  })
})
