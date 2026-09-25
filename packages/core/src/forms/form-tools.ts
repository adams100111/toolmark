import type { Registration, Toolmark } from '../registry.js'
import { registryState } from '../registry.js'
import { invalid, ok, type FieldChange, type ToolResult } from '../result.js'
import { resolveJsonSchema, stripRequired, validateInput } from '../schema.js'
import type { Scope } from '../scope.js'
import type { StandardSchemaV1 } from '../standard-schema.js'
import type { JsonSchema, ToolDefinition } from '../tool.js'
import { CONFIRM_SNAPSHOT, type ConfirmSnapshotHook } from '../confirm-snapshot.js'
import {
  applyArrayOp,
  deepEqual,
  extractArrayOps,
  flatten,
  flattenWithRejected,
  getPath,
  isPlainObject,
  isSafePath,
  setPath,
  snapshotValue,
} from './paths.js'
import type { FieldInfo, FormAdapter, FormToolOptions } from './types.js'

const REDACTED = '[redacted]'

interface FillInput {
  values: Record<string, unknown>
  overwrite?: boolean
}

/** Strict validator for the `fill` tool's own input shape. */
const fillInputSchema: StandardSchemaV1<unknown, FillInput> = {
  '~standard': {
    version: 1,
    vendor: 'toolmark',
    validate(value) {
      if (!isPlainObject(value)) return { issues: [{ message: 'Expected an object' }] }
      const issues: { message: string; path: PropertyKey[] }[] = []
      for (const key of Object.keys(value)) {
        if (key !== 'values' && key !== 'overwrite') {
          issues.push({ message: 'Unknown field', path: [key] })
        }
      }
      if (!isPlainObject(value.values)) {
        issues.push({ message: 'Expected an object of field values', path: ['values'] })
      }
      if (value.overwrite !== undefined && typeof value.overwrite !== 'boolean') {
        issues.push({ message: 'Expected a boolean', path: ['overwrite'] })
      }
      if (issues.length > 0) return { issues }
      const out: FillInput = { values: value.values as Record<string, unknown> }
      if (typeof value.overwrite === 'boolean') out.overwrite = value.overwrite
      return { value: out }
    },
  },
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Every property path the JSON Schema declares (object nodes and leaves). */
function declaredPaths(root: JsonSchema): Set<string> {
  const out = new Set<string>()
  const deref = (node: unknown): unknown => {
    if (!isRecord(node) || typeof node.$ref !== 'string') return node
    const m = /^#\/(\$defs|definitions)\/(.+)$/.exec(node.$ref)
    const defs = m ? root[m[1]!] : undefined
    return m && isRecord(defs) ? defs[m[2]!] : node
  }
  const walk = (raw: unknown, prefix: string, depth: number): void => {
    const node = deref(raw)
    if (!isRecord(node) || depth > 32) return
    for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
      const branches = node[key]
      if (Array.isArray(branches)) for (const b of branches) walk(b, prefix, depth + 1)
    }
    if (isRecord(node.properties)) {
      for (const [key, child] of Object.entries(node.properties)) {
        const path = prefix === '' ? key : `${prefix}.${key}`
        out.add(path)
        walk(child, path, depth + 1)
      }
    }
  }
  walk(root, '', 0)
  return out
}

/** Shape of an array-only node (arrays allowed, objects not), else `undefined`. */
function arrayOnlyShape(node: unknown, root: JsonSchema): Shape | undefined {
  const arr = collect(node, 'array', root)
  if (arr === undefined || arr === 'open' || collect(node, 'object', root) !== undefined) {
    return undefined
  }
  return arr
}

/**
 * The array-op `anyOf` (M2 pass-2 ruling): the stripped property `P`, `{ $append }` whose items
 * come from the unstripped schema (so their `required` survives), and `{ $remove }`.
 */
