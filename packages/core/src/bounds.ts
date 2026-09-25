// Shared bounds of untrusted inbound values (the bridge's inbound messages, WebMCP `execute` input).

/** @internal Deepest nesting accepted in an untrusted inbound value. */
export const MAX_DEPTH = 64

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

/**
 * @internal Bounds an untrusted inbound value before it is serialized: rejects nesting deeper than
 * {@link MAX_DEPTH} (which also catches cycles) and stops as soon as a lower bound of its
 * serialized size exceeds `maxBytes`. Array lengths are charged before their slots are visited, so
 * sparse arrays and shared sub-trees (structured clone) cannot blow up the traversal: the work is
 * bounded by `maxBytes`. Returns a problem description or `null`.
 */
export function boundsProblem(root: unknown, maxBytes: number): string | null {
  const tooLarge = 'message too large'
  let budget = 0
  const stack: [unknown, number][] = [[root, 1]]
  while (stack.length > 0) {
    const [value, depth] = stack.pop()!
    if (typeof value === 'string') {
      budget += value.length + 2
    } else if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
      budget += 1
    } else if (isObj(value)) {
      if (depth > MAX_DEPTH) return `message nested deeper than ${MAX_DEPTH}`
      budget += 2
      if (Array.isArray(value)) {
        const length = (value as unknown[]).length
        // Every slot serializes to at least one byte (holes become `null`), plus the commas.
        budget += Math.max(0, 2 * length - 1)
        if (budget > maxBytes) return tooLarge
        budget -= length // each slot charges itself again when visited
        for (let i = 0; i < length; i++) stack.push([(value as unknown[])[i], depth + 1])
      } else {
        let first = true
        for (const key of Object.keys(value)) {
          const item = value[key]
          if (item === undefined || typeof item === 'function' || typeof item === 'symbol') continue
          budget += key.length + 3 + (first ? 0 : 1) // quotes, colon, comma
          first = false
          if (budget > maxBytes) return tooLarge
          stack.push([item, depth + 1])
        }
      }
    }
    if (budget > maxBytes) return tooLarge
  }
  return null
}

/** @internal UTF-8 byte length of `s`, stopping early once it exceeds `limit`. */
export function utf8Exceeds(s: string, limit: number): boolean {
  if (s.length > limit) return true
  if (s.length * 3 <= limit) return false
  let bytes = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 0x80) bytes += 1
    else if (c < 0x800) bytes += 2
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const next = s.charCodeAt(i + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4
        i++
      } else bytes += 3
    } else bytes += 3
    if (bytes > limit) return true
  }
  return false
}
