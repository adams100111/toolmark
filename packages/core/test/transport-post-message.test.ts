import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PageToAgentMessage } from '@toolmark/core/protocol'
import { postMessageTransport } from '@toolmark/core/bridge/post-message'

const msg: PageToAgentMessage = { protocol: 1, type: 'changed', clientId: 'k7', rev: 3 }
const inbound = { protocol: 1, type: 'cancel', clientId: 'k7', id: 'c1' }

let hub: EventTarget

beforeEach(() => {
  hub = new EventTarget()
  vi.stubGlobal('addEventListener', hub.addEventListener.bind(hub))
  vi.stubGlobal('removeEventListener', hub.removeEventListener.bind(hub))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function fakeWindow() {
  const postMessage = vi.fn()
  const target = { postMessage } as unknown as Window
  return Object.assign(target, { posted: postMessage })
}

function dispatch(data: unknown, origin: string, source: unknown) {
  hub.dispatchEvent(Object.assign(new Event('message'), { data, origin, source }))
}

describe('postMessageTransport', () => {
  it('post_message_rejects_star_origin', () => {
    const target = fakeWindow()
    expect(() =>
      postMessageTransport({ target, targetOrigin: '*', allowedOrigins: ['https://a.test'] }),
    ).toThrow(new TypeError('targetOrigin must be an exact origin'))
    expect(() =>
      postMessageTransport({ target, targetOrigin: 'https://a.test', allowedOrigins: ['*'] }),
    ).toThrow(TypeError)
    expect(() =>
      postMessageTransport({ target, targetOrigin: 'https://a.test', allowedOrigins: [] }),
    ).toThrow(TypeError)
  })

  it('post_message_rejects_null_origin', () => {
    const target = fakeWindow()
    expect(() =>
      postMessageTransport({
        target,
        targetOrigin: 'https://a.test',
        allowedOrigins: ['https://a.test', 'null'],
      }),
    ).toThrow(TypeError)
  })

  it('post_message_filters_origin_and_source', () => {
    const target = fakeWindow()
    const other = fakeWindow()
    const t = postMessageTransport({
      target,
      targetOrigin: 'https://agent.test',
      allowedOrigins: ['https://agent.test'],
    })
    const got: unknown[] = []
    t.onMessage((m) => got.push(m))
    dispatch({ toolmark: 1, message: inbound }, 'https://evil.test', target) // wrong origin
    dispatch({ toolmark: 1, message: inbound }, 'https://agent.test', other) // wrong source
    dispatch({ toolmark: 1, message: inbound }, 'https://agent.test', target) // accepted
    expect(got).toEqual([inbound])

    void t.send(msg)
    expect(target.posted).toHaveBeenCalledWith({ toolmark: 1, message: msg }, 'https://agent.test')

    t.close?.()
    dispatch({ toolmark: 1, message: inbound }, 'https://agent.test', target)
    expect(got).toHaveLength(1)
  })

  it('post_message_ignores_foreign_messages', () => {
    const target = fakeWindow()
    const t = postMessageTransport({
      target,
      targetOrigin: 'https://agent.test',
      allowedOrigins: ['https://agent.test'],
    })
    const handler = vi.fn()
    t.onMessage(handler)
    dispatch(inbound, 'https://agent.test', target) // no envelope
    dispatch({ toolmark: 2, message: inbound }, 'https://agent.test', target)
    dispatch('text', 'https://agent.test', target)
    dispatch(null, 'https://agent.test', target)
    expect(handler).not.toHaveBeenCalled()
  })
})
