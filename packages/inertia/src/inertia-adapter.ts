import type { FieldInfo, FormAdapter, ToolResult } from '@toolmark/core'
import { flatten, setPath } from '@toolmark/core'
import { visitOutcome, type InertiaVisitCallbacks } from './visit-outcome.js'

/**
 * The subset of `@inertiajs/react`'s `useForm()` return value {@link inertiaAdapter} needs,
 * structurally compatible with both Inertia 2 and 3 (`InertiaFormProps<V>` / `InertiaForm<V>`).
 */
export interface InertiaFormLike<V extends Record<string, unknown>> {
  /** The form's current values, as of the last render. */
  data: V
  /** Replaces the form's values (Inertia's `setData`, called with a full object). */
  setData(data: V): void
  /** Server-reported validation errors, keyed by field. */
  errors: Partial<Record<string, string>>
  /** Registers a callback that produces the payload a visit actually sends. */
  transform(callback: (data: V) => Record<string, unknown>): void
  /** Starts a visit (Inertia's `useForm().submit`). */
  submit(method: string, url: string, opts: InertiaVisitCallbacks): void
}

interface AdapterState {
  /** The adapter's own idea of the form's values (ahead of `form.data` until the next render). */
  current: Record<string, unknown>
  /** What the adapter last wrote (or first read); used to detect external changes to `form.data`. */
  lastSeenData: Record<string, unknown>
  /** `form.data` at the moment this state was created, flattened, for `dirtyPaths`. */
  snapshot: Record<string, unknown>
}

/**
 * Structural equality for flattened leaves. Inertia's keyed `setData` deep-clones the whole form,
 * so an untouched array, nested plain object or `Date` gets a new identity on every user edit;
 * comparing by `Object.is` would report it dirty and fills would skip it. Arrays and plain
 * objects compare element-wise, Dates by time, and anything else (Files, Blobs, class instances)
 * by identity.
 */
function sameValue(a: unknown, b: unknown, depth = 0): boolean {
  if (Object.is(a, b)) return true
  if (depth > 64 || typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return false
  }
  if (a instanceof Date && b instanceof Date) return Object.is(a.getTime(), b.getTime())
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false
    return a.every((item, i) => sameValue(item, b[i], depth + 1))
  }
  if (!isPlainObject(a) || !isPlainObject(b)) return false
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  return keys.every((k) => Object.hasOwn(b, k) && sameValue(a[k], b[k], depth + 1))
}

function isPlainObject(v: object): v is Record<string, unknown> {
  const proto = Object.getPrototypeOf(v) as unknown
  return proto === Object.prototype || proto === null
}

/** Per-form adapter state, keyed by a render-stable identity of the form (`form.setData`). */
const stateByForm = new WeakMap<object, AdapterState>()

/**
 * Bridges `@inertiajs/react`'s `useForm()` to Toolmark form tools (spec §8.1, §10.1). Call it on
 * every render with the latest `useForm()` result; per-form state (the working values and the
 * dirty-tracking snapshot) survives across renders in a module-level map keyed by `form.setData`.
 * @param form - The `useForm()` result (or a structurally compatible object).
 * @param opts - `submit` names the visit's method and URL; `elementFor` resolves a field's DOM
 * element for anchors and redaction (spec §14).
 * @returns A {@link FormAdapter} for `useFormTool` / `createFormTools`.
 */
export function inertiaAdapter<V extends Record<string, unknown>>(
  form: InertiaFormLike<V>,
  opts: {
    submit: { method: 'post' | 'put' | 'patch' | 'delete'; url: string }
    elementFor?: (path: string) => Element | null
  },
): FormAdapter<V> {
  // Used only as a WeakMap key (never called unbound): identifies the form across renders.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const key: object = form.setData
  let state = stateByForm.get(key)
  if (!state) {
    const initial = flatten(form.data)
    state = { current: form.data, lastSeenData: form.data, snapshot: initial }
    stateByForm.set(key, state)
  } else if (!Object.is(form.data, state.lastSeenData)) {
    // form.data moved since the adapter last wrote it (user typing, reset, a later render's
    // defaults, …): re-sync, the outside world now owns the current values.
    state.current = form.data
    state.lastSeenData = form.data
  }
  const st = state

  return {
    getValues(): V {
      return st.current as V
    },
    setValues(values: Record<string, unknown>, _opts: { source: 'agent' | 'undo' }): void {
      let next = st.current
      for (const [path, value] of Object.entries(values)) {
        next = setPath(next, path, value)
      }
      st.current = next
      st.lastSeenData = next
      form.setData(next as V)
    },
    dirtyPaths(): string[] {
      const currentFlat = flatten(st.current)
      const paths = new Set([...Object.keys(st.snapshot), ...Object.keys(currentFlat)])
      const dirty: string[] = []
      for (const path of paths) {
        if (!sameValue(currentFlat[path], st.snapshot[path])) dirty.push(path)
      }
      return dirty
    },
    submit(): Promise<ToolResult<unknown>> {
      form.transform(() => st.current)
      const { callbacks, result } = visitOutcome()
      form.submit(opts.submit.method, opts.submit.url, callbacks)
      return result
    },
    fields(): FieldInfo[] {
      return Object.keys(flatten(st.current)).map((path) => {
        const info: FieldInfo = { path }
        if (opts.elementFor) info.element = opts.elementFor(path) ?? null
        return info
      })
    },
  }
}
