import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PageToAgentMessage } from '@toolmark/core/protocol'
import { websocketTransport } from '@toolmark/core/bridge/websocket'

/** Fake WebSocket: the test drives the server side (`open`, `serverSend`, `fail`, `serverClose`). */
class FakeWebSocket extends EventTarget {
  static instances: FakeWebSocket[] = []
  readyState = 0
  readonly sent: string[] = []
  constructor(
    readonly url: string,
    readonly protocols?: string | string[],
  ) {
    super()
    FakeWebSocket.instances.push(this)
  }
  send(text: string): void {
    if (this.readyState !== 1) throw new Error('not open')
    this.sent.push(text)
  }
  close(code = 1000): void {
    if (this.readyState === 3) return
    this.readyState = 3
    this.dispatchEvent(Object.assign(new Event('close'), { code }))
  }
  open(): void {
    this.readyState = 1
    this.dispatchEvent(new Event('open'))
  }
  serverSend(data: unknown): void {
    this.dispatchEvent(Object.assign(new Event('message'), { data }))
  }
  fail(): void {
    this.dispatchEvent(new Event('error'))
    this.close(1006)
  }
  serverClose(code: number): void {
    this.close(code)
  }
}

const sock = (i: number): FakeWebSocket => FakeWebSocket.instances[i]!
const m = (rev: number): PageToAgentMessage => ({
  protocol: 1,
  type: 'changed',
  clientId: 'k',
  rev,
})
const flush = () => vi.advanceTimersByTimeAsync(0)

/** Captures a promise's settlement without unhandled rejections. */
function track(p: Promise<void>) {
  const state: { status: 'pending' | 'resolved' | 'rejected'; error?: Error } = {
    status: 'pending',
  }
  p.then(
    () => (state.status = 'resolved'),
    (e: Error) => {
      state.status = 'rejected'
      state.error = e
    },
  )
  return state
}

