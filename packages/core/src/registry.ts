import { ToolmarkError } from './errors.js'
import {
  createEmitter,
  safeCall,
  type Emitter,
  type ToolmarkErrorEvent,
  type ToolmarkEventMap,
} from './events.js'
import { newId } from './ids.js'
import {
  buildManifestEntry,
  buildSummaryEntry,
  type ManifestSource,
  type ToolManifest,
  type ToolManifestSummary,
} from './manifest.js'
import { isValidToolName, toLlmName } from './names.js'
import {
  hintClass,
  isAllowed,
  isKnownCaller,
  needsConfirmation,
  POLICY_CALLERS,
  resolvePolicy,
  type CallerPolicy,
  type HintClass,
  type PolicyCaller,
  type ResolvedPolicy,
} from './policy.js'
import type { FieldChange, ToolResult } from './result.js'
import { resolveJsonSchema, type JsonSchemaConverter } from './schema.js'
import { ScopeNode, type Scope, type ScopeOptions } from './scope.js'
import type {
  Caller,
  ConfirmOutcome,
  JsonSchema,
  ToolDefinition,
  ToolHints,
  ToolOrigin,
  ToolState,
} from './tool.js'
import { anchorFromSpec, createAnchorOverrides } from './anchors.js'
import { createCallRuntime } from './call.js'
import { filesConfig, type FilesConfig, type FilesOptions } from './files.js'
import type { PendingConfirmation } from './confirm.js'

/** A confirmation request handed to the inline `confirm` handler. */
export interface ConfirmRequest {
  /** Unique id of this confirmation. */
  confirmId: string
  /** Full tool name. */
  tool: string
  /** Tool title, if any. */
  title?: string
  /** Who asked. */
  caller: Caller
  /** Validated input. */
  input: unknown
  /** The tool's hints. */
  hints: ToolHints
  /** User-facing summary. */
  summary: string
  /** Field changes to show, if any (sensitive values redacted). */
  changes?: FieldChange[]
}

/**
 * Options for {@link createToolmark}. Invalid `confirmMode` / `policy` entries are validated while
 * `createToolmark` runs: in development they throw; in production they are reported as `error`
 * events (`invalid_confirm_mode`, `invalid_policy`) before any `events.on` listener can exist, so
 * only `onError` observes them.
 */
export interface ToolmarkOptions {
  /** Development behaviour: misconfiguration throws instead of emitting `error` events. */
  dev?: boolean
  /** Inline confirmation handler (used by inline-mode callers). */
  confirm?: (req: ConfirmRequest) => Promise<ConfirmOutcome>
  /** Confirmation mode per caller; only `inapp`/`test` are configurable (default `deferred`). */
  confirmMode?: {
    inapp?: 'deferred' | 'inline'
    test?: 'deferred' | 'inline'
    webmcp?: 'inline'
    mcp?: 'inline'
    tour?: 'inline'
  }
  /** Per-caller policy (`human` is fixed). */
  policy?: Partial<Record<Exclude<Caller, 'human'>, CallerPolicy>>
  /** Global JSON Schema converter for schemas without Standard JSON Schema. */
  jsonSchema?: JsonSchemaConverter
  /** Pending/inline confirmation expiry in ms (default 600000). */
  confirmExpiryMs?: number
  /** Grace period after abort before a call is abandoned, in ms (default 5000). */
  abortGraceMs?: number
  /** Visible-tool budget; exceeding it emits `tool_budget_exceeded` in `dev` (default 40). */
  budget?: number
  /**
   * File references (spec §8.4, D27): the `{ ref }` resolver, URL origins (URL fetching is off
   * unless `allowOrigins` is non-empty) and limits. Misconfiguration → `files_misconfigured`.
   */
  files?: FilesOptions
  /** Receives every `error` event (after `events.on('error')` listeners). */
  onError?: (e: ToolmarkErrorEvent) => void
  /** @internal Undocumented test hook; overrides the browser detection (SSR is inert). */
  __environment?: 'browser' | 'server'
}

