import { ToolmarkError } from '../errors.js'

const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor'])
const MAX_DEPTH = 64

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

function segments(path: string): string[] {
  if (!isSafePath(path)) {
    throw new ToolmarkError('invalid_path', `Invalid field path "${path}"`)
  }
  return path.split('.')
}

/**
 * Finds the first unsafe key inside a leaf value (arrays and plain objects, depth-bounded).
 * Returns its full path, or `null` when the value is safe.
 */
function unsafeInside(
  value: unknown,
  path: string,
  depth: number,
  seen: WeakSet<object>,
): string | null {
  if (typeof value !== 'object' || value === null) return null
  const isArray = Array.isArray(value)
  if (!isArray && !isPlainObject(value)) return null
  if (depth > MAX_DEPTH || seen.has(value)) return path
  seen.add(value)
  const keys = isArray ? value.map((_, i) => String(i)) : Object.keys(value)
  for (const key of keys) {
    const child = `${path}.${key}`
    if (!isSafePath(key)) return child
    const found = unsafeInside((value as Record<string, unknown>)[key], child, depth + 1, seen)
    if (found !== null) return found
  }
  seen.delete(value)
  return null
}

/**
 * @internal Like {@link flatten}, also returning the paths it refused: prototype keys and empty
 * segments anywhere (including inside array / object leaves, reported with their full path, e.g.
 * `tags.0.__proto__`), cycles and values nested deeper than 64 levels. A refused subtree is not
 * emitted.
 */
export function flattenWithRejected(obj: unknown): {
  values: Record<string, unknown>
  rejected: string[]
} {
  const values: Record<string, unknown> = {}
  const rejected: string[] = []
  const ancestors = new WeakSet<object>()
  const walk = (node: Record<string, unknown>, prefix: string, depth: number): void => {
    ancestors.add(node)
    for (const key of Object.keys(node)) {
      const path = prefix === '' ? key : `${prefix}.${key}`
      if (!isSafePath(key) || !isSafePath(path)) {
        rejected.push(path)
        continue
      }
      const value = node[key]
      if (isPlainObject(value)) {
        if (depth >= MAX_DEPTH || ancestors.has(value)) rejected.push(path)
        else walk(value, path, depth + 1)
        continue
      }
      const unsafe = unsafeInside(value, path, depth + 1, new WeakSet())
      if (unsafe !== null) {
        rejected.push(unsafe)
        continue
      }
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
  return { values, rejected }
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
 * Flattens a plain object into leaf dot paths (`{ a: { b: 1 } }` → `{ 'a.b': 1 }`). Arrays and
 * non-plain objects (e.g. `Date`, `File`) are leaves; empty objects produce no path. Keys that are
 * `__proto__`, `prototype` or `constructor` (at any depth, including inside array leaves), cycles
 * and values nested deeper than 64 levels are never emitted. Only own properties are read.
 * @param obj - The value to flatten (non-objects yield `{}`).
 * @returns A record keyed by dot path.
 */
export function flatten(obj: unknown): Record<string, unknown> {
  return flattenWithRejected(obj).values
}

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
