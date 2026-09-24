import { useCallback, useRef, useSyncExternalStore } from 'react'
import type { ConfirmQueue, ConfirmRequest } from '@toolmark/core'

/** Snapshot + actions returned by {@link useConfirmQueue}. */
export interface ConfirmQueueState {
  /** Head of the queue, or `null` when nothing is pending. */
  pending: ConfirmRequest | null
  /** Approves the head request. */
  approve: (input?: unknown) => void
  /** Rejects the head request. */
  reject: (reason?: string) => void
}

const EMPTY_QUEUE_STATE: { pending: ConfirmRequest | null } = Object.freeze({ pending: null })

/**
 * Subscribes to an inline {@link ConfirmQueue} (spec §7, §9): renders its head request and
 * resolves it. SSR-safe: the server snapshot is a frozen, module-level `{ pending: null }`.
 * @param queue - The queue created with `createConfirmQueue()` and passed as
 * `ToolmarkOptions.confirm`.
 */
export function useConfirmQueue(queue: ConfirmQueue): ConfirmQueueState {
  // Caches the wrapper object so `getSnapshot` returns a stable reference when the head request
  // hasn't changed (`useSyncExternalStore` compares snapshots with `Object.is`).
  const lastPending = useRef<ConfirmRequest | null>(null)
  const cached = useRef<{ pending: ConfirmRequest | null }>(EMPTY_QUEUE_STATE)

  const getSnapshot = useCallback((): { pending: ConfirmRequest | null } => {
    const pending = queue.getPending()
    if (pending !== lastPending.current) {
      lastPending.current = pending
      cached.current = pending === null ? EMPTY_QUEUE_STATE : { pending }
    }
    return cached.current
  }, [queue])

  const subscribe = useCallback((fn: () => void) => queue.subscribe(fn), [queue])
  const getServerSnapshot = useCallback(() => EMPTY_QUEUE_STATE, [])

  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const approve = useCallback((input?: unknown) => queue.approve(input), [queue])
  const reject = useCallback((reason?: string) => queue.reject(reason), [queue])

  return { pending: state.pending, approve, reject }
}
