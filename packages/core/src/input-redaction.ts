import {
  isSensitivePattern,
  isUnderSensitive,
  redactValues,
  REDACTED,
  sensitiveBelow,
} from './forms/hooks.js'
import { isPlainObject } from './forms/paths.js'
import type { FieldChange } from './result.js'

/** Deepest input nesting the redaction walk follows; anything deeper is redacted whole. */
const MAX_REDACT_DEPTH = 64
/** Most input nodes the redaction walk visits; past that the whole input is redacted. */
const MAX_REDACT_NODES = 10_000

/**
 * @internal Hook a tool can carry (under this symbol) that maps its sensitive paths
 * (`ToolDefinition.sensitivePaths()`, which are paths of the tool's *values*) onto the shape of
 * its call *input*, for consumers that redact inputs (the OTel exporter). Form fills map `p` →
 * `values.<p>`, wizard fills map `<step>.<p>` → `steps.<step>.<p>`. Returned paths may contain
 * `[]` (any array index); the consumer expands them against the input. A tool without the hook
 * falls back to its `sensitivePaths()` as-is (its input and values share one shape).
 */
export const INPUT_SENSITIVE_PATHS: unique symbol = Symbol('toolmark.inputSensitivePaths')

/** @internal Shape of the {@link INPUT_SENSITIVE_PATHS} hook. */
export type InputSensitivePathsHook = () => string[]

/** @internal Reads the hook from a tool definition, if any. */
export function inputSensitiveHookOf(tool: object): InputSensitivePathsHook | undefined {
  const hook = (tool as { [INPUT_SENSITIVE_PATHS]?: unknown })[INPUT_SENSITIVE_PATHS]
  return typeof hook === 'function' ? (hook as InputSensitivePathsHook) : undefined
}

/**
 * @internal A copy of `input` in which every node at or under one of the sensitive input `paths` (`[]` =
 * any array index) is replaced by `'[redacted]'`. A node's path is its *effective* path, as form
 * fills read it: a dotted key (`{ "card.number": … }`) contributes each of its segments and an
 * array-op key `$append` contributes none (its items stand at array indices). The walk is bounded
 * ({@link MAX_REDACT_DEPTH}, {@link MAX_REDACT_NODES}) and fails closed: a too-deep node, or the
 * whole input once the node budget runs out, is redacted.
 */
export function redactInput(input: unknown, paths: readonly string[]): unknown {
  if (paths.length === 0) return input
  let nodes = 0
  let overflow = false
  const sensitive = (segs: readonly string[]): boolean => {
    if (segs.length === 0) return false
    const path = segs.join('.')
    return paths.some((p) => isUnderSensitive(path, p))
  }
  const walk = (node: unknown, segs: string[], depth: number): unknown => {
    if (overflow) return REDACTED
    if (++nodes > MAX_REDACT_NODES) {
      overflow = true
      return REDACTED
    }
    if (sensitive(segs)) return REDACTED
    if (typeof node !== 'object' || node === null) return node
    if (depth >= MAX_REDACT_DEPTH) return REDACTED
    if (Array.isArray(node)) {
      return node.map((item, i) => walk(item, [...segs, String(i)], depth + 1))
    }
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(node)) {
      const at = key === '$append' ? segs : [...segs, ...key.split('.')]
      Object.defineProperty(out, key, {
        value: walk(value, at, depth + 1),
        enumerable: true,
        configurable: true,
        writable: true,
      })
    }
    return out
  }
  const out = walk(input, [], 0)
  return overflow ? REDACTED : out
}

/**
 * @internal SEC-5/SEC-24: `changes` with their sensitive values redacted, for confirmation payloads,
 * telemetry and form results. `paths` are value-shaped sensitive paths (`[]` = any array index).
 * A change at or under a sensitive path (`cards.0.cvc` under `cards[].cvc`) has `before`/`after`
 * replaced by `'[redacted]'`; a change over one (`cards`, `cards.0`, or the root `''`) keeps its
 * values with every sensitive descendant inside them redacted. A malformed pattern falls back to
 * plain string matching and redacts the whole change. `paths === null` (the tool's sensitive paths
 * could not be read) redacts every change: fail closed.
 */
