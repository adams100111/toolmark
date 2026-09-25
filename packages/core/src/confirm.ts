import { snapshotValue } from './forms/paths.js'
import type { FieldChange } from './result.js'
import type { Caller } from './tool.js'

/** A deferred confirmation waiting for `tm.confirmPending` (spec §7, D16). */
export interface PendingConfirmation {
  /** Single-use id. */
  confirmId: string
  /** Full tool name. */
  tool: string
  /** Tool title, if any. */
  title?: string
  /** Who made the call. */
  caller: Caller
  /** Validated input the tool will run with (unless the approval edits it). */
  input: unknown
  /** User-facing summary. */
  summary: string
  /** Field changes, if any. */
  changes?: FieldChange[]
  /** Creation time (ms since epoch). */
  createdAt: number
  /** Expiry time (ms since epoch). */
  expiresAt: number
}

/** @internal Stored pending confirmation with its owner and expiry timer. */
export interface StoredPending<Owner> {
  readonly public: PendingConfirmation
  readonly owner: Owner
  timer: ReturnType<typeof setTimeout> | undefined
  /** Expiry callback (the timer's, or a sweep that finds the item past `expiresAt`). */
  readonly onExpire: (p: StoredPending<Owner>) => void
  /** Snapshot taken by the tool's confirm-snapshot hook, if it has one. */
  snapshot?: { value: unknown }
}

/** @internal Maximum pending deferred confirmations (oldest evicted). */
export const PENDING_LIMIT = 100

/**
 * @internal Copies plain objects/arrays deeply and keeps every other value (class instances such as
 * a transformed `Money`, `File`, `Date`) by reference, so the approved run sees the same types as an
 * inline run while callers cannot mutate the stored containers (N2).
 */
export function cloneValue<T>(v: T): T {
  return snapshotValue(v)
}

/** @internal Deferred confirmation store: single-use, expiring, bounded, dropped with the tool. */
export class PendingStore<Owner> {
  readonly #items = new Map<string, StoredPending<Owner>>()

  constructor(readonly limit = PENDING_LIMIT) {}

  /** Stores `item` (input deep-copied); returns entries evicted to respect the limit. */
  add(
    item: PendingConfirmation,
    owner: Owner,
    onExpire: (p: StoredPending<Owner>) => void,
    snapshot?: { value: unknown },
  ): StoredPending<Owner>[] {
    const stored: StoredPending<Owner> = {
      public: { ...item, input: cloneValue(item.input) },
      owner,
      timer: undefined,
      onExpire,
      ...(snapshot !== undefined ? { snapshot } : {}),
    }
    stored.timer = setTimeout(
      () => {
        if (this.#items.get(item.confirmId) !== stored) return
        this.#items.delete(item.confirmId)
        onExpire(stored)
      },
      Math.max(0, item.expiresAt - item.createdAt),
    )
    this.#items.set(item.confirmId, stored)
    const evicted: StoredPending<Owner>[] = []
    while (this.#items.size > this.limit) {
      const oldest = this.#items.keys().next().value as string
      const e = this.take(oldest)
      if (e) evicted.push(e)
    }
    return evicted
  }

  /** Consumes `confirmId` synchronously (single use). */
  take(confirmId: string): StoredPending<Owner> | undefined {
    const stored = this.#items.get(confirmId)
    if (!stored) return undefined
    this.#items.delete(confirmId)
    clearTimeout(stored.timer)
    return stored
  }

  /** Removes every confirmation owned by `owner`, returning them. */
  dropOwner(owner: Owner): StoredPending<Owner>[] {
    const out: StoredPending<Owner>[] = []
    for (const [id, stored] of this.#items) {
      if (stored.owner !== owner) continue
      this.#items.delete(id)
      clearTimeout(stored.timer)
      out.push(stored)
    }
    return out
  }

  /**
   * Expires every item past its `expiresAt` (SEC-3): timers are delayed in background or frozen
   * tabs and across device sleep, so expiry is also checked against the clock on every read.
   */
  sweep(now = Date.now()): void {
    for (const [id, stored] of [...this.#items]) {
      if (now < stored.public.expiresAt) continue
      this.#items.delete(id)
      clearTimeout(stored.timer)
      stored.onExpire(stored)
    }
  }

  list(): PendingConfirmation[] {
    this.sweep()
    return [...this.#items.values()].map((s) => copyPending(s.public))
  }
}

function copyPending(p: PendingConfirmation): PendingConfirmation {
  const out: PendingConfirmation = {
    confirmId: p.confirmId,
    tool: p.tool,
    caller: p.caller,
    input: cloneValue(p.input),
    summary: p.summary,
    createdAt: p.createdAt,
    expiresAt: p.expiresAt,
  }
  if (p.title !== undefined) out.title = p.title
  if (p.changes !== undefined) out.changes = p.changes.map((c) => ({ ...c }))
  return out
}
