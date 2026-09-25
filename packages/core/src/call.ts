import { PendingStore, type PendingConfirmation } from './confirm.js'
import { confirmRequestSignals } from './confirm-queue.js'
import { snapshotHookOf } from './confirm-snapshot.js'
import { ToolmarkError } from './errors.js'
import { safeCall } from './events.js'
import { resolveFileRef } from './files.js'
import { isPlainObject } from './forms/paths.js'
import { newId } from './ids.js'
import { isAllowed, needsConfirmation } from './policy.js'
import { SerialQueue } from './queue.js'
import type { ConfirmRequest, Entry, RegistryState } from './registry.js'
import {
  cancelled,
  errorResult,
  invalid,
  refuse,
  type FieldChange,
  type ToolResult,
} from './result.js'
import { validateInput } from './schema.js'
import type { ScopeNode } from './scope.js'
import type { Caller, ConfirmOutcome, ToolContext } from './tool.js'
import { UndoStore } from './undo.js'

const DEFAULT_CONFIRM_EXPIRY_MS = 600_000
const DEFAULT_ABORT_GRACE_MS = 5_000
const STATUSES = new Set(['ok', 'invalid', 'refused', 'needs_confirmation', 'cancelled', 'error'])

type InlineOutcome =
  | { kind: 'approved'; input?: unknown }
  | { kind: 'rejected'; reason?: string }
  | { kind: 'signal' }
  | { kind: 'expired' }

/** @internal Call options accepted by `tm.call`. */
export interface CallOptions {
  caller: Caller
  rev?: number
  signal?: AbortSignal
}

/** @internal The call pipeline, confirmations and undo behind a registry (spec §5–§7, §14). */
export interface CallRuntime {
  call(name: string, input: unknown, opts: CallOptions): Promise<ToolResult<unknown>>
  confirmPending(confirmId: string, outcome: ConfirmOutcome): Promise<ToolResult<unknown>>
  pendingConfirmations(): PendingConfirmation[]
  undo(callId: string): Promise<ToolResult<{ changes: FieldChange[] }>>
  onEntryRemoved(entry: Entry): void
}

function isToolResult(v: unknown): v is ToolResult<unknown> {
  return (
    typeof v === 'object' &&
    v !== null &&
    STATUSES.has((v as { status?: unknown }).status as string)
  )
}

