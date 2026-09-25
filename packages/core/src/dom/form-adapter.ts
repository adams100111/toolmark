import type { FieldInfo, FormAdapter } from '../forms/types.js'
import { deepEqual, getPath, setPath } from '../forms/paths.js'
import { invalid, ok, type ToolResult } from '../result.js'
import {
  discover,
  isExcluded,
  kindOf,
  labelText,
  nestValues,
  readField,
  writeField,
  type FormField,
} from './elements.js'

/** Options for {@link domFormAdapter}. */
export interface DomFormAdapterOptions {
  /**
   * Replaces the default submit (constraint validation, then `form.requestSubmit()`), e.g. to
   * submit through a router.
   */
  submit?: (form: HTMLFormElement) => Promise<ToolResult<unknown>>
}

/** A {@link FormAdapter} over a DOM form; `dispose()` removes every listener it added. */
export type DomFormAdapter = FormAdapter & {
  /** Removes the adapter's listeners (and any pending re-snapshot). */
  dispose(): void
}

const isUnder = (path: string, base: string): boolean =>
  path === base || path.startsWith(`${base}.`)

/**
 * Adapts an uncontrolled (or framework-controlled) DOM form to form tools (spec §8.1, §10.2).
 *
 * - **Fields** are the named controls of `form.elements` (`form=`-associated controls and
 *   form-associated custom elements included). Hidden (e.g. CSRF `_token`), password,
 *   `autocomplete="cc-*"`, disabled and `[data-tool-ignore]` controls are never read, reported or
 *   written. Names map to dot paths (`a[b]` → `a.b`, `a[0][b]` → `a.0.b`; `a[]` or a repeated
 *   name → an array; `fieldset[name]` prefixes its descendants).
 * - **`setValues`** writes through the prototypes' native setters (text, `select`,
 *   `option.selected`, `files` via `DataTransfer`) and dispatches bubbling `input` and `change`;
 *   checkboxes and radios whose state must change are `click()`ed, so React-controlled inputs
 *   update their state.
 * - **`dirtyPaths`** = fields whose value differs from the load snapshot and is not the value the
 *   agent last set, plus fields touched by trusted (`isTrusted`) `input`/`change` events; a form
 *   `reset` (not cancelled) re-snapshots and clears both.
 * - **`submit`** (default): `form.checkValidity()` fails → `invalid` with each invalid field's
 *   `validationMessage` at its path (an excluded control is reported at `""` without its name);
 *   else `form.requestSubmit()` → `ok({ submitted: true })`.
 *
 * @param form - The form element.
 * @param opts - Optional submit override.
 * @returns The adapter; call `dispose()` when the form goes away.
 */