beforeEach(() => {
  FakeWebSocket.instances = []
  vi.stubGlobal('WebSocket', FakeWebSocket)
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('websocketTransport', () => {
  it('websocket_reconnects_with_backoff_and_flushes', async () => {
    const t = websocketTransport({ url: 'wss://agent.test/ws', protocols: 'toolmark.v1' })
    const first = track(t.send(m(1)) as Promise<void>)
    expect(sock(0).url).toBe('wss://agent.test/ws')
    expect(sock(0).protocols).toBe('toolmark.v1')
    for (const [i, delay] of [
      [0, 500],
      [1, 1000],
      [2, 2000],
      [3, 4000],
    ] as const) {
      sock(i).fail()
      await vi.advanceTimersByTimeAsync(delay - 1)
      expect(FakeWebSocket.instances).toHaveLength(i + 1)
      await vi.advanceTimersByTimeAsync(1)
      expect(FakeWebSocket.instances).toHaveLength(i + 2)
    }
    const second = track(t.send(m(2)) as Promise<void>)
    sock(4).open()
    await flush()
    expect(sock(4).sent).toEqual([JSON.stringify(m(1)), JSON.stringify(m(2))])
    expect(first.status).toBe('resolved')
    expect(second.status).toBe('resolved')
    await t.send(m(3))
    expect(sock(4).sent).toHaveLength(3)
    t.close?.()
  })

  it('websocket_backoff_capped_at_max_delay', async () => {
    const t = websocketTransport({ url: 'wss://a', maxDelayMs: 1500 })
    t.onMessage(() => {})
    sock(0).fail()
    await vi.advanceTimersByTimeAsync(500)
    sock(1).fail()
    await vi.advanceTimersByTimeAsync(1000)
    sock(2).fail()
    await vi.advanceTimersByTimeAsync(1499)
    expect(FakeWebSocket.instances).toHaveLength(3)
    await vi.advanceTimersByTimeAsync(1)
    expect(FakeWebSocket.instances).toHaveLength(4)
    t.close?.()
  })

  it('websocket_on_open_runs_before_flush', async () => {
    let release: () => void = () => {}
    const onOpen = vi.fn(async (socket: WebSocket) => {
      socket.send('hello')
      await new Promise<void>((r) => (release = r))
    })
    const t = websocketTransport({ url: 'wss://a', onOpen })
    const p1 = track(t.send(m(1)) as Promise<void>)
    sock(0).open()
    await flush()
    expect(sock(0).sent).toEqual(['hello'])
    expect(p1.status).toBe('pending')
    release()
    await flush()
    expect(sock(0).sent).toEqual(['hello', JSON.stringify(m(1))])
    expect(p1.status).toBe('resolved')

    sock(0).serverClose(1001)
    const p2 = track(t.send(m(2)) as Promise<void>)
    await vi.advanceTimersByTimeAsync(500)
    sock(1).open()
    await flush()
    expect(sock(1).sent).toEqual(['hello'])
    release()
    await flush()
    expect(sock(1).sent).toEqual(['hello', JSON.stringify(m(2))])
    expect(p2.status).toBe('resolved')
    expect(onOpen).toHaveBeenCalledTimes(2)
    t.close?.()
  })

  it('websocket_rejecting_on_open_stops', async () => {
    const statuses: string[] = []
    const t = websocketTransport({
      url: 'wss://a',
      onOpen: () => Promise.reject(new Error('handshake refused')),
      onStatus: (s) => statuses.push(s.state),
    })
    const p = track(t.send(m(1)) as Promise<void>)
    sock(0).open()
    await flush()
    expect(p.status).toBe('rejected')
    expect(p.error?.message).toBe('transport stopped')
    await vi.advanceTimersByTimeAsync(60000)
    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(sock(0).readyState).toBe(3)
    expect(statuses.at(-1)).toBe('stopped')
    await expect(t.send(m(2))).rejects.toThrow('transport stopped')
  })

  it('websocket_frames_during_on_open_go_to_receive', async () => {
    let received: unknown
    let release: () => void = () => {}
    const t = websocketTransport({
      url: 'wss://a',
      onOpen: async (_socket, io) => {
        received = await io.receive()
        await new Promise<void>((r) => (release = r))
      },
    })
    const handler = vi.fn()
    t.onMessage(handler)
    sock(0).open()
    await flush()
    sock(0).serverSend('not json')
    sock(0).serverSend(JSON.stringify({ paired: true }))
    await flush()
    expect(received).toEqual({ paired: true })
    sock(0).serverSend(JSON.stringify({ early: true })) // still inside onOpen: not for the bridge
    release()
    await flush()
    sock(0).serverSend(JSON.stringify({ protocol: 1 }))
    sock(0).serverSend('{broken')
    expect(handler.mock.calls).toEqual([[{ protocol: 1 }]])
    t.close?.()
  })

  it('websocket_terminal_close_code_stops_reconnect', async () => {
    const statuses: { state: string; closeCode?: number }[] = []
    const t = websocketTransport({
      url: 'wss://a',
      terminalCloseCodes: [4409],
      onOpen: () => new Promise<void>(() => {}),
      onStatus: (s) => statuses.push(s),
    })
    const p = track(t.send(m(1)) as Promise<void>)
    sock(0).open()
    await flush()
    sock(0).serverClose(4409)
    await flush()
    expect(vi.getTimerCount()).toBe(0)
    expect(p.status).toBe('rejected')
    expect(p.error?.message).toBe('transport stopped')
    await vi.advanceTimersByTimeAsync(60000)
    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(statuses).toEqual([
      { state: 'connecting' },
      { state: 'closed', closeCode: 4409 },
      { state: 'stopped' },
    ])
  })

  it('websocket_non_terminal_close_reconnects', async () => {
    const t = websocketTransport({ url: 'wss://a', terminalCloseCodes: [4409] })
    t.onMessage(() => {})
    sock(0).open()
    await flush()
    sock(0).serverClose(1001)
    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(500)
    expect(FakeWebSocket.instances).toHaveLength(2)
    t.close?.()
  })

  it('websocket_receive_times_out', async () => {
    let error: Error | undefined
    const t = websocketTransport({
      url: 'wss://a',
      onOpen: async (_socket, io) => {
        try {
          await io.receive(100)
        } catch (e) {
          error = e as Error
        }
      },
    })
    t.onMessage(() => {})
    sock(0).open()
    await vi.advanceTimersByTimeAsync(99)
    expect(error).toBeUndefined()
    await vi.advanceTimersByTimeAsync(1)
    expect(error?.message).toBe('receive timeout')
    t.close?.()
  })

  it('websocket_receive_rejects_when_socket_closes', async () => {
    let error: Error | undefined
    const t = websocketTransport({
      url: 'wss://a',
      onOpen: async (_socket, io) => {
        try {
          await io.receive()
        } catch (e) {
          error = e as Error
        }
      },
    })
    t.onMessage(() => {})
    sock(0).open()
    await flush()
    sock(0).serverClose(1001)
    await flush()
    expect(error?.message).toBe('socket closed')
    t.close?.()
  })

  it('websocket_on_status_reports_first_connect_failure', async () => {
    const statuses: unknown[] = []
    const t = websocketTransport({ url: 'wss://a', onStatus: (s) => statuses.push(s) })
    t.onMessage(() => {})
    sock(0).fail()
    await vi.advanceTimersByTimeAsync(500)
    sock(1).open()
    await flush()
    sock(1).serverClose(1001)
    t.close?.()
    expect(statuses).toEqual([
      { state: 'connecting' },
      { state: 'closed', closeCode: 1006, firstConnectFailed: true },
      { state: 'connecting' },
      { state: 'open' },
      { state: 'closed', closeCode: 1001 },
      { state: 'stopped' },
    ])
  })

  it('websocket_buffer_overflow_rejects_oldest', async () => {
    const t = websocketTransport({ url: 'wss://a' })
    const sends = Array.from({ length: 101 }, (_, i) => track(t.send(m(i)) as Promise<void>))
    await flush()
    expect(sends[0]!.status).toBe('rejected')
    expect(sends[0]!.error?.message).toBe('buffer overflow')
    expect(sends.slice(1).every((s) => s.status === 'pending')).toBe(true)
    t.close?.()
    await flush()
    expect(sends[100]!.error?.message).toBe('transport stopped')
  })
})
