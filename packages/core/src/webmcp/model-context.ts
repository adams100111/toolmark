/**
 * Local structural types for the WebMCP `ModelContext` (live spec: `document.modelContext`). Declared
 * here so the adapter depends on neither `webmcp-types` nor the `@mcp-b/webmcp-types` globals.
 */

/**
 * Behaviour annotations a WebMCP tool carries (the subset Toolmark maps its hints to).
 * @experimental WebMCP is an origin-trial API; this adapter is outside semver (D28).
 */
export interface WebMcpToolAnnotations {
  /** The tool only reads data. */
  readOnlyHint?: boolean
  /** Running the tool has significant, real-world or non-reversible effects. */
  consequentialHint?: boolean
  /** The tool's results may contain untrusted (page or user) content. */
  untrustedContentHint?: boolean
}

/**
 * Options the browser (or polyfill) passes to a tool's `execute`. The polyfill passes none.
 * @experimental WebMCP is an origin-trial API; this adapter is outside semver (D28).
 */
export interface WebMcpExecuteOptions {
  /** Aborted when the agent cancels the execution. */
  signal?: AbortSignal
}

/**
 * The tool descriptor handed to `ModelContext.registerTool`.
 * @experimental WebMCP is an origin-trial API; this adapter is outside semver (D28).
 */
export interface WebMcpToolDescriptor {
  /** Tool name (1–128 characters: ASCII alphanumerics, `_`, `-`, `.`). */
  name: string
  /** Human-readable title. */
  title?: string
  /** Natural-language description. */
  description: string
  /** Input JSON Schema. */
  inputSchema?: object
  /** Behaviour annotations. */
  annotations?: WebMcpToolAnnotations
  /**
   * Runs the tool. Resolves the result object; the browser or polyfill serializes it once.
   * @param input - The input object (a JSON string is also accepted).
   * @param options - Execution options (absent under the polyfill).
   */
  execute(input: unknown, options?: WebMcpExecuteOptions): Promise<unknown>
}

/**
 * Options for `ModelContext.registerTool`.
 * @experimental WebMCP is an origin-trial API; this adapter is outside semver (D28).
 */
export interface WebMcpRegisterToolOptions {
  /** Aborting it unregisters the tool. */
  signal?: AbortSignal
  /** Origins allowed to call the tool (native WebMCP only; the polyfill rejects it). */
  exposedTo?: string[]
}

/**
 * The part of the WebMCP `ModelContext` the adapter uses. The native `ModelContext`
 * (`document.modelContext`, or the legacy `navigator.modelContext`) and
 * `@mcp-b/webmcp-polyfill`'s implementation both satisfy it.
 * @experimental WebMCP is an origin-trial API; this adapter is outside semver (D28).
 */
export interface ModelContextLike {
  /**
   * Registers a tool; aborting `options.signal` unregisters it.
   * @param tool - The tool descriptor.
   * @param options - Registration options.
   */
  registerTool(
    tool: WebMcpToolDescriptor,
    options?: WebMcpRegisterToolOptions,
  ): Promise<void> | void
  /** Lists the tools registered in this document (including native declarative forms). */
  getTools?(): Promise<Array<{ name: string }>>
}

/**
 * The module shape `webmcp({ polyfill })` expects from its loader
 * (`() => import('@mcp-b/webmcp-polyfill')`).
 * @experimental WebMCP is an origin-trial API; this adapter is outside semver (D28).
 */
export interface WebMcpPolyfillModule {
  /**
   * Installs `document.modelContext` when the browser has none (no-op in insecure contexts).
   * @param options - Polyfill options.
   */
  initializeWebMCPPolyfill(options?: { installTestingShim?: boolean }): void
}

/** @internal A resolver that never throws; returns a usable model context or `undefined`. */
export function resolveModelContext(
  custom: (() => ModelContextLike | undefined) | undefined,
): ModelContextLike | undefined {
  const candidates: (() => unknown)[] = []
  if (custom) candidates.push(custom)
  candidates.push(
    () => (globalThis as { document?: { modelContext?: unknown } }).document?.modelContext,
    () => (globalThis as { navigator?: { modelContext?: unknown } }).navigator?.modelContext,
  )
  for (const candidate of candidates) {
    let value: unknown
    try {
      value = candidate()
    } catch {
      continue
    }
    if (isModelContext(value)) return value
  }
  return undefined
}

function isModelContext(value: unknown): value is ModelContextLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { registerTool?: unknown }).registerTool === 'function'
  )
}
