import type { FieldValues, UseFormReturn } from 'react-hook-form'
import {
  flatten,
  getPath,
  type FieldInfo,
  type FormAdapter,
  type ToolIssue,
  type ToolResult,
} from '@toolmark/core'

/** Options for {@link rhfAdapter}. */
export interface RhfAdapterOptions<V extends FieldValues> {
  /** Called with the validated values on a successful submit; may be sync or async. */
  onSubmit: (values: V) => unknown
  /** Resolves a field's mounted element, for anchors and sensitive-field redaction (spec §14). */
  elementFor?: (path: string) => Element | null
}

/** @internal Loosened `setValue` signature: paths are dynamic dot paths, not a static union. */
type DynamicSetValue = (
  name: string,
  value: unknown,
  options?: { shouldDirty?: boolean; shouldValidate?: boolean; shouldTouch?: boolean },
) => void

function emptyFor(current: unknown): '' | null {
  return typeof current === 'string' ? '' : null
}

/** Recursively collects the dot paths whose leaf value is `true` in a react-hook-form marker tree
 * (`dirtyFields`, `touchedFields`): unlike {@link flatten}, a leaf here is any `true`/`false`, not
 * just non-plain-object values (array entries are visited too). */
function trueLeafPaths(node: unknown, prefix: string, out: string[]): void {
  if (node === true) {
    if (prefix !== '') out.push(prefix)
    return
  }
  if (node === false || node === null || typeof node !== 'object') return
  if (Array.isArray(node)) {
    node.forEach((child, i) => trueLeafPaths(child, prefix === '' ? String(i) : `${prefix}.${i}`, out))
    return
  }
  for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
    trueLeafPaths(child, prefix === '' ? key : `${prefix}.${key}`, out)
  }
}

function isFieldErrorLike(v: unknown): v is { type?: unknown; message?: unknown } {
  return typeof v === 'object' && v !== null && ('type' in v || 'message' in v)
}

/** Flattens react-hook-form's `FieldErrors` into `{ path, message }` issues. */
function errorsToIssues(errors: unknown, prefix = ''): ToolIssue[] {
  if (!errors || typeof errors !== 'object') return []
  const out: ToolIssue[] = []
  for (const [key, value] of Object.entries(errors as Record<string, unknown>)) {
    if (value === undefined || value === null) continue
    const path = prefix === '' ? key : `${prefix}.${key}`
    if (isFieldErrorLike(value)) {
      out.push({ path, message: typeof value.message === 'string' ? value.message : 'Invalid value' })
    } else if (typeof value === 'object') {
      out.push(...errorsToIssues(value, path))
    }
  }
  return out
}

/** Whether `value` can round-trip through `JSON.stringify` without silently dropping data. */
function isJsonSafe(value: unknown, depth = 0): boolean {
  if (depth > 64) return false
  if (value === null) return true
  const t = typeof value
  if (t === 'string' || t === 'number' || t === 'boolean') return true
  if (t === 'function' || t === 'symbol' || t === 'bigint' || t === 'undefined') return false
  if (Array.isArray(value)) return value.every((v) => isJsonSafe(v, depth + 1))
  if (t === 'object') {
    const proto = Object.getPrototypeOf(value) as unknown
    if (proto !== Object.prototype && proto !== null) return false
    return Object.values(value as Record<string, unknown>).every((v) => isJsonSafe(v, depth + 1))
  }
  return false
}

/**
 * Bridges a react-hook-form `useForm()` instance to Toolmark form tools (spec §8.1, §9).
 *
 * Reads `form.formState.dirtyFields` once, synchronously, when the adapter object is constructed:
 * react-hook-form's `formState` is a Proxy that only tracks the fields it has been read for
 * (`dirtyFields` included), so `useFormTool` (which builds the adapter during render, before any
 * effect) enables this tracking even when the host component never reads `formState` itself.
 * @param form - The `useForm()` return value.
 * @param opts - See {@link RhfAdapterOptions}.
 */
export function rhfAdapter<V extends FieldValues>(
  form: UseFormReturn<V>,
  opts: RhfAdapterOptions<V>,
): FormAdapter<V> {
  // Enables the dirtyFields Proxy subscription for the lifetime of this `form` control (see the
  // TSDoc above).
  void form.formState.dirtyFields

  const setValue = form.setValue as unknown as DynamicSetValue

  return {
    getValues: () => form.getValues(),

    setValues(values) {
      const current = form.getValues()
      for (const [path, value] of Object.entries(values)) {
        const next = value === null ? emptyFor(getPath(current, path)) : value
        setValue(path, next, { shouldDirty: true, shouldValidate: true, shouldTouch: false })
      }
    },

    /**
     * `form.formState` is a Proxy that only reflects a field's latest value at the *next* render
     * after react-hook-form updates it — reading `dirtyFields` synchronously right after a
     * `setValue`/user-input event (before React has re-rendered) can observe a stale snapshot. Core
     * calls `dirtyPaths()` at tool-registration/call time, which in practice is after a render has
     * already happened, but a caller reading it synchronously inside the same tick as an input event
     * (outside of React's render cycle) may see paths lag by one render.
     */
    dirtyPaths(): string[] {
      const out: string[] = []
      trueLeafPaths(form.formState.dirtyFields, '', out)
      return out
    },

    async submit(): Promise<ToolResult<unknown>> {
      let outcome: ToolResult<unknown> = { status: 'ok', data: {} }
      try {
        // Let a thrown `onSubmit` propagate out of `onValid` (and out of the `handleSubmit(...)()`
        // call below) rather than swallowing it here: react-hook-form's `handleSubmit` "will not
        // swallow errors that occurred inside your onSubmit callback" and only marks
        // `formState.isSubmitSuccessful` true when `onValid` resolves without throwing — catching
        // the error inside `onValid` (and merely recording an `error` outcome) would make RHF think
        // the submission succeeded even though it failed.
        await form.handleSubmit(async (values) => {
          const result: unknown = await opts.onSubmit(values)
          outcome = { status: 'ok', data: isJsonSafe(result) ? result : {} }
        }, (errors) => {
          outcome = { status: 'invalid', issues: errorsToIssues(errors) }
        })()
      } catch (cause) {
        outcome = { status: 'error', message: cause instanceof Error ? cause.message : String(cause) }
      }
      return outcome
    },

    fields(): FieldInfo[] {
      return Object.keys(flatten(form.getValues())).map((path) => ({
        path,
        element: opts.elementFor?.(path) ?? null,
      }))
    },
  }
}
