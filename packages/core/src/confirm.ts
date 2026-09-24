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

/** @internal Deferred confirmation store: single-use, expiring, dropped with the owning tool. */
export class PendingStore<Owner> {
  readonly #items = new Map<string, StoredPending<Owner>>()

  add(item: PendingConfirmation, owner: Owner, onExpire: (p: StoredPending<Owner>) => void): void {
    const stored: StoredPending<Owner> = { public: item, owner, timer: undefined }
    stored.timer = setTimeout(
      () => {
        if (this.#items.get(item.confirmId) !== stored) return
        this.#items.delete(item.confirmId)
        onExpire(stored)
      },
      Math.max(0, item.expiresAt - item.createdAt),
    )
    this.#items.set(item.confirmId, stored)
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
    input: p.input,
    summary: p.summary,
    createdAt: p.createdAt,
    expiresAt: p.expiresAt,
  }
  if (p.title !== undefined) out.title = p.title
  if (p.changes !== undefined) out.changes = p.changes.map((c) => ({ ...c }))
  return out
}