export function domFormAdapter(
  form: HTMLFormElement,
  opts?: DomFormAdapterOptions,
): DomFormAdapter {
  const fields = (): FormField[] => discover(form).fields
  const values = (list: FormField[]): Map<string, unknown> =>
    new Map(list.map((f) => [f.path, readField(f)] as const))

  let snapshot = values(fields())
  const agentSet = new Map<string, unknown>()
  const touched = new Set<string>()

  /** The field a user event came from (the first field control on its composed path). */
  const pathOf = (event: Event): string | undefined => {
    const list = fields()
    for (const target of event.composedPath()) {
      const field = list.find((f) => f.controls.includes(target as HTMLElement))
      if (field) return field.path
    }
    return undefined
  }

  // Events fired while the adapter writes (a `click()`'s activation fires trusted `input`/`change`)
  // are the agent's, not the user's.
  let writing = false
  const onUserEvent = (event: Event): void => {
    if (!event.isTrusted || writing) return
    const path = pathOf(event)
    if (path !== undefined) touched.add(path)
  }
  let resetTimer: ReturnType<typeof setTimeout> | undefined
  const onReset = (event: Event): void => {
    // Controls are reset after the event is dispatched (and only when it is not cancelled).
    if (resetTimer !== undefined) clearTimeout(resetTimer)
    resetTimer = setTimeout(() => {
      resetTimer = undefined
      if (event.defaultPrevented) return
      snapshot = values(fields())
      touched.clear()
      agentSet.clear()
    }, 0)
  }

  // `form=`-associated controls live outside the form, so user events are observed on its root.
  const root = form.getRootNode() as Document | ShadowRoot
  root.addEventListener('input', onUserEvent, true)
  root.addEventListener('change', onUserEvent, true)
  form.addEventListener('reset', onReset)

  const adapter: DomFormAdapter = {
    getValues() {
      return nestValues(fields().map((f) => [f.path, readField(f)]))
    },

    setValues(input, { source }) {
      const list = fields()
      const affected = new Set<FormField>()
      writing = true
      try {
        write(list, input, affected)
      } finally {
        writing = false
      }
      for (const field of affected) {
        if (source === 'agent') agentSet.set(field.path, readField(field))
        else agentSet.delete(field.path)
      }
    },

    dirtyPaths() {
      const out: string[] = []
      for (const field of fields()) {
        const path = field.path
        const value = readField(field)
        if (!snapshot.has(path)) snapshot.set(path, value) // appeared after load
        if (touched.has(path)) {
          out.push(path)
          continue
        }
        const agent = agentSet.has(path) && deepEqual(value, agentSet.get(path))
        if (!agent && !deepEqual(value, snapshot.get(path))) out.push(path)
      }
      return out
    },

    submit() {
      if (opts?.submit) return opts.submit(form)
      if (!form.checkValidity()) return Promise.resolve(invalid(validityIssues(form)))
      form.requestSubmit()
      return Promise.resolve(ok({ submitted: true }))
    },

    fields(): FieldInfo[] {
      return fields().map((f) => {
        const label = labelText(f.controls[0]!)
        return { path: f.path, element: f.controls[0]!, ...(label !== '' ? { label } : {}) }
      })
    },

    dispose() {
      root.removeEventListener('input', onUserEvent, true)
      root.removeEventListener('change', onUserEvent, true)
      form.removeEventListener('reset', onReset)
      if (resetTimer !== undefined) clearTimeout(resetTimer)
      resetTimer = undefined
    },
  }
  return adapter
}

/** Writes flat `{ path: value }` entries to the fields they address. */
function write(list: FormField[], input: Record<string, unknown>, affected: Set<FormField>): void {
  for (const [path, value] of Object.entries(input)) {
    for (const field of list) {
      try {
        if (isUnder(field.path, path)) {
          // The field is the path, or lies under it (an array / object written as a unit).
          const sub =
            field.path === path ? value : getPath(value, field.path.slice(path.length + 1))
          writeField(field, value === null ? null : (sub ?? null))
          affected.add(field)
        } else if (isUnder(path, field.path)) {
          // The path lies inside the field's value (an item of an array field).
          const next = setPath(readField(field) ?? [], path.slice(field.path.length + 1), value)
          writeField(field, next)
          affected.add(field)
        }
      } catch {
        // An unsafe path segment (`__proto__`, …) is never written.
      }
    }
  }
}

type Validatable = Element & {
  validity?: ValidityState
  validationMessage?: string
  willValidate?: boolean
}

/** One issue per invalid field (list items at `<path>.<index>`); excluded controls at `""`, unnamed. */
function validityIssues(form: HTMLFormElement): Array<{ path: string; message: string }> {
  const issues = new Map<string, string>()
  const known = new Set<Element>()
  for (const field of discover(form).fields) {
    field.controls.forEach((c, i) => {
      known.add(c)
      const v = c as Validatable
      if (v.validity === undefined || v.validity.valid) return
      const path = field.shape === 'list' ? `${field.path}.${i}` : field.path
      if (!issues.has(path)) issues.set(path, v.validationMessage ?? 'Invalid value')
    })
  }
  for (const el of Array.from(form.elements)) {
    const v = el as Validatable
    if (known.has(el) || v.willValidate !== true || v.validity?.valid !== false) continue
    if (kindOf(el) === undefined && el.localName !== 'input') continue
    if (!issues.has('')) {
      issues.set(
        '',
        isExcluded(el)
          ? 'A field the agent cannot fill (for example a password) is invalid'
          : 'The form has an invalid field the agent cannot fill',
      )
    }
  }
  if (issues.size === 0) issues.set('', 'The form is invalid')
  return [...issues]
    .map(([path, message]) => ({ path, message }))
    .sort((a, b) => a.path.localeCompare(b.path))
}
