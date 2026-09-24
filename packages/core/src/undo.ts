import type { ToolResult } from './result.js'

/** @internal Maximum stored undo restorers (oldest evicted). */
export const UNDO_LIMIT = 100

type Restore = () => ToolResult<unknown> | Promise<ToolResult<unknown>>

/** @internal Undo restorers keyed by `callId`, bounded, dropped with their tool. */
export class UndoStore<Owner> {
  readonly #items = new Map<string, { restore: Restore; owner: Owner }>()

  constructor(readonly limit = UNDO_LIMIT) {}

  set(callId: string, owner: Owner, restore: Restore): void {
    this.#items.delete(callId)
    this.#items.set(callId, { restore, owner })
    while (this.#items.size > this.limit) {
      const oldest = this.#items.keys().next().value as string
      this.#items.delete(oldest)
    }
  }

  /** Removes and returns the restorer for `callId`. */
  take(callId: string): { restore: Restore; owner: Owner } | undefined {
    const item = this.#items.get(callId)
    this.#items.delete(callId)
    return item
  }

  /** Drops every restorer owned by `owner`. */
  dropOwner(owner: Owner): void {
    for (const [id, item] of this.#items) if (item.owner === owner) this.#items.delete(id)
  }
}
