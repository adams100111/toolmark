import {
  emitEvent,
  fromJsonSchema,
  invalid,
  isValidToolName,
  ToolmarkError,
  type JsonSchema,
  type Scope,
  type Toolmark,
  type ToolDefinition,
  type ToolHints,
} from '@toolmark/core'
import { resolveSameOriginUrl, type RouterLike, type VisitDataValue } from './router-like.js'
import { visitOutcome, type InertiaVisitCallbacks } from './visit-outcome.js'

/** HTTP methods a props-declared tool may visit with. */
export type PropsToolMethod = 'get' | 'post' | 'put' | 'patch' | 'delete'

/**
 * One server-declared tool, as rendered by the server into the `toolmark` Inertia props key
 * (spec §12.4): a manifest-shaped entry plus the visit that executes it. The server filters the
 * list with its own authorization; the client treats every entry as untrusted and validates it.
 */
export interface PropsToolEntry {
  /** Full tool name (`^[A-Za-z0-9_.-]{1,128}$`), registered unprefixed. */
  name: string
  /** User-facing title. */
  title?: string
  /** For the LLM: what the tool does. Non-empty. */
  description: string
  /** Draft 2020-12 input schema in the `fromJsonSchema` subset; input is validated against it. */
  inputSchema: JsonSchema
  /** Behaviour hints. A non-`get` visit is always at least `consequential`. */
  hints?: ToolHints
  /**
   * The Inertia visit that runs the tool; `url` must be same-origin. After registration it holds
   * the canonical absolute URL resolved against the page the entry was registered on.
   */
  visit: { url: string; method: PropsToolMethod }
}

/** Maximum `description` length (UTF-16 code units) of a props tool; longer entries are skipped. */
export const MAX_PROPS_TOOL_DESCRIPTION_LENGTH = 2048
/** Maximum `title` length (UTF-16 code units) of a props tool; longer entries are skipped. */
export const MAX_PROPS_TOOL_TITLE_LENGTH = 128
/**
 * Maximum number of props tool entries registered per page; entries beyond it are skipped with a
 * single `invalid_props_tool` event.
 */
export const MAX_PROPS_TOOLS_PER_PAGE = 64
/**
 * Maximum `JSON.stringify(inputSchema).length` of a props tool; larger schemas are skipped.
 */
export const MAX_PROPS_TOOL_SCHEMA_LENGTH = 32768

/**
 * Keys a props tool's input may never carry, at any depth: frameworks read them from the request
 * body (`_method` spoofs the HTTP method in Laravel/Rails, `_token` is Laravel's CSRF field), so an
 * agent supplying them could turn a `post` tool into a `delete`, or tamper with CSRF handling.
 */
const RESERVED_INPUT_KEYS: readonly string[] = ['_method', '_token']

/** Options for {@link propsTools}. */
export interface PropsToolsOptions {
  /** The router whose `visit` executes the tools. */
  router: Pick<RouterLike, 'visit'>
  /**
   * Aborting it cancels every in-flight visit started by these tools and resolves their calls as
   * `cancelled` `signal` (used by `inertiaPages`' disposer).
   */
  signal?: AbortSignal
}

const METHODS: readonly string[] = ['get', 'post', 'put', 'patch', 'delete']
const HINT_KEYS = ['readOnly', 'consequential', 'destructive', 'untrustedContent'] as const

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  const proto = Object.getPrototypeOf(v) as unknown
  return proto === Object.prototype || proto === null
}

/** Own-property read (never walks the prototype chain of server data). */
function own(obj: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(obj, key) ? obj[key] : undefined
}

type Checked =
  | { ok: true; entry: PropsToolEntry; input: ReturnType<typeof fromJsonSchema> }
  | { ok: false; reason: string; name?: string }

