import { ToolmarkError } from '../errors.js'
import { deepEqual } from '../forms/paths.js'
import type { JsonSchema } from '../tool.js'
import { unsafePatternReason } from './pattern-safety.js'

/** One validation issue: `path` segments are property names and array indexes (numbers). */
export interface SchemaIssue {
  path: (string | number)[]
  message: string
}

/**
 * Validates a value against the compiled schema (`[]` = valid).
 * @internal
 */
export type SchemaValidator = (value: unknown) => SchemaIssue[]

type Node = boolean | Record<string, unknown>

/** Maximum schema-evaluation depth (bounds `$ref` cycles that consume no input). */
const MAX_DEPTH = 256

/**
 * Longest string (in UTF-16 code units) ever run against a `pattern`. A longer value is not
 * matched and gets the issue "Value too long for pattern", bounding polynomial backtracking.
 * @internal
 */
export const MAX_PATTERN_INPUT_LENGTH = 10000

/**
 * Most schema-node evaluations one validation may perform. Past it the value gets the single issue
 * "Input too complex" at the root, so recursive `anyOf` / `oneOf` unions (each branch re-walking
 * the same subtree) cannot blow up exponentially with the nesting of the input.
 * @internal
 */
export const MAX_SCHEMA_EVALUATIONS = 100000

const REF = /^#\/\$defs\/([^/]+)$/

const FORMATS: Record<string, (s: string) => boolean> = {
  date: isDate,
  time: (s) => /^\d{2}:\d{2}(:\d{2})?$/.test(s),
  'date-time': (s) =>
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(s) &&
    !Number.isNaN(Date.parse(s)),
  email: (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s),
  uri: (s) => {
    try {
      new URL(s)
      return true
    } catch {
      return false
    }
  },
}

function isDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const [y, m, d] = s.split('-').map(Number) as [number, number, number]
  if (m < 1 || m > 12 || d < 1) return false
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]!
  return d <= days
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

const own = (o: Record<string, unknown>, k: string): unknown =>
  Object.hasOwn(o, k) ? o[k] : undefined

function fail(message: string): never {
  throw new ToolmarkError('schema_conversion_failed', `Unsupported JSON Schema: ${message}`)
}

function typeOf(v: unknown): string {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  return typeof v
}

function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string'
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value)
    case 'boolean':
      return typeof value === 'boolean'
    case 'null':
      return value === null
    case 'array':
      return Array.isArray(value)
    case 'object':
      return isRecord(value)
    default:
      return true // an unknown type name constrains nothing
  }
}

function isMultiple(value: number, m: number): boolean {
  if (!(m > 0)) return true
  const q = value / m
  return Math.abs(q - Math.round(q)) <= 1e-9 * Math.max(1, Math.abs(q))
}

function describe(v: unknown): string {
  return typeof v === 'string' ? JSON.stringify(v) : String(JSON.stringify(v) ?? v)
}

/**
 * Compiles a schema of the supported JSON-Schema subset (M2 constraints) into a validator. Every
 * supported subschema position is checked at construction: a `$ref` other than a resolvable
 * `#/$defs/<name>`, a `pattern` that is not a valid `u`-flag regular expression, or a `pattern` rejected by the
 * ReDoS heuristic (see {@link unsafePatternReason}: backreferences, nested quantifiers, ambiguous
 * repeated alternation) throws a `ToolmarkError` `schema_conversion_failed`. Other keywords are
 * ignored.
 * @internal
 */
