import { randomInt, timingSafeEqual } from 'node:crypto'

/** Crockford base32 alphabet of pairing codes. */
export const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
/** Characters in a pairing code (shown `XXXX-XXXX`). */
export const CODE_LENGTH = 8
/** Lifetime of a pairing code. */
export const CODE_TTL_MS = 300_000
/** Failed attempts (wrong code or token, across all connections) that rotate the code. */
export const MAX_FAILED_ATTEMPTS = 5

/** Longest raw input considered for normalization; longer input is rejected unread. */
const MAX_INPUT_LENGTH = 64

/** @internal A fresh random code (8 characters, no separator). */
export function generateCode(): string {
  let code = ''
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(32)]
  return code
}

/** @internal The display form `XXXX-XXXX` of a raw code. */
export function formatCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`
}

/**
 * @internal Normalizes user input: uppercase, `-` and spaces removed, `I`/`L` → `1`, `O` → `0`.
 * Returns `null` unless the result is exactly 8 alphabet characters.
 */
export function normalizeCode(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > MAX_INPUT_LENGTH) return null
  const s = input.toUpperCase().replace(/[\s-]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0')
  if (s.length !== CODE_LENGTH) return null
  for (const ch of s) if (!CODE_ALPHABET.includes(ch)) return null
  return s
}

/** @internal Constant-time comparison of two ASCII strings of any length. */
export function constantTimeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  if (x.length !== y.length) {
    // Still spend one comparison so the length check is not the only work done.
    timingSafeEqual(x, x)
    return false
  }
  return timingSafeEqual(x, y)
}

/** @internal The single current pairing code, its expiry and the failed-attempt budget. */
export interface PairingCodes {
  /** The current code (display form) and its remaining lifetime; replaces an expired code first. */
  current(): { code: string; expiresInMs: number }
  /**
   * Checks `input`. A match consumes the code and issues a new one; a miss counts one failed
   * attempt. An expired code never matches (it is replaced).
   */
  verify(input: unknown): boolean
  /** Counts one failed attempt (e.g. an unknown session token); the fifth rotates the code. */
  fail(): void
}

/**
 * @internal Creates the pairing code store. `onIssue` runs for every new code, including the
 * first (the CLI prints it to stderr).
 */
export function createPairingCodes(o: {
  now: () => number
  onIssue: (display: string, expiresInMs: number) => void
}): PairingCodes {
  let code = ''
  let issuedAt = 0
  let failures = 0
  const issue = (): void => {
    code = generateCode()
    issuedAt = o.now()
    failures = 0
    o.onIssue(formatCode(code), CODE_TTL_MS)
  }
  const expired = (): boolean => o.now() - issuedAt >= CODE_TTL_MS
  const refresh = (): void => {
    if (expired()) issue()
  }
  const fail = (): void => {
    failures++
    if (failures >= MAX_FAILED_ATTEMPTS) issue()
  }
  issue()
  return {
    current() {
      refresh()
      return {
        code: formatCode(code),
        expiresInMs: Math.max(0, CODE_TTL_MS - (o.now() - issuedAt)),
      }
    },
    verify(input) {
      if (expired()) {
        // An expired code is replaced first (resetting the budget), and the miss is then charged
        // to the fresh code: an attempt with a stale code still spends one of the five tries, so
        // expiry never hands out free guesses, and the fresh code starts at 1 of 5.
        issue()
        fail()
        return false
      }
      const normalized = normalizeCode(input)
      if (normalized !== null && constantTimeEqual(normalized, code)) {
        issue()
        return true
      }
      fail()
      return false
    },
    fail,
  }
}
