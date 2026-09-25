import { ToolmarkError } from '../errors.js'

const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor'])
const MAX_DEPTH = 64

/**
 * @internal Maximum number of nodes (containers and leaves, counted per visit, so shared
 * references count every time they are reached) a walk over one `fill` input may visit.
 */
export const MAX_INPUT_NODES = 10000

/**
 * @internal A node budget shared by the walks over one input. Each visited node spends one unit;
 * once `left` is negative the walks stop descending and the caller must refuse the input
 * ("Input too complex"). Bounds shared-reference (DAG) inputs, which are otherwise exponential.
 */
export interface NodeBudget {
  left: number
}

/** @internal A fresh {@link NodeBudget} of `max` nodes. */
export function nodeBudget(max = MAX_INPUT_NODES): NodeBudget {
  return { left: max }
}

/** Spends one node; `false` once the budget is exhausted. */
function spend(budget: NodeBudget): boolean {
  budget.left--
  return budget.left >= 0
}

const hasOwn = (obj: object, key: PropertyKey): boolean =>
  Object.prototype.hasOwnProperty.call(obj, key)

/** @internal Plain object (prototype `Object.prototype` or `null`). */
export function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  const proto = Object.getPrototypeOf(v) as unknown
  return proto === Object.prototype || proto === null
}

/** @internal Whether every segment of a dot path is non-empty and not a prototype key. */
export function isSafePath(path: string): boolean {
  if (path === '') return false
  return path.split('.').every((seg) => seg !== '' && !FORBIDDEN.has(seg))
}

/**
 * Own enumerable keys; array indices skip holes (`i in arr`) so sparse arrays never yield
 * `undefined`. An array longer than the remaining budget exhausts it (a huge sparse array would
 * otherwise cost its full length) and yields no keys.
 */
function ownKeys(node: Record<string, unknown> | unknown[], budget: NodeBudget): string[] {
  if (!Array.isArray(node)) return Object.keys(node)
  if (node.length > budget.left) {
    budget.left = -1
    return []
  }
  const keys: string[] = []
  for (let i = 0; i < node.length; i++) if (i in node) keys.push(String(i))
  return keys
}

function segments(path: string): string[] {
  if (!isSafePath(path)) {
    throw new ToolmarkError('invalid_path', `Invalid field path "${path}"`)
  }
  return path.split('.')
}

/**
 * Finds the first unsafe key inside a leaf value (arrays and plain objects, depth-bounded).
 * Returns its full path, or `null` when the value is safe. An exhausted budget reports `path`.
 */
function unsafeInside(
  value: unknown,
  path: string,
  depth: number,
  seen: WeakSet<object>,
  budget: NodeBudget,
): string | null {
  if (typeof value !== 'object' || value === null) return null
  const isArray = Array.isArray(value)
  if (!isArray && !isPlainObject(value)) return null
  if (depth > MAX_DEPTH || seen.has(value) || !spend(budget)) return path
  seen.add(value)
  const keys = ownKeys(value, budget)
  if (budget.left < 0) return path
  for (const key of keys) {
    const child = `${path}.${key}`
    if (!isSafePath(key)) return child
    const found = unsafeInside(
      (value as Record<string, unknown>)[key],
      child,
      depth + 1,
      seen,
      budget,
    )
    if (found !== null) return found
  }
  seen.delete(value)
  return null
}

/** Options for {@link flatten}. */
export interface FlattenOptions {
  /**
   * `true` (default): arrays are leaves (`{ tags: [{ n: 1 }] }` → `{ tags: [...] }`). `false`:
   * arrays are expanded into index paths (`{ 'tags.0.n': 1 }`); an empty array produces no path.
   */
  arraysAsLeaves?: boolean
}

/**
 * @internal Like {@link flatten}, also returning the paths it refused: prototype keys and empty
 * segments anywhere (including inside array / object leaves, reported with their full path, e.g.
 * `tags.0.__proto__`), cycles, values nested deeper than 64 levels and subtrees past the node
 * `budget` (default: a fresh {@link MAX_INPUT_NODES} budget; check `budget.left < 0`). A refused
 * subtree is not emitted. `duplicates` lists paths reached twice (e.g. `{ 'a.b': 1, a: { b: 2 } }`);
 * the later value wins in `values`.
 */