export function compileJsonSchema(schema: JsonSchema | boolean): SchemaValidator {
  if (typeof schema !== 'boolean' && !isRecord(schema)) fail('the schema must be an object')
  const root: Node = schema
  const defs =
    isRecord(root) && isRecord(own(root, '$defs')) ? (root.$defs as Record<string, unknown>) : {}
  const patterns = new Map<string, RegExp>()

  const resolveRef = (ref: unknown): Node => {
    if (typeof ref !== 'string') fail('"$ref" must be a string')
    const m = REF.exec(ref)
    if (!m) fail(`only local "#/$defs/<name>" references are supported (got "${ref}")`)
    let name: string
    try {
      name = decodeURIComponent(m[1]!).replace(/~1/g, '/').replace(/~0/g, '~')
    } catch {
      fail(`malformed reference "${ref}"`)
    }
    const target = own(defs, name)
    if (typeof target !== 'boolean' && !isRecord(target)) fail(`unresolved reference "${ref}"`)
    return target
  }

  // Construction-time checks over every supported subschema position.
  const seen = new Set<unknown>()
  const check = (node: unknown, depth: number): void => {
    if (typeof node === 'boolean') return
    if (!isRecord(node)) fail('a subschema must be an object or a boolean')
    if (seen.has(node) || depth > MAX_DEPTH) return
    seen.add(node)
    if (Object.hasOwn(node, '$ref')) resolveRef(node.$ref)
    if (Object.hasOwn(node, 'pattern')) {
      const p = node.pattern
      if (typeof p !== 'string') fail('"pattern" must be a string')
      let re: RegExp
      try {
        re = new RegExp(p, 'u')
      } catch {
        fail(`invalid "pattern" ${JSON.stringify(p)}`)
      }
      const unsafe = unsafePatternReason(p)
      if (unsafe !== undefined) fail(`unsafe "pattern" ${JSON.stringify(p)}: ${unsafe}`)
      patterns.set(p, re)
    }
    for (const key of ['properties', '$defs'] as const) {
      const map = own(node, key)
      if (isRecord(map)) for (const k of Object.keys(map)) check(map[k], depth + 1)
    }
    for (const key of ['items', 'additionalProperties'] as const) {
      const sub = own(node, key)
      if (sub !== undefined) check(sub, depth + 1)
    }
    for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
      const list = own(node, key)
      if (Array.isArray(list)) for (const b of list) check(b, depth + 1)
    }
  }
  check(root, 0)

  // Per-validation evaluation budget (reset by every call of the returned validator).
  let evaluations = 0
  const validate = (
    node: Node,
    value: unknown,
    path: (string | number)[],
    depth: number,
  ): SchemaIssue[] => {
    // Over budget: unwind with no issues; the caller reports "Input too complex" instead.
    if (++evaluations > MAX_SCHEMA_EVALUATIONS) return []
    if (node === true) return []
    if (node === false) return [{ path, message: 'Not allowed' }]
    if (depth > MAX_DEPTH) return [{ path, message: 'Schema nesting too deep' }]
    const issues: SchemaIssue[] = []
    const at = (message: string): void => {
      issues.push({ path, message })
    }

    if (Object.hasOwn(node, '$ref')) {
      issues.push(...validate(resolveRef(node.$ref), value, path, depth + 1))
    }

    const type = own(node, 'type')
    const types =
      typeof type === 'string'
        ? [type]
        : Array.isArray(type)
          ? type.filter((t) => typeof t === 'string')
          : undefined
    if (types && types.length > 0 && !types.some((t) => matchesType(value, t))) {
      // A type mismatch makes every other check on this node noise.
      return [
        ...issues,
        { path, message: `Expected ${types.join(' or ')}, received ${typeOf(value)}` },
      ]
    }
    if (Object.hasOwn(node, 'const') && !deepEqual(value, node.const)) {
      at(`Must equal ${describe(node.const)}`)
    }
    const en = own(node, 'enum')
    if (Array.isArray(en) && !en.some((e) => deepEqual(value, e))) {
      at(`Must be one of: ${en.map(describe).join(', ')}`)
    }

    if (typeof value === 'string') {
      const len = [...value].length
      const min = own(node, 'minLength')
      const max = own(node, 'maxLength')
      if (typeof min === 'number' && len < min) at(`Must be at least ${min} characters`)
      if (typeof max === 'number' && len > max) at(`Must be at most ${max} characters`)
      const pattern = own(node, 'pattern')
      if (typeof pattern === 'string') {
        if (value.length > MAX_PATTERN_INPUT_LENGTH) at('Value too long for pattern')
        else if (!patterns.get(pattern)!.test(value)) at(`Must match the pattern ${pattern}`)
      }
      const format = own(node, 'format')
      const test =
        typeof format === 'string' && Object.hasOwn(FORMATS, format) ? FORMATS[format] : undefined
      if (test && !test(value)) at(`Must be a valid ${String(format)}`)
    }

    if (typeof value === 'number') {
      const min = own(node, 'minimum')
      const max = own(node, 'maximum')
      const mul = own(node, 'multipleOf')
      if (typeof min === 'number' && value < min) at(`Must be at least ${min}`)
      if (typeof max === 'number' && value > max) at(`Must be at most ${max}`)
      if (typeof mul === 'number' && !isMultiple(value, mul)) at(`Must be a multiple of ${mul}`)
    }

    if (Array.isArray(value)) {
      const min = own(node, 'minItems')
      const max = own(node, 'maxItems')
      if (typeof min === 'number' && value.length < min) at(`Must have at least ${min} items`)
      if (typeof max === 'number' && value.length > max) at(`Must have at most ${max} items`)
      if (own(node, 'uniqueItems') === true) {
        const dup = value.findIndex((v, i) => value.slice(0, i).some((w) => deepEqual(v, w)))
        if (dup !== -1) at('Items must be unique')
      }
      const items = own(node, 'items')
      if (typeof items === 'boolean' || isRecord(items)) {
        value.forEach((item, i) => {
          issues.push(...validate(items, item, [...path, i], depth + 1))
        })
      }
    }

    if (isRecord(value)) {
      const required = own(node, 'required')
      if (Array.isArray(required)) {
        for (const key of required) {
          if (typeof key === 'string' && !Object.hasOwn(value, key)) {
            issues.push({ path: [...path, key], message: 'Required' })
          }
        }
      }
      const props = own(node, 'properties')
      const declared = isRecord(props) ? props : {}
      const extra = own(node, 'additionalProperties')
      for (const key of Object.keys(value)) {
        const sub = own(declared, key)
        if (typeof sub === 'boolean' || isRecord(sub)) {
          issues.push(...validate(sub, value[key], [...path, key], depth + 1))
        } else if (extra === false) {
          issues.push({ path: [...path, key], message: 'Unknown field' })
        } else if (isRecord(extra)) {
          issues.push(...validate(extra, value[key], [...path, key], depth + 1))
        }
      }
    }

    const allOf = own(node, 'allOf')
    if (Array.isArray(allOf)) {
      for (const b of allOf as Node[]) issues.push(...validate(b, value, path, depth + 1))
    }
    for (const key of ['anyOf', 'oneOf'] as const) {
      const list = own(node, key)
      if (!Array.isArray(list) || list.length === 0) continue
      const results = (list as Node[]).map((b) => validate(b, value, path, depth + 1))
      const passing = results.filter((r) => r.length === 0).length
      if (key === 'oneOf' && passing > 1) at('Matches more than one allowed schema')
      if (passing > 0) continue
      issues.push(...closest(results, path))
    }
    return issues
  }

  return (value) => {
    evaluations = 0
    const issues = validate(root, value, [], 0)
    return evaluations > MAX_SCHEMA_EVALUATIONS
      ? [{ path: [], message: 'Input too complex' }]
      : issues
  }
}

/**
 * The issues of a failed union: those of the branch that matched the value's kind (all issues
 * nested below `path`) with the fewest issues, else one issue at `path`.
 */
function closest(results: SchemaIssue[][], path: (string | number)[]): SchemaIssue[] {
  let best: SchemaIssue[] | undefined
  for (const r of results) {
    if (!r.every((i) => i.path.length > path.length)) continue
    if (best === undefined || r.length < best.length) best = r
  }
  return best ?? [{ path, message: 'Does not match any allowed schema' }]
}