function arrayOpSchema(stripped: unknown, items: unknown): JsonSchema {
  const append: JsonSchema = { type: 'array' }
  if (items !== undefined) append.items = structuredClone(items)
  return {
    anyOf: [
      stripped,
      {
        type: 'object',
        properties: { $append: append },
        required: ['$append'],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: {
          $remove: { type: 'array', items: { type: 'integer', minimum: 0 }, uniqueItems: true },
        },
        required: ['$remove'],
        additionalProperties: false,
      },
    ],
  }
}

/**
 * Wraps every array-only property reachable through `properties` and `allOf`/`anyOf`/`oneOf` of
 * the stripped schema in {@link arrayOpSchema}, walking the unstripped schema in parallel. Array
 * items and `$defs` are not descended into (ops on arrays nested inside arrays stay accepted at
 * runtime but are not advertised).
 */
function wrapArrayOps(
  stripped: unknown,
  original: unknown,
  roots: { stripped: JsonSchema; original: JsonSchema },
  depth = 0,
): unknown {
  if (!isRecord(stripped) || !isRecord(original) || depth > 32) return stripped
  const out: Record<string, unknown> = { ...stripped }
  if (isRecord(stripped.properties) && isRecord(original.properties)) {
    const props: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(stripped.properties)) {
      const orig = Object.hasOwn(original.properties, key) ? original.properties[key] : undefined
      const shape = arrayOnlyShape(child, roots.stripped)
      const origShape = orig === undefined ? undefined : arrayOnlyShape(orig, roots.original)
      Object.defineProperty(props, key, {
        value:
          shape !== undefined
            ? arrayOpSchema(child, (origShape ?? shape).items)
            : wrapArrayOps(child, orig, roots, depth + 1),
        enumerable: true,
        writable: true,
        configurable: true,
      })
    }
    out.properties = props
  }
  for (const key of ['allOf', 'anyOf', 'oneOf'] as const) {
    const a = stripped[key]
    const b = original[key]
    if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
      out[key] = a.map((branch, i) => wrapArrayOps(branch, b[i], roots, depth + 1))
    }
  }
  return out
}

/**
 * The `fill` manifest schema (M1 rulings): input schema without `required`, then every array
 * property wrapped in the array-op `anyOf` (M2), `$defs` hoisted.
 */
function fillJsonSchema(inputSchema: JsonSchema): JsonSchema {
  const stripped = stripRequired(inputSchema)
  const values = wrapArrayOps(stripped, inputSchema, {
    stripped,
    original: inputSchema,
  }) as JsonSchema
  const schema: JsonSchema = {
    type: 'object',
    properties: { values, overwrite: { type: 'boolean' } },
    required: ['values'],
  }
  // Hoist definitions so `#/$defs/…` and `#/definitions/…` refs keep resolving from the root.
  for (const key of ['$defs', 'definitions'] as const) {
    if (values[key] !== undefined) schema[key] = values[key]
    delete values[key]
  }
  delete values.$schema
  return schema
}

function isSensitiveElement(el: Element | null | undefined): boolean {
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
      .some((token) => token.startsWith('cc-'))
  )
}

function sensitivePaths(opts: { sensitive?: string[] }, fields: FieldInfo[]): string[] {
  const out = [...(opts.sensitive ?? [])]
  for (const f of fields)
    if (f.sensitive === true || isSensitiveElement(f.element)) out.push(f.path)
  return out
}

function isUnder(path: string, base: string): boolean {
  return path === base || path.startsWith(`${base}.`)
}

/** Replaces every sensitive sub-path inside `value` (rooted at `path`) with `'[redacted]'`. */
function redactInside(value: unknown, path: string, sensitive: string[]): unknown {
  let out = value
  for (const s of sensitive) {
    if (!s.startsWith(`${path}.`) || typeof out !== 'object' || out === null) continue
    const rel = s.slice(path.length + 1)
    if (isSafePath(rel) && getPath(out, rel) !== undefined) out = setPath(out, rel, REDACTED)
  }
  return out
}

