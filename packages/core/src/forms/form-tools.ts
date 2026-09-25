import { ToolmarkError } from '../errors.js'
import {
  effectiveSpec,
  fileFieldSchema,
  fileLimitIssues,
  fileRefCount,
  filesConfig,
  fileSpecProblems,
  jsonSafeFiles,
  MAX_FILE_REFS_PER_FILL,
  resolveFileRef,
  TOO_MANY_FILES_PER_FILL,
  type FileFieldSpec,
  type FilesConfig,
  type FileRef,
} from '../files.js'
import { fromJsonSchema } from '../json-schema/from-json-schema.js'
import type { Registration, Toolmark } from '../registry.js'
import { registryState } from '../registry.js'
import { invalid, ok, refuse, type FieldChange, type ToolResult } from '../result.js'
import { resolveJsonSchema, stripRequired, validateInput } from '../schema.js'
import type { Scope } from '../scope.js'
import type { StandardSchemaV1 } from '../standard-schema.js'
import type { AnchorSpec, JsonSchema, ToolDefinition, ToolHints, ToolState } from '../tool.js'
import { CONFIRM_SNAPSHOT, type ConfirmSnapshotHook } from '../confirm-snapshot.js'
import { INPUT_SENSITIVE_PATHS, redactChanges } from '../input-redaction.js'
import {
  applyArrayOp,
  deepEqual,
  extractArrayOps,
  flatten,
  flattenWithRejected,
  getPath,
  isPlainObject,
  isSafePath,
  nodeBudget,
  setPath,
  snapshotValue,
  spend,
  type NodeBudget,
} from './paths.js'
import { annotateOptionField, optionsToolDefinition } from './options.js'
import {
  createIssueReader,
  emitInteraction,
  fieldElement,
  firstFormOwner,
  publishSensitive,
  redactValues,
  safeFields,
  sensitiveMemoryOf,
  stickySensitive,
  subscribeInteractions,
} from './hooks.js'
import type { FormAdapter, FormToolOptions } from './types.js'

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
 * items and `$defs` are not descended into. At runtime `fill` resolves paths only through
 * `properties`, `additionalProperties` and local `$ref`s, never through array `items`, so an op on
 * an array nested inside an array is rejected (`invalid`, fail closed); an array reached only
 * through a `$ref`'d object is accepted but not advertised.
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

/** Splits a file/option key into segments, `[]` as its own segment (`a[].b` → `a`,`[]`,`b`). */
function keySegments(path: string): string[] {
  return path
    .split('.')
    .flatMap((seg) => (seg.endsWith('[]') && seg !== '[]' ? [seg.slice(0, -2), '[]'] : [seg]))
}

/** Follows a local `$ref` of the fill schema (after `$defs` hoisting). */
function derefFill(node: Record<string, unknown>, root: JsonSchema): unknown {
  if (typeof node.$ref !== 'string') return undefined
  const m = /^#\/(\$defs|definitions)\/([^/]+)$/.exec(node.$ref)
  const defs = m ? root[m[1]!] : undefined
  return m && isRecord(defs) && Object.hasOwn(defs, m[2]!) ? defs[m[2]!] : undefined
}

/**
 * Replaces the node(s) a file key reaches in the fill schema `values` node with `schema` (in
 * place, M2 T3): through `properties`, `items` for `[]` (and the `$append` items of an array-op
 * branch), unions, `allOf` and local `$ref`s. The whole property is replaced, so a file field never
 * carries array-op branches.
 */