export function redactChanges(
  changes: readonly FieldChange[],
  paths: readonly string[] | null,
): FieldChange[] {
  const whole = (c: FieldChange): FieldChange => ({
    path: c.path,
    before: REDACTED,
    after: REDACTED,
  })
  if (paths === null) return changes.map(whole)
  return changes.map((c) => {
    const hit = paths.some((p) =>
      isSensitivePattern(p)
        ? isUnderSensitive(c.path, p)
        : c.path === p || c.path.startsWith(`${p}.`) || p.startsWith(`${c.path}.`),
    )
    if (hit) return whole(c)
    const below = paths.flatMap((p) => {
      if (!isSensitivePattern(p)) return []
      if (c.path === '') return [p]
      const rest = sensitiveBelow(c.path, p)
      return rest === undefined ? [] : [rest]
    })
    if (below.length === 0) return c
    // Rooted under a `v` key so a walk that runs out of budget redacts the whole value (the
    // expansion then fails closed to the path before the first `[]`, here `v`).
    const inside = (v: unknown): unknown =>
      typeof v === 'object' && v !== null
        ? redactValues(
            { v },
            below.map((b) => `v.${b}`),
          ).v
        : v
    return { path: c.path, before: inside(c.before), after: inside(c.after) }
  })
}

/** @internal Outcome of {@link restoreRedacted}: the restored input, or the path to re-enter. */
export type RestoreOutcome = { ok: true; value: unknown } | { ok: false; path: string }

/**
 * @internal SEC-11: the approver-edited `edited` input with every `'[redacted]'` placeholder that
 * stands at a sensitive input path (one {@link redactInput} would redact) put back to the node at
 * the same position in `raw`, the stored real input. A sensitive path the approver changed keeps
 * its new value. A root
 * `'[redacted]'` (the whole input was hidden) restores `raw` whole. Positions are matched key by
 * key, as {@link redactInput} walks them (dotted keys and `$append` included).
 *
 * SEC-26: an array item is only matched to the raw item at the same index when the item's identity
 * is unambiguous: the edited array has the raw array's length and the item's non-sensitive content
 * is unchanged. Otherwise (a row deleted, inserted, reordered or edited) its placeholders have no
 * source. SEC-27: a placeholder at a sensitive path with no source (that, or a key the approver
 * restructured) is refused: `{ ok: false, path }`, the caller answers `invalid` "Re-enter
 * sensitive field" there. SEC-28: so is any placeholder left in the result that `raw` does not
 * hold at the same position (outside the sensitive paths, or with `paths` empty because they could
 * not be read), so the tool never runs with a literal `'[redacted]'` it was not sent. The walk is
 * bounded like {@link redactInput} and fails closed (path `''`) past its node budget.
 */
