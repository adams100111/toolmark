import type { PageToAgentMessage } from '../protocol/messages.js'
import { validateMessage } from '../protocol/validate.js'
import { emitEvent, type Toolmark } from '../registry.js'
import { errorResult, ok, refuse, type ToolResult } from '../result.js'
import type { BridgeTransport } from './transport.js'

/** Options for {@link bridge}. */
export interface BridgeOptions {
  /** The channel to the agent. */
  transport: BridgeTransport
  /**
   * What to send on each registry revision: a full summary `manifest` (default) or a bare
   * `changed` message.
   */
  onChange?: 'manifest' | 'changed'
  /** The caller identity used for policy, manifests and calls (default `'inapp'`). */
  caller?: 'inapp'
  /**
   * Largest accepted inbound message, in UTF-8 bytes of its JSON serialization (default
   * `1048576`). Larger messages are dropped with the `error` event `invalid_message`.
   */
  maxMessageBytes?: number
}

const DEFAULT_MAX_MESSAGE_BYTES = 1048576
const MAX_DEPTH = 64
const REMEMBERED_IDS = 1000

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null

/**
 * Bounds an untrusted inbound value before it is serialized: rejects nesting deeper than
 * {@link MAX_DEPTH} (which also catches cycles) and stops as soon as a lower bound of its
 * serialized size exceeds `maxBytes`, so shared sub-trees (structured clone) cannot blow up the
 * traversal. Returns a problem description or `null`.
 */
function boundsProblem(root: unknown, maxBytes: number): string | null {
  let budget = 0
  const stack: [unknown, number][] = [[root, 1]]
  while (stack.length > 0) {
    const [value, depth] = stack.pop()!
    if (typeof value === 'string') {
      budget += value.length + 2
    } else if (isObj(value)) {
      if (depth > MAX_DEPTH) return `message nested deeper than ${MAX_DEPTH}`
      budget += 2
      if (Array.isArray(value)) {
        for (const item of value as unknown[]) stack.push([item, depth + 1])
      } else {
        for (const key of Object.keys(value)) {
          budget += key.length + 3
          stack.push([value[key], depth + 1])
        }
      }
    } else {
      budget += 1
    }
    if (budget > maxBytes) return 'message too large'
  }
  return null
}

/** UTF-8 byte length of `s`, stopping early once it exceeds `limit`. */
function utf8Exceeds(s: string, limit: number): boolean {
  if (s.length > limit) return true
  if (s.length * 3 <= limit) return false
  let bytes = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 0x80) bytes += 1
    else if (c < 0x800) bytes += 2
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const next = s.charCodeAt(i + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4
        i++
      } else bytes += 3
    } else bytes += 3
    if (bytes > limit) return true
  }
  return false
}

/**
 * Whether `value` is JSON-safe data: plain objects (`undefined` property values are allowed, JSON
 * drops them), arrays, strings, finite numbers, booleans and `null`, nested at most
 * {@link MAX_DEPTH} deep, with no cycles.
 */
function isJsonSafe(value: unknown, depth: number, ancestors: Set<object>): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'object') return false
  if (depth > MAX_DEPTH || ancestors.has(value)) return false
  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) return false
      for (const item of value as unknown[]) {
        if (!isJsonSafe(item, depth + 1, ancestors)) return false
      }
      return true
    }
    const proto: unknown = Object.getPrototypeOf(value)
    if (proto !== Object.prototype && proto !== null) return false
    for (const item of Object.values(value)) {
      if (item === undefined) continue
      if (!isJsonSafe(item, depth + 1, ancestors)) return false
    }
    return true
  } finally {
    ancestors.delete(value)
  }
}

/**
 * A detached JSON copy of a tool result, or `null` when the result is not JSON-safe. Sending a
 * copy keeps live page objects away from the agent side of in-page transports.
 */
function serializableCopy(result: ToolResult<unknown>): ToolResult<unknown> | null {
  try {
    if (!isJsonSafe(result, 1, new Set())) return null
    return JSON.parse(JSON.stringify(result)) as ToolResult<unknown>
  } catch {
    return null
  }
}