function replaceFileField(
  values: JsonSchema,
  root: JsonSchema,
  path: string,
  schema: JsonSchema,
): void {
  const visit = (node: unknown, rest: string[], depth: number): void => {
    if (!isRecord(node) || depth > 64 || rest.length === 0) return
    const target = derefFill(node, root)
    if (target !== undefined) visit(target, rest, depth + 1)
    for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
      const list = node[key]
      if (Array.isArray(list)) for (const b of list) visit(b, rest, depth + 1)
    }
    const [head, ...tail] = rest as [string, ...string[]]
    const props = isRecord(node.properties) ? node.properties : undefined
    if (head === '[]') {
      const append = props && Object.hasOwn(props, '$append') ? props.$append : undefined
      for (const holder of [node, isRecord(append) ? append : undefined]) {
        if (!holder || holder.items === undefined) continue
        if (tail.length === 0) holder.items = structuredClone(schema)
        else visit(holder.items, tail, depth + 1)
      }
    } else if (props && Object.hasOwn(props, head)) {
      if (tail.length === 0) {
        Object.defineProperty(props, head, {
          value: structuredClone(schema),
          enumerable: true,
          writable: true,
          configurable: true,
        })
      } else {
        visit(props[head], tail, depth + 1)
      }
    }
  }
  visit(values, keySegments(path), 0)
}

/**
 * The `fill` manifest schema (M1 rulings): input schema without `required`, then every array
 * property wrapped in the array-op `anyOf` (M2), `$defs` hoisted, then every file path replaced by
 * its `fileFieldSchema` (M2 T3) and every option field's `description` suffixed with the
 * `<name>.options` hint (M2 T2).
 */
function fillJsonSchema(
  inputSchema: JsonSchema,
  options?: { form: string; keys: string[] },
  files?: { path: string; schema: JsonSchema }[],
): JsonSchema {
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
  for (const f of files ?? []) replaceFileField(values, schema, f.path, f.schema)
  if (options) {
    const suffix = ` (use ${options.form}.options to find valid values)`
    for (const key of options.keys) annotateOptionField(values, schema, key, suffix)
  }
  return schema
}

function isUnder(path: string, base: string): boolean {
  return path === base || path.startsWith(`${base}.`)
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
        // SEC-2: an open `additionalProperties` next to declared `properties` (plain JSON Schema,
        // `z.looseObject`) does not declare other keys; only a record (no `properties`) does.
        if (shape.props !== undefined) return excludedByBranch ? 'excluded' : 'undeclared'
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
      shape.props === undefined &&
      (shape.addl === true || shape.addl === undefined || isRecord(shape.addl))
    ) {
      // A record / free-form object (no `properties`): its keys are data.
      out[key] = obj[key]
    } else if (shape.addl === true || isRecord(shape.addl)) {
      // SEC-2: a key that a node with `properties` does not declare but explicitly leaves open
      // (`additionalProperties: true` or `{}`, e.g. `z.looseObject`) is refused, never written.
      undeclared.push(child)
    }
    // `additionalProperties: false`, or absent on a node with `properties` → dropped (never
    // written; zod's default object strips such keys the same way).
  }
  return out
}

/** A form file field: its key segments and effective limits. */
interface FileField {
  segs: string[]
  spec: FileFieldSpec
  validate: StandardSchemaV1<unknown, unknown>
}

/** A file value found in the agent's input, to be replaced by the resolved `File`(s). */
interface FileSlot {
  path: string
  raw: unknown
  field: FileField
  container: Record<string, unknown> | unknown[]
  key: string
}

/** Total references of the collected slots (toward {@link MAX_FILE_REFS_PER_FILL}). */
const slotRefCount = (slots: FileSlot[]): number =>
  slots.reduce((n, slot) => n + fileRefCount(slot.raw, slot.field.spec), 0)

/**
 * @internal Carried by a form's `fill` definition: counts the file references a `values` object
 * holds (0 when the form has no file fields or the input is too complex to walk), so a wizard can
 * cap the total across all its steps before any step resolves a file.
 */
export const FILE_REF_COUNT: unique symbol = Symbol('toolmark.fileRefCount')

const matchesKey = (pattern: string[], segs: string[]): boolean =>
  pattern.length === segs.length &&
  pattern.every((p, i) => (p === '[]' ? /^\d+$/.test(segs[i]!) : p === segs[i]))

const define = (container: object, key: string, value: unknown): void => {
  Object.defineProperty(container, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  })
}

/**
 * Copies the agent's `values`, collecting every value at a file path (M2 T3). `$append` segments
 * are transparent (items of an append op match `list[]` keys). A dotted key that runs through a
 * file path is an issue ("Expected a file reference"). Cycles, over-deep values and subtrees past
 * `budget` are copied raw (the later walks refuse them).
 */
