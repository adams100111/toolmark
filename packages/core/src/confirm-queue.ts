import type { ConfirmRequest } from './registry.js'
import type { ConfirmOutcome } from './tool.js'

/**
 * @internal Abort signal of each inline confirmation request (call aborted or confirmation
 * expired). Set by the registry before it calls the inline handler.
 */
export const confirmRequestSignals = new WeakMap<ConfirmRequest, AbortSignal>()

/**
 * A FIFO of inline confirmation requests. Pass `queue.handler` as `ToolmarkOptions.confirm`, render
 * `getPending()` and answer with `approve`/`reject` (spec §7; `useConfirmQueue` subscribes to it).
 */
export interface ConfirmQueue {
  /** Inline confirm handler: resolves when the request is approved, rejected or aborted. */
  handler: (req: ConfirmRequest) => Promise<ConfirmOutcome>
  /** Head of the FIFO, or `null` when nothing is pending. */
  getPending(): ConfirmRequest | null
  /** Subscribes to queue changes; returns an unsubscribe function. */
  subscribe(fn: () => void): () => void
  /**
   * Approves the head request.
   * @param input - Optional edited input (re-validated by the registry).
   */
  approve(input?: unknown): void
  /**
   * Rejects the head request.
   * @param reason - Optional reason passed to the outcome.
   */
  reject(reason?: string): void
}

/**
 * Creates an inline confirmation queue. It exists before any UI renders, so it can be passed to
 * `createToolmark({ confirm: queue.handler })`.
 * @returns A new, empty queue.
 */
export function createConfirmQueue(): ConfirmQueue {
  const items: { req: ConfirmRequest; resolve: (o: ConfirmOutcome) => void }[] = []
  const listeners = new Set<() => void>()
  const notify = (): void => {
    for (const fn of [...listeners]) {
      try {
        fn()
      } catch (e) {
        console.error('[toolmark] confirm queue listener threw', e)
      }
    }
  }
  const settleHead = (outcome: ConfirmOutcome): void => {
    const head = items.shift()
    if (!head) return
    head.resolve(outcome)
    notify()
  }
  return {
    handler(req) {
      return new Promise<ConfirmOutcome>((resolve) => {
        const item = { req, resolve }
        const signal = confirmRequestSignals.get(req)
        if (signal?.aborted) {
          resolve({ approved: false, reason: 'signal' })
          return
        }
        items.push(item)
        signal?.addEventListener(
          'abort',
          () => {
            const i = items.indexOf(item)
            if (i < 0) return
            items.splice(i, 1)
            resolve({ approved: false, reason: 'signal' })
            notify()
          },
          { once: true },
        )
        notify()
      })
    },
    getPending: () => items[0]?.req ?? null,
    subscribe(fn) {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
    approve(input) {
      settleHead(input === undefined ? { approved: true } : { approved: true, input })
    },
    reject(reason) {
      settleHead(reason === undefined ? { approved: false } : { approved: false, reason })
    },
  }
}