/** Redacts sensitive paths and sensitive values nested under changed ancestors (I1). */
function redact(changes: FieldChange[], sensitive: string[]): FieldChange[] {
  return changes.map((c) =>
    sensitive.some((s) => isUnder(c.path, s))
      ? { path: c.path, before: REDACTED, after: REDACTED }
      : {
          path: c.path,
          before: redactInside(c.before, c.path, sensitive),
          after: redactInside(c.after, c.path, sensitive),
        },
  )
}

interface ResolvedNode {
  properties: Record<string, unknown> | undefined
  items: unknown
  open: boolean
}

/** Follows a local `$ref` (`#/$defs/…`, `#/definitions/…`); unresolvable refs → `undefined`. */
function deref(node: unknown, root: JsonSchema, depth = 0): Record<string, unknown> | undefined {
  if (!isRecord(node) || depth > 32) return undefined
  if (typeof node.$ref !== 'string') return node
  const m = /^#\/(\$defs|definitions)\/([^/]+)$/.exec(node.$ref)
  const defs = m ? root[m[1]!] : undefined
  const target =
    m && isRecord(defs) && Object.prototype.hasOwnProperty.call(defs, m[2]!)
      ? defs[m[2]!]
      : undefined
  return deref(target, root, depth + 1)
}

const typeIncludes = (n: Record<string, unknown>, t: string): boolean =>
  n.type === t || (Array.isArray(n.type) && n.type.includes(t))

/**
 * Resolves a schema node for `value` (N1): follows `$ref`, merges `allOf`, and from
 * `anyOf`/`oneOf` keeps the branches whose shape matches the value (object or array), unioning
 * their properties. `undefined` when the node cannot be resolved.
 */
function resolveNode(
  raw: unknown,
  root: JsonSchema,
  value: unknown,
  depth = 0,
): ResolvedNode | undefined {
  const node = deref(raw, root)
  if (!node || depth > 32) return undefined
  const out: ResolvedNode = { properties: undefined, items: undefined, open: false }
  const merge = (r: ResolvedNode): void => {
    if (r.properties) out.properties = { ...(out.properties ?? {}), ...r.properties }
    if (out.items === undefined && r.items !== undefined) out.items = r.items
    if (r.open) out.open = true
  }
  if (isRecord(node.properties)) out.properties = { ...node.properties }
  if (node.items !== undefined) out.items = node.items
  if (node.additionalProperties !== undefined && node.additionalProperties !== false)
    out.open = true
  if (Array.isArray(node.allOf)) {
    for (const b of node.allOf) {
      const r = resolveNode(b, root, value, depth + 1)
      if (r) merge(r)
    }
  }
  for (const key of ['anyOf', 'oneOf'] as const) {
    const branches = node[key]
    if (!Array.isArray(branches)) continue
    for (const b of branches) {
      const target = deref(b, root)
      const r = resolveNode(b, root, value, depth + 1)
      if (!target || !r) continue
      const matches = Array.isArray(value)
        ? r.items !== undefined || typeIncludes(target, 'array')
        : isPlainObject(value)
          ? r.properties !== undefined || r.open || typeIncludes(target, 'object')
          : true
      if (matches) merge(r)
    }
  }
  return out
}

/** Why {@link nodeAt} could not resolve a path. */
type Unresolved = 'undeclared' | 'excluded'

/**
 * The JSON Schema node declaring `path` for the form value `merged`: follows `properties` (through
 * `$ref`, `allOf`, `anyOf`, `oneOf`), then `additionalProperties` (records); `true` once an open
 * `additionalProperties` accepts everything below. At a union whose value is an object, only the
 * branch matching that value is followed ({@link pickBranch}), so a key declared solely by another
 * branch is `'excluded'`; any other miss is `'undeclared'`.
 */
