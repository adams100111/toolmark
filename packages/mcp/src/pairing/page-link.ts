import { randomUUID } from 'node:crypto'
import type { Writable } from 'node:stream'
import {
  cancelled,
  type ToolManifest,
  type ToolManifestSummary,
  type ToolResult,
} from '@toolmark/core'
import { validateMessage } from '@toolmark/core/protocol'
import type { PageLink } from '../server/server.js'
import { MAX_LISTED_TOOLS } from '../server/server.js'
import { isPlainObject, utf8Length } from '../server/tool-mapping.js'

/** Result text of calls pending on a page that reloaded (a new `clientId` was adopted). */
export const RELOAD_TEXT = 'The page reloaded before the result arrived; the outcome is unknown.'
/** Result text of calls pending on a page that another page replaced (a new pairing code was used). */
export const SUPERSEDED_TEXT =
  'Another page took over the MCP connection before the result arrived.'
/** Result text of calls pending on a page that stayed away past the unpaired grace. */
export const DISCONNECTED_TEXT =
  'The page disconnected before the result arrived; the outcome is unknown.'
const NOT_CONNECTED_TEXT = 'No page is connected.'
const TOO_LARGE_TEXT = 'The call input is too large to send to the page.'
const UNSENDABLE_TEXT = 'The call input could not be sent to the page.'
const BUSY_TEXT = 'Too many calls are waiting for the page.'
const SHUTDOWN_TEXT = 'The MCP server is shutting down.'

/** How long page tools stay listed after the paired socket closes. */
export const UNPAIRED_GRACE_MS = 2000
/** Timeout of one `describe` request. */
export const DESCRIBE_TIMEOUT_MS = 10_000
/** Largest `call` frame sent to the page (the page bridge's default inbound limit). */
export const MAX_CALL_FRAME_BYTES = 1_048_576
/** Most calls and describes waiting for the page at once. */
export const MAX_PENDING_REQUESTS = 256
/** Most call ids kept for a deferred `cancel` (oldest dropped first). */
export const MAX_DEFERRED_CANCELS = 1024
/** Longest page-controlled text quoted in a stderr line. */
const MAX_QUOTED = 120

/** @internal The part of a WebSocket the link writes to. */
export interface LinkSocket {
  readonly readyState: number
  send(data: string): void
}

/** @internal The link plus the hooks the pairing server drives. */
export interface PageLinkController extends PageLink {
  /**
   * A socket completed pairing; the next `manifest` on it fixes the `clientId`. `how` is the
   * handshake it used: a `pair` (fresh code) that brings a new `clientId` is another page taking
   * over; a `resume` (session token) that does is the same tab reloaded (default).
   */
  attach(socket: LinkSocket, how?: 'pair' | 'resume'): void
  /** A socket closed; the unpaired grace starts when it was the paired one. */
  detach(socket: LinkSocket): void
  /** A text frame arrived on a paired socket. */
  receive(socket: LinkSocket, text: string): void
  /** Fails pending requests, stops timers and drops listeners. */
  dispose(): void
}

interface Pending {
  clientId: string
  /** `call` (the page may run it) or `describe` (read-only). */
  kind: 'call' | 'describe'
  resolve(result: ToolResult<unknown>): void
}

const quote = (s: string): string =>
  JSON.stringify(s.length > MAX_QUOTED ? `${s.slice(0, MAX_QUOTED)}…` : s)

/**
 * @internal Creates the CLI's {@link PageLink}: the bridge-protocol agent side of the paired page
 * (spec §11.3, §12). Page frames are validated with `validateMessage(…, 'toAgent')` and bound to
 * the adopted `clientId`; calls carry a deadline and are cancelled on the page on deadline or
 * abort; a reload (new `clientId`) or a page gone past the grace fails pending calls. Inbound
 * `changed` frames are ignored: the paired page announces every revision with a full `manifest`.
 */