/** @internal */
export function createCallRuntime(state: RegistryState): CallRuntime {
  const queues = new WeakMap<ScopeNode, SerialQueue>()
  const pending = new PendingStore<Entry>()
  const undos = new UndoStore<Entry>()
  const expiryMs = (): number => state.options.confirmExpiryMs ?? DEFAULT_CONFIRM_EXPIRY_MS
  const graceMs = (): number => state.options.abortGraceMs ?? DEFAULT_ABORT_GRACE_MS

  const queueFor = (scope: ScopeNode): SerialQueue => {
    let q = queues.get(scope)
    if (!q) queues.set(scope, (q = new SerialQueue()))
    return q
  }

  const summaryOf = (entry: Entry, input: unknown): string => {
    try {
      const s = entry.tool.summary?.(input)
      if (typeof s === 'string') return s
    } catch (cause) {
      state.report({
        code: 'tool_threw',
        message: `summary() of "${entry.fullName}" threw`,
        tool: entry.fullName,
        cause,
      })
    }
    return entry.tool.title ?? entry.fullName
  }

  const emitConfirm = (
    confirmId: string,
    entry: Entry,
    stage: 'pending' | 'approved' | 'rejected' | 'expired',
    result?: ToolResult<unknown>,
  ): void => {
    state.emitter.emit('confirm', {
      confirmId,
      tool: entry.fullName,
      stage,
      ...(result !== undefined ? { result } : {}),
    })
  }

  /** Takes the tool's confirm snapshot, if it has a snapshot hook. */
  const takeSnapshot = (entry: Entry): { value: unknown } | undefined => {
    const hook = snapshotHookOf(entry.tool)
    if (!hook) return undefined
    try {
      return { value: hook.take() }
    } catch (cause) {
      state.report({ code: 'tool_threw', message: 'snapshot failed', tool: entry.fullName, cause })
      return { value: undefined }
    }
  }
  const snapshotPrecheck =
    (entry: Entry, snapshot: { value: unknown } | undefined) => (): ToolResult<unknown> | null => {
      const hook = snapshotHookOf(entry.tool)
      if (!hook || snapshot === undefined) return null
      let changed = true
      try {
        changed = hook.changed(snapshot.value)
      } catch (cause) {
        state.report({
          code: 'tool_threw',
          message: 'snapshot check failed',
          tool: entry.fullName,
          cause,
        })
      }
      return changed
        ? refuse('stale', 'Form changed since confirmation was requested', { rev: state.rev })
        : null
    }

  const expiredResult = (): ToolResult<never> =>
    refuse('confirmation_expired', 'The confirmation expired or was already used')

  /**
   * Validates with `schema`, never throwing: a throwing validator becomes `error` "Tool failed"
   * plus a `tool_threw` event (C1).
   */
  async function check(
    entry: Entry,
    value: unknown,
  ): Promise<{ ok: true; value: unknown } | { ok: false; result: ToolResult<unknown> }> {
    if (entry.tool.input === undefined && entry.tool.jsonSchema === undefined) {
      // m7: the advertised schema is `{ type: 'object', properties: {}, additionalProperties:
      // false }`, so only "no input" or an empty plain object is accepted.
      const empty = value === undefined || (isPlainObject(value) && Object.keys(value).length === 0)
      return empty
        ? { ok: true, value }
        : { ok: false, result: invalid([{ path: '', message: 'This tool takes no input' }]) }
    }
    try {
      const v = await validateInput(entry.validator, value)
      return v.ok ? v : { ok: false, result: invalid(v.issues) }
    } catch (cause) {
      state.report({
        code: 'tool_threw',
        message: `Input validation of "${entry.fullName}" threw`,
        tool: entry.fullName,
        cause,
      })
      return { ok: false, result: errorResult('Tool failed') }
    }
  }

  /** Asks the inline handler, bounded by `signal` and the confirmation expiry. Never rejects. */
  function askInline(
    entry: Entry,
    req: { summary: string; changes?: FieldChange[] },
    caller: Caller,
    input: unknown,
    signal: AbortSignal | undefined,
  ): Promise<InlineOutcome> {
    const handler = state.options.confirm
    if (!handler) return Promise.resolve({ kind: 'rejected' })
    const confirmId = newId()
    const request: ConfirmRequest = {
      confirmId,
      tool: entry.fullName,
      ...(entry.tool.title !== undefined ? { title: entry.tool.title } : {}),
      caller,
      input,
      hints: { ...entry.tool.hints },
      summary: req.summary,
      ...(req.changes !== undefined ? { changes: req.changes } : {}),
    }
    const requestAbort = new AbortController()
    confirmRequestSignals.set(request, requestAbort.signal)
    const deadline = Date.now() + expiryMs()
    emitConfirm(confirmId, entry, 'pending')
    return new Promise<InlineOutcome>((resolve) => {
      let done = false
      const finish = (settled: InlineOutcome): void => {
        if (done) return
        done = true
        // SEC-3: an approval that arrives after the deadline (the timer fired late) is expired.
        const outcome: InlineOutcome =
          settled.kind === 'approved' && Date.now() >= deadline ? { kind: 'expired' } : settled
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        requestAbort.abort()
        const stage =
          outcome.kind === 'approved'
            ? 'approved'
            : outcome.kind === 'expired'
              ? 'expired'
              : 'rejected'
        emitConfirm(confirmId, entry, stage)
        resolve(outcome)
      }
      const onAbort = (): void => finish({ kind: 'signal' })
      const timer = setTimeout(() => finish({ kind: 'expired' }), expiryMs())
      if (signal?.aborted) {
        onAbort()
        return
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      Promise.resolve()
        .then(() => handler(request))
        .then(
          (outcome) => {
            if (outcome?.approved === true) {
              finish(
                outcome.input !== undefined
                  ? { kind: 'approved', input: outcome.input }
                  : { kind: 'approved' },
              )
            } else {
              const reason = (outcome as { reason?: unknown } | undefined)?.reason
              finish(
                typeof reason === 'string' ? { kind: 'rejected', reason } : { kind: 'rejected' },
              )
            }
          },
          (cause: unknown) => {
            state.report({
              code: 'tool_threw',
              message: `The inline confirm handler threw for "${entry.fullName}"`,
              tool: entry.fullName,
              cause,
            })
            finish({ kind: 'rejected' })
          },
        )
    })
  }

  /** `ctx.confirm` inside `run` (spec §5). Never throws. */
  async function ctxConfirm(
    entry: Entry,
    caller: Caller,
    input: unknown,
    req: { summary: string; changes?: FieldChange[] },
    signal: AbortSignal,
  ): Promise<ConfirmOutcome> {
    if (caller === 'human') return { approved: true }
    if (state.modeOf(caller) === 'inline' && state.options.confirm) {
      const outcome = await askInline(entry, req, caller, input, signal)
      switch (outcome.kind) {
        case 'approved':
          return outcome.input !== undefined
            ? { approved: true, input: outcome.input }
            : { approved: true }
        case 'rejected':
          return outcome.reason !== undefined
            ? { approved: false, reason: outcome.reason }
            : { approved: false }
        case 'signal':
          return { approved: false, reason: 'signal' }
        case 'expired':
          return { approved: false, reason: 'expired' }
      }
    }
    if (state.dev) {
      state.report({
        code: 'ctx_confirm_unavailable',
        message:
          `ctx.confirm() in "${entry.fullName}" has no inline confirmation path for caller ` +
          `"${caller}"; declare the tool consequential instead`,
        tool: entry.fullName,
      })
    }
    return { approved: false, reason: 'confirmation_unavailable' }
  }

  /** Runs the tool; resolves with its result, or `cancelled` after the abort grace period. */
  function runTool(
    entry: Entry,
    value: unknown,
    caller: Caller,
    callId: string,
    callerSignal: AbortSignal | undefined,
  ): Promise<ToolResult<unknown>> {
    const controller = new AbortController()
    const onCallerAbort = (): void => controller.abort(callerSignal?.reason)
    if (callerSignal?.aborted) onCallerAbort()
    else callerSignal?.addEventListener('abort', onCallerAbort, { once: true })

    const ctx: ToolContext = {
      signal: controller.signal,
      callId,
      caller,
      confirm: (req) => ctxConfirm(entry, caller, value, req, controller.signal),
      registerUndo: (restore) => undos.set(callId, entry, restore),
      files: {
        resolve: (ref) => resolveFileRef(ref, {}, state.files, controller.signal),
      },
    }
    const work = (async (): Promise<ToolResult<unknown>> => {
      try {
        const result: unknown = await entry.tool.run(value, ctx)
        if (isToolResult(result)) return result
        state.report({
          code: 'tool_threw',
          message: `Tool "${entry.fullName}" returned something that is not a ToolResult`,
          tool: entry.fullName,
        })
      } catch (cause) {
        // Files (spec §8.4): a file rejection is the agent's input being refused, not a tool bug.
        if (cause instanceof ToolmarkError && cause.code === 'file_rejected') {
          return refuse('file_rejected', cause.message)
        }
        state.report({
          code: 'tool_threw',
          message: `Tool "${entry.fullName}" threw`,
          tool: entry.fullName,
          cause,
        })
      }
      return errorResult('Tool failed')
    })()

    return new Promise<ToolResult<unknown>>((resolve) => {
      let settled = false
      let graceTimer: ReturnType<typeof setTimeout> | undefined
      const startGrace = (): void => {
        graceTimer = setTimeout(() => {
          if (settled) return
          settled = true
          resolve(cancelled('signal'))
        }, graceMs())
      }
      if (controller.signal.aborted) startGrace()
      else controller.signal.addEventListener('abort', startGrace, { once: true })

      void work.then(async (result) => {
        callerSignal?.removeEventListener('abort', onCallerAbort)
        controller.signal.removeEventListener('abort', startGrace)
        if (settled) {
          state.report({
            code: 'late_result',
            message: `Tool "${entry.fullName}" settled after its call was abandoned; result dropped`,
            tool: entry.fullName,
          })
          return
        }
        settled = true
        clearTimeout(graceTimer)
        if (state.dev && result.status === 'ok' && entry.tool.output) {
          try {
            const checked = await validateInput(entry.tool.output, result.data)
            if (!checked.ok) {
              state.report({
                code: 'output_invalid',
                message: `Tool "${entry.fullName}" returned data that fails its output schema`,
                tool: entry.fullName,
                cause: checked.issues,
              })
            }
          } catch (cause) {
            state.report({
              code: 'output_invalid',
              message: `Output validation of "${entry.fullName}" threw`,
              tool: entry.fullName,
              cause,
            })
          }
        }
        resolve(result)
      })
    })
  }

  /** Enqueues a run on the tool's scope queue (serial per scope, `busy` beyond the limit). */
  function enqueue(
    entry: Entry,
    value: unknown,
    caller: Caller,
    callId: string,
    signal: AbortSignal | undefined,
    precheck?: () => ToolResult<unknown> | null,
  ): Promise<ToolResult<unknown>> {
    return new Promise<ToolResult<unknown>>((resolve) => {
      let settled = false
      let started = false
      const done = (r: ToolResult<unknown>): void => {
        if (settled) return
        settled = true
        signal?.removeEventListener('abort', onQueuedAbort)
        resolve(r)
      }
      const onQueuedAbort = (): void => {
        if (started) return
        slot?.cancel()
        done(cancelled('signal'))
      }
      const slot = queueFor(entry.scope).push(async () => {
        started = true
        signal?.removeEventListener('abort', onQueuedAbort)
        if (settled) return
        if (!entry.alive) {
          done(refuse('unknown_tool', `Tool "${entry.fullName}" was removed`, { rev: state.rev }))
          return
        }
        if (signal?.aborted) {
          done(cancelled('signal'))
          return
        }
        const refused = precheck?.()
        if (refused) {
          done(refused)
          return
        }
        done(await runTool(entry, value, caller, callId, signal))
      })
      if (!slot) {
        done(refuse('busy', `Too many pending calls in the scope of "${entry.fullName}"`))
        return
      }
      if (!started) signal?.addEventListener('abort', onQueuedAbort, { once: true })
    })
  }

  /** Emits `call`, returns a function that emits `result` and passes the result through. */
  function track(
    callId: string,
    tool: string,
    caller: Caller,
    input: unknown,
  ): (r: ToolResult<unknown>) => ToolResult<unknown> {
    const started = Date.now()
    state.emitter.emit('call', { callId, tool, caller, input })
    return (result) => {
      state.emitter.emit('result', {
        callId,
        tool,
        caller,
        result,
        durationMs: Date.now() - started,
      })
      return result
    }
  }

  async function call(
    name: string,
    input: unknown,
    opts: CallOptions,
  ): Promise<ToolResult<unknown>> {
    const { caller, signal } = opts
    if (!state.browser) return refuse('unknown_tool', `Unknown tool "${name}"`, { rev: 0 })
    const entry = state.entries.get(name)
    if (!entry || !entry.alive || !entry.scope.isShown()) {
      if (opts.rev !== undefined && opts.rev !== state.rev) {
        return refuse('stale', `Tool "${name}" is not available at rev ${state.rev}`, {
          rev: state.rev,
        })
      }
      return refuse('unknown_tool', `Unknown tool "${name}"`, { rev: state.rev })
    }
    if (
      !isAllowed(state.policy, caller, entry.cls, entry.fullName) ||
      !state.visible(entry, caller)
    ) {
      return refuse('not_allowed', `Caller "${caller}" may not call "${name}"`)
    }

    const callId = newId()
    const finish = track(callId, name, caller, input)
    if (signal?.aborted) return finish(cancelled('signal'))

    const validated = await check(entry, input)
    if (!validated.ok) return finish(validated.result)
    let value = validated.value
    let precheck: (() => ToolResult<unknown> | null) | undefined

    if (needsConfirmation(entry.cls) && caller !== 'human') {
      const summary = summaryOf(entry, value)
      if (state.modeOf(caller) === 'deferred') {
        const confirmId = newId()
        const now = Date.now()
        const evicted = pending.add(
          {
            confirmId,
            tool: entry.fullName,
            ...(entry.tool.title !== undefined ? { title: entry.tool.title } : {}),
            caller,
            input: value,
            summary,
            createdAt: now,
            expiresAt: now + expiryMs(),
          },
          entry,
          () => emitConfirm(confirmId, entry, 'expired', expiredResult()),
          takeSnapshot(entry),
        )
        for (const e of evicted) {
          emitConfirm(e.public.confirmId, e.owner, 'expired', expiredResult())
        }
        emitConfirm(confirmId, entry, 'pending')
        return finish(Object.freeze({ status: 'needs_confirmation' as const, confirmId, summary }))
      }
      const snapshot = takeSnapshot(entry)
      precheck = snapshotPrecheck(entry, snapshot)
      const outcome = await askInline(entry, { summary }, caller, value, signal)
      if (outcome.kind === 'signal') return finish(cancelled('signal'))
      if (outcome.kind !== 'approved') return finish(cancelled('operator'))
      if (outcome.input !== undefined) {
        const edited = await check(entry, outcome.input)
        if (!edited.ok) return finish(edited.result)
        value = edited.value
      }
    }
    return finish(await enqueue(entry, value, caller, callId, signal, precheck))
  }

  async function confirmPending(
    confirmId: string,
    outcome: ConfirmOutcome,
  ): Promise<ToolResult<unknown>> {
    const stored = pending.take(confirmId)
    if (!stored) return expiredResult()
    for (const fn of [...state.pendingConsumed]) safeCall(fn, 'pending confirmation listener')
    const entry = stored.owner
    // SEC-3: a late expiry timer (frozen tab, device sleep) must not let an expired item run.
    if (Date.now() >= stored.public.expiresAt) {
      const r = expiredResult()
      emitConfirm(confirmId, entry, 'expired', r)
      return r
    }
    if (outcome.approved !== true) {
      const r = cancelled('operator')
      emitConfirm(confirmId, entry, 'rejected', r)
      return r
    }
    let value = stored.public.input
    if (outcome.input !== undefined) {
      const edited = await check(entry, outcome.input)
      if (!edited.ok) {
        emitConfirm(confirmId, entry, 'approved', edited.result)
        return edited.result
      }
      value = edited.value
    }
    const callId = newId()
    const finish = track(callId, entry.fullName, 'human', value)
    const r = finish(
      await enqueue(
        entry,
        value,
        'human',
        callId,
        undefined,
        snapshotPrecheck(entry, stored.snapshot),
      ),
    )
    emitConfirm(confirmId, entry, 'approved', r)
    return r
  }

  /** Runs a stored undo restorer once, on the tool's scope queue (m7). */
  function undo(callId: string): Promise<ToolResult<{ changes: FieldChange[] }>> {
    const item = undos.take(callId)
    if (!item || !item.owner.alive) {
      return Promise.resolve(refuse('undo_unavailable', 'Nothing to undo for this call'))
    }
    const owner = item.owner
    const restore = async (): Promise<ToolResult<{ changes: FieldChange[] }>> => {
      if (!owner.alive) return refuse('undo_unavailable', 'Nothing to undo for this call')
      try {
        const r: unknown = await item.restore()
        if (isToolResult(r)) return r as ToolResult<{ changes: FieldChange[] }>
      } catch (cause) {
        state.report({
          code: 'tool_threw',
          message: `Undo of "${owner.fullName}" threw`,
          tool: owner.fullName,
          cause,
        })
      }
      return errorResult('Tool failed')
    }
    return new Promise((resolve) => {
      const slot = queueFor(owner.scope).push(async () => resolve(await restore()))
      if (!slot)
        resolve(refuse('busy', `Too many pending calls in the scope of "${owner.fullName}"`))
    })
  }

  return {
    call,
    confirmPending,
    pendingConfirmations: () => pending.list(),
    undo,
    onEntryRemoved(entry) {
      for (const dropped of pending.dropOwner(entry)) {
        emitConfirm(dropped.public.confirmId, entry, 'expired', expiredResult())
      }
      undos.dropOwner(entry)
    },
  }
}
