/**
 * Tour-hook helpers shared by form and wizard tools (spec §13, §14): the sensitive-path rule,
 * value redaction for `state()`, the form-owner anchor and the synchronous issue snapshot.
 * Internal to `@toolmark/core` (not exported from the package entry).
 */
import { emitEvent, type Toolmark } from '../registry.js'
import type { StandardSchemaV1 } from '../standard-schema.js'
import { getPath, isSafePath, nodeBudget, setPath, snapshotValue, spend } from './paths.js'
import type { FieldInfo, FormAdapter } from './types.js'

/** @internal The value that replaces a sensitive value in results, payloads and `state()`. */
export const REDACTED = '[redacted]'

/** Secret `autocomplete` tokens (besides `cc-*`); mirrors the DOM adapter's exclusion list. */
const SECRET_AUTOCOMPLETE = new Set(['current-password', 'new-password', 'one-time-code'])

/**
 * @internal Whether an element holds a secret: an `<input type="password">`, or an `autocomplete`
 * token that starts with `cc-` or is `current-password` / `new-password` / `one-time-code`. Duck
 * typed (attribute first, then property), so it also works on non-DOM stand-ins.
 * @param el - The field's element, if any.
 */
export function isSensitiveElement(el: Element | null | undefined): boolean {
  if (!el || typeof el !== 'object') return false
  const loose = el as unknown as {
    tagName?: unknown
    type?: unknown
    autocomplete?: unknown
    getAttribute?: (name: string) => string | null
  }
  const attr = (name: string): unknown =>
    typeof loose.getAttribute === 'function' ? loose.getAttribute(name) : null
  const type = attr('type') ?? loose.type
  if (
    typeof loose.tagName === 'string' &&
    loose.tagName.toUpperCase() === 'INPUT' &&
    typeof type === 'string' &&
    type.toLowerCase() === 'password'
  ) {
    return true
  }
  const ac = attr('autocomplete') ?? loose.autocomplete
  return (
    typeof ac === 'string' &&
    ac
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .some((token) => token.startsWith('cc-') || SECRET_AUTOCOMPLETE.has(token))
  )
}

/** Whether a field is sensitive by its own facts (`FieldInfo.sensitive` or its element). */
const isSensitiveField = (f: FieldInfo): boolean =>
  f.sensitive === true || isSensitiveElement(f.element)

/**
 * @internal The sensitive rule (spec §14) of one form tool (or one wizard step): the app-declared
 * `sensitive` paths (declared order first), plus every field whose `FieldInfo.sensitive` is `true`
 * or whose element is a password / `cc-*` / secret `autocomplete` control. Sticky: every path
 * that was ever reported sensitive stays sensitive, so a "show password" toggle (`type="password"`
 * → `"text"`), an unmounted step form or a re-rendered element never exposes a value that was
 * redacted before. A path only becomes sensitive once it has been seen that way: an element that
 * is plain text on every read before it turns into a password is not covered, so apps declare
 * such paths in `sensitive`.
 * @param declared - App-declared sensitive dot paths (`[]` wildcards allowed).
 * @param seen - The memory of paths seen sensitive (shared, e.g. {@link sensitiveMemoryOf}).
 * @returns Returns the current list (declared first, then every path seen sensitive) for `fields`.
 */
export function stickySensitive(
  declared: readonly string[] | undefined,
  seen: Set<string> = new Set(),
): (fields: FieldInfo[]) => string[] {
  return (fields) => {
    for (const f of fields) if (typeof f.path === 'string' && isSensitiveField(f)) seen.add(f.path)
    const out = new Set<string>()
    for (const p of declared ?? []) if (typeof p === 'string') out.add(p)
    for (const p of seen) out.add(p)
    return [...out]
  }
}

const memories = new WeakMap<object, Set<string>>()

/**
 * @internal The memory of paths seen sensitive for one adapter object, shared by every form tool
 * registered over it, so a re-registration (e.g. `useFormTool` after a dependency change) does not
 * forget a path that was a password before a "show password" toggle.
 * @param adapter - The form adapter.
 */
export function sensitiveMemoryOf(adapter: object): Set<string> {
  let memory = memories.get(adapter)
  if (!memory) {
    memory = new Set()
    memories.set(adapter, memory)
  }
  return memory
}

/**
 * Splits a sensitive path into segments, `[]` (any array index) as its own segment:
 * `cards[].cvc` → `cards`, `[]`, `cvc` (`a[][]` and `a.[].b` work too). `undefined` for an
 * empty segment or a prototype key.
 */
function patternSegments(path: string): string[] | undefined {
  const out: string[] = []
  for (const seg of path.split('.')) {
    const m = /^([^[\]]*)((?:\[\])*)$/.exec(seg)
    if (!m) return undefined
    const base = m[1]!
    const wildcards = m[2]!.length / 2
    if (base === '' && wildcards === 0) return undefined
    if (base !== '') {
      if (!isSafePath(base)) return undefined
      out.push(base)
    }
    for (let i = 0; i < wildcards; i++) out.push('[]')
  }
  return out
}

const INDEX = /^\d+$/

