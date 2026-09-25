/** A promise with external resolve (test helper). */
export function deferred<T = void>(): {
  promise: Promise<T>
  resolve: (v: T) => void
} {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

/** Lets pending promise callbacks run (a few macrotask turns). */
export async function settle(turns = 3): Promise<void> {
  for (let i = 0; i < turns; i++) await new Promise((r) => setTimeout(r, 0))
}
