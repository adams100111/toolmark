import {
  createToolmark,
  type Caller,
  type ConfirmOutcome,
  type ConfirmRequest,
  type Toolmark,
  type ToolmarkOptions,
  type ToolResult,
} from '@toolmark/core'

/** One recorded `result` event, in call order (spec §18). */
export interface RecordedCall {
  /** Full tool name. */
  tool: string
  /** Who made the call (`human` for approved deferred/inline confirmations). */
  caller: Caller
  /** Validated input the call started with. */
  input: unknown
  /** The call's settled result. */
  result: ToolResult<unknown>
}

/** The extra surface {@link createTestToolmark} adds onto the registry object itself. */
export interface TestToolmark {
  /** Every settled call, in order (mixed onto the registry, never a copy). */
  calls: RecordedCall[]
  /** Every inline confirmation request the installed handler has seen, in order. */
  confirms: ConfirmRequest[]
  /** Approves every currently pending deferred confirmation. */
  approveAll(): Promise<void>
}

/** Options accepted by {@link createTestToolmark}. */
export interface CreateTestToolmarkOptions extends ToolmarkOptions {
  /**
   * Scripts the installed inline confirmation handler for inline-mode callers (`webmcp`, `mcp`,
   * `tour`, or `inapp`/`test` configured inline): `'approve'` (default), `'reject'`, or a function
   * given the full request. `opts.confirm`, when given, wins and runs instead (still recorded in
   * `.confirms`).
   */
  inline?: 'approve' | 'reject' | ((req: ConfirmRequest) => Promise<ConfirmOutcome>)
}

/**
 * Creates a `Toolmark` registry for Vitest and other node-environment tests. Production
 * confirmation modes stay intact (spec §11.6 amended): `inapp`/`test` default to `deferred`,
 * `webmcp`/`mcp`/`tour` stay `inline`. An inline confirm handler is always installed (scripted by
 * `inline`, or `opts.confirm` when given), every request it sees is recorded in `.confirms`, every
 * settled call is recorded in `.calls`, `.approveAll()` approves every pending deferred
 * confirmation, and `__environment` is forced to `'browser'` so registration is never inert. Never
 * imports `@playwright/test`.
 * @param opts - `ToolmarkOptions` plus `inline`.
 * @returns The registry with `.calls`, `.confirms` and `.approveAll()` mixed onto the same object:
 * never a copy, since the registry's internal state is keyed by the object's own identity.
 */
export function createTestToolmark(opts: CreateTestToolmarkOptions = {}): Toolmark & TestToolmark {
  const { inline = 'approve', confirm: userConfirm, ...rest } = opts

  const calls: RecordedCall[] = []
  const confirms: ConfirmRequest[] = []
  const started = new Map<string, { tool: string; caller: Caller; input: unknown }>()

  const scriptedOutcome = (req: ConfirmRequest): Promise<ConfirmOutcome> => {
    if (typeof inline === 'function') return inline(req)
    return Promise.resolve(inline === 'reject' ? { approved: false } : { approved: true })
  }

  const handleInline = (req: ConfirmRequest): Promise<ConfirmOutcome> => {
    confirms.push(req)
    return userConfirm ? userConfirm(req) : scriptedOutcome(req)
  }

  const tm = createToolmark({
    ...rest,
    confirm: handleInline,
    __environment: 'browser',
  })

  tm.events.on('call', (e) => {
    started.set(e.callId, { tool: e.tool, caller: e.caller, input: e.input })
  })
  tm.events.on('result', (e) => {
    const info = started.get(e.callId)
    started.delete(e.callId)
    calls.push({
      tool: e.tool,
      caller: e.caller,
      input: info ? info.input : undefined,
      result: e.result,
    })
  })

  async function approveAll(): Promise<void> {
    const pending = tm.pendingConfirmations()
    await Promise.all(pending.map((p) => tm.confirmPending(p.confirmId, { approved: true })))
  }

  return Object.assign(tm, { calls, confirms, approveAll })
}