/** Handle returned by {@link Toolmark.register}. */
export interface Registration {
  /** Full tool name. */
  readonly name: string
  /** Removes the tool (idempotent). */
  dispose(): void
}

/** Registry-only facts about a tool, returned by {@link Toolmark.info} (never in a manifest). */
export interface ToolInfo {
  /** Where the tool came from (`'code'` unless its definition says otherwise). */
  origin: ToolOrigin
  /** The native `toolname` of a `'native-form'` tool. */
  nativeName?: string
  /**
   * The tool's sensitive input paths (`ToolDefinition.sensitivePaths()`, evaluated on every
   * `info` call; `[]` when it has none). Consumers redact these from state and telemetry.
   */
  sensitivePaths: string[]
}

/** The tool registry (spec §5). */
export interface Toolmark {
  /** Random id of this page load (D17). */
  readonly clientId: string
  /** Current manifest revision. */
  readonly rev: number
  /**
   * Registers a tool.
   * @param tool - The tool declaration.
   * @param opts - Target `scope` and an optional `signal` whose abort unregisters the tool.
   */
  register<I, O>(
    tool: ToolDefinition<I, O>,
    opts?: { scope?: Scope; signal?: AbortSignal },
  ): Registration
  /**
   * Creates a root-level scope (nest with `scope.scope()`).
   * @param name - Scope name (the path segment its tools are prefixed with).
   * @param opts - `when: false` hides its tools; `transparent: true` adds no name segment.
   */
  scope(name: string, opts?: ScopeOptions): Scope
  /** Summary manifest, sorted by name; filtered by policy when `caller` is given. */
  manifest(opts?: { caller?: Caller; detail?: 'summary' }): {
    rev: number
    tools: ToolManifestSummary[]
  }
  /** Full manifest (with schemas). */
  manifest(opts: { caller?: Caller; detail: 'full' }): { rev: number; tools: ToolManifest[] }
  /** Full manifest entry of one tool, or `undefined` when unknown/hidden for `caller`. */
  describe(name: string, opts?: { caller?: Caller }): ToolManifest | undefined
  /**
   * Registry-only facts about a registered tool (including one hidden by `when`), or `undefined`
   * when no tool has that full name. Not policy-filtered and never part of `manifest()`,
   * `describe()` or protocol messages.
   * @param name - Full tool name.
   */
  info(name: string): ToolInfo | undefined
  /**
   * The element a tool (or one of its params) is anchored to, for tours (spec §13). Precedence with
   * `param`: {@link Toolmark.setAnchor} override → `anchors.params[param]()` →
   * `anchors.resolve(param)` → `null`; without `param`: override → `anchors.element()` → `null`.
   * `null` for unknown tools. Never throws: a throwing anchor function gives `null` (and a
   * development `error` event `tool_threw`).
   * @param tool - Full tool name.
   * @param param - Input path, e.g. `email` or `items.0.qty`.
   */
  anchor(tool: string, param?: string): Element | null
  /**
   * Overrides the anchor of `(tool, param)` (`param` `undefined` = the tool's own element), e.g. for
   * custom widgets. `null` clears the override. Overrides are dropped when the tool is disposed.
   * @param tool - Full tool name.
   * @param param - Input path, or `undefined` for the tool itself.
   * @param el - The element, or `null` to clear.
   */
  setAnchor(tool: string, param: string | undefined, el: Element | null): void
  /**
   * The tool's current state from its `state()` hook, or `undefined` for unknown tools and tools
   * without one. Synchronous and side-effect free; never throws (a throwing hook gives `undefined`
   * and a development `error` event `tool_threw`).
   * @param tool - Full tool name.
   */
  state(tool: string): ToolState<unknown> | undefined
  /** Calls a tool. Never throws; every outcome is a {@link ToolResult}. */
  call(
    name: string,
    input: unknown,
    opts: { caller: Caller; rev?: number; signal?: AbortSignal },
  ): Promise<ToolResult<unknown>>
  /** Deferred confirmations waiting for {@link Toolmark.confirmPending}. */
  pendingConfirmations(): PendingConfirmation[]
  /**
   * Completes a `needs_confirmation` call (single use). Approval runs the tool as caller `human`
   * (with re-validated edited `input`, if given); rejection → `cancelled` `operator`.
   * Known limit: the approved run has no caller signal, so it cannot be cancelled.
   */
  confirmPending(confirmId: string, outcome: ConfirmOutcome): Promise<ToolResult<unknown>>
  /** Runs the undo restorer a call registered (once); otherwise `refused` `undo_unavailable`. */
  undo(callId: string): Promise<ToolResult<{ changes: FieldChange[] }>>
  /** Subscribes to revision changes (once per microtask). Returns an unsubscribe function. */
  subscribe(listener: (rev: number) => void): () => void
  /** Registry events. */
  readonly events: {
    on<K extends keyof ToolmarkEventMap>(type: K, fn: (e: ToolmarkEventMap[K]) => void): () => void
  }
  /** Attaches a consumer (e.g. the bridge); returns its idempotent disposer. */
  use(consumer: (tm: Toolmark) => () => void): () => void
}

