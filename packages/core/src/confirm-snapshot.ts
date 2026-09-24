/**
 * @internal Hook a tool can carry (under this symbol) so that a confirmation is invalidated when the
 * state it describes changes before approval (submit TOCTOU, fix round 1 I3). `take()` runs when
 * the confirmation is requested; `changed(snapshot)` runs right before the approved run.
 */
export const CONFIRM_SNAPSHOT: unique symbol = Symbol('toolmark.confirmSnapshot')

/** @internal */
export interface ConfirmSnapshotHook {
  take(): unknown
  changed(snapshot: unknown): boolean
}

/** @internal Reads the hook from a tool definition, if any. */
export function snapshotHookOf(tool: object): ConfirmSnapshotHook | undefined {
  const hook = (tool as { [CONFIRM_SNAPSHOT]?: unknown })[CONFIRM_SNAPSHOT]
  return typeof hook === 'object' && hook !== null ? (hook as ConfirmSnapshotHook) : undefined
}