/**
 * Creates the in-app bridge consumer (spec §11.1, protocol v1 §12): attach it with
 * `tm.use(bridge({ transport }))`.
 *
 * Every inbound message is treated as hostile: it is bounded (size and depth), copied, validated
 * against protocol v1 and ignored unless addressed to this registry's `clientId`. Each `call` and
 * `describe` id is answered exactly once; duplicates of an in-flight or recently answered id (last
 * 1000) are ignored. Deferred confirmations created by bridge calls are forwarded as `confirmed`
 * messages.
 * @param options - Transport and behaviour; see {@link BridgeOptions}.
 * @returns A consumer for `tm.use`; its disposer unsubscribes everything, aborts in-flight calls
 * and closes the transport.
 * @throws TypeError when `maxMessageBytes` is not a positive integer.
 */
export function bridge(options: BridgeOptions): (tm: Toolmark) => () => void {
  const maxBytes = options.maxMessageBytes ?? DEFAULT_MAX_MESSAGE_BYTES
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) {
    throw new TypeError('maxMessageBytes must be a positive integer')
  }
  const { transport } = options
  const caller = options.caller ?? 'inapp'
  const onChange = options.onChange === 'changed' ? 'changed' : 'manifest'

  return (tm) => {
    const clientId = tm.clientId
    const inflight = new Map<string, AbortController>()
    const answered = new Set<string>()
    /** Registry call ids of calls this bridge started (captured from the `call` event). */
    const ownCalls = new Set<string>()
    /** Deferred confirmations created by this bridge's calls, awaiting a terminal stage. */
    const ownConfirms = new Set<string>()
    let capture: { tool: string; input: unknown } | null = null
    let disposed = false

    const report = (code: string, message: string, cause?: unknown): void => {
      emitEvent(tm, 'error', { code, message, ...(cause !== undefined ? { cause } : {}) })
    }

    const send = (message: PageToAgentMessage): void => {
      if (disposed) return
      try {
        const pending = transport.send(message)
        if (pending !== undefined) {
          Promise.resolve(pending).then(undefined, (cause: unknown) => {
            report('transport_failed', `Bridge transport failed to send "${message.type}"`, cause)
          })
        }
      } catch (cause) {
        report('transport_failed', `Bridge transport failed to send "${message.type}"`, cause)
      }
    }

    /** Checks JSON-safety; a non-serializable result becomes an `error` result. */
    const safeResult = (result: ToolResult<unknown>): ToolResult<unknown> => {
      const copy = serializableCopy(result)
      if (copy) return copy
      report('transport_failed', 'Result not serializable')
      return errorResult('Result not serializable')
    }

    const remember = (id: string): void => {
      answered.add(id)
      if (answered.size > REMEMBERED_IDS) {
        const oldest = answered.values().next()
        if (!oldest.done) answered.delete(oldest.value)
      }
    }

    const respond = (id: string, result: ToolResult<unknown>): void => {
      inflight.delete(id)
      remember(id)
      send({ protocol: 1, type: 'result', clientId, id, result: safeResult(result) })
    }

    const sendManifest = (): void => {
      const m = tm.manifest({ caller })
      send({ protocol: 1, type: 'manifest', clientId, rev: m.rev, tools: m.tools })
    }

    const handleCall = (
      id: string,
      tool: string,
      input: unknown,
      rev: number | undefined,
    ): void => {
      const controller = new AbortController()
      inflight.set(id, controller)
      let pending: Promise<ToolResult<unknown>>
      capture = { tool, input }
      try {
        pending = tm.call(tool, input, {
          caller,
          signal: controller.signal,
          ...(rev !== undefined ? { rev } : {}),
        })
      } catch (cause) {
        pending = Promise.reject(cause instanceof Error ? cause : new Error(String(cause)))
      } finally {
        capture = null
      }
      pending.then(
        (result) => {
          if (!disposed) respond(id, result)
        },
        (cause: unknown) => {
          if (disposed) return
          report('transport_failed', `Call "${tool}" rejected unexpectedly`, cause)
          respond(id, errorResult('Tool failed'))
        },
      )
    }

    const handle = (raw: unknown): void => {
      const problem = boundsProblem(raw, maxBytes)
      if (problem) {
        report('invalid_message', `Dropped inbound message: ${problem}`)
        return
      }
      const text = JSON.stringify(raw) as string | undefined
      if (text === undefined) {
        report('invalid_message', 'Dropped inbound message: not serializable')
        return
      }
      if (utf8Exceeds(text, maxBytes)) {
        report('invalid_message', 'Dropped inbound message: message too large')
        return
      }
      // Act on a detached plain copy: no getters, prototypes or later mutation by the sender.
      const value: unknown = JSON.parse(text)
      if (isObj(value) && typeof value.clientId === 'string' && value.clientId !== clientId) return

      const checked = validateMessage(value, 'toPage')
      if (!checked.ok) {
        // Only answer an unsupported protocol when the message is addressed to this page, so
        // several pages on one channel never answer the same id.
        if (
          checked.unsupportedProtocol &&
          checked.id !== undefined &&
          checked.id !== '' &&
          isObj(value) &&
          value.clientId === clientId
        ) {
          const id = checked.id
          if (!inflight.has(id) && !answered.has(id)) {
            respond(id, errorResult('unsupported protocol'))
          }
          return
        }
        report('invalid_message', `Dropped inbound message: ${checked.reason}`)
        return
      }
      const message = checked.message
      switch (message.type) {
        case 'call':
          if (inflight.has(message.id) || answered.has(message.id)) return
          handleCall(message.id, message.tool, message.input, message.rev)
          return
        case 'describe': {
          if (inflight.has(message.id) || answered.has(message.id)) return
          const entry = tm.describe(message.tool, { caller })
          respond(
            message.id,
            entry
              ? ok(entry)
              : refuse('unknown_tool', `Unknown tool "${message.tool}"`, { rev: tm.rev }),
          )
          return
        }
        case 'cancel':
          inflight.get(message.id)?.abort()
          return
        default:
          // Page→agent message types fail validation for direction `toPage`.
          report('invalid_message', 'Dropped inbound message: unexpected type')
      }
    }

    const onInbound = (raw: unknown): void => {
      if (disposed) return
      try {
        handle(raw)
      } catch (cause) {
        report('invalid_message', 'Dropped inbound message: could not be read', cause)
      }
    }

    const offCall = tm.events.on('call', (e) => {
      if (capture && e.caller === caller && e.tool === capture.tool && e.input === capture.input) {
        ownCalls.add(e.callId)
        capture = null
      }
    })
    const offResult = tm.events.on('result', (e) => {
      if (!ownCalls.delete(e.callId)) return
      if (e.result.status === 'needs_confirmation') ownConfirms.add(e.result.confirmId)
    })
    const offConfirm = tm.events.on('confirm', (e) => {
      if (e.stage === 'pending' || !ownConfirms.delete(e.confirmId)) return
      const result =
        e.result ??
        (e.stage === 'expired'
          ? refuse('confirmation_expired', 'The confirmation expired or was already used')
          : errorResult('Tool failed'))
      send({
        protocol: 1,
        type: 'confirmed',
        clientId,
        confirmId: e.confirmId,
        result: safeResult(result),
      })
    })
    const offRev = tm.subscribe((rev) => {
      if (onChange === 'changed') send({ protocol: 1, type: 'changed', clientId, rev })
      else sendManifest()
    })
    const offMessage = transport.onMessage(onInbound)

    sendManifest()

    return () => {
      if (disposed) return
      disposed = true
      offMessage()
      offRev()
      offConfirm()
      offResult()
      offCall()
      const controllers = [...inflight.values()]
      inflight.clear()
      ownCalls.clear()
      ownConfirms.clear()
      for (const c of controllers) c.abort()
      try {
        transport.close?.()
      } catch (cause) {
        report('transport_failed', 'Bridge transport failed to close', cause)
      }
    }
  }
}
