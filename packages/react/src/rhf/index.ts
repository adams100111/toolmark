/**
 * `@toolmark/react/rhf` — The react-hook-form adapter (`rhfAdapter`) for `useFormTool`.
 * @packageDocumentation
 * @module @toolmark/react/rhf
 */
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
  /**
   * Resolves a field's mounted element, for anchors and sensitive-field redaction (spec §13, §14).
   * Defaults, when {@link root} is given, to the first `[name="<path>"]` under `root()`.
   *
   * Without `root` or `elementFor` there are no elements, hence no element rule: password /
   * `cc-*` fields are not detected and must be declared in the form tool's `sensitive`.
   */
  elementFor?: (path: string) => Element | null
  /**
   * The element that contains the form's fields (usually the `<form>`), read on every use. Gives
   * the form automatic anchors (`[name="<path>"]` lookup, when {@link elementFor} is absent), the
   * sensitive-element rule (password / `cc-*` inputs are redacted from `state()`), and `focus` /
   * `submit` interaction events. Without it only `input` interaction events are emitted.
   */
  root?: () => Element | null
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
      out.push({
        path,
        message: typeof value.message === 'string' ? value.message : 'Invalid value',
      })
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
 *
 * Tour hooks (spec §13): `onUserInteraction` reports `input` for react-hook-form's own user-change
 * signal (`watch` with `type: 'change'`, never the adapter's `setValue` writes) and, when
 * `opts.root` is given, `focus` for trusted `focusin` on named elements inside `root()` and
 * `submit` for a trusted `submit` event inside it. Only paths are reported, never values.
 *
 * - `input` follows react-hook-form's own change signal, not the DOM event: a synthetic
 *   `onChange` from page script (or a component library calling `field.onChange`) is reported as
 *   a user `input` too. Only the DOM `focus` / `submit` reports check `isTrusted`.
 * - Sensitivity (spec §14): with elements (`root` / `elementFor`), a path whose element was ever
 *   seen as a password / `cc-*` / secret-`autocomplete` input stays redacted for the adapter's
 *   lifetime, so a "show password" toggle (`type="password"` → `"text"`) never exposes it in
 *   `state()`. A path is only known once its element has been seen that way; without `root` /
 *   `elementFor` nothing is detected, so declare secret paths in the form tool's `sensitive`.
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

  const elementFor =
    opts.elementFor ??
    (opts.root
      ? (path: string): Element | null => {
          const root = opts.root?.()
          if (!root || typeof CSS === 'undefined') return null
          return root.querySelector(`[name="${CSS.escape(path)}"]`) ?? null
        }
      : undefined)

  return {
    getValues: () => form.getValues(),

    setValues(values) {
      const current = form.getValues()
      for (const [path, value] of Object.entries(values)) {
        // An array path is replaced wholesale (spec §8.3): `shouldTouch` has no field-level
        // meaning for a whole array and, unlike a scalar leaf, is left to react-hook-form's
        // default so a mounted `useFieldArray`'s `fields` stays in sync (M2 T7; verified against
        // react-hook-form 7.88 — see the rhf-arrays test and its ledgered finding below).
        if (Array.isArray(value)) {
          setValue(path, value, { shouldDirty: true, shouldValidate: true })
          continue
        }
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
     *
     * Uses core's {@link flatten} (`arraysAsLeaves: false`) so array entries are visited by index
     * (`a.0.b`) exactly like every other dot path in this package, then keeps only the `true`
     * leaves (react-hook-form's `dirtyFields` tree marks a changed leaf `true` and leaves
     * unresolved branches as nested objects/arrays; `false` never appears for a leaf it tracked).
     */
    dirtyPaths(): string[] {
      const flat = flatten(form.formState.dirtyFields, { arraysAsLeaves: false })
      return Object.keys(flat).filter((path) => flat[path] === true)
    },

    /**
     * Runs react-hook-form's `handleSubmit`. A throwing `onSubmit` is deliberately not caught:
     * the rejection propagates to core, which returns the generic `error` "Tool failed" plus a
     * `tool_threw` event, so the app's exception message never reaches the agent.
     */
    async submit(): Promise<ToolResult<unknown>> {
      let outcome: ToolResult<unknown> = { status: 'ok', data: {} }
      // Let a thrown `onSubmit` propagate out of `onValid` (and out of the `handleSubmit(...)()`
      // call below) rather than swallowing it: react-hook-form's `handleSubmit` "will not swallow
      // errors that occurred inside your onSubmit callback" and only marks
      // `formState.isSubmitSuccessful` true when `onValid` resolves without throwing (M6).
      await form.handleSubmit(
        async (values) => {
          const result: unknown = await opts.onSubmit(values)
          outcome = { status: 'ok', data: isJsonSafe(result) ? result : {} }
        },
        (errors) => {
          outcome = { status: 'invalid', issues: errorsToIssues(errors) }
        },
      )()
      return outcome
    },

    onUserInteraction(cb) {
      if (typeof cb !== 'function') return () => undefined
      let active = true
      const report = (e: { path: string; kind: 'input' | 'focus' | 'submit' }): void => {
        if (!active) return
        try {
          cb(e)
        } catch (error) {
          console.error(error)
        }
      }
      // `input`: react-hook-form reports its registered inputs' and controllers' `onChange` as
      // `type: 'change'`; `setValue` (the adapter's own writes), `reset` and the like carry no type.
      const watcher = form.watch((_values, info) => {
        if (info.type === 'change' && typeof info.name === 'string' && info.name !== '') {
          report({ path: info.name, kind: 'input' })
        }
      })
      // `focus` / `submit`: trusted DOM events inside `root()`, observed on the document so the
      // root may mount, move or be replaced after subscribing. The adapter's own `submit()` runs
      // `handleSubmit` directly and dispatches no DOM event.
      const doc = opts.root && typeof document !== 'undefined' ? document : undefined
      const inRoot = (event: Event): Element | undefined => {
        const root = opts.root?.()
        const target = event.composedPath()[0]
        return root && target instanceof Element && root.contains(target) ? target : undefined
      }
      const onFocus = (event: Event): void => {
        if (!event.isTrusted) return
        const target = inRoot(event)
        const name = target?.getAttribute('name')
        if (typeof name === 'string' && name !== '') report({ path: name, kind: 'focus' })
      }
      const onSubmitEvent = (event: Event): void => {
        if (event.isTrusted && inRoot(event)) report({ path: '', kind: 'submit' })
      }
      doc?.addEventListener('focusin', onFocus, true)
      doc?.addEventListener('submit', onSubmitEvent, true)
      return () => {
        if (!active) return
        active = false
        watcher.unsubscribe()
        doc?.removeEventListener('focusin', onFocus, true)
        doc?.removeEventListener('submit', onSubmitEvent, true)
      }
    },

    fields(): FieldInfo[] {
      return Object.keys(flatten(form.getValues())).map((path) => ({
        path,
        element: elementFor?.(path) ?? null,
      }))
    },
  }
}