export function flattenWithRejected(
  obj: unknown,
  opts?: FlattenOptions,
  budget: NodeBudget = nodeBudget(),
): {
  values: Record<string, unknown>
  rejected: string[]
  duplicates: string[]
} {
  const expandArrays = opts?.arraysAsLeaves === false
  const values: Record<string, unknown> = {}
  const rejected: string[] = []
  const duplicates: string[] = []
  const ancestors = new WeakSet<object>()
  const isContainer = (v: unknown): v is Record<string, unknown> | unknown[] =>
    isPlainObject(v) || (expandArrays && Array.isArray(v))
  const walk = (node: Record<string, unknown> | unknown[], prefix: string, depth: number): void => {
    ancestors.add(node)
    const keys = ownKeys(node, budget)
    if (budget.left < 0) rejected.push(prefix)
    for (const key of keys) {
      const path = prefix === '' ? key : `${prefix}.${key}`
      if (!spend(budget)) {
        rejected.push(path)
        break
      }
      if (!isSafePath(key) || !isSafePath(path)) {
        rejected.push(path)
        continue
      }
      const value = (node as Record<string, unknown>)[key]
      if (isContainer(value)) {
        if (depth >= MAX_DEPTH || ancestors.has(value)) rejected.push(path)
        else walk(value, path, depth + 1)
        continue
      }
      const unsafe = unsafeInside(value, path, depth + 1, new WeakSet(), budget)
      if (unsafe !== null) {
        rejected.push(unsafe)
        continue
      }
      if (hasOwn(values, path)) duplicates.push(path)
      Object.defineProperty(values, path, {
        value,
        enumerable: true,
        writable: true,
        configurable: true,
      })
    }
    ancestors.delete(node)
  }
  if (isPlainObject(obj)) walk(obj, '', 0)
  return { values, rejected, duplicates }
}

/**
 * @internal Copies plain objects and arrays deeply (own keys) and keeps every other value by
 * reference (so `File`/`Blob` identity survives), for change detection snapshots.
 */
export function snapshotValue<T>(value: T, depth = 0): T {
  if (depth > MAX_DEPTH) return value
  if (Array.isArray(value)) return value.map((v) => snapshotValue(v, depth + 1) as unknown) as T
  if (!isPlainObject(value)) return value
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value)) {
    Object.defineProperty(out, key, {
      value: snapshotValue(value[key], depth + 1),
      enumerable: true,
      writable: true,
      configurable: true,
    })
  }
  return out as T
}

/**
 * Flattens a plain object into leaf dot paths (`{ a: { b: 1 } }` → `{ 'a.b': 1 }`). Arrays are
 * leaves unless `arraysAsLeaves: false`; non-plain objects (e.g. `Date`, `File`) are always
 * leaves; empty objects produce no path. Keys that are `__proto__`, `prototype` or `constructor`
 * (at any depth, including inside array leaves), cycles and values nested deeper than 64 levels
 * are never emitted. At most 10000 nodes are visited (shared references count each time they are
 * reached); the rest of a larger value is not emitted. Only own properties are read.
 * @param obj - The value to flatten (non-objects yield `{}`).
 * @param opts - See {@link FlattenOptions}; arrays are leaves by default.
 * @returns A record keyed by dot path.
 */
export function flatten(obj: unknown, opts?: FlattenOptions): Record<string, unknown> {
  return flattenWithRejected(obj, opts).values
}

/**
 * A `fill` operation on an array field (spec §8.3), given instead of a replacement array:
 * `{ $append: items }` adds items at the end (allowed even when the user edited the array);
 * `{ $remove: indexes }` removes items by their index in the current array (unique, in range,
 * applied in descending order).
 */
export type ArrayOp = { $append: unknown[] } | { $remove: number[] }

/**
 * Reads a dot path using own properties only.
 * @param obj - Source value.
 * @param path - Dot path such as `address.city` or `items.0`.
 * @returns The value, or `undefined` when absent.
 * @throws ToolmarkError `invalid_path` for an empty segment or a prototype key.
 */
export function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj
  for (const seg of segments(path)) {
    if (typeof cur !== 'object' || cur === null || !hasOwn(cur, seg)) return undefined
    cur = (cur as Record<string, unknown>)[seg]
  }
  return cur
}

/**
 * Returns a copy of `obj` with `path` set to `value` (copying each container along the path;
 * missing or non-object intermediates become plain objects).
 * @param obj - Source value (not mutated).
 * @param path - Dot path.
 * @param value - Value to set.
 * @returns The updated copy.
 * @throws ToolmarkError `invalid_path` for an empty segment or a prototype key.
 */
export function setPath<T>(obj: T, path: string, value: unknown): T {
  const segs = segments(path)
  const set = (node: unknown, i: number): unknown => {
    const seg = segs[i]!
    let copy: Record<string, unknown> | unknown[]
    if (Array.isArray(node)) copy = node.slice()
    else if (typeof node === 'object' && node !== null) copy = { ...node }
    else copy = {}
    const container = copy as Record<string, unknown>
    const child = hasOwn(container, seg) ? container[seg] : undefined
    Object.defineProperty(container, seg, {
      value: i === segs.length - 1 ? value : set(child, i + 1),
      enumerable: true,
      writable: true,
      configurable: true,
    })
    return copy
  }
  return set(obj, 0) as T
}

