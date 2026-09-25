/**
 * Returns a random RFC 4122 v4 UUID (lowercase). Uses `crypto.randomUUID()` when available
 * (secure contexts only), else builds one from `crypto.getRandomValues`. Never `Math.random`.
 * @internal
 */
export function newId(): string {
  const c = globalThis.crypto as Crypto & { randomUUID?: () => string }
  if (typeof c.randomUUID === 'function') return c.randomUUID()
  const b = c.getRandomValues(new Uint8Array(16))
  b[6] = (b[6]! & 0x0f) | 0x40
  b[8] = (b[8]! & 0x3f) | 0x80
  let hex = ''
  for (const byte of b) hex += byte.toString(16).padStart(2, '0')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
