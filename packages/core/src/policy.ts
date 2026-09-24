import type { Caller, ToolHints } from './tool.js'

/** A tool's hint class; `destructive` > `consequential` > `readOnly` > `default` (unhinted). */
export type HintClass = 'readOnly' | 'default' | 'consequential' | 'destructive'

/**
 * Per-caller policy. `allow` (when present) replaces the caller's default hint classes; `tools`
 * filters by full name or `prefix.*` (`deny` wins over `allow`).
 */
export interface CallerPolicy {
  /** Hint classes this caller may use (replaces the defaults). */
  allow?: HintClass[]
  /** Tool-name filter: exact full names or `prefix.*` patterns. */
  tools?: { allow?: string[]; deny?: string[] }
}

/** @internal Configurable (non-human) callers. */
export type PolicyCaller = Exclude<Caller, 'human'>

/** @internal */
export const HINT_CLASSES: readonly HintClass[] = [
  'readOnly',
  'default',
  'consequential',
  'destructive',
]

/** @internal */
export const POLICY_CALLERS: readonly PolicyCaller[] = ['inapp', 'webmcp', 'mcp', 'test', 'tour']

/** @internal Every known caller. */
export const CALLERS: readonly Caller[] = [...POLICY_CALLERS, 'human']

/** @internal Whether `c` is a known caller (guards untrusted caller strings). */
export function isKnownCaller(c: unknown): c is Caller {
  return typeof c === 'string' && (CALLERS as readonly string[]).includes(c)
}

/** @internal Default exposure per caller (spec §7 table, M1 constraints). */
export const DEFAULT_ALLOW: Readonly<Record<Caller, readonly HintClass[]>> = {
  inapp: HINT_CLASSES,
  test: HINT_CLASSES,
  human: HINT_CLASSES,
  webmcp: ['readOnly', 'default', 'consequential'],
  mcp: ['readOnly', 'default', 'consequential'],
  tour: ['readOnly', 'default', 'consequential'],
}

/** @internal Resolved, validated policy. */
export type ResolvedPolicy = Partial<Record<PolicyCaller, CallerPolicy>>

/** @internal */
export function hintClass(hints: ToolHints | undefined): HintClass {
  if (hints?.destructive) return 'destructive'
  if (hints?.consequential) return 'consequential'
  if (hints?.readOnly) return 'readOnly'
  return 'default'
}

/** @internal Whether a class needs confirmation (unless the caller is `human`). */
export function needsConfirmation(cls: HintClass): boolean {
  return cls === 'consequential' || cls === 'destructive'
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string')
}

/**
 * @internal Validates `policy` entries. Invalid entries (`human`, unknown callers, unknown hint
 * classes, malformed `tools`) are reported through `report` and ignored.
 */
export function resolvePolicy(policy: unknown, report: (message: string) => void): ResolvedPolicy {
  const out: ResolvedPolicy = {}
  if (policy === undefined) return out
  if (typeof policy !== 'object' || policy === null) {
    report('policy must be an object')
    return out
  }
  for (const [key, entry] of Object.entries(policy as Record<string, unknown>)) {
    if (key === 'human') {
      report("policy.human is not configurable: the 'human' caller is fixed")
      continue
    }
    if (!(POLICY_CALLERS as readonly string[]).includes(key)) {
      report(`policy.${key}: unknown caller`)
      continue
    }
    if (typeof entry !== 'object' || entry === null) {
      report(`policy.${key} must be an object`)
      continue
    }
    const { allow, tools } = entry as { allow?: unknown; tools?: unknown }
    if (allow !== undefined) {
      if (!Array.isArray(allow)) {
        report(`policy.${key}.allow must be an array of hint classes`)
        continue
      }
      const bad = allow.filter((c) => !(HINT_CLASSES as readonly unknown[]).includes(c))
      if (bad.length > 0) {
        report(`policy.${key}.allow: unknown hint class ${bad.map(String).join(', ')}`)
        continue
      }
    }
    let toolsOut: CallerPolicy['tools']
    if (tools !== undefined) {
      const t = tools as { allow?: unknown; deny?: unknown }
      if (
        typeof tools !== 'object' ||
        tools === null ||
        (t.allow !== undefined && !isStringArray(t.allow)) ||
        (t.deny !== undefined && !isStringArray(t.deny))
      ) {
        report(`policy.${key}.tools must be { allow?: string[]; deny?: string[] }`)
        continue
      }
      toolsOut = {
        ...(t.allow !== undefined ? { allow: [...t.allow] } : {}),
        ...(t.deny !== undefined ? { deny: [...t.deny] } : {}),
      }
    }
    out[key as PolicyCaller] = {
      ...(allow !== undefined ? { allow: [...(allow as HintClass[])] } : {}),
      ...(toolsOut !== undefined ? { tools: toolsOut } : {}),
    }
  }
  return out
}

function matches(pattern: string, name: string): boolean {
  if (pattern.endsWith('.*')) return name.startsWith(pattern.slice(0, -1))
  return pattern === name
}

/**
 * @internal Whether `caller` may see/call a tool of class `cls` named `fullName` under `policy`
 * (hint class and name must both pass). `human` is never filtered.
 */
export function isAllowed(
  policy: ResolvedPolicy,
  caller: Caller,
  cls: HintClass,
  fullName: string,
): boolean {
  if (!isKnownCaller(caller)) return false
  if (caller === 'human') return true
  const entry = Object.prototype.hasOwnProperty.call(policy, caller) ? policy[caller] : undefined
  const classes = entry?.allow ?? DEFAULT_ALLOW[caller]
  if (!classes.includes(cls)) return false
  const tools = entry?.tools
  if (tools?.deny?.some((p) => matches(p, fullName))) return false
  if (tools?.allow && !tools.allow.some((p) => matches(p, fullName))) return false
  return true
}