/** @internal Structural equality for JSON-like values (plain objects, arrays, Dates, primitives). */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime()
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]))
  }
  if (!isPlainObject(a) || !isPlainObject(b)) return false
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  return ka.length === kb.length && ka.every((k) => hasOwn(b, k) && deepEqual(a[k], b[k]))
}

/**
 * @internal Splits `fill` values into plain values and array operations. A plain object at `path`
 * is taken as an array-op candidate when `isArrayField(path)` says the schema declares only an
 * array there, or when one of its keys starts with `$` and `declaresArray(path)` says the path
 * takes array ops (form tools: an array is declared there, or no object is — so `$`-keyed data in
 * records / open objects stays plain data). Without
 * `declaresArray`, any `$`-keyed object is a candidate. Candidates are returned raw (validated by
 * {@link applyArrayOp}). Every other value is copied as-is (unsafe keys, cycles, over-deep values
 * and subtrees past the node `budget` are kept raw, so the caller's flatten still refuses them).
 * `duplicates` lists op paths reached twice (e.g. `{ 'a.b': op, a: { b: op } }`).
 */
export function extractArrayOps(
  values: Record<string, unknown>,
  isArrayField: (path: string) => boolean,
  declaresArray?: (path: string) => boolean,
  budget: NodeBudget = nodeBudget(),
): {
  rest: Record<string, unknown>
  ops: Map<string, Record<string, unknown>>
  duplicates: string[]
} {
  const ops = new Map<string, Record<string, unknown>>()
  const duplicates: string[] = []
  const ancestors = new WeakSet<object>()
  const isOp = (value: Record<string, unknown>, path: string): boolean =>
    isArrayField(path) ||
    (Object.keys(value).some((k) => k.startsWith('$')) && (declaresArray?.(path) ?? true))
  const walk = (node: Record<string, unknown>, prefix: string, depth: number) => {
    ancestors.add(node)
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(node)) {
      const path = prefix === '' ? key : `${prefix}.${key}`
      let value = node[key]
      if (
        isPlainObject(value) &&
        isSafePath(path) &&
        depth < MAX_DEPTH &&
        !ancestors.has(value) &&
        spend(budget)
      ) {
        if (isOp(value, path)) {
          if (ops.has(path)) duplicates.push(path)
          ops.set(path, value)
          continue
        }
        value = walk(value, path, depth + 1)
      }
      Object.defineProperty(out, key, {
        value,
        enumerable: true,
        writable: true,
        configurable: true,
      })
    }
    ancestors.delete(node)
    return out
  }
  return { rest: walk(values, '', 0), ops, duplicates }
}

/**
 * @internal Applies an array-op candidate to the current array value (`undefined`/`null` count as
 * `[]`). Returns the new array, or the reason the op is invalid: not exactly one of
 * `$append`/`$remove`, a non-array operand, unsafe keys inside appended items, or a duplicate,
 * negative, non-integer or out-of-range `$remove` index.
 */
export function applyArrayOp(
  op: Record<string, unknown>,
  current: unknown,
  path: string,
  budget: NodeBudget = nodeBudget(),
): { kind: 'append' | 'remove'; next: unknown[] } | { error: string } {
  const keys = Object.keys(op)
  if (keys.length !== 1 || (keys[0] !== '$append' && keys[0] !== '$remove')) {
    return { error: 'Expected an array, { $append: [...] } or { $remove: [indexes] }' }
  }
  const base = current === undefined || current === null ? [] : current
  if (!Array.isArray(base)) return { error: 'The current value is not an array' }
  const operand = op[keys[0]]
  if (keys[0] === '$append') {
    if (!Array.isArray(operand)) return { error: '$append expects an array of items' }
    if (unsafeInside(operand, path, 1, new WeakSet(), budget) !== null) {
      return { error: 'Invalid field path inside appended items' }
    }
    return { kind: 'append', next: [...(base as unknown[]), ...(operand as unknown[])] }
  }
  if (!Array.isArray(operand)) return { error: '$remove expects an array of indexes' }
  if (operand.length > base.length) {
    return { error: '$remove lists more indexes than the current array has' }
  }
  const seen = new Set<number>()
  for (const i of operand as unknown[]) {
    if (typeof i !== 'number' || !Number.isInteger(i) || i < 0 || i >= base.length) {
      return { error: `$remove index ${JSON.stringify(i)} is not an index of the current array` }
    }
    if (seen.has(i)) return { error: `$remove index ${i} is repeated` }
    seen.add(i)
  }
  const next = (base as unknown[]).slice()
  for (const i of [...seen].sort((a, b) => b - a)) next.splice(i, 1)
  return { kind: 'remove', next }
}