function collectFileSlots(
  values: Record<string, unknown>,
  fields: FileField[],
  budget: NodeBudget,
): {
  tree: Record<string, unknown>
  slots: FileSlot[]
  issues: { path: string; message: string }[]
} {
  const slots: FileSlot[] = []
  const issues: { path: string; message: string }[] = []
  const ancestors = new WeakSet<object>()
  const fieldAt = (segs: string[]): FileField | undefined =>
    fields.find((f) => matchesKey(f.segs, segs))
  const walk = (
    node: Record<string, unknown> | unknown[],
    match: string[],
    real: string[],
    depth: number,
  ): Record<string, unknown> | unknown[] => {
    ancestors.add(node)
    const isArray = Array.isArray(node)
    const out: Record<string, unknown> | unknown[] = isArray ? new Array<unknown>(node.length) : {}
    const keys: string[] = []
    if (isArray) {
      for (let i = 0; i < node.length; i++) if (i in node) keys.push(String(i))
    } else {
      keys.push(...Object.keys(node))
    }
    for (const key of keys) {
      const value = (node as Record<string, unknown>)[key]
      const keySegs = isArray ? [key] : key.split('.')
      const realSegs = [...real, ...keySegs]
      const matchSegs = !isArray && key === '$append' ? match : [...match, ...keySegs]
      let next = value
      let through = -1
      for (let i = 1; i < keySegs.length && through < 0; i++) {
        if (fieldAt([...match, ...keySegs.slice(0, i)])) through = i
      }
      if (through > 0) {
        issues.push({
          path: [...real, ...keySegs.slice(0, through)].join('.'),
          message: 'Expected a file reference',
        })
      } else {
        const field = fieldAt(matchSegs)
        if (field) {
          if (value !== null && value !== undefined) {
            slots.push({ path: realSegs.join('.'), raw: value, field, container: out, key })
          }
        } else if (
          (isPlainObject(value) || Array.isArray(value)) &&
          depth < 64 &&
          !ancestors.has(value) &&
          (!Array.isArray(value) || value.length <= budget.left) &&
          spend(budget)
        ) {
          next = walk(value, matchSegs, realSegs, depth + 1)
        } else if (Array.isArray(value) && value.length > budget.left) {
          budget.left = -1
        }
      }
      define(out, key, next)
    }
    ancestors.delete(node)
    return out
  }
  const tree = walk(values, [], [], 0) as Record<string, unknown>
  return { tree, slots, issues }
}

/**
 * Validates each file slot's shape against its field's `fileFieldSchema` (issues at the slot).
 * The count (`maxFiles`) and reference-length limits are checked first, cheaply; a slot that
 * breaks them is not schema-validated further (no walk over thousands of items or huge strings).
 */
function fileShapeIssues(slots: FileSlot[]): { path: string; message: string }[] {
  const issues: { path: string; message: string }[] = []
  for (const slot of slots) {
    const limits = fileLimitIssues(slot.raw, slot.field.spec, slot.path)
    if (limits.length > 0) {
      issues.push(...limits)
      continue
    }
    const r = slot.field.validate['~standard'].validate(slot.raw)
    if (r instanceof Promise || !r.issues) continue
    for (const issue of r.issues) {
      const rel = (issue.path ?? [])
        .map((seg) => String(typeof seg === 'object' && seg !== null ? seg.key : seg))
        .join('.')
      issues.push({ path: rel === '' ? slot.path : `${slot.path}.${rel}`, message: issue.message })
    }
  }
  return issues
}

/**
 * Resolves every slot (sequentially, `multiple` → `File[]`) and writes the files into the copied
 * tree. Returns the first `file_rejected` message, or `undefined` when all resolved.
 */