/**
 * @internal Whether `pattern` is a well-formed sensitive path (dot segments, `[]` wildcards, no
 * empty segment or prototype key) that {@link isUnderSensitive} and {@link sensitiveBelow} match.
 */
export function isSensitivePattern(pattern: string): boolean {
  return patternSegments(pattern) !== undefined
}

/**
 * @internal The concrete dot paths that the sensitive path `pattern` addresses in `values`: the
 * path itself when it has no `[]`, else every existing match (`cards[].cvc` → `cards.0.cvc`,
 * `cards.1.cvc`, …). At most 10000 nodes are visited; past that the walk fails closed and returns
 * the path before the first `[]` (the whole array is then redacted). Invalid patterns yield `[]`.
 * @param values - The values to expand against.
 * @param pattern - A sensitive dot path, possibly with `[]` wildcards.
 */
export function expandSensitive(values: unknown, pattern: string): string[] {
  if (!pattern.includes('[]')) return isSafePath(pattern) ? [pattern] : []
  const segs = patternSegments(pattern)
  if (!segs) return []
  const budget = nodeBudget()
  const out: string[] = []
  let overflow = false
  const walk = (node: unknown, i: number, at: string[]): void => {
    if (overflow) return
    if (!spend(budget)) {
      overflow = true
      return
    }
    if (i === segs.length) {
      out.push(at.join('.'))
      return
    }
    const seg = segs[i]!
    if (seg === '[]') {
      if (!Array.isArray(node)) return
      for (let k = 0; k < node.length && !overflow; k++) {
        if (k in node) walk(node[k], i + 1, [...at, String(k)])
      }
    } else if (typeof node === 'object' && node !== null && Object.hasOwn(node, seg)) {
      walk((node as Record<string, unknown>)[seg], i + 1, [...at, seg])
    }
  }
  walk(values, 0, [])
  if (overflow) {
    const head = segs.slice(0, segs.indexOf('[]')).join('.')
    return head === '' ? [] : [head]
  }
  return out
}

/**
 * @internal Whether the concrete dot path `path` is at or under the sensitive path `pattern`
 * (`[]` matches any array index): `cards.0.cvc` and `cards.0.cvc.x` are under `cards[].cvc`.
 */
export function isUnderSensitive(path: string, pattern: string): boolean {
  const segs = patternSegments(pattern)
  if (!segs) return false
  const parts = path.split('.')
  if (parts.length < segs.length) return false
  return segs.every((s, i) => (s === '[]' ? INDEX.test(parts[i]!) : s === parts[i]))
}

/**
 * @internal The part of the sensitive path `pattern` that lies strictly below the concrete path
 * `path` (`cards` + `cards[].cvc` → `[].cvc`), or `undefined` when `pattern` is not below `path`.
 */
export function sensitiveBelow(path: string, pattern: string): string | undefined {
  const segs = patternSegments(pattern)
  if (!segs) return undefined
  const parts = path.split('.')
  if (segs.length <= parts.length) return undefined
  const matches = parts.every((p, i) => (segs[i] === '[]' ? INDEX.test(p) : segs[i] === p))
  return matches ? segs.slice(parts.length).join('.') : undefined
}

/**
 * @internal The published `sensitivePaths` list: the sensitive paths as given (patterns with `[]`
 * kept, for consumers that match by pattern) plus the concrete paths each `[]` pattern addresses
 * in `values` right now (for consumers that redact by exact path, such as the OTel exporter).
 */
export function publishSensitive(sensitive: readonly string[], values: unknown): string[] {
  const out = new Set(sensitive)
  for (const p of sensitive)
    if (p.includes('[]')) for (const c of expandSensitive(values, p)) out.add(c)
  return [...out]
}

/**
 * @internal The adapter's fields, or `[]` when `fields()` throws (a failing adapter must never
 * break redaction: callers then fall back to the declared paths only).
 */
