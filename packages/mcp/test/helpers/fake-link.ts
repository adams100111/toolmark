import type { ToolManifest, ToolResult } from '@toolmark/core'
import type { PageLink } from '../../src/index.js'

/** One recorded `link.call`. */
export interface FakeCall {
  name: string
  input: unknown
  signal: AbortSignal
}

/** A scriptable in-memory `PageLink` for server tests. */
export interface FakeLink extends PageLink {
  /** Calls received, in order. */
  calls: FakeCall[]
  /** Pairs (or re-lists) with `tools` and notifies listeners. */
  pair(tools: ToolManifest[]): void
  /** Unpairs and notifies listeners. */
  unpair(): void
  /** Replaces how calls are answered (default: echo `ok`). */
  respond(fn: (call: FakeCall) => Promise<ToolResult<unknown>> | ToolResult<unknown>): void
  /** Number of registered `onChange` listeners. */
  listenerCount(): number
}

/** Builds a manifest entry with sensible defaults. */
export function entry(name: string, extra: Partial<ToolManifest> = {}): ToolManifest {
  return {
    name,
    llmName: name.replaceAll('.', '__'),
    description: `Runs ${name}.`,
    hints: {},
    inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
    ...extra,
  }
}

/** Creates a fake link, unpaired, with pairing code `ABCD-EFGH` expiring in 4.5 minutes. */
export function createFakeLink(): FakeLink {
  let paired = false
  let tools: ToolManifest[] = []
  const listeners = new Set<() => void>()
  let responder = (call: FakeCall): Promise<ToolResult<unknown>> | ToolResult<unknown> => ({
    status: 'ok',
    data: { tool: call.name, input: call.input },
  })
  const notify = () => {
    for (const cb of [...listeners]) cb()
  }
  const calls: FakeCall[] = []
  return {
    calls,
    state: () => (paired ? 'paired' : 'unpaired'),
    manifest: () => Promise.resolve(paired ? tools : []),
    call(name, input, opts) {
      const call = { name, input, signal: opts.signal }
      calls.push(call)
      return Promise.resolve(responder(call))
    },
    pairingCode: () => ({ code: 'ABCD-EFGH', expiresInMs: 270_000 }),
    onChange(cb) {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    },
    pair(next) {
      paired = true
      tools = next
      notify()
    },
    unpair() {
      paired = false
      tools = []
      notify()
    },
    respond(fn) {
      responder = fn
    },
    listenerCount: () => listeners.size,
  }
}