export function createPageLink(o: {
  callTimeoutMs: number
  stderr: Writable
  pairingCode: () => { code: string; expiresInMs: number }
  graceMs?: number
}): PageLinkController {
  const graceMs = o.graceMs ?? UNPAIRED_GRACE_MS
  const listeners = new Set<() => void>()
  const pending = new Map<string, Pending>()
  const describeCache = new Map<string, Promise<ToolManifest | null>>()
  /**
   * Calls that ended (deadline, abort, grace expiry) while no `cancel` could reach the page, by
   * call id → the `clientId` they were sent to. Insertion order is FIFO. When a manifest re-adopts
   * that `clientId`, a `cancel` for each is sent before anything else, so a still-live inline
   * confirmation on the page can never run a call the agent already saw end (spec §11.3).
   */
  const deferredCancels = new Map<string, string>()
  let socket: LinkSocket | null = null
  let attachedBy: 'pair' | 'resume' = 'resume'
  let awaitingManifest = true
  let clientId: string | null = null
  let paired = false
  let rev = 0
  let tools: ToolManifestSummary[] = []
  let toolsKey = '[]'
  let capReportedFor: string | null = null
  let graceTimer: ReturnType<typeof setTimeout> | undefined
  let disposed = false

  const log = (line: string): void => {
    try {
      o.stderr.write(`Toolmark MCP: ${line}\n`)
    } catch {
      // Diagnostics never break the link.
    }
  }

  const notify = (): void => {
    for (const cb of [...listeners]) {
      try {
        cb()
      } catch (e) {
        log(`a change listener failed: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }

  const sendText = (text: string): boolean => {
    const s = socket
    if (!s || s.readyState !== 1) return false
    try {
      s.send(text)
      return true
    } catch {
      return false
    }
  }

  const deferCancel = (id: string, cid: string): void => {
    deferredCancels.delete(id)
    deferredCancels.set(id, cid)
    while (deferredCancels.size > MAX_DEFERRED_CANCELS) {
      deferredCancels.delete(deferredCancels.keys().next().value!)
    }
  }

  /** Sends `cancel` for call `id` now when the page that holds it is live, else defers it. */
  const cancelOnPage = (id: string, cid: string): void => {
    const text = JSON.stringify({ protocol: 1, type: 'cancel', clientId: cid, id })
    if (!awaitingManifest && clientId === cid && sendText(text)) return
    deferCancel(id, cid)
  }

  const failPending = (message: string, cancelCalls = false): void => {
    const entries = [...pending.entries()]
    pending.clear()
    for (const [id, p] of entries) {
      if (cancelCalls && p.kind === 'call') deferCancel(id, p.clientId)
      p.resolve({ status: 'error', message })
    }
  }

  /** Registers a request; `resolve` runs at most once (deadline, abort, answer or failure). */
  const track = (
    id: string,
    cid: string,
    kind: Pending['kind'],
    timeoutMs: number,
    onTimeout: () => ToolResult<unknown>,
    signal?: AbortSignal,
    onAbort?: () => ToolResult<unknown>,
  ): Promise<ToolResult<unknown>> =>
    new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (pending.has(id)) finish(onTimeout())
      }, timeoutMs)
      const abort = (): void => {
        if (pending.has(id)) finish(onAbort!())
      }
      const finish = (r: ToolResult<unknown>): void => {
        pending.delete(id)
        clearTimeout(timer)
        signal?.removeEventListener('abort', abort)
        resolve(r)
      }
      pending.set(id, { clientId: cid, kind, resolve: finish })
      if (signal && onAbort) signal.addEventListener('abort', abort, { once: true })
    })

  const describe = (summary: ToolManifestSummary, atRev: number): Promise<ToolManifest | null> => {
    const key = `${atRev}\n${summary.name}`
    const cached = describeCache.get(key)
    if (cached) return cached
    const skip = (why: string): null => {
      log(`skipped tool ${quote(summary.name)}: ${why}`)
      describeCache.delete(key)
      return null
    }
    const cid = clientId
    if (cid === null) return Promise.resolve(null)
    if (pending.size >= MAX_PENDING_REQUESTS) return Promise.resolve(skip('too many requests'))
    const id = randomUUID()
    const promise = (async (): Promise<ToolManifest | null> => {
      const answer = track(id, cid, 'describe', DESCRIBE_TIMEOUT_MS, () => ({
        status: 'error',
        message: 'describe timed out',
      }))
      const text = JSON.stringify({
        protocol: 1,
        type: 'describe',
        clientId: cid,
        id,
        tool: summary.name,
      })
      if (!sendText(text)) {
        pending.get(id)?.resolve({ status: 'error', message: 'not connected' })
      }
      const r = await answer
      if (r.status !== 'ok') return skip(`describe returned ${r.status}`)
      const data: unknown = r.data
      if (!isPlainObject(data) || data.name !== summary.name || data.llmName !== summary.llmName) {
        return skip('describe returned a mismatched entry')
      }
      return data as unknown as ToolManifest
    })()
    describeCache.set(key, promise)
    return promise
  }

  const adopt = (id: string): void => {
    if (clientId !== null && clientId !== id) {
      failPending(attachedBy === 'pair' ? SUPERSEDED_TEXT : RELOAD_TEXT)
      describeCache.clear()
    }
    clientId = id
    awaitingManifest = false
    // Deferred cancels go out first, and only to the page instance that holds those calls; a
    // different `clientId` is a new page instance that never saw them.
    const owed = [...deferredCancels].filter(([, cid]) => cid === id)
    deferredCancels.clear()
    for (const [callId, cid] of owed) cancelOnPage(callId, cid)
  }

  const applyManifest = (nextRev: number, nextTools: ToolManifestSummary[]): void => {
    const key = JSON.stringify(nextTools)
    const changed = !paired || nextRev !== rev || key !== toolsKey
    paired = true
    rev = nextRev
    tools = nextTools
    toolsKey = key
    for (const k of [...describeCache.keys()]) {
      if (!k.startsWith(`${rev}\n`)) describeCache.delete(k)
    }
    if (changed) notify()
  }

  const unpair = (): void => {
    graceTimer = undefined
    if (socket !== null) return
    failPending(DISCONNECTED_TEXT, true)
    describeCache.clear()
    clientId = null
    awaitingManifest = true
    tools = []
    toolsKey = '[]'
    if (paired) {
      paired = false
      notify()
    }
  }

  return {
    state: () => (paired ? 'paired' : 'unpaired'),

    async manifest() {
      if (!paired || clientId === null) return []
      let list = tools
      if (list.length > MAX_LISTED_TOOLS) {
        const marker = `${clientId}\n${rev}`
        if (capReportedFor !== marker) {
          capReportedFor = marker
          log(
            `the page offers ${list.length} tools; only the first ${MAX_LISTED_TOOLS} are described`,
          )
        }
        list = list.slice(0, MAX_LISTED_TOOLS)
      }
      const atRev = rev
      const entries = await Promise.all(list.map((s) => describe(s, atRev)))
      return entries.filter((e): e is ToolManifest => e !== null)
    },

    call(name, input, { signal }) {
      const cid = clientId
      if (!paired || cid === null || awaitingManifest) {
        return Promise.resolve({ status: 'error', message: NOT_CONNECTED_TEXT })
      }
      if (signal.aborted) return Promise.resolve(cancelled('signal'))
      if (pending.size >= MAX_PENDING_REQUESTS) {
        return Promise.resolve({ status: 'error', message: BUSY_TEXT })
      }
      const id = randomUUID()
      let text: string
      try {
        text = JSON.stringify({
          protocol: 1,
          type: 'call',
          clientId: cid,
          id,
          rev,
          tool: name,
          input,
        })
      } catch {
        return Promise.resolve({ status: 'error', message: UNSENDABLE_TEXT })
      }
      if (utf8Length(text) > MAX_CALL_FRAME_BYTES) {
        return Promise.resolve({ status: 'error', message: TOO_LARGE_TEXT })
      }
      if (!sendText(text)) return Promise.resolve({ status: 'error', message: NOT_CONNECTED_TEXT })
      const cancel = (): ToolResult<unknown> => {
        cancelOnPage(id, cid)
        return cancelled('signal')
      }
      return track(id, cid, 'call', o.callTimeoutMs, cancel, signal, cancel)
    },

    pairingCode: () => o.pairingCode(),

    onChange(cb) {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    },

    attach(s, how = 'resume') {
      if (disposed) return
      socket = s
      attachedBy = how
      awaitingManifest = true
      if (graceTimer !== undefined) clearTimeout(graceTimer)
      graceTimer = undefined
    },

    detach(s) {
      if (s !== socket) return
      socket = null
      awaitingManifest = true
      if (disposed) return
      if (graceTimer !== undefined) clearTimeout(graceTimer)
      graceTimer = setTimeout(unpair, graceMs)
    },

    receive(s, text) {
      if (s !== socket || disposed) return
      let raw: unknown
      try {
        raw = JSON.parse(text)
      } catch {
        log('dropped a page frame that is not JSON')
        return
      }
      const checked = validateMessage(raw, 'toAgent')
      if (!checked.ok) {
        log(`dropped an invalid page frame: ${quote(checked.reason)}`)
        return
      }
      const m = checked.message
      if (m.type === 'call' || m.type === 'describe' || m.type === 'cancel') return
      if (awaitingManifest) {
        if (m.type !== 'manifest') return
        adopt(m.clientId)
      } else if (m.clientId !== clientId) {
        return
      }
      switch (m.type) {
        case 'manifest':
          applyManifest(m.rev, m.tools)
          return
        case 'changed':
          // Ignored (M7): `mcpPairing` always sends full manifests (`onChange: 'manifest'`), so a
          // bare `changed` is not ours to trust — adopting its `rev` without the tool list would
          // pin later calls to a revision whose tools this link never saw.
          return
        case 'result': {
          const p = pending.get(m.id)
          if (p && p.clientId === m.clientId) p.resolve(m.result)
          return
        }
        default:
          // `confirmed` never concerns an inline caller such as `mcp`.
          return
      }
    },

    dispose() {
      if (disposed) return
      disposed = true
      if (graceTimer !== undefined) clearTimeout(graceTimer)
      graceTimer = undefined
      failPending(SHUTDOWN_TEXT)
      describeCache.clear()
      deferredCancels.clear()
      socket = null
      paired = false
      listeners.clear()
    },
  }
}
