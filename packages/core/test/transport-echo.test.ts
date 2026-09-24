import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PageToAgentMessage } from '@toolmark/core/protocol'
import { echoTransport, type EchoLike } from '@toolmark/core/bridge/echo'

const msg: PageToAgentMessage = { protocol: 1, type: 'changed', clientId: 'k7', rev: 3 }

function fakeEcho() {
  const listeners = new Map<string, (payload: unknown) => void>()
  const channel = {
    listen: vi.fn((event: string, cb: (payload: unknown) => void) => {
      listeners.set(event, cb)
      return channel
    }),
    stopListening: vi.fn((event: string) => {
      listeners.delete(event)
      return channel
    }),
  }
  const echo = { private: vi.fn((_name: string) => channel) } satisfies EchoLike
  return {
    echo,
    channel,
    emit(event: string, payload: unknown) {
      listeners.get(event)?.(payload)
    },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('echoTransport', () => {
  it('echo_listens_on_private_channel_and_posts', async () => {
    const e = fakeEcho()
    const fetchMock = vi.fn((_url: string, _init: RequestInit) =>
      Promise.resolve(new Response(null, { status: 204 })),
    )
    vi.stubGlobal('fetch', fetchMock)
    const t = echoTransport({
      echo: e.echo,
      channel: 'toolmark.user.1.conv.2',
      postUrl: '/toolmark/bridge',
      headers: () => ({ 'X-CSRF-TOKEN': 'tok' }),
    })
    const got: unknown[] = []
    t.onMessage((m) => got.push(m))
    expect(e.echo.private).toHaveBeenCalledWith('toolmark.user.1.conv.2')
    expect(e.channel.listen).toHaveBeenCalledWith('.toolmark.message', expect.any(Function))
    e.emit('.toolmark.message', { protocol: 1, type: 'cancel', clientId: 'k7', id: 'c1' })
    expect(got).toEqual([{ protocol: 1, type: 'cancel', clientId: 'k7', id: 'c1' }])

    await t.send(msg)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/toolmark/bridge')
    expect(init).toEqual({
      method: 'POST',
      headers: {
        'X-CSRF-TOKEN': 'tok',
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: JSON.stringify(msg),
      credentials: 'same-origin',
    })

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 419 }))
    await expect(t.send(msg)).rejects.toThrow(/419/)
  })

  it('echo_accepts_wrapped_payload', () => {
    const e = fakeEcho()
    const t = echoTransport({ echo: e.echo, channel: 'c', event: 'Custom', postUrl: '/p' })
    const got: unknown[] = []
    t.onMessage((m) => got.push(m))
    const inner = { protocol: 1, type: 'cancel', clientId: 'k7', id: 'c1' }
    e.emit('Custom', { message: inner })
    e.emit('Custom', inner)
    expect(got).toEqual([inner, inner])
  })

  it('echo_close_stops_listening', () => {
    const e = fakeEcho()
    const t = echoTransport({ echo: e.echo, channel: 'c', postUrl: '/p' })
    const handler = vi.fn()
    t.onMessage(handler)
    t.close?.()
    expect(e.channel.stopListening).toHaveBeenCalledWith('.toolmark.message')
    e.emit('.toolmark.message', { protocol: 1 })
    expect(handler).not.toHaveBeenCalled()
  })
})