/** Validates one untrusted entry; never throws. */
function checkEntry(raw: unknown): Checked {
  if (!isPlainObject(raw)) return { ok: false, reason: 'entry is not an object' }
  const name = own(raw, 'name')
  if (typeof name !== 'string' || !isValidToolName(name)) {
    return { ok: false, reason: 'name is not a valid tool name' }
  }
  const fail = (reason: string): Checked => ({ ok: false, reason, name })
  const title = own(raw, 'title')
  if (title !== undefined && typeof title !== 'string') return fail('title is not a string')
  if (title !== undefined && title.length > MAX_PROPS_TOOL_TITLE_LENGTH) {
    return fail(`title is longer than ${MAX_PROPS_TOOL_TITLE_LENGTH} characters`)
  }
  const description = own(raw, 'description')
  if (typeof description !== 'string' || description.trim() === '') {
    return fail('description is not a non-empty string')
  }
  if (description.length > MAX_PROPS_TOOL_DESCRIPTION_LENGTH) {
    return fail(`description is longer than ${MAX_PROPS_TOOL_DESCRIPTION_LENGTH} characters`)
  }
  const rawHints = own(raw, 'hints')
  let hints: ToolHints | undefined
  if (rawHints !== undefined) {
    if (!isPlainObject(rawHints)) return fail('hints is not an object')
    hints = {}
    for (const key of HINT_KEYS) {
      const v = own(rawHints, key)
      if (v === undefined) continue
      if (typeof v !== 'boolean') return fail(`hints.${key} is not a boolean`)
      hints[key] = v
    }
  }
  const visit = own(raw, 'visit')
  if (!isPlainObject(visit)) return fail('visit is not an object')
  const method = own(visit, 'method')
  if (typeof method !== 'string' || !METHODS.includes(method)) {
    return fail(`visit.method is not one of ${METHODS.join(', ')}`)
  }
  const url = own(visit, 'url')
  if (typeof url !== 'string') return fail('visit.url is not a string')
  const href = resolveSameOriginUrl(url)
  if (href === null) return fail('visit.url is not a same-origin http(s) URL')
  const inputSchema = own(raw, 'inputSchema')
  if (!isPlainObject(inputSchema)) return fail('inputSchema is not an object')
  let serialized: string
  try {
    serialized = JSON.stringify(inputSchema)
  } catch {
    return fail('inputSchema is not plain JSON data')
  }
  if (serialized.length > MAX_PROPS_TOOL_SCHEMA_LENGTH) {
    return fail(`inputSchema is larger than ${MAX_PROPS_TOOL_SCHEMA_LENGTH} characters`)
  }
  if (
    method !== 'get' &&
    (own(inputSchema, 'type') !== 'object' || own(inputSchema, 'additionalProperties') !== false)
  ) {
    return fail(
      'inputSchema of a non-get tool must be { type: "object", additionalProperties: false }',
    )
  }
  const reserved = declaredReservedKey(inputSchema)
  if (reserved !== undefined) return fail(`inputSchema declares the reserved key "${reserved}"`)
  let input: ReturnType<typeof fromJsonSchema>
  try {
    input = fromJsonSchema(inputSchema)
  } catch {
    return fail('inputSchema is not a supported JSON Schema')
  }
  const entry: PropsToolEntry = {
    name,
    description,
    inputSchema,
    visit: { url: href, method: method as PropsToolMethod },
  }
  if (title !== undefined) entry.title = title
  if (hints !== undefined) entry.hints = hints
  return { ok: true, entry, input }
}

/** The first reserved key declared in any `properties` of `schema` (JSON data), if any. */
function declaredReservedKey(schema: unknown): string | undefined {
  const stack: unknown[] = [schema]
  while (stack.length > 0) {
    const node = stack.pop()
    if (typeof node !== 'object' || node === null) continue
    if (Array.isArray(node)) {
      stack.push(...(node as unknown[]))
      continue
    }
    const rec = node as Record<string, unknown>
    const props = own(rec, 'properties')
    if (isPlainObject(props)) {
      const hit = RESERVED_INPUT_KEYS.find((k) => Object.hasOwn(props, k))
      if (hit !== undefined) return hit
    }
    for (const key of Object.keys(rec)) stack.push(rec[key])
  }
  return undefined
}

/** Dotted path of the first reserved key anywhere in `data` (JSON input), if any. */
function reservedKeyPath(data: unknown, path: string[] = []): string | undefined {
  if (typeof data !== 'object' || data === null) return undefined
  const keys = Array.isArray(data) ? data.map((_, i) => String(i)) : Object.keys(data)
  for (const key of keys) {
    if (!Array.isArray(data) && RESERVED_INPUT_KEYS.includes(key)) return [...path, key].join('.')
    const hit = reservedKeyPath((data as Record<string, unknown>)[key], [...path, key])
    if (hit !== undefined) return hit
  }
  return undefined
}

/**
 * Hints a props tool is registered with: a `get` visit keeps the server's hints; any other method
 * is at least `consequential` (a server `destructive` is kept, `readOnly` is dropped) so a
 * server-declared mutation always goes through confirmation (D7).
 */
function effectiveHints(entry: PropsToolEntry): ToolHints | undefined {
  if (entry.visit.method === 'get') return entry.hints
  const out: ToolHints = { consequential: true }
  if (entry.hints?.destructive === true) out.destructive = true
  if (entry.hints?.untrustedContent === true) out.untrustedContent = true
  return out
}

