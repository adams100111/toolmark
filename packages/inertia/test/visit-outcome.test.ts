import { describe, expect, it, vi } from 'vitest'
import { visitOutcome } from '../src/visit-outcome.js'

describe('visit-outcome', () => {
  it('visit_outcome_maps_every_callback', async () => {
    const cases: {
      name: string
      fire: (cb: ReturnType<typeof visitOutcome>['callbacks']) => void
      expected: unknown
    }[] = [
      { name: 'onSuccess', fire: (cb) => cb.onSuccess?.(), expected: { status: 'ok', data: {} } },
      {
        name: 'onError',
        fire: (cb) => cb.onError?.({ title: 'Required', 'address.city': 'Required' }),
        expected: {
          status: 'invalid',
          issues: [
            { path: 'title', message: 'Required' },
            { path: 'address.city', message: 'Required' },
          ],
        },
      },
      {
        name: 'onHttpException',
        fire: (cb) => cb.onHttpException?.({ status: 500 }),
        expected: { status: 'error', message: 'Request failed' },
      },
      {
        name: 'onInvalid',
        fire: (cb) => cb.onInvalid?.({ status: 500 }),
        expected: { status: 'error', message: 'Request failed' },
      },
      {
        name: 'onNetworkError',
        fire: (cb) => cb.onNetworkError?.(new Error('offline')),
        expected: { status: 'error', message: 'Network error' },
      },
      {
        name: 'onException',
        fire: (cb) => cb.onException?.(new Error('boom')),
        expected: { status: 'error', message: 'Network error' },
      },
      {
        name: 'onCancel',
        fire: (cb) => cb.onCancel?.(),
        expected: { status: 'cancelled', by: 'signal' },
      },
      {
        name: 'onFinish cancelled',
        fire: (cb) => cb.onFinish?.({ cancelled: true, interrupted: false }),
        expected: { status: 'cancelled', by: 'signal' },
      },
      {
        name: 'onFinish interrupted',
        fire: (cb) => cb.onFinish?.({ cancelled: false, interrupted: true }),
        expected: { status: 'cancelled', by: 'signal' },
      },
      {
        name: 'onFinish with no earlier outcome',
        fire: (cb) => cb.onFinish?.({ cancelled: false, interrupted: false }),
        expected: { status: 'error', message: 'Visit did not complete' },
      },
    ]

    for (const { fire, expected } of cases) {
      const { callbacks, result } = visitOutcome()
      fire(callbacks)
      await expect(result).resolves.toEqual(expected)
    }
  })

  it('visit_outcome_settles_once', async () => {
    const { callbacks, result } = visitOutcome()
    callbacks.onSuccess?.()
    callbacks.onError?.({ title: 'Required' })
    callbacks.onFinish?.({ cancelled: false, interrupted: false })
    await expect(result).resolves.toEqual({ status: 'ok', data: {} })
  })

  it('visit_outcome_signal_cancels_token', () => {
    const controller = new AbortController()
    const { callbacks } = visitOutcome({ signal: controller.signal })
    const cancel = vi.fn()
    callbacks.onCancelToken?.({ cancel })
    expect(cancel).not.toHaveBeenCalled()
    controller.abort()
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('visit_outcome_signal_cancels_token_arriving_after_abort', () => {
    const controller = new AbortController()
    controller.abort()
    const { callbacks } = visitOutcome({ signal: controller.signal })
    const cancel = vi.fn()
    callbacks.onCancelToken?.({ cancel })
    expect(cancel).toHaveBeenCalledTimes(1)
  })
})
