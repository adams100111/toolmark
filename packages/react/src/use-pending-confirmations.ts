import { useCallback, useSyncExternalStore } from 'react'
import {
  onPendingConsumed,
  type PendingConfirmation,
  type ToolResult,
  type Toolmark,
} from '@toolmark/core'
import { useToolmark } from './provider.js'

/** Snapshot + actions returned by {@link usePendingConfirmations}. */
export interface PendingConfirmationsState {
  /** Every deferred confirmation currently waiting. */
  items: PendingConfirmation[]
  /** Approves a pending confirmation, optionally with edited input. */
  approve: (confirmId: string, input?: unknown) => Promise<ToolResult<unknown>>
  /** Rejects a pending confirmation, optionally with a reason. */
  reject: (confirmId: string, reason?: string) => Promise<ToolResult<unknown>>
}

const EMPTY_ITEMS: PendingConfirmation[] = Object.freeze([]) as unknown as PendingConfirmation[]

interface PendingStore {
  subscribe(fn: () => void): () => void
  getSnapshot(): PendingConfirmation[]
}

const stores = new WeakMap<Toolmark, PendingStore>()

function pendingStoreOf(tm: Toolmark): PendingStore {
  const existing = stores.get(tm)
  if (existing) return existing

  const listeners = new Set<() => void>()
  let snapshot: PendingConfirmation[] = EMPTY_ITEMS
  let dirty = true

  const invalidate = (): void => {
    dirty = true
    for (const fn of [...listeners]) fn()
  }
  tm.events.on('confirm', invalidate)
  // A consumed id leaves the list before the approved tool settles (its `confirm` event comes
  // later): refresh immediately so the card disappears and a double click finds no stale item.
  onPendingConsumed(tm, invalidate)

  const store: PendingStore = {
    subscribe(fn) {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
    getSnapshot() {
      if (dirty) {
        const list = tm.pendingConfirmations()
        snapshot = list.length === 0 ? EMPTY_ITEMS : list
        dirty = false
      }
      return snapshot
    },
  }
  stores.set(tm, store)
  return store
}

/**
 * Live view of the registry's deferred confirmations (spec §7, §9), with `approve`/`reject`
 * actions. SSR-safe: the server snapshot is a frozen, module-level empty array.
 */
export function usePendingConfirmations(): PendingConfirmationsState {
  const toolmark = useToolmark()
  const store = pendingStoreOf(toolmark)
  const items = useSyncExternalStore(
    (fn) => store.subscribe(fn),
    () => store.getSnapshot(),
    () => EMPTY_ITEMS,
  )

  const approve = useCallback(
    (confirmId: string, input?: unknown) =>
      toolmark.confirmPending(
        confirmId,
        input === undefined ? { approved: true } : { approved: true, input },
      ),
    [toolmark],
  )
  const reject = useCallback(
    (confirmId: string, reason?: string) =>
      toolmark.confirmPending(
        confirmId,
        reason === undefined ? { approved: false } : { approved: false, reason },
      ),
    [toolmark],
  )

  return { items, approve, reject }
}
