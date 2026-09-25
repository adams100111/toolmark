// Shared by the node pairing server and the browser client entry: no `node:*` or `ws` imports.

/** Default pairing port of `toolmark-mcp` and `mcpPairing` (`--port`). */
export const DEFAULT_PAIRING_PORT = 17840

/** WebSocket close codes the pairing server sends to the page (spec §11.3, §23 "MCP pairing (R3)"). */
export const PAIRING_CLOSE_CODES = Object.freeze({
  /** The first frame was not a valid `pair` / `resume` frame. Terminal. */
  invalidFrame: 4400,
  /** Wrong or expired code, or an unknown or revoked session token. Terminal. */
  unauthorized: 4401,
  /** No pairing frame within the handshake timeout (`10000` ms). Terminal. */
  handshakeTimeout: 4408,
  /** A newer pairing or resume replaced this page. Terminal. */
  superseded: 4409,
  /** Another pairing handshake is in progress. Transient: the page reconnects. */
  busy: 4429,
  /** The CLI is shutting down. Transient: the page reconnects. */
  goingAway: 1001,
} as const)

/** Close codes after which the page stops reconnecting. */
export const TERMINAL_CLOSE_CODES: readonly number[] = Object.freeze([4400, 4401, 4408, 4409])

/** Time the page has to send its `pair` / `resume` frame, and to receive `paired`. */
export const HANDSHAKE_TIMEOUT_MS = 10_000

/** Shape of a session token: 32 random bytes, base64url without padding. */
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/