function nodeAt(root: JsonSchema, path: string, merged: unknown): { node: unknown } | Unresolved {
  let node: unknown = root
  let value: unknown = merged
  for (const seg of path.split('.')) {
    const picked = pickBranch(node, value, root)
    if (picked === undefined) return 'excluded'
    const excludedByBranch = picked !== node
    node = picked
    const r = resolveNode(node, root, {})
    const props = r?.properties
    value = isPlainObject(value) && Object.hasOwn(value, seg) ? value[seg] : undefined
    if (props && Object.prototype.hasOwnProperty.call(props, seg)) {
      node = props[seg]
      continue
    }
    const shape = collect(node, 'object', root)
    if (shape !== undefined && shape !== 'open') {
      if (shape.addl === true || (isRecord(shape.addl) && Object.keys(shape.addl).length === 0)) {
        return { node: true }
      }
      if (isRecord(shape.addl)) {
        node = shape.addl
        continue
      }
    }
    return excludedByBranch ? 'excluded' : 'undeclared'
  }
  return { node }
}

/** The union branches of a node that is only a union (`anyOf` or `oneOf`, plus maybe `type`). */
function unionBranches(node: Record<string, unknown>): unknown[] | undefined {
  const any = Array.isArray(node.anyOf) ? (node.anyOf as unknown[]) : undefined
  const one = Array.isArray(node.oneOf) ? (node.oneOf as unknown[]) : undefined
  if ((any === undefined) === (one === undefined)) return undefined
  const others = STRUCTURAL.filter(
    (k) => k in node && k !== 'anyOf' && k !== 'oneOf' && k !== 'type',
  )
  return others.length > 0 ? undefined : (any ?? one)
}

/** Whether every `const` / `enum` property of `branch` present in `value` agrees with it. */
function discriminatorsMatch(
  branch: Record<string, unknown>,
  value: Record<string, unknown>,
  root: JsonSchema,
): boolean {
  if (!isRecord(branch.properties)) return true
  for (const [key, raw] of Object.entries(branch.properties)) {
    if (!Object.hasOwn(value, key)) continue
    const prop = deref(raw, root)
    if (!prop) continue
    if ('const' in prop && !deepEqual(prop.const, value[key])) return false
    if (Array.isArray(prop.enum) && !prop.enum.some((e) => deepEqual(e, value[key]))) return false
  }
  return true
}

/**
 * For a union node and an object value, the single branch matching the value (m3): branches of the
 * wrong kind or whose `const`/`enum` discriminators disagree are discarded, then the branch
 * declaring most of the value's keys wins (first on ties). Nested unions are resolved in turn.
 * Returns `node` unchanged when it is not a union (or the value is not an object) and `undefined`
 * when no branch matches.
 */
function pickBranch(node: unknown, value: unknown, root: JsonSchema): unknown {
  let current = node
  for (let depth = 0; depth < 32; depth++) {
    const n = deref(current, root)
    const branches = n ? unionBranches(n) : undefined
    if (!branches || !isPlainObject(value)) return current
    let best: unknown
    let bestScore = -1
    for (const b of branches) {
      const target = deref(b, root)
      const shape = collect(b, 'object', root)
      if (!target || shape === undefined || !discriminatorsMatch(target, value, root)) continue
      const keys = Object.keys(value)
      const score =
        shape === 'open' || shape.addl === true || isRecord(shape.addl)
          ? keys.length
          : keys.filter((k) => shape.props !== undefined && Object.hasOwn(shape.props, k)).length
      if (score > bestScore) {
        best = b
        bestScore = score
      }
    }
    if (best === undefined) return undefined
    current = best
  }
  return current
}

const STRUCTURAL = [
  'type',
  'properties',
  'items',
  'prefixItems',
  'additionalProperties',
  'anyOf',
  'oneOf',
  'allOf',
  '$ref',
] as const

/** Effective shape of a schema node for one value kind (fix round 3). */
interface Shape {
  props: Record<string, unknown> | undefined
  items: unknown
  prefix: unknown[] | undefined
  /** `undefined` = absent. */
  addl: unknown
}

/**
 * Collects the shape a node declares for a value of `kind`. Returns `'open'` for `true`, `{}` or a
 * node without structural keywords; `undefined` (unresolved) for unresolvable `$ref`s, a `type`
 * that excludes `kind`, a failing `allOf` branch, or `anyOf`/`oneOf` with no branch of that kind
 * and no own shape.
 */
