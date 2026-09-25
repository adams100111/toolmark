/**
 * One field change reported by a form tool (`fill` / undo) or a confirmation card.
 * Sensitive paths carry `'[redacted]'` in `before` and `after`.
 */
export interface FieldChange {
  /** Dot path of the field, e.g. `title.en`. */
  path: string
  /** Value before the change. */
  before: unknown
  /** Value after the change. */
  after: unknown
}

/** A validation issue: dot `path` (root is `""`) and a human-readable `message`. */
export interface ToolIssue {
  /** Dot path of the offending value; `""` for the root. */
  path: string
  /** Human-readable message. */
  message: string
}

/**
 * The outcome of a tool call (spec §6). Plain, frozen, structured-cloneable data; a call never
 * throws, every failure is one of these statuses.
 */
export type ToolResult<T> =
  | { status: 'ok'; data: T }
  | { status: 'invalid'; issues: { path: string; message: string }[] }
  | { status: 'refused'; code: string; message: string; rev?: number }
  | { status: 'needs_confirmation'; confirmId: string; summary: string; changes?: FieldChange[] }
  | { status: 'cancelled'; by: 'operator' | 'signal' | 'policy' }
  | { status: 'error'; message: string }

/**
 * Successful result.
 * @param data - The tool's output data.
 * @returns `{ status: 'ok', data }`, frozen.
 */
export function ok<T>(data: T): ToolResult<T> {
  return Object.freeze({ status: 'ok' as const, data })
}

/**
 * Input validation failure.
 * @param issues - One entry per offending path.
 * @returns `{ status: 'invalid', issues }`, frozen.
 */
export function invalid(issues: { path: string; message: string }[]): ToolResult<never> {
  return Object.freeze({
    status: 'invalid' as const,
    issues: issues.map((i) => ({ path: i.path, message: i.message })),
  })
}

/**
 * The call was refused before running (policy, unknown tool, stale revision, busy queue, …).
 * @param code - A reserved `refused` code such as `unknown_tool` or `not_allowed`.
 * @param message - Human-readable explanation.
 * @param extra - Optional `rev` (manifest revision) for `unknown_tool` / `stale`.
 * @returns `{ status: 'refused', code, message, rev? }`, frozen.
 */
export function refuse(code: string, message: string, extra?: { rev?: number }): ToolResult<never> {
  return Object.freeze(
    extra?.rev !== undefined
      ? { status: 'refused' as const, code, message, rev: extra.rev }
      : { status: 'refused' as const, code, message },
  )
}

/**
 * The call was cancelled.
 * @param by - `operator` (a human rejected), `signal` (aborted) or `policy`.
 * @returns `{ status: 'cancelled', by }`, frozen.
 */
export function cancelled(by: 'operator' | 'signal' | 'policy'): ToolResult<never> {
  return Object.freeze({ status: 'cancelled' as const, by })
}

/** @internal Builds an `error` result (generic message; details go to events only). */
export function errorResult(message: string): ToolResult<never> {
  return Object.freeze({ status: 'error' as const, message })
}
