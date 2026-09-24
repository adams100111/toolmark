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
}

/** @internal Maximum pending deferred confirmations (oldest evicted). */
export const PENDING_LIMIT = 100

/** @internal Deep copy where possible (inputs are JSON-like); falls back to the reference. */
export function cloneValue<T>(v: T): T {
  try {
    return structuredClone(v)
  } catch {
    return v
  }
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
  ): StoredPending<Owner>[] {
    const stored: StoredPending<Owner> = {
      public: { ...item, input: cloneValue(item.input) },
      owner,
      timer: undefined,
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

  list(): PendingConfirmation[] {
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
