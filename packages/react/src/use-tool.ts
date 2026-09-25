import { useEffect, useRef } from 'react'
import type { Scope, ToolDefinition, Toolmark, ToolState } from '@toolmark/core'
import { useCurrentScope } from './scope.js'
import { useToolmark } from './provider.js'

// Bundlers (webpack, Next.js, esbuild) statically replace `process.env.NODE_ENV`; declaring the
// ambient shape (instead of depending on `@types/node`, which this package doesn't have) lets that
// replacement/dead-code-elimination happen without a real Node `process` at runtime.
declare const process: { env: Record<string, string | undefined> } | undefined

/** @internal Best-effort dev-mode detection with no bundler-specific dependency. */
function isDevEnvironment(): boolean {
  try {
    const meta = import.meta as unknown as { env?: { DEV?: boolean; MODE?: string } }
    if (meta.env) {
      if (typeof meta.env.DEV === 'boolean') return meta.env.DEV
      if (typeof meta.env.MODE === 'string') return meta.env.MODE !== 'production'
    }
  } catch {
    // Not bundled with a `define`d `import.meta.env`; fall through.
  }
  if (typeof process !== 'undefined' && process.env.NODE_ENV) {
    return process.env.NODE_ENV !== 'production'
  }
  return false
}

/** @internal Registration timestamps per (registry, scope path + name), for the churn warning. */
const churnTimestamps = new WeakMap<Toolmark, Map<string, number[]>>()
const CHURN_WINDOW_MS = 1000
const CHURN_THRESHOLD = 3

function warnIfChurning(toolmark: Toolmark, scope: Scope | undefined, name: string): void {
  if (!isDevEnvironment()) return
  const key = `${scope?.path ?? ''}.${name}`
  let byKey = churnTimestamps.get(toolmark)
  if (!byKey) churnTimestamps.set(toolmark, (byKey = new Map<string, number[]>()))
  const now = Date.now()
  const times = (byKey.get(key) ?? []).filter((t) => now - t < CHURN_WINDOW_MS)
  times.push(now)
  byKey.set(key, times)
  if (times.length === CHURN_THRESHOLD + 1) {
    console.warn(
      `[toolmark] useTool("${key}") re-registered ${times.length} times in the last second; ` +
        `hoist its input/output schema (and any hints object) outside the component so their ` +
        `identity stays stable across renders.`,
    )
  }
}

/** Shallow key of a tool's hints, for change detection independent of object identity. */
function hintsKey(hints: ToolDefinition['hints']): string {
  if (!hints) return ''
  return [
    hints.readOnly ?? false,
    hints.consequential ?? false,
    hints.destructive ?? false,
    hints.untrustedContent ?? false,
  ].join('|')
}

/**
 * Registers `def` as a tool in the current scope (spec §9) while the component is mounted.
 *
 * Registration happens in an effect and is StrictMode-safe (a double mount/unmount leaves exactly
 * one live registration). `run`, `summary` and `state` always call the latest `def` through a ref
 * updated on every render, so a fresh `def` object each render never needs a re-registration by
 * itself. The tool re-registers only when `name`, `description`, `title`, `hints` (compared
 * shallowly) or the `input`/`output`/`jsonSchema` identities change.
 * @param def - The tool declaration.
 */
export function useTool<I, O>(def: ToolDefinition<I, O>): void {
  const toolmark = useToolmark()
  const scope = useCurrentScope()
  const defRef = useRef(def)
  defRef.current = def

  const hkey = hintsKey(def.hints)

  useEffect(() => {
    // A StrictMode remount can run this effect a moment before the enclosing `<ToolScope>` has
    // recreated its scope (children's effects run before their parent's). Skip this pass rather
    // than registering into a disposed scope: `<ToolScope>` forces a re-render once its scope is
    // live again, which re-runs this effect with a fresh `scope`.
    if (scope?.disposed) return undefined
    const current = defRef.current
    warnIfChurning(toolmark, scope, current.name)
    const registration = toolmark.register(
      {
        name: current.name,
        ...(current.title !== undefined ? { title: current.title } : {}),
        description: current.description,
        ...(current.input !== undefined ? { input: current.input } : {}),
        ...(current.output !== undefined ? { output: current.output } : {}),
        ...(current.jsonSchema !== undefined ? { jsonSchema: current.jsonSchema } : {}),
        ...(current.hints !== undefined ? { hints: current.hints } : {}),
        // Only wrap `summary` when the caller declared one: core falls back to `title ?? the
        // full tool name` for confirmation text (`call.ts` `summaryOf`) when a tool has none, and
        // an always-present wrapper returning `''` would silently defeat that fallback (I1).
        ...(current.summary !== undefined
          ? { summary: (input: I): string => defRef.current.summary?.(input) ?? '' }
          : {}),
        ...(current.anchors !== undefined ? { anchors: current.anchors } : {}),
        ...(current.state !== undefined
          ? {
              state: (): ToolState<I> =>
                defRef.current.state?.() ?? { values: {}, issues: [] },
            }
          : {}),
        run: (input, ctx) => defRef.current.run(input, ctx),
      },
      scope ? { scope } : undefined,
    )
    return () => registration.dispose()
  }, [
    toolmark,
    scope,
    def.name,
    def.description,
    def.title,
    hkey,
    def.input,
    def.output,
    def.jsonSchema,
    def.summary !== undefined,
  ])
}