async function resolveFileSlots(
  slots: FileSlot[],
  files: FilesConfig,
  signal: AbortSignal,
): Promise<string | undefined> {
  const resolved: { slot: FileSlot; value: File | File[] }[] = []
  try {
    for (const slot of slots) {
      const spec = slot.field.spec
      if (spec.multiple === true) {
        const list: File[] = []
        const refs = slot.raw as FileRef[]
        for (let i = 0; i < refs.length; i++) {
          list.push(
            await resolveFileRef(refs[i]!, spec, files, signal, { path: `${slot.path}.${i}` }),
          )
        }
        resolved.push({ slot, value: list })
      } else {
        const file = await resolveFileRef(slot.raw as FileRef, spec, files, signal, {
          path: slot.path,
        })
        resolved.push({ slot, value: file })
      }
    }
  } catch (e) {
    return e instanceof ToolmarkError && e.code === 'file_rejected' ? e.message : 'File rejected'
  }
  for (const { slot, value } of resolved) define(slot.container, slot.key, value)
  return undefined
}

/** A change with file values described JSON-safely (`{ file: { name, size, type } }`). */
const safeChange = (c: FieldChange): FieldChange => ({
  path: c.path,
  before: jsonSafeFiles(c.before),
  after: jsonSafeFiles(c.after),
})

const byPath = (a: { path: string }, b: { path: string }): number =>
  a.path < b.path ? -1 : a.path > b.path ? 1 : 0

/**
 * Registers `<name>.fill` (partial, skips user-edited fields, undoable) and `<name>.submit`
 * (`consequential`) for a form (spec §8.1, D19), plus `<name>.options` (`readOnly`) when
 * `opts.options` declares async option lookups (spec §8.3).
 *
 * Tour hooks (spec §13): `.fill` anchors `resolve(path)` to that field's `element` from
 * `adapter.fields()`; `.fill` and `.submit` anchor to the form owner of the first field element
 * (`null` without one). Both expose `state()` → `{ values, issues }`: `values` from
 * `adapter.getValues()` with every sensitive path replaced by `'[redacted]'`, `issues` from a full
 * validation of the current values (an async schema yields the last settled result, initially
 * `[]`); `state()` never awaits and never writes the form. Sensitive paths (`sensitivePaths()`,
 * `tm.info`) are `opts.sensitive`, fields with `FieldInfo.sensitive`, and fields whose element is a
 * password / `cc-*` / secret-`autocomplete` control. When the adapter has `onUserInteraction`, each
 * user interaction is emitted as an `interaction` event (`<name>.fill` with `param: <path>` for
 * `input`/`focus`, `<name>.submit` for `submit`; paths only, never values).
 * @param tm - The registry.
 * @param adapter - The form adapter.
 * @param opts - Form tool options plus an optional target `scope`.
 * @returns A handle whose `dispose()` removes the form's tools.
 */
/** Options objects the DOM scanner built for a `toolautosubmit` form (see {@link markAutosubmit}). */
const autosubmitForms = new WeakSet<object>()

/**
 * @internal Marks a `createFormTools` options object as the DOM scanner's `toolautosubmit` form,
 * the only case whose `hints.submit` may drop below `consequential` (the browser page itself opted
 * into agent submission). Not reachable through any public option.
 */
export function markAutosubmit<T extends object>(opts: T): T {
  autosubmitForms.add(opts)
  return opts
}

/**
 * The submit tool's hints: `hints.submit` merged over the floor — a submit is always at least
 * `consequential` (or `destructive`) and never `readOnly`, except for a scanner-marked
 * `toolautosubmit` form, whose hints are taken as given.
 */
function submitHints(opts: object, given: ToolHints | undefined): ToolHints {
  if (autosubmitForms.has(opts)) return given !== undefined ? { ...given } : { consequential: true }
  const hints: ToolHints = { ...given }
  delete hints.readOnly
  if (hints.destructive !== true) hints.consequential = true
  return hints
}

