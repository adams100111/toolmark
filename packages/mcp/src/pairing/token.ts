import { randomBytes } from 'node:crypto'
import { TOKEN_PATTERN } from './constants.js'
import { constantTimeEqual } from './code.js'

/** @internal A fresh session token: 32 random bytes, base64url (43 characters). */
export function generateToken(): string {
  return randomBytes(32).toString('base64url')
}

/** @internal Constant-time check of a presented token against the current one (`null`: none). */
export function tokenMatches(current: string | null, presented: unknown): boolean {
  if (typeof presented !== 'string' || !TOKEN_PATTERN.test(presented)) return false
  // Compare against a same-length dummy when no token exists, so both paths do equal work.
  return constantTimeEqual(presented, current ?? '\0'.repeat(43)) && current !== null
}