export function safeFields(adapter: Pick<FormAdapter, 'fields'> | undefined): FieldInfo[] {
  if (!adapter) return []
  try {
    const list = adapter.fields()
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

/**
 * @internal A deep copy of `values` (plain objects and arrays) in which every sensitive path that
 * holds a value is replaced by {@link REDACTED}. `[]` in a sensitive path matches every array
 * index (`cards[].cvc`; see {@link expandSensitive}). Unsafe paths are ignored.
 * @param values - Current form values (not mutated).
 * @param sensitive - Sensitive dot paths.
 */
export function redactValues<T>(values: T, sensitive: readonly string[]): T {
  let out = snapshotValue(values)
  for (const pattern of sensitive) {
    if (typeof pattern !== 'string') continue
    for (const path of expandSensitive(out, pattern)) {
      if (getPath(out, path) !== undefined) out = setPath(out, path, REDACTED)
    }
  }
  return out
}

/**
 * @internal The form that owns `el`: its `form` property when that is a `<form>` (covers
 * `form=`-associated controls), else `el.closest('form')`, else `null`.
 * @param el - A field element.
 */
export function formOwnerOf(el: Element | null | undefined): Element | null {
  if (!el || typeof el !== 'object') return null
  const owner = (el as unknown as { form?: unknown }).form
  if (
    typeof owner === 'object' &&
    owner !== null &&
    (owner as { localName?: unknown }).localName === 'form'
  ) {
    return owner as Element
  }
  const closest = (el as unknown as { closest?: unknown }).closest
  if (typeof closest !== 'function') return null
  const found: unknown = (closest as (sel: string) => unknown).call(el, 'form')
  return typeof found === 'object' && found !== null ? (found as Element) : null
}

/**
 * @internal The element of `path` among `fields` (exact path match), else `null`.
 * @param fields - The adapter's fields.
 * @param path - Dot path.
 */
export function fieldElement(fields: FieldInfo[], path: string): Element | null {
  for (const f of fields) if (f.path === path) return f.element ?? null
  return null
}

/** @internal The form owner of the first field that has an element, else `null`. */
export function firstFormOwner(fields: FieldInfo[]): Element | null {
  for (const f of fields) if (f.element) return formOwnerOf(f.element)
  return null
}

type Issue = { path: string; message: string }

/** Joins Standard Schema path segments with `.`; root issues use `""`. */
function issuePath(path: StandardSchemaV1.Issue['path']): string {
  if (!path || path.length === 0) return ''
  return path
    .map((seg) => {
      const key = typeof seg === 'object' && seg !== null ? seg.key : seg
      return typeof key === 'symbol' ? (key.description ?? '') : String(key)
    })
    .join('.')
}

const toIssues = (result: StandardSchemaV1.Result<unknown>): Issue[] =>
  result.issues
    ? result.issues.map((i) => ({ path: issuePath(i.path), message: String(i.message) }))
    : []

/**
 * @internal A synchronous issue reader for `state()`: runs a full `~standard.validate` of the
 * given values. A synchronous result is returned directly. A Promise result is not awaited: the
 * last settled result is returned instead (initially `[]`), and the pending one is cached when it
 * settles (newer validations win; no revision change is emitted). A throwing or rejecting schema
 * leaves the cached issues unchanged.
 * @param schema - Returns the schema to validate with (read on each call).
 */
export function createIssueReader(
  schema: () => StandardSchemaV1 | undefined,
): (values: unknown) => Issue[] {
  let last: Issue[] = []
  let started = 0
  let settled = 0
  return (values) => {
    const s = schema()
    if (!s) return []
    let result: StandardSchemaV1.Result<unknown> | Promise<StandardSchemaV1.Result<unknown>>
    try {
      // A detached copy: validators never see (or mutate) the form's own objects.
      result = s['~standard'].validate(snapshotValue(values))
    } catch {
      return last.map((i) => ({ ...i }))
    }
    if (result instanceof Promise) {
      const seq = ++started
      result.then(
        (r) => {
          if (seq < settled) return
          settled = seq
          last = toIssues(r)
        },
        () => undefined,
      )
      return last.map((i) => ({ ...i }))
    }
    const issues = toIssues(result)
    last = issues
    settled = ++started
    return issues.map((i) => ({ ...i }))
  }
}

/**
 * @internal Turns an adapter interaction into an `interaction` event. `input`/`focus` go to
 * `fillTool` with `param` = `mapPath(path)`; `submit` goes to `submitTool` (no param) when given,
 * else to `fillTool` with `param` = `mapPath('')` when that is non-empty. Malformed reports are
 * dropped. Only paths are emitted, never values.
 */
export function emitInteraction(
  tm: Toolmark,
  e: unknown,
  target: { fillTool: string; submitTool?: string; mapPath?: (path: string) => string },
): void {
  if (typeof e !== 'object' || e === null) return
  const { path, kind } = e as { path?: unknown; kind?: unknown }
  if (typeof path !== 'string' || (kind !== 'input' && kind !== 'focus' && kind !== 'submit')) {
    return
  }
  const param = target.mapPath ? target.mapPath(path) : path
  if (kind === 'submit' && target.submitTool !== undefined) {
    emitEvent(tm, 'interaction', { tool: target.submitTool, kind, caller: 'human' })
    return
  }
  emitEvent(tm, 'interaction', {
    tool: target.fillTool,
    ...(param !== '' ? { param } : {}),
    kind,
    caller: 'human',
  })
}

/**
 * @internal Subscribes to `adapter.onUserInteraction` when the adapter has it. A throwing
 * subscription is reported as a `tool_threw` `error` event and treated as no subscription.
 * @returns The unsubscribe function (a no-op when there is none).
 */
export function subscribeInteractions(
  tm: Toolmark,
  adapter: FormAdapter | undefined,
  tool: string,
  cb: (e: unknown) => void,
): () => void {
  if (typeof adapter?.onUserInteraction !== 'function') return () => undefined
  try {
    const off: unknown = adapter.onUserInteraction(cb)
    return typeof off === 'function' ? (off as () => void) : () => undefined
  } catch (cause) {
    emitEvent(tm, 'error', {
      code: 'tool_threw',
      message: `onUserInteraction() of the form adapter of "${tool}" threw`,
      tool,
      cause,
    })
    return () => undefined
  }
}