export function createFormTools<V extends Record<string, unknown>>(
  tm: Toolmark,
  adapter: FormAdapter<V>,
  opts: FormToolOptions<V> & { scope?: Scope },
): { dispose(): void } {
  const state = registryState(tm)
  const fillName = `${opts.name}.fill`

  // Files (M2 T3): validate the specs first; a misconfigured form registers no tools.
  const fileKeys = opts.files ? Object.keys(opts.files) : []
  if (state?.browser) {
    const problems = fileKeys.flatMap((key) => [
      ...(keySegments(key).every((seg) => seg === '[]' || isSafePath(seg))
        ? []
        : [`files key "${key}" is not a valid field path`]),
      ...fileSpecProblems(key, opts.files![key]),
    ])
    if (problems.length > 0) {
      state.fail('files_misconfigured', `Form "${opts.name}": ${problems.join('; ')}`, fillName)
      return { dispose() {} }
    }
  }
  const filesCfg =
    state?.files ??
    filesConfig(
      undefined,
      () => undefined,
      () => undefined,
    )
  const fileFields: FileField[] = fileKeys.map((key) => {
    const spec = effectiveSpec(opts.files![key]!, filesCfg)
    return { segs: keySegments(key), spec, validate: fromJsonSchema(fileFieldSchema(spec)) }
  })

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
    fileKeys.length > 0 ? { libraryOptions: { unrepresentable: 'any' } } : undefined,
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

  /** The sensitive rule of this form, sticky for the adapter's lifetime (spec §14). */
  const sensitiveOf = stickySensitive(
    opts.sensitive,
    typeof adapter === 'object' && adapter !== null ? sensitiveMemoryOf(adapter) : undefined,
  )

  async function fill(
    input: FillInput,
    registerUndo: (restore: () => ToolResult<unknown>) => void,
    signal: AbortSignal,
  ) {
    // Every walk over the agent's input shares one node budget (DAG inputs from in-page callers).
    const budget = nodeBudget()
    const tooComplex = () => invalid([{ path: '', message: 'Input too complex' }])
    // Files (M2 T3): (1) shape-check every file value, (2) resolve all (any failure refuses the
    // fill, nothing set), (3) continue with the resolved `File`s merged into the input.
    let values = input.values
    if (fileFields.length > 0) {
      const collected = collectFileSlots(values, fileFields, budget)
      if (budget.left < 0) return tooComplex()
      // Total cap (all slots, `[]` items and `multiple` lists together) before any shape check
      // or resolution: an agent cannot make the resolver / fetch run thousands of times.
      if (slotRefCount(collected.slots) > MAX_FILE_REFS_PER_FILL) {
        return invalid([{ ...TOO_MANY_FILES_PER_FILL }])
      }
      const shapeIssues = [...collected.issues, ...fileShapeIssues(collected.slots)]
      if (shapeIssues.length > 0) return invalid(shapeIssues.sort(byPath))
      const failure = await resolveFileSlots(collected.slots, filesCfg, signal)
      if (failure !== undefined) return refuse('file_rejected', failure)
      values = collected.tree
    }
    const current = adapter.getValues()
    // Array ops (M2): an object where the schema declares only an array, or a `$`-keyed object
    // unless the schema declares an object (record / open object) and no array there, so
    // `$`-keyed record data stays plain data (I3) while `{ $append }` on a scalar is still an op
    // (then "Array operations apply to array fields only").
    const nodeFor = (path: string): unknown => {
      const at = nodeAt(inputSchema, path, current)
      return typeof at === 'object' ? at.node : undefined
    }
    const {
      rest,
      ops,
      duplicates: opDuplicates,
    } = extractArrayOps(
      values,
      (path) => {
        const node = nodeFor(path)
        return node !== undefined && arrayOnlyShape(node, inputSchema) !== undefined
      },
      (path) => {
        const node = nodeFor(path)
        if (node === undefined) return true
        const arr = collect(node, 'array', inputSchema)
        return (
          (arr !== undefined && arr !== 'open') ||
          collect(node, 'object', inputSchema) === undefined
        )
      },
      budget,
    )
    if (budget.left < 0) return tooComplex()
    const { values: flat, rejected, duplicates } = flattenWithRejected(rest, undefined, budget)
    if (budget.left < 0) return tooComplex()
    const issues = rejected.map((path) => ({ path, message: 'Invalid field path' }))
    // m1: two values (ops or plain) resolving to the same path are refused, nothing is set.
    const duplicated = new Set([...duplicates, ...opDuplicates])
    for (const path of ops.keys()) if (Object.hasOwn(flat, path)) duplicated.add(path)
    for (const path of duplicated) issues.push({ path, message: 'Duplicate field path' })
    const opKinds = new Map<string, 'append' | 'remove'>()
    for (const [path, op] of ops) {
      if (duplicated.has(path)) continue
      const node = nodeFor(path)
      const conflict = Object.keys(flat).find((p) => isUnder(p, path) || isUnder(path, p))
      if (node === undefined || collect(node, 'array', inputSchema) === undefined) {
        issues.push({ path, message: 'Array operations apply to array fields only' })
      } else if (conflict !== undefined) {
        issues.push({ path: conflict, message: 'Conflicts with an array operation' })
      } else {
        const applied = applyArrayOp(op, getPath(current, path), path, budget)
        if (budget.left < 0) return tooComplex()
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
    // SEC-2: the schema check runs for every touched path, including ones an open validator
    // (`z.looseObject`, JSON Schema without `additionalProperties: false`) kept: those are
    // "Undeclared field"; paths neither the validator nor the schema knows are "Unknown field".
    const openUndeclared: string[] = []
    for (const p of touched) {
      const at = nodeAt(inputSchema, p, merged)
      if (typeof at === 'object') nodes.set(p, at.node)
      if (at === 'excluded' || (at === 'undeclared' && !declared.has(p))) {
        if (parsedPaths.has(p)) openUndeclared.push(p)
        else unknown.push(p)
      }
    }
    if (unknown.length > 0 || openUndeclared.length > 0) {
      return invalid(
        [
          ...unknown.map((path) => ({ path, message: 'Unknown field' })),
          ...openUndeclared.map((path) => ({ path, message: 'Undeclared field' })),
        ].sort(byPath),
      )
    }

    const before = new Map(touched.map((p) => [p, getPath(current, p)] as const))
    // C2: write the validated value (schema-stripped); without one, the schema-sanitized value.
    const undeclared: string[] = []
    const safe = new Map<string, unknown>()
    for (const path of touched) {
      const raw = flat[path]
      let v: unknown = raw === null ? null : undefined
      if (raw !== null && checked.ok) v = getPath(checked.value, path)
      if (raw !== null) {
        // SEC-2: the validated value is sanitized too (an open validator keeps undeclared keys).
        v = sanitize(v === undefined ? raw : v, nodes.get(path), inputSchema, path, undeclared)
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
          changes: redactChanges(undoChanges.map(safeChange), sensitiveOf(adapter.fields())).sort(
            byPath,
          ),
          skipped: undoSkipped.sort(),
        })
      })
    }

    return ok({
      changes: redactChanges(changes.map(safeChange), sensitiveOf(adapter.fields())).sort(byPath),
      skipped: skipped.sort(),
    })
  }

  // Tour hooks (spec §13, §14; M3 T2). Redaction is owned here: `state()` redacts every path of
  // the sensitive rule, and `sensitivePaths()` publishes the same list through `tm.info`.
  const currentSensitive = (): string[] => sensitiveOf(safeFields(adapter))
  const readIssues = createIssueReader(() => opts.input)
  const readState = (): ToolState<V> => {
    const values = adapter.getValues()
    return { values: redactValues(values, currentSensitive()), issues: readIssues(values) }
  }
  /** `[]` patterns as declared plus their current concrete paths (for exact-path consumers). */
  const publishedSensitive = (): string[] => {
    const list = currentSensitive()
    if (!list.some((p) => p.includes('[]'))) return list
    let values: unknown
    try {
      values = adapter.getValues()
    } catch {
      return list
    }
    return publishSensitive(list, values)
  }
  const formAnchor = (): Element | null => firstFormOwner(safeFields(adapter))
  const fillAnchors: AnchorSpec = {
    element: formAnchor,
    resolve: (path) => fieldElement(safeFields(adapter), path),
  }
  const hooks = { state: readState, sensitivePaths: publishedSensitive }
  // The fill's input is `{ values, overwrite? }`: its sensitive input paths live under `values`
  // (C1; `[]` patterns are expanded against the input by the consumer).
  const fillInputSensitive = {
    [INPUT_SENSITIVE_PATHS]: (): string[] => currentSensitive().map((p) => `values.${p}`),
  }

  const optionKeys = opts.options ? Object.keys(opts.options) : []
  const title = opts.title !== undefined ? { title: opts.title } : {}
  const countFileRefs = (values: unknown): number => {
    if (fileFields.length === 0 || !isPlainObject(values)) return 0
    const budget = nodeBudget()
    const { slots } = collectFileSlots(values, fileFields, budget)
    return budget.left < 0 ? 0 : slotRefCount(slots)
  }
  const fillDef: ToolDefinition<FillInput, unknown> & {
    [FILE_REF_COUNT]: (values: unknown) => number
  } = {
    name: fillName,
    ...title,
    ...(opts.origin !== undefined ? { origin: opts.origin } : {}),
    ...(opts.nativeName?.fill !== undefined ? { nativeName: opts.nativeName.fill } : {}),
    // SEC-6: a fill returns values the user typed or the page loaded (`changes`, issues), so it
    // is always `untrustedContent`, whatever `hints.fill` says.
    hints: { ...opts.hints?.fill, untrustedContent: true },
    description:
      `${opts.description} Fill form fields: pass a partial object in "values" (null clears a ` +
      `field). Fields the user edited are skipped unless "overwrite" is true.` +
      (fileFields.length > 0 ? ' File fields take { "ref": "..." } or { "url": "..." }.' : ''),
    input: fillInputSchema,
    jsonSchema: fillJsonSchema(
      inputSchema,
      optionKeys.length > 0 ? { form: opts.name, keys: optionKeys } : undefined,
      fileKeys.map((path, i) => ({ path, schema: fileFieldSchema(fileFields[i]!.spec) })),
    ),
    anchors: fillAnchors,
    ...hooks,
    ...fillInputSensitive,
    run: (input, ctx) => fill(input, (restore) => ctx.registerUndo(restore), ctx.signal),
    [FILE_REF_COUNT]: countFileRefs,
  }
  const fillReg = tm.register(fillDef, opts.scope ? { scope: opts.scope } : undefined)
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
      hints: submitHints(opts, opts.hints?.submit),
      ...(opts.origin !== undefined ? { origin: opts.origin } : {}),
      ...(opts.nativeName?.submit !== undefined ? { nativeName: opts.nativeName.submit } : {}),
      summary: () =>
        opts.submitSummary?.(adapter.getValues()) ?? `Submit ${opts.title ?? opts.name}`,
      anchors: { element: formAnchor },
      ...hooks,
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
  // M2 T2: `<name>.options` when any field declares async options; all or nothing, like the pair.
  let optionsReg: Registration | undefined
  if (opts.options && optionKeys.length > 0) {
    try {
      const optionsTool = optionsToolDefinition(tm, opts.name, opts.description, opts.options)
      optionsReg = tm.register(
        opts.origin !== undefined ? { ...optionsTool, origin: opts.origin } : optionsTool,
        scopeOpt,
      )
    } catch (e) {
      fillReg.dispose()
      submitReg.dispose()
      throw e
    }
    if (!isLive(optionsReg)) {
      fillReg.dispose()
      submitReg.dispose()
      return { dispose() {} }
    }
  }
  // Interaction events (spec §13): user-originated only, reported by the adapter; the agent's own
  // `setValues`/`submit` never produce them. Paths only, never values (sensitive paths included).
  // A late report from an adapter that ignores its unsubscribe is dropped after dispose.
  let live = true
  const offInteraction = state?.browser
    ? subscribeInteractions(tm, adapter, fillReg.name, (e) => {
        if (live) emitInteraction(tm, e, { fillTool: fillReg.name, submitTool: submitReg.name })
      })
    : () => undefined
  return {
    dispose() {
      live = false
      offInteraction()
      fillReg.dispose()
      submitReg.dispose()
      optionsReg?.dispose()
    },
  }
}