export function restoreRedacted(
  edited: unknown,
  raw: unknown,
  paths: readonly string[],
): RestoreOutcome {
  if (edited === REDACTED) return { ok: true, value: raw }
  let nodes = 0
  let failed: string | undefined
  const sensitive = (segs: readonly string[]): boolean => {
    if (segs.length === 0) return false
    const path = segs.join('.')
    return paths.some((p) => isUnderSensitive(path, p))
  }
  const own = (node: unknown, key: string): { value: unknown } | undefined => {
    if (typeof node !== 'object' || node === null) return undefined
    return Object.prototype.hasOwnProperty.call(node, key)
      ? { value: (node as Record<string, unknown>)[key] }
      : undefined
  }
  const keySegs = (segs: string[], key: string): string[] =>
    key === '$append' ? segs : [...segs, ...key.split('.')]
  /** Whether `a` and `b` agree everywhere outside the sensitive paths (bounded; else `false`). */
  const sameVisible = (a: unknown, b: unknown, segs: string[], depth: number): boolean => {
    if (++nodes > MAX_REDACT_NODES) {
      failed ??= ''
      return false
    }
    if (sensitive(segs)) return true
    if (depth >= MAX_REDACT_DEPTH) return false
    if (Array.isArray(a) || Array.isArray(b)) {
      if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
      for (let i = 0; i < a.length; i++) {
        if (i in a !== i in b) return false
        if (!sameVisible(a[i], b[i], [...segs, String(i)], depth + 1)) return false
      }
      return true
    }
    if (isPlainObject(a) && isPlainObject(b)) {
      const ka = Object.keys(a)
      if (ka.length !== Object.keys(b).length) return false
      return ka.every(
        (k) =>
          Object.prototype.hasOwnProperty.call(b, k) &&
          sameVisible(a[k], b[k], keySegs(segs, k), depth + 1),
      )
    }
    return Object.is(a, b)
  }
  const walk = (
    node: unknown,
    source: { value: unknown } | undefined,
    segs: string[],
    depth: number,
  ): unknown => {
    if (failed !== undefined) return node
    if (++nodes > MAX_REDACT_NODES) {
      failed = ''
      return node
    }
    if (node === REDACTED) {
      const atSensitive = sensitive(segs)
      if (source !== undefined && (atSensitive || depth >= MAX_REDACT_DEPTH)) return source.value
      if (atSensitive) failed = segs.join('.')
      return node
    }
    if (depth >= MAX_REDACT_DEPTH) return node
    if (Array.isArray(node)) {
      const rawItems =
        source !== undefined && Array.isArray(source.value) && source.value.length === node.length
          ? (source.value as unknown[])
          : undefined
      let changed = false
      const out = node.map((item, i) => {
        const at = [...segs, String(i)]
        const itemSource =
          rawItems !== undefined && i in rawItems && sameVisible(item, rawItems[i], at, depth + 1)
            ? { value: rawItems[i] }
            : undefined
        const next = walk(item, itemSource, at, depth + 1)
        if (next !== item) changed = true
        return next
      })
      return changed ? out : node
    }
    // Only plain objects are rebuilt; anything else (a `File`, a class instance) is kept as is.
    if (!isPlainObject(node)) return node
    // SEC-30: an object never takes its sources from a raw array (an index-keyed rewrite of the
    // rows would bind secrets by key with no row-identity check).
    const from = Array.isArray(source?.value) ? undefined : source?.value
    let changed = false
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(node)) {
      const next = walk(value, own(from, key), keySegs(segs, key), depth + 1)
      if (next !== value) changed = true
      Object.defineProperty(out, key, {
        value: next,
        enumerable: true,
        configurable: true,
        writable: true,
      })
    }
    return changed ? out : node
  }
  const value = walk(edited, { value: raw }, [], 0)
  if (failed !== undefined) return { ok: false, path: failed }
  const left = strayPlaceholder(value, raw)
  return left === undefined ? { ok: true, value } : { ok: false, path: left }
}

/**
 * SEC-28: the path of a `'[redacted]'` placeholder in `value` (a restored edit) that `raw` does not
 * hold at the same position, i.e. one that would reach the tool as literal text; `undefined` when
 * there is none. Past the node budget or the depth bound it fails closed (the current path).
 */
function strayPlaceholder(value: unknown, raw: unknown): string | undefined {
  let nodes = 0
  const at = (node: unknown, key: string): unknown =>
    typeof node === 'object' && node !== null && Object.prototype.hasOwnProperty.call(node, key)
      ? (node as Record<string, unknown>)[key]
      : undefined
  const scan = (
    node: unknown,
    source: unknown,
    segs: string[],
    depth: number,
  ): string | undefined => {
    if (++nodes > MAX_REDACT_NODES) return ''
    if (node === REDACTED) return source === REDACTED ? undefined : segs.join('.')
    if (typeof node !== 'object' || node === null) return undefined
    if (node === source) return undefined
    if (depth >= MAX_REDACT_DEPTH) return segs.join('.')
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        const hit = scan(node[i], at(source, String(i)), [...segs, String(i)], depth + 1)
        if (hit !== undefined) return hit
      }
      return undefined
    }
    if (!isPlainObject(node)) return undefined
    for (const [key, v] of Object.entries(node)) {
      const next = key === '$append' ? segs : [...segs, ...key.split('.')]
      const hit = scan(v, at(source, key), next, depth + 1)
      if (hit !== undefined) return hit
    }
    return undefined
  }
  return scan(value, raw, [], 0)
}