function toolFor(
  entry: PropsToolEntry,
  input: ReturnType<typeof fromJsonSchema>,
  opts: PropsToolsOptions,
): ToolDefinition<unknown, unknown> {
  const { url, method } = entry.visit
  const def: ToolDefinition<unknown, unknown> = {
    name: entry.name,
    description: entry.description,
    input,
    origin: 'server',
    run(data, ctx) {
      if (data !== undefined && !isPlainObject(data)) {
        return invalid([{ path: '', message: 'Input must be an object' }])
      }
      const reserved = reservedKeyPath(data)
      if (reserved !== undefined) {
        return invalid([{ path: reserved, message: 'Reserved field is not allowed' }])
      }
      const page = opts.signal
      const signal = page ? AbortSignal.any([ctx.signal, page]) : ctx.signal
      const { callbacks, result } = visitOutcome({ signal })
      // A cancelled token may never report back (or arrive late); settle the call ourselves.
      const onPageAbort = (): void => callbacks.onCancel?.()
      if (page) {
        if (page.aborted) onPageAbort()
        else page.addEventListener('abort', onPageAbort, { once: true })
      }
      const settled = result.finally(() => page?.removeEventListener('abort', onPageAbort))
      if (page?.aborted) return settled
      const visitCallbacks: InertiaVisitCallbacks = callbacks
      // `data` is schema-validated JSON (an object for every sane server schema).
      const payload = data as Record<string, VisitDataValue>
      opts.router.visit(url, { method, data: payload, preserveState: true, ...visitCallbacks })
      return settled
    },
  }
  if (entry.title !== undefined) def.title = entry.title
  const hints = effectiveHints(entry)
  if (hints !== undefined) def.hints = hints
  return def
}

/**
 * Registers server-declared tools (spec §10.1, §12.4) into `scope`. Every entry is untrusted:
 * an entry that is not a valid {@link PropsToolEntry} (bad name, empty description, schema outside
 * the `fromJsonSchema` subset, unknown method, non-same-origin URL, …) is skipped with an `error`
 * event `invalid_props_tool`. Hardening (all `invalid_props_tool`): `title` ≤
 * {@link MAX_PROPS_TOOL_TITLE_LENGTH}, `description` ≤ {@link MAX_PROPS_TOOL_DESCRIPTION_LENGTH},
 * serialized `inputSchema` ≤ {@link MAX_PROPS_TOOL_SCHEMA_LENGTH}, at most
 * {@link MAX_PROPS_TOOLS_PER_PAGE} entries (the rest skipped with one event); a non-`get` entry's
 * schema root must be `{ type: 'object', additionalProperties: false }`; no schema may declare the
 * reserved keys `_method`/`_token`, and input carrying them at any depth is `invalid`. The visit URL
 * is resolved once, at registration, to its canonical absolute form. A name already taken (by any tool, or its LLM name) is skipped with
 * `duplicate_name`. Nothing is ever thrown, in development or production. Tools carry
 * `origin: 'server'`, validate input with `fromJsonSchema(inputSchema)` and run
 * `router.visit(url, { method, data: input, preserveState: true, ...callbacks })`, settling through
 * the per-visit callbacks (`finish` alone is an `error`, never `ok`).
 * @param tm - The registry.
 * @param entries - Untrusted entries (typically `page.props.toolmark`).
 * @param scope - Target scope (normally a transparent page scope, so names stay as the server gave).
 * @param opts - The router, and an optional signal that cancels in-flight visits.
 */
export function propsTools(
  tm: Toolmark,
  entries: unknown[],
  scope: Scope,
  opts: PropsToolsOptions,
): void {
  const all: unknown[] = Array.isArray(entries) ? entries : []
  const list = all.slice(0, MAX_PROPS_TOOLS_PER_PAGE)
  if (all.length > list.length) {
    emitEvent(tm, 'error', {
      code: 'invalid_props_tool',
      message: `${all.length - list.length} props tool entries skipped: more than ${MAX_PROPS_TOOLS_PER_PAGE} per page`,
    })
  }
  for (let i = 0; i < list.length; i++) {
    const checked = checkEntry(list[i])
    if (!checked.ok) {
      emitEvent(tm, 'error', {
        code: 'invalid_props_tool',
        message: `Props tool entry ${i} skipped: ${checked.reason}`,
        ...(checked.name !== undefined ? { tool: checked.name } : {}),
      })
      continue
    }
    const { entry, input } = checked
    const fullName = scope.path === '' ? entry.name : `${scope.path}.${entry.name}`
    if (tm.info(fullName) !== undefined) {
      emitEvent(tm, 'error', {
        code: 'duplicate_name',
        message: `Props tool "${fullName}" skipped: a tool with that name is already registered`,
        tool: fullName,
      })
      continue
    }
    try {
      // Production failures (e.g. an LLM-name collision) are reported by the registry itself.
      tm.register(toolFor(entry, input, opts), { scope })
    } catch (e) {
      // Development throws a ToolmarkError: report it as the event production would emit.
      emitEvent(tm, 'error', {
        code: e instanceof ToolmarkError ? e.code : 'invalid_props_tool',
        message:
          e instanceof Error ? e.message : `Props tool "${fullName}" could not be registered`,
        tool: fullName,
        cause: e,
      })
    }
  }
}