function collect(
  raw: unknown,
  kind: 'array' | 'object',
  root: JsonSchema,
  depth = 0,
): Shape | 'open' | undefined {
  if (raw === true) return 'open'
  if (!isRecord(raw) || depth > 32) return undefined
  let node: Record<string, unknown> = raw
  if (typeof node.$ref === 'string') {
    const target = deref(node, root)
    if (!target) return undefined
    const rest = { ...node }
    delete rest.$ref
    node = STRUCTURAL.some((k) => k in rest)
      ? {
          ...rest,
          allOf: [...(Array.isArray(rest.allOf) ? (rest.allOf as unknown[]) : []), target],
        }
      : target
  }
  if (!STRUCTURAL.some((k) => k in node)) return 'open'
  if (node.type !== undefined && !typeIncludes(node, kind)) return undefined

  const shape: Shape = {
    props: isRecord(node.properties) ? { ...node.properties } : undefined,
    items: node.items,
    prefix: Array.isArray(node.prefixItems) ? node.prefixItems : undefined,
    addl: node.additionalProperties,
  }
  const merge = (b: Shape): void => {
    if (b.props) shape.props = { ...(shape.props ?? {}), ...b.props }
    if (shape.items === undefined) shape.items = b.items
    if (shape.prefix === undefined) shape.prefix = b.prefix
    if (shape.addl === undefined || (!isRecord(shape.addl) && isRecord(b.addl))) {
      if (b.addl !== undefined) shape.addl = b.addl
    }
  }
  const hasShape = (): boolean =>
    shape.props !== undefined ||
    shape.items !== undefined ||
    shape.prefix !== undefined ||
    shape.addl !== undefined
  let allOpen = false
  if (Array.isArray(node.allOf)) {
    for (const b of node.allOf) {
      const c = collect(b, kind, root, depth + 1)
      if (c === undefined) return undefined
      if (c === 'open') allOpen = true
      else merge(c)
    }
  }
  for (const key of ['anyOf', 'oneOf'] as const) {
    const branches = node[key]
    if (!Array.isArray(branches)) continue
    const matches = branches
      .map((b) => collect(b, kind, root, depth + 1))
      .filter((c) => c !== undefined)
    if (matches.length === 0) {
      if (!hasShape()) return undefined
      continue
    }
    if (matches.includes('open') && !hasShape()) return 'open'
    for (const c of matches) if (c !== 'open') merge(c)
  }
  if (!hasShape() && allOpen) return 'open'
  return shape
}

const isStructured = (v: unknown): boolean => Array.isArray(v) || isPlainObject(v)

/**
 * Keeps only what the JSON Schema declares (C2b fallback when no validated value exists), per the
 * fix-round-3 ruling. Fails closed: any object/array whose node is unresolved is reported in
 * `undeclared` and the fill is refused.
 */
function sanitize(
  value: unknown,
  node: unknown,
  root: JsonSchema,
  path: string,
  undeclared: string[],
  depth = 0,
): unknown {
  if (!isStructured(value)) return value
  const kind = Array.isArray(value) ? 'array' : 'object'
  const branch = node === undefined ? undefined : pickBranch(node, value, root)
  const shape = depth > 64 || branch === undefined ? undefined : collect(branch, kind, root)
  if (shape === undefined) {
    undeclared.push(path)
    return undefined
  }
  if (shape === 'open') return value
  if (Array.isArray(value)) {
    return (value as unknown[]).map((item, i) => {
      const itemNode = shape.prefix && i < shape.prefix.length ? shape.prefix[i] : shape.items
      if (itemNode === undefined) {
        if (!isStructured(item)) return item
        undeclared.push(`${path}.${i}`)
        return undefined
      }
      return sanitize(item, itemNode, root, `${path}.${i}`, undeclared, depth + 1)
    })
  }
  const obj = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(obj)) {
    const child = `${path}.${key}`
    if (shape.props && Object.prototype.hasOwnProperty.call(shape.props, key)) {
      out[key] = sanitize(obj[key], shape.props[key], root, child, undeclared, depth + 1)
    } else if (isRecord(shape.addl) && Object.keys(shape.addl).length > 0) {
      out[key] = sanitize(obj[key], shape.addl, root, child, undeclared, depth + 1)
    } else if (
      shape.addl === true ||
      (isRecord(shape.addl) && Object.keys(shape.addl).length === 0) ||
      (shape.addl === undefined && shape.props === undefined)
    ) {
      out[key] = obj[key]
    }
    // `additionalProperties: false`, or absent on a node with `properties` → dropped.
  }
  return out
}

