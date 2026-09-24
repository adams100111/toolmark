/** @internal Maximum pending (running + waiting) calls per scope. */
export const QUEUE_LIMIT = 32

/** @internal A slot handle: `cancel()` withdraws a job that has not started yet. */
export interface QueueSlot {
  cancel(): void
}

/**
 * @internal Serial per-scope queue (D22). Jobs run one at a time in arrival order; a job's promise
 * settling releases its slot. At most {@link QUEUE_LIMIT} jobs are pending at once.
 */
export class SerialQueue {
  readonly #waiting: Array<() => Promise<void>> = []
  #running = false
  #size = 0

  constructor(readonly limit = QUEUE_LIMIT) {}

  /** Adds a job; returns `null` when the queue is full (`busy`). */
  push(job: () => Promise<void>): QueueSlot | null {
    if (this.#size >= this.limit) return null
    this.#size++
    this.#waiting.push(job)
    this.#pump()
    return {
      cancel: () => {
        const i = this.#waiting.indexOf(job)
        if (i >= 0) {
          this.#waiting.splice(i, 1)
          this.#size--
        }
      },
    }
  }

  #pump(): void {
    if (this.#running) return
    const job = this.#waiting.shift()
    if (!job) return
    this.#running = true
    const release = (): void => {
      this.#running = false
      this.#size--
      this.#pump()
    }
    let p: Promise<void>
    try {
      p = job()
    } catch {
      p = Promise.resolve()
    }
    p.then(release, release)
  }
}