/** @internal Registry entry for one live tool. */
export interface Entry {
  readonly fullName: string
  readonly tool: ToolDefinition<unknown, unknown>
  readonly scope: ScopeNode
  readonly cls: HintClass
  readonly source: ManifestSource
  /** Registry-only static facts (`tm.info`; `sensitivePaths` is evaluated per call). */
  readonly info: Omit<ToolInfo, 'sensitivePaths'>
  alive: boolean
  readonly registration: Registration
  /** Detaches the registration's abort listener (I5). */
  detach?: () => void
}

type ConfirmMode = 'deferred' | 'inline'

/** @internal Shared state between the registry and the call pipeline. */
export interface RegistryState {
  readonly tm: Toolmark
  readonly options: ToolmarkOptions
  readonly dev: boolean
  readonly browser: boolean
  readonly policy: ResolvedPolicy
  readonly modes: Readonly<Record<PolicyCaller, ConfirmMode>>
  readonly entries: Map<string, Entry>
  readonly emitter: Emitter<ToolmarkEventMap>
  rev: number
  /** Emits an `error` event (listeners, then `onError`). */
  report(e: ToolmarkErrorEvent): void
  /** Dev: throws a `ToolmarkError`; production: reports an `error` event. */
  fail(code: string, message: string, tool?: string, cause?: unknown): void
  /** Resolves a live tool visible (`when`) and not policy-hidden for `caller`. */
  visible(entry: Entry, caller?: Caller): boolean
  /** Whether `caller` has no confirmation path for confirmable tools (inline, no handler). */
  inlineWithoutHandler(caller: Caller): boolean
  modeOf(caller: Caller): ConfirmMode | undefined
  /** Listeners notified when `confirmPending` consumes a pending confirmation (m5). */
  readonly pendingConsumed: Set<() => void>
  /** Validated file settings (`options.files`). */
  readonly files: FilesConfig
}

const stateOf = new WeakMap<Toolmark, RegistryState>()

/**
 * @internal Emits an event on a registry from Toolmark packages (core bridge/dom, inertia), with the
 * same listener isolation as the registry (`error` also reaches `onError`).
 */
export function emitEvent<K extends keyof ToolmarkEventMap>(
  tm: Toolmark,
  type: K,
  payload: ToolmarkEventMap[K],
): void {
  const state = stateOf.get(tm)
  if (!state) return
  if (type === 'error') state.report(payload as ToolmarkErrorEvent)
  else state.emitter.emit(type, payload)
}

/**
 * @internal For `@toolmark/react`'s `usePendingConfirmations`; not part of the stable API.
 * Subscribes to "`confirmPending` consumed a pending confirmation": fired synchronously when the
 * id is taken — before the approved tool runs, whereas the `confirm` event's `approved` stage only
 * fires once it settled — so a confirmation UI can drop the item (and block a double click)
 * immediately. `tm.pendingConfirmations()` no longer lists the id at that point.
 * @param tm - The registry.
 * @param fn - Listener (a throwing listener is reported to the console and ignored).
 * @returns An unsubscribe function.
 */
