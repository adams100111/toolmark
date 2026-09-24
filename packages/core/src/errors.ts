/**
 * Error thrown by Toolmark for misconfiguration in development (and for the few APIs that reject
 * instead of emitting events, e.g. `invalid_path`, `files_not_configured`). `code` is a stable
 * machine-readable string.
 */
export class ToolmarkError extends Error {
  /** Stable error code, e.g. `duplicate_name`. */
  readonly code: string

  /**
   * @param code - Stable error code.
   * @param message - Human-readable message.
   * @param options - Optional `cause`.
   */
  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined)
    this.name = 'ToolmarkError'
    this.code = code
  }
}
