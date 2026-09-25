import type { ToolResult } from './result.js'
import type { Caller } from './tool.js'

/** Payload of the `error` event (and of `ToolmarkOptions.onError`). */
export interface ToolmarkErrorEvent {
  /** Stable error code, e.g. `duplicate_name`, `tool_threw`. */
  code: string
  /** Human-readable message. */
  message: string
  /** Full tool name, when the error concerns one tool. */
  tool?: string
  /** Underlying error, when any. */
  cause?: unknown
}

/** Every registry event and its payload. */
export interface ToolmarkEventMap {
  /** A call passed resolution and policy and is about to be validated. */
  call: { callId: string; tool: string; caller: Caller; input: unknown }
  /** A call settled. */
  result: {
    callId: string
    tool: string
    caller: Caller
    result: ToolResult<unknown>
    durationMs: number
  }
  /** A confirmation changed stage. */
  confirm: {
    confirmId: string
    tool: string
    stage: 'pending' | 'approved' | 'rejected' | 'expired'
    result?: ToolResult<unknown>
  }
  /** A user-originated interaction with a tool's UI (tour hooks). */
  interaction: { tool: string; param?: string; kind: 'input' | 'focus' | 'submit'; caller: 'human' }
  /** The registry revision changed (fired once per microtask). */
  change: { rev: number }
  /** A misconfiguration or runtime problem (production reports instead of throwing). */
  error: ToolmarkErrorEvent
}

type Listener<T> = (payload: T) => void

/** @internal Calls `fn`, reporting (never rethrowing) a thrown error. */
export function safeCall(fn: () => void, what: string): void {
  try {
    fn()
  } catch (e) {
    console.error(`[toolmark] ${what} threw`, e)
  }
}

/** @internal Minimal typed emitter; a throwing listener never breaks emission. */
export interface Emitter<M> {
  on<K extends keyof M>(type: K, fn: Listener<M[K]>): () => void
  emit<K extends keyof M>(type: K, payload: M[K]): void
}

/** @internal */
export function createEmitter<M>(): Emitter<M> {
  const listeners = new Map<keyof M, Set<Listener<never>>>()
  return {
    on(type, fn) {
      let set = listeners.get(type)
      if (!set) listeners.set(type, (set = new Set()))
      const entry = fn as Listener<never>
      set.add(entry)
      return () => {
        set.delete(entry)
      }
    },
    emit(type, payload) {
      const set = listeners.get(type)
      if (!set) return
      for (const fn of [...set]) {
        safeCall(() => (fn as Listener<typeof payload>)(payload), `'${String(type)}' listener`)
      }
    },
  }
}