export function onPendingConsumed(tm: Toolmark, fn: () => void): () => void {
  const state = stateOf.get(tm)
  if (!state) return () => undefined
  const listener = (): void => {
    fn()
  }
  state.pendingConsumed.add(listener)
  return () => {
    state.pendingConsumed.delete(listener)
  }
}

/**
 * @internal For `@toolmark/react` hooks' own misconfiguration checks; not part of the stable API.
 * Whether `tm` was created with `dev: true` (its "throw in development, `error` event in production"
 * contract). `false` for an SSR (inert) registry and for any object not created by
 * {@link createToolmark}.
 * @param tm - The registry.
 * @returns `true` only for a live browser registry created with `dev: true`.
 */
export function isDevRegistry(tm: Toolmark): boolean {
  const state = stateOf.get(tm)
  return state !== undefined && state.browser && state.dev
}

/** @internal */
export function registryState(tm: Toolmark): RegistryState | undefined {
  return stateOf.get(tm)
}

const ORIGINS: readonly ToolOrigin[] = ['code', 'native-form', 'dom', 'server']
const INLINE_ONLY: readonly PolicyCaller[] = ['webmcp', 'mcp', 'tour']
const DEFAULT_BUDGET = 40

function detectBrowser(env: ToolmarkOptions['__environment']): boolean {
  if (env === 'browser') return true
  if (env === 'server') return false
  return typeof document !== 'undefined'
}

function outputJsonSchema(tool: ToolDefinition<unknown, unknown>): JsonSchema | undefined {
  const std = (tool.output?.['~standard'] as { jsonSchema?: { output?: unknown } } | undefined)
    ?.jsonSchema
  if (!std || typeof std.output !== 'function') return undefined
  try {
    const out: unknown = (std.output as (o: { target: string }) => unknown)({
      target: 'draft-2020-12',
    })
    return typeof out === 'object' && out !== null ? (out as JsonSchema) : undefined
  } catch {
    return undefined
  }
}

/**
 * Creates a tool registry.
 * @param options - Registry options; see {@link ToolmarkOptions}. Production-mode option errors
 * (`invalid_confirm_mode`, `invalid_policy`) fire during this call, so only `options.onError`
 * receives them.
 * @returns The registry. In SSR (no `document`) registration and consumers are inert no-ops.
 */
