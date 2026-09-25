/**
 * `@toolmark/testing/page` — The in-page test hook (`installTestHook`), installed only outside production builds.
 * @packageDocumentation
 * @module @toolmark/testing/page
 */
import type {
  Caller,
  ConfirmOutcome,
  PendingConfirmation,
  Toolmark,
  ToolManifest,
  ToolManifestSummary,
  ToolResult,
} from '@toolmark/core'

/** Callers the test hook accepts: every {@link Caller} except `human` (spec §11.6). */
export type TestHookCaller = Exclude<Caller, 'human'>

/** The JSON-safe surface installed at `globalThis.__toolmark_test__` by {@link installTestHook}. */
export interface ToolmarkTestHook {
  /** Summary or full manifest, filtered by `caller` (default `'test'`). */
  manifest(opts?: { caller?: TestHookCaller; detail?: 'summary' | 'full' }): {
    rev: number
    tools: ToolManifestSummary[] | ToolManifest[]
  }
  /** Full manifest entry of one tool, or `undefined` when unknown/hidden for `caller`. */
  describe(name: string, opts?: { caller?: TestHookCaller }): ToolManifest | undefined
  /** Calls a tool; `caller` defaults to `'test'`. */
  call(
    name: string,
    input: unknown,
    opts?: { caller?: TestHookCaller },
  ): Promise<ToolResult<unknown>>
  /** Completes a pending deferred confirmation. */
  confirmPending(confirmId: string, outcome: ConfirmOutcome): Promise<ToolResult<unknown>>
  /** Deferred confirmations currently pending. */
  pending(): PendingConfirmation[]
}

declare global {
  var __toolmark_test__: ToolmarkTestHook | undefined
}

const HUMAN_MESSAGE = 'caller human is not allowed through the test hook'

function checkCaller(caller: TestHookCaller | undefined): void {
  if ((caller as Caller | undefined) === 'human') throw new TypeError(HUMAN_MESSAGE)
}

/**
 * Installs the test hook at `globalThis.__toolmark_test__` for `tm`. Test builds only: apps call
 * this behind a non-production check (see Task 15's pattern). It accepts every caller except
 * `human`, which throws (or rejects, from `call`) a `TypeError` with message
 * `"caller human is not allowed through the test hook"`.
 * @param tm - The registry to expose.
 * @returns Removes the hook (idempotent; a no-op if another `installTestHook` call replaced it).
 */
export function installTestHook(tm: Toolmark): () => void {
  const hook: ToolmarkTestHook = {
    manifest(opts) {
      checkCaller(opts?.caller)
      const caller = opts?.caller as Caller | undefined
      const callerOpt = caller !== undefined ? { caller } : {}
      return opts?.detail === 'full'
        ? tm.manifest({ ...callerOpt, detail: 'full' })
        : tm.manifest(callerOpt)
    },
    describe(name, opts) {
      checkCaller(opts?.caller)
      const caller = opts?.caller as Caller | undefined
      return tm.describe(name, caller !== undefined ? { caller } : {})
    },
    async call(name, input, opts) {
      checkCaller(opts?.caller)
      const caller = (opts?.caller as Caller | undefined) ?? 'test'
      return tm.call(name, input, { caller })
    },
    confirmPending: (confirmId, outcome) => tm.confirmPending(confirmId, outcome),
    pending: () => tm.pendingConfirmations(),
  }
  globalThis.__toolmark_test__ = hook
  let removed = false
  return () => {
    if (removed) return
    removed = true
    if (globalThis.__toolmark_test__ === hook) globalThis.__toolmark_test__ = undefined
  }
}
