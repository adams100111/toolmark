import { isUnderSensitive, REDACTED } from './forms/hooks.js'
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

/** @internal Redacts `before`/`after` of every change at, under, or over one of `paths`. */
export function redactChanges(changes: FieldChange[], paths: readonly string[]): FieldChange[] {
  return changes.map((c) =>
    paths.some((p) => c.path === p || c.path.startsWith(`${p}.`) || p.startsWith(`${c.path}.`))
      ? { path: c.path, before: REDACTED, after: REDACTED }
      : c,
  )
}

/**
 * @internal SEC-11: the approver-edited `edited` input with every `'[redacted]'` placeholder that
 * stands at a sensitive input path (one {@link redactInput} would redact) put back to the node at
 * the same position in `raw`, the stored real input. A sensitive path the approver changed keeps
 * its new value, and a placeholder outside the sensitive paths is kept as ordinary text. A root
 * `'[redacted]'` (the whole input was hidden) restores `raw` whole. Positions are matched key by
 * key, as {@link redactInput} walks them (dotted keys and `$append` included), so the result is
 * the edit applied to the real input. The walk is bounded like {@link redactInput}; past the
 * bounds the edit is returned unchanged (it is re-validated by the caller either way).
 */
export function restoreRedacted(edited: unknown, raw: unknown, paths: readonly string[]): unknown {
  if (edited === REDACTED) return raw
  if (paths.length === 0) return edited
  let nodes = 0
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
  const walk = (
    node: unknown,
    source: { value: unknown } | undefined,
    segs: string[],
    depth: number,
  ): unknown => {
    if (++nodes > MAX_REDACT_NODES) return node
    if (
      node === REDACTED &&
      source !== undefined &&
      (sensitive(segs) || depth >= MAX_REDACT_DEPTH)
    ) {
      return source.value
    }
    if (depth >= MAX_REDACT_DEPTH) return node
    if (Array.isArray(node)) {
      let changed = false
      const out = node.map((item, i) => {
        const next = walk(item, own(source?.value, String(i)), [...segs, String(i)], depth + 1)
        if (next !== item) changed = true
        return next
      })
      return changed ? out : node
    }
    // Only plain objects are rebuilt; anything else (a `File`, a class instance) is kept as is.
    if (!isPlainObject(node)) return node
    let changed = false
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(node)) {
      const at = key === '$append' ? segs : [...segs, ...key.split('.')]
      const next = walk(value, own(source?.value, key), at, depth + 1)
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
  return walk(edited, { value: raw }, [], 0)
}
