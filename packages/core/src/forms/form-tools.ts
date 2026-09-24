import type { Toolmark } from '../registry.js'
import { registryState } from '../registry.js'
import { invalid, ok, type FieldChange, type ToolResult } from '../result.js'
import { resolveJsonSchema, stripRequired, validateInput } from '../schema.js'
import type { Scope } from '../scope.js'
import type { StandardSchemaV1 } from '../standard-schema.js'
import type { JsonSchema, ToolDefinition } from '../tool.js'
import { CONFIRM_SNAPSHOT, type ConfirmSnapshotHook } from '../confirm-snapshot.js'
import {
  deepEqual,
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

/** The `fill` manifest schema (M1 rulings): input schema without `required`, `$defs` hoisted. */
function fillJsonSchema(inputSchema: JsonSchema): JsonSchema {
  const values = stripRequired(inputSchema)
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

/** The raw JSON Schema node declaring `path` (through `$ref`, `allOf`, `anyOf`, `oneOf`). */
function schemaAt(root: JsonSchema, path: string): unknown {
  let node: unknown = root
  for (const seg of path.split('.')) {
    const r = resolveNode(node, root, {})
    const props = r?.properties
    if (!props || !Object.prototype.hasOwnProperty.call(props, seg)) return undefined
    node = props[seg]
  }
  return node
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
  const shape = depth > 64 || node === undefined ? undefined : collect(node, kind, root)
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

  async function fill(
    input: FillInput,
    registerUndo: (restore: () => ToolResult<unknown>) => void,
  ) {
    const { values: flat, rejected } = flattenWithRejected(input.values)
    if (rejected.length > 0) {
      return invalid(rejected.sort().map((path) => ({ path, message: 'Invalid field path' })))
    }
    const current = adapter.getValues()
    const dirty = adapter.dirtyPaths()
    const skipped: string[] = []
    const touched: string[] = []
    for (const path of Object.keys(flat)) {
      if (flat[path] === undefined) continue
      if (input.overwrite !== true && isUserEdited(path, current, dirty)) {
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

    // Declared paths only (spec §14).
    const parsedPaths = checked.ok
      ? new Set(Object.keys(flatten(checked.value)))
      : new Set<string>()
    const unknown = touched.filter((p) => !declared.has(p) && !parsedPaths.has(p))
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
        v = sanitize(raw, schemaAt(inputSchema, path), inputSchema, path, undeclared)
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
  let submitReg: { dispose(): void }
  try {
    submitReg = tm.register(submitTool, opts.scope ? { scope: opts.scope } : undefined)
  } catch (e) {
    fillReg.dispose()
    throw e
  }
  return {
    dispose() {
      fillReg.dispose()
      submitReg.dispose()
    },
  }
}
