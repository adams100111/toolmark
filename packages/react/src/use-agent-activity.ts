import { useSyncExternalStore } from 'react'
import type { Caller, Toolmark } from '@toolmark/core'
import { useToolmark } from './provider.js'

/** One in-flight tool call. */
export interface ActiveCall {
  /** Unique id of the call. */
  callId: string
  /** Full tool name. */
  tool: string
  /** Who is calling. */
  caller: Caller
  /** When the call started (ms since epoch). */
  startedAt: number
}

/** Snapshot returned by {@link useAgentActivity}. */
export interface AgentActivity {
  /** Calls that have been sent but have not yet settled. */
  active: ActiveCall[]
}

const EMPTY_ACTIVE: ActiveCall[] = Object.freeze([]) as unknown as ActiveCall[]
const EMPTY_ACTIVITY: AgentActivity = Object.freeze({ active: EMPTY_ACTIVE })

interface ActivityStore {
  subscribe(fn: () => void): () => void
  getSnapshot(): AgentActivity
}

const stores = new WeakMap<Toolmark, ActivityStore>()

function activityStoreOf(tm: Toolmark): ActivityStore {
  const existing = stores.get(tm)
  if (existing) return existing

  const calls = new Map<string, ActiveCall>()
  const listeners = new Set<() => void>()
  let snapshot: AgentActivity = EMPTY_ACTIVITY
  let dirty = false

  const notify = (): void => {
    dirty = true
    for (const fn of [...listeners]) fn()
  }
  tm.events.on('call', (e) => {
    calls.set(e.callId, { callId: e.callId, tool: e.tool, caller: e.caller, startedAt: Date.now() })
    notify()
  })
  tm.events.on('result', (e) => {
    calls.delete(e.callId)
    notify()
  })

  const store: ActivityStore = {
    subscribe(fn) {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
    getSnapshot() {
      if (dirty) {
        snapshot = calls.size === 0 ? EMPTY_ACTIVITY : { active: [...calls.values()] }
        dirty = false
      }
      return snapshot
    },
  }
  stores.set(tm, store)
  return store
}

/**
 * Live view of the registry's in-flight tool calls (spec §9). SSR-safe: the server snapshot is a
 * frozen, module-level empty value.
 */
export function useAgentActivity(): AgentActivity {
  const toolmark = useToolmark()
  const store = activityStoreOf(toolmark)
  return useSyncExternalStore(
    (fn) => store.subscribe(fn),
    () => store.getSnapshot(),
    () => EMPTY_ACTIVITY,
  )
}