const byPath = (a: { path: string }, b: { path: string }): number =>
  a.path < b.path ? -1 : a.path > b.path ? 1 : 0

/**
 * Registers `<name>.fill` (partial, skips user-edited fields, undoable) and `<name>.submit`
 * (`consequential`) for a form (spec §8.1, D19).
 * @param tm - The registry.
 * @param adapter - The form adapter.
 * @param opts - Form tool options plus an optional target `scope`.
 * @returns A handle whose `dispose()` removes both tools.
 */
export function createFormTools<V extends Record<string, unknown>>(
  tm: Toolmark,
  adapter: FormAdapter<V>,
  opts: FormToolOptions<V> & { scope?: Scope },
): { dispose(): void } {
  const state = registryState(tm)
  const fillName = `${opts.name}.fill`

  let inputSchema: JsonSchema = {}
  const resolved = resolveJsonSchema(
    {
      name: fillName,
      description: opts.description,
      input: opts.input,
      ...(opts.jsonSchema !== undefined ? { jsonSchema: opts.jsonSchema } : {}),
      run: () => ok(null),
    },
    state?.options.jsonSchema,
  )
  if (resolved.ok) {
    inputSchema = resolved.schema
  } else if (state?.browser) {
    state.fail(
      'schema_conversion_failed',
      `Form "${opts.name}": cannot derive a JSON Schema for its input (${resolved.reason}). ` +
        `Set the form's jsonSchema or a global jsonSchema converter.`,
      fillName,
    )
  }
  const declared = declaredPaths(inputSchema)

  /** The value the agent last stored at each path (as read back from the adapter). */
  const agentSet = new Map<string, unknown>()

  /** The value the agent last stored at `path` (directly or via an ancestor write). */
  const agentValueAt = (path: string): { value: unknown } | undefined => {
    if (agentSet.has(path)) return { value: agentSet.get(path) }
    for (const [p, v] of agentSet) {
      if (path.startsWith(`${p}.`)) return { value: getPath(v, path.slice(p.length + 1)) }
    }
    return undefined
  }
  const differsFromAgent = (values: unknown, path: string): boolean => {
    const agent = agentValueAt(path)
    return agent === undefined || !deepEqual(getPath(values, path), agent.value)
  }
  /** Two-way (I2): a dirty path at, above or below `path` that the agent did not write. */
  const isUserEdited = (path: string, values: unknown, dirty: string[]): boolean =>
    dirty.some((d) => {
      if (!isSafePath(d)) return false
      if (isUnder(path, d)) return differsFromAgent(values, path)
      if (isUnder(d, path)) return differsFromAgent(values, d)
      return false
    })

  /** Array rule (M2): a dirty path at or under `path` and the array differs from the agent's. */
  const isArrayUserEdited = (path: string, values: unknown, dirty: string[]): boolean =>
    dirty.some((d) => isSafePath(d) && (isUnder(d, path) || isUnder(path, d))) &&
    differsFromAgent(values, path)

  async function fill(
    input: FillInput,
    registerUndo: (restore: () => ToolResult<unknown>) => void,
  ) {
    const current = adapter.getValues()
    // Array ops (M2): a `$`-keyed object, or any object where the schema declares only an array.
    const nodeFor = (path: string): unknown => {
      const at = nodeAt(inputSchema, path, current)
      return typeof at === 'object' ? at.node : undefined
    }
    const { rest, ops } = extractArrayOps(input.values, (path) => {
      const node = nodeFor(path)
      return node !== undefined && arrayOnlyShape(node, inputSchema) !== undefined
    })
    const { values: flat, rejected } = flattenWithRejected(rest)
    const issues = rejected.map((path) => ({ path, message: 'Invalid field path' }))
    const opKinds = new Map<string, 'append' | 'remove'>()
    for (const [path, op] of ops) {
      const node = nodeFor(path)
      const conflict = Object.keys(flat).find((p) => isUnder(p, path) || isUnder(path, p))
      if (node === undefined || collect(node, 'array', inputSchema) === undefined) {
        issues.push({ path, message: 'Array operations apply to array fields only' })
      } else if (conflict !== undefined) {
        issues.push({ path: conflict, message: 'Conflicts with an array operation' })
      } else {
        const applied = applyArrayOp(op, getPath(current, path), path)
        if ('error' in applied) {
          issues.push({ path, message: applied.error })
        } else {
          opKinds.set(path, applied.kind)
          Object.defineProperty(flat, path, {
            value: applied.next,
            enumerable: true,
            writable: true,
            configurable: true,
          })
        }
      }
    }
    if (issues.length > 0) return invalid(issues.sort(byPath))
    const dirty = adapter.dirtyPaths()
    const skipped: string[] = []
    const touched: string[] = []
    for (const path of Object.keys(flat)) {
      if (flat[path] === undefined) continue
      const kind = opKinds.get(path)
      const edited =
        kind === 'append'
          ? false // `$append` keeps existing items untouched, so it is applied even when edited.
          : kind === 'remove' || Array.isArray(flat[path])
            ? isArrayUserEdited(path, current, dirty)
            : isUserEdited(path, current, dirty)
      if (input.overwrite !== true && edited) {
        skipped.push(path)
      } else {
        touched.push(path)
      }
    }

    // Merge-based validation: only issues on touched paths count (M1 rulings).
    let merged: unknown = current
    for (const path of touched)
      merged = setPath(merged, path, flat[path] === null ? undefined : flat[path])
    const checked = await validateInput(opts.input, merged)
    if (!checked.ok) {
      const relevant = checked.issues.filter((i) => touched.some((p) => isUnder(i.path, p)))
      if (relevant.length > 0) return invalid(relevant)
    }

    // Declared paths only (spec §14), including record entries (`additionalProperties`, m2). A
    // key that only another union branch declares is unknown for this value (m3).
    const parsedPaths = checked.ok
      ? new Set(Object.keys(flatten(checked.value)))
      : new Set<string>()
    const nodes = new Map<string, unknown>()
    const unknown: string[] = []
    for (const p of touched) {
      const at = nodeAt(inputSchema, p, merged)
      if (typeof at === 'object') nodes.set(p, at.node)
      if (parsedPaths.has(p)) continue
      if (at === 'excluded' || (at === 'undeclared' && !declared.has(p))) unknown.push(p)
    }
    if (unknown.length > 0) {
      return invalid(unknown.sort().map((path) => ({ path, message: 'Unknown field' })))
    }

    const before = new Map(touched.map((p) => [p, getPath(current, p)] as const))
    // C2: write the validated value (schema-stripped); without one, the schema-sanitized value.
    const undeclared: string[] = []
    const safe = new Map<string, unknown>()
    for (const path of touched) {
      const raw = flat[path]
      let v: unknown = raw === null ? null : undefined
      if (raw !== null && checked.ok) v = getPath(checked.value, path)
      if (raw !== null && v === undefined) {
        v = sanitize(raw, nodes.get(path), inputSchema, path, undeclared)
      }
      safe.set(path, v)
    }
    if (undeclared.length > 0) {
      return invalid(undeclared.sort().map((path) => ({ path, message: 'Undeclared field' })))
    }
    const safeValue = (path: string): unknown => safe.get(path)
    const toWrite: Record<string, unknown> = {}
    for (const path of touched) {
      const next = safeValue(path)
      const prev = before.get(path)
      const changes = next === null ? prev !== undefined && prev !== null : !deepEqual(prev, next)
      if (changes) toWrite[path] = next
    }
    if (Object.keys(toWrite).length > 0) adapter.setValues(toWrite, { source: 'agent' })
    const after = adapter.getValues()
    const changes: FieldChange[] = []
    const stored = new Map<string, unknown>()
    for (const path of touched) {
      const value = getPath(after, path)
      for (const p of [...agentSet.keys()]) if (p.startsWith(`${path}.`)) agentSet.delete(p)
      agentSet.set(path, value)
      stored.set(path, value)
      if (!deepEqual(before.get(path), value)) {
        changes.push({ path, before: before.get(path), after: value })
      }
    }

    if (changes.length > 0) {
      const restorable = changes.map((c) => c.path)
      registerUndo(() => {
        const now = adapter.getValues()
        const restore: Record<string, unknown> = {}
        const undoSkipped: string[] = []
        for (const path of restorable) {
          if (deepEqual(getPath(now, path), stored.get(path))) {
            const prev = before.get(path)
            restore[path] = prev === undefined ? null : prev
          } else {
            undoSkipped.push(path)
          }
        }
        if (Object.keys(restore).length > 0) adapter.setValues(restore, { source: 'undo' })
        const restored = adapter.getValues()
        const undoChanges: FieldChange[] = []
        for (const path of Object.keys(restore)) {
          agentSet.delete(path)
          undoChanges.push({ path, before: getPath(now, path), after: getPath(restored, path) })
        }
        return ok({
          changes: redact(undoChanges, sensitivePaths(opts, adapter.fields())).sort(byPath),
          skipped: undoSkipped.sort(),
        })
      })
    }

    return ok({
      changes: redact(changes, sensitivePaths(opts, adapter.fields())).sort(byPath),
      skipped: skipped.sort(),
    })
  }

  const title = opts.title !== undefined ? { title: opts.title } : {}
  const fillReg = tm.register(
    {
      name: fillName,
      ...title,
      description:
        `${opts.description} Fill form fields: pass a partial object in "values" (null clears a ` +
        `field). Fields the user edited are skipped unless "overwrite" is true.`,
      input: fillInputSchema,
      jsonSchema: fillJsonSchema(inputSchema),
      run: (input, ctx) => fill(input, (restore) => ctx.registerUndo(restore)),
    },
    opts.scope ? { scope: opts.scope } : undefined,
  )
  // I3: a confirmation is refused `stale` when the form changed after it was requested.
  const snapshotHook: ConfirmSnapshotHook = {
    take: () => snapshotValue(adapter.getValues()),
    changed: (snapshot) => !deepEqual(adapter.getValues(), snapshot),
  }
  const submitTool: ToolDefinition<unknown, unknown> & { [CONFIRM_SNAPSHOT]: ConfirmSnapshotHook } =
    {
      name: `${opts.name}.submit`,
      ...title,
      description: `${opts.description} Submit the form.`,
      hints: { consequential: true },
      summary: () =>
        opts.submitSummary?.(adapter.getValues()) ?? `Submit ${opts.title ?? opts.name}`,
      run: () => adapter.submit(),
      [CONFIRM_SNAPSHOT]: snapshotHook,
    }
  /** Whether `reg` is live (production reports a failed registration and returns an inert one). */
  const isLive = (reg: Registration): boolean =>
    !state?.browser || state.entries.get(reg.name)?.registration === reg
  const scopeOpt = opts.scope ? { scope: opts.scope } : undefined
  // m8: never leave half a pair behind — without `fill` there is no `submit`, and vice versa.
  if (!isLive(fillReg)) return { dispose() {} }
  let submitReg: Registration
  try {
    submitReg = tm.register(submitTool, scopeOpt)
  } catch (e) {
    fillReg.dispose()
    throw e
  }
  if (!isLive(submitReg)) {
    fillReg.dispose()
    return { dispose() {} }
  }
  return {
    dispose() {
      fillReg.dispose()
      submitReg.dispose()
    },
  }
}