export function createToolmark(options: ToolmarkOptions = {}): Toolmark {
  const dev = options.dev === true
  const browser = detectBrowser(options.__environment)
  const emitter = createEmitter<ToolmarkEventMap>()
  const entries = new Map<string, Entry>()
  const llmNames = new Map<string, Entry>()
  const revListeners = new Set<(rev: number) => void>()
  let notifyPending = false

  const report = (e: ToolmarkErrorEvent): void => {
    emitter.emit('error', e)
    const onError = options.onError
    if (onError) safeCall(() => onError(e), 'onError')
  }
  const fail = (code: string, message: string, tool?: string, cause?: unknown): void => {
    if (dev) throw new ToolmarkError(code, message, cause !== undefined ? { cause } : undefined)
    report({
      code,
      message,
      ...(tool !== undefined ? { tool } : {}),
      ...(cause !== undefined ? { cause } : {}),
    })
  }

  // --- options validation ---------------------------------------------------------------
  const modes: Record<PolicyCaller, ConfirmMode> = {
    inapp: 'deferred',
    test: 'deferred',
    webmcp: 'inline',
    mcp: 'inline',
    tour: 'inline',
  }
  if (options.confirmMode !== undefined) {
    for (const [key, value] of Object.entries(options.confirmMode as Record<string, unknown>)) {
      if (value === undefined) continue
      if ((key === 'inapp' || key === 'test') && (value === 'deferred' || value === 'inline')) {
        modes[key] = value
      } else if ((INLINE_ONLY as readonly string[]).includes(key) && value === 'inline') {
        // always inline
      } else {
        fail(
          'invalid_confirm_mode',
          `confirmMode.${key} = ${JSON.stringify(value)} is not allowed: only inapp/test may be ` +
            `'deferred' | 'inline'; webmcp, mcp and tour are always 'inline'`,
        )
      }
    }
  }
  const policy = resolvePolicy(options.policy, (message) => fail('invalid_policy', message))
  const files = filesConfig(
    options.files,
    (message) => fail('files_misconfigured', message),
    () => {
      if (dev) {
        report({
          code: 'files_not_configured',
          message: 'A file reference { ref } was given but no files.resolve is configured',
        })
      }
    },
  )

  const modeOf = (caller: Caller): ConfirmMode | undefined =>
    caller !== 'human' && isKnownCaller(caller) ? modes[caller] : undefined
  const inlineWithoutHandler = (caller: Caller): boolean =>
    modeOf(caller) === 'inline' && options.confirm === undefined
  const visible = (entry: Entry, caller?: Caller): boolean => {
    if (!entry.alive || !entry.scope.isShown()) return false
    if (caller === undefined) return true
    if (!isAllowed(policy, caller, entry.cls, entry.fullName)) return false
    return !(needsConfirmation(entry.cls) && inlineWithoutHandler(caller))
  }

  // --- revisions --------------------------------------------------------------------------
  const flush = (): void => {
    notifyPending = false
    const rev = state.rev
    for (const fn of [...revListeners]) safeCall(() => fn(rev), 'subscribe listener')
    emitter.emit('change', { rev })
    if (dev) {
      const budget = options.budget ?? DEFAULT_BUDGET
      let count = 0
      for (const e of entries.values()) if (visible(e)) count++
      if (count > budget) {
        report({
          code: 'tool_budget_exceeded',
          message: `${count} visible tools exceed the budget of ${budget} (D21)`,
        })
      }
    }
  }
  const markChanged = (): void => {
    if (notifyPending) return
    notifyPending = true
    state.rev++
    queueMicrotask(flush)
  }

  const anchorOverrides = createAnchorOverrides()

  const removeEntry = (entry: Entry): void => {
    if (!entry.alive) return
    entry.alive = false
    entry.detach?.()
    anchorOverrides.drop(entry.fullName)
    if (llmNames.get(entry.source.llmName) === entry) llmNames.delete(entry.source.llmName)
    if (entries.get(entry.fullName) === entry) entries.delete(entry.fullName)
    runtime.onEntryRemoved(entry)
    markChanged()
  }

  const root = new ScopeNode('', null, true, {
    attach: browser,
    onWhenChange(node) {
      for (const e of entries.values()) {
        if (e.scope.isWithin(node)) {
          markChanged()
          return
        }
      }
    },
    onDispose(node) {
      for (const e of [...entries.values()]) if (e.scope === node) removeEntry(e)
    },
  })

  const inert = (name: string): Registration => ({ name, dispose() {} })

  function register<I, O>(
    tool: ToolDefinition<I, O>,
    opts?: { scope?: Scope; signal?: AbortSignal },
  ): Registration {
    const given = opts?.scope
    const scope = given ?? root
    const fullName =
      typeof scope.path === 'string' && scope.path !== '' ? `${scope.path}.${tool.name}` : tool.name
    if (!browser) return inert(fullName)
    if (!(scope instanceof ScopeNode) || scope.root() !== root) {
      fail(
        'invalid_scope',
        `Cannot register "${fullName}": the scope does not belong to this registry`,
        fullName,
      )
      return inert(fullName)
    }
    if (scope.disposed) {
      fail('scope_disposed', `Cannot register "${fullName}": its scope is disposed`, fullName)
      return inert(fullName)
    }
    if (typeof tool.name !== 'string' || !isValidToolName(fullName)) {
      fail(
        'invalid_name',
        `Invalid tool name "${fullName}": use 1-128 characters from A-Z a-z 0-9 _ - .`,
        fullName,
      )
      return inert(fullName)
    }
    if (entries.has(fullName)) {
      fail('duplicate_name', `A tool named "${fullName}" is already registered`, fullName)
      return inert(fullName)
    }
    const llmName = toLlmName(fullName)
    const llmOwner = llmNames.get(llmName)
    if (llmOwner) {
      fail(
        'duplicate_name',
        `"${fullName}" has the same LLM name "${llmName}" as "${llmOwner.fullName}"`,
        fullName,
      )
      return inert(fullName)
    }
    if (opts?.signal?.aborted) return inert(fullName)

    const def = tool as unknown as ToolDefinition<unknown, unknown>
    const cls = hintClass(def.hints)

    // Confirm rule (spec §7, D7).
    let inlineHidden = false
    if (needsConfirmation(cls)) {
      const allowed = POLICY_CALLERS.filter((c) => isAllowed(policy, c, cls, fullName))
      const withPath = allowed.filter((c) => !inlineWithoutHandler(c))
      if (allowed.length > 0 && withPath.length === 0) {
        fail(
          'missing_confirm_handler',
          `"${fullName}" needs confirmation but no caller allowed to use it has a confirmation ` +
            `path: configure a deferred mode or an inline confirm handler`,
          fullName,
        )
        return inert(fullName)
      }
      inlineHidden = allowed.some((c) => inlineWithoutHandler(c))
    }

    let inputSchema: JsonSchema
    const resolved = resolveJsonSchema(def, options.jsonSchema)
    if (resolved.ok) {
      inputSchema = resolved.schema
    } else {
      fail(
        'schema_conversion_failed',
        `Tool "${fullName}": cannot derive a JSON Schema for its input (${resolved.reason}). ` +
          `Set the tool's jsonSchema or a global jsonSchema converter.`,
        fullName,
      )
      inputSchema = {}
    }

    if (inlineHidden && dev) {
      report({
        code: 'missing_confirm_handler',
        message:
          `"${fullName}" is hidden from inline-mode callers (webmcp, mcp, tour, or inline ` +
          `inapp/test) because no inline confirm handler is configured`,
        tool: fullName,
      })
    }

    const registration: Registration = {
      name: fullName,
      dispose: () => removeEntry(entry),
    }
    const info: Entry['info'] = {
      origin: ORIGINS.includes(def.origin as ToolOrigin) ? (def.origin as ToolOrigin) : 'code',
    }
    if (typeof def.nativeName === 'string') info.nativeName = def.nativeName
    const entry: Entry = {
      fullName,
      tool: def,
      info,
      scope,
      cls,
      alive: true,
      registration,
      source: {
        name: fullName,
        llmName,
        title: def.title,
        description: def.description,
        hints: def.hints,
        ...(def.mode === 'stepwise' ? { mode: 'stepwise' as const } : {}),
        inputSchema,
        outputSchema: outputJsonSchema(def),
      },
    }
    entries.set(fullName, entry)
    llmNames.set(llmName, entry)
    markChanged()
    const signal = opts?.signal
    if (signal) {
      const onAbort = (): void => registration.dispose()
      signal.addEventListener('abort', onAbort, { once: true })
      entry.detach = () => signal.removeEventListener('abort', onAbort)
    }
    return registration
  }

  function listVisible(caller: Caller | undefined): Entry[] {
    if (!browser) return []
    return [...entries.values()]
      .filter((e) => visible(e, caller))
      .sort((a, b) => (a.fullName < b.fullName ? -1 : a.fullName > b.fullName ? 1 : 0))
  }

  function manifest(opts?: { caller?: Caller; detail?: 'summary' }): {
    rev: number
    tools: ToolManifestSummary[]
  }
  function manifest(opts: { caller?: Caller; detail: 'full' }): {
    rev: number
    tools: ToolManifest[]
  }
  function manifest(opts?: { caller?: Caller; detail?: 'summary' | 'full' }): {
    rev: number
    tools: ToolManifestSummary[] | ToolManifest[]
  } {
    if (!browser) return { rev: 0, tools: [] }
    const list = listVisible(opts?.caller)
    return {
      rev: state.rev,
      tools:
        opts?.detail === 'full'
          ? list.map((e) => buildManifestEntry(e.source))
          : list.map((e) => buildSummaryEntry(e.source)),
    }
  }

  const liveEntry = (name: string): Entry | undefined => {
    if (!browser) return undefined
    const entry = entries.get(name)
    return entry?.alive === true ? entry : undefined
  }

  /** Reports a throwing tool hook (development only: tours poll these hooks). */
  const hookThrew = (entry: Entry, hook: string, cause: unknown): void => {
    if (dev) {
      report({
        code: 'tool_threw',
        message: `${hook} of "${entry.fullName}" threw`,
        tool: entry.fullName,
        cause,
      })
    }
  }

  const sensitivePathsOf = (entry: Entry): string[] => {
    const tool = entry.tool
    if (typeof tool.sensitivePaths !== 'function') return []
    let paths: unknown
    try {
      paths = tool.sensitivePaths()
    } catch (cause) {
      // Always reported: a failed redaction list is a privacy problem, not tour noise.
      report({
        code: 'tool_threw',
        message: `sensitivePaths() of "${entry.fullName}" threw`,
        tool: entry.fullName,
        cause,
      })
      return []
    }
    if (!Array.isArray(paths)) {
      report({
        code: 'tool_threw',
        message: `sensitivePaths() of "${entry.fullName}" did not return an array`,
        tool: entry.fullName,
      })
      return []
    }
    return (paths as unknown[]).filter((p): p is string => typeof p === 'string')
  }

  const tm: Toolmark = {
    clientId: newId(),
    get rev() {
      return state.rev
    },
    register,
    scope: (name, opts) => root.scope(name, opts),
    manifest,
    describe(name, opts) {
      if (!browser) return undefined
      const entry = entries.get(name)
      if (!entry || !visible(entry, opts?.caller)) return undefined
      return buildManifestEntry(entry.source)
    },
    info(name) {
      const entry = liveEntry(name)
      return entry ? { ...entry.info, sensitivePaths: sensitivePathsOf(entry) } : undefined
    },
    anchor(name, param) {
      const entry = liveEntry(name)
      if (!entry) return null
      const override = anchorOverrides.get(name, param)
      if (override) return override
      try {
        return anchorFromSpec(entry.tool.anchors, param) ?? null
      } catch (cause) {
        hookThrew(entry, param === undefined ? 'anchor' : `anchor("${param}")`, cause)
        return null
      }
    },
    setAnchor(name, param, el) {
      if (!browser || typeof name !== 'string') return
      if (param !== undefined && typeof param !== 'string') return
      // Untyped callers may pass anything; only DOM elements (or null to clear) are stored.
      if (el != null && !(typeof Element !== 'undefined' && el instanceof Element)) return
      anchorOverrides.set(name, param, el ?? null)
    },
    state(name) {
      const entry = liveEntry(name)
      if (!entry || typeof entry.tool.state !== 'function') return undefined
      try {
        return entry.tool.state()
      } catch (cause) {
        hookThrew(entry, 'state()', cause)
        return undefined
      }
    },
    call: (name, input, opts) => runtime.call(name, input, opts),
    pendingConfirmations: () => (browser ? runtime.pendingConfirmations() : []),
    confirmPending: (confirmId, outcome) => runtime.confirmPending(confirmId, outcome),
    undo: (callId) => runtime.undo(callId),
    subscribe(listener) {
      const fn = (rev: number): void => listener(rev)
      revListeners.add(fn)
      return () => {
        revListeners.delete(fn)
      }
    },
    events: { on: (type, fn) => emitter.on(type, fn) },
    use(consumer) {
      if (!browser) return () => {}
      const cleanup = consumer(tm)
      let done = false
      return () => {
        if (done) return
        done = true
        cleanup()
      }
    },
  }

  const state: RegistryState = {
    tm,
    options,
    dev,
    browser,
    policy,
    modes,
    entries,
    emitter,
    rev: 0,
    report,
    fail,
    visible,
    inlineWithoutHandler,
    modeOf,
    pendingConsumed: new Set(),
    files,
  }
  const runtime = createCallRuntime(state)
  stateOf.set(tm, state)
  return tm
}
