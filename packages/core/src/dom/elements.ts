/**
 * Field discovery for DOM forms (spec §10.2): which controls of a form are fields, their dot paths,
 * and how their values are read and written. Internal to `@toolmark/core/dom`; every DOM access
 * happens inside functions (the entry imports under Node).
 * @internal
 * @packageDocumentation
 */

/** @internal How a control is implemented. */
export type ControlKind = 'input' | 'select' | 'textarea' | 'custom'

/**
 * @internal How a field's controls combine into one value: `single` (one control), `checkbox-group`
 * (array of checked values), `radio-group` (the checked value) or `list` (array, one item per
 * control).
 */
export type FieldShape = 'single' | 'checkbox-group' | 'radio-group' | 'list'

/** @internal One field of a form: a dot path and the control(s) that hold its value. */
export interface FormField {
  /** Dot path (`address.city`, `rows.0.name`). */
  path: string
  /** How the controls combine. */
  shape: FieldShape
  /** Controls in document order (radio / checkbox groups and lists have several). */
  controls: HTMLElement[]
  /** The raw `name` attribute of the first control (for `data-tool-param-<name>`). */
  name: string
}

/** @internal One discovered control (see {@link discoverFields}). */
export interface DiscoveredField {
  /** Dot path of the field the control belongs to. */
  path: string
  /** The control. */
  element: HTMLElement
  /** How the control is implemented. */
  kind: ControlKind
  /** How the field's controls combine. */
  shape: FieldShape
  /** Item index for `list` fields. */
  index?: number
}

/** @internal A named control that was left out, and why (reported by the scanner). */
export interface SkippedControl {
  /** The raw `name` (or path, for patterns). */
  path: string
  /** Why it was skipped. */
  reason: string
}

/** @internal The fields of a form, plus named controls that could not be mapped to a path. */
export interface Discovery {
  fields: FormField[]
  skipped: SkippedControl[]
}

const NON_FIELD_INPUT_TYPES = new Set(['submit', 'reset', 'button', 'image'])
const UNSAFE_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor'])

// ---------------------------------------------------------------------------------------------
// DOM-clobbering-safe access. A form's named controls shadow its own properties
// (`<input name="elements">` replaces `form.elements`), so form methods are called through the
// prototypes, looked up at call time.

/** @internal `form.elements`, immune to a control named `elements`. */
export function formElements(form: HTMLFormElement): Element[] {
  const elements = Reflect.get(HTMLFormElement.prototype, 'elements', form) as HTMLCollection
  return Array.from(elements)
}

/** @internal `el.getAttribute(name)`, immune to a control named `getAttribute` (on forms). */
export function getAttr(el: Element, name: string): string | null {
  return Element.prototype.getAttribute.call(el, name)
}

/** @internal `node.getRootNode()`, immune to clobbering. */
export function rootOf(node: Node): Document | ShadowRoot {
  return Node.prototype.getRootNode.call(node) as Document | ShadowRoot
}

/** @internal `ancestor.contains(node)`, immune to clobbering. */
export function containsNode(ancestor: Node, node: Node): boolean {
  return Node.prototype.contains.call(ancestor, node)
}

/** @internal Truncates to at most `max` characters, ending in `…` when cut (no split surrogates). */
export function cap(text: string, max: number): string {
  if (text.length <= max) return text
  let end = max - 1
  const code = text.charCodeAt(end - 1)
  if (code >= 0xd800 && code <= 0xdbff) end--
  return `${text.slice(0, end)}…`
}

/** @internal Maximum length of a field description or label taken from the page. */
export const MAX_DESCRIPTION = 500
/** @internal Maximum length of an option title taken from the page. */
export const MAX_OPTION_TITLE = 200

/** @internal The lower-cased `type` of an `<input>` (`text` when absent or unknown). */
export function inputType(el: Element): string {
  return (el as HTMLInputElement).type.toLowerCase()
}

/** @internal The control kind of a listed form element, or `undefined` when it is not a field. */
export function kindOf(el: Element): ControlKind | undefined {
  switch (el.localName) {
    case 'input':
      return NON_FIELD_INPUT_TYPES.has(inputType(el)) ? undefined : 'input'
    case 'select':
      return 'select'
    case 'textarea':
      return 'textarea'
    default:
      // A form-associated custom element (only those are listed in `form.elements`).
      return el.localName.includes('-') ? 'custom' : undefined
  }
}

/** Autocomplete tokens of secrets that are excluded even when the control is not `type=password`. */
const SECRET_AUTOCOMPLETE = new Set(['current-password', 'new-password', 'one-time-code'])

function hasSensitiveAutocomplete(el: Element): boolean {
  const ac = getAttr(el, 'autocomplete')
  return (
    ac !== null &&
    ac
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .some((token) => token.startsWith('cc-') || SECRET_AUTOCOMPLETE.has(token))
  )
}

/**
 * Controls ever seen as `type="password"`: a "show password" toggle flips the type to `text`, and
 * the control stays excluded (sticky, for the page's lifetime).
 */
const seenAsPassword = new WeakSet<Element>()

function isDisabled(el: Element): boolean {
  try {
    return el.matches(':disabled')
  } catch {
    return false
  }
}

/**
 * @internal Whether a control is excluded from schemas, values, `changes`, `skipped`, `fields()`
 * and writes (spec §10.2, §14): `type="hidden"` (CSRF tokens), `type="password"` (and any control
 * once seen as one, so a "show password" toggle does not expose it), `autocomplete` tokens `cc-*`,
 * `current-password`, `new-password` and `one-time-code`, disabled controls (incl. inside a
 * disabled `fieldset`) and anything under `[data-tool-ignore]`.
 */
export function isExcluded(el: Element): boolean {
  if (seenAsPassword.has(el)) return true
  if (el.localName === 'input') {
    const type = inputType(el)
    if (type === 'password') {
      seenAsPassword.add(el)
      return true
    }
    if (type === 'hidden') return true
  }
  return hasSensitiveAutocomplete(el) || isDisabled(el) || el.closest('[data-tool-ignore]') !== null
}

/**
 * @internal Whether a control is read-only (`readonly` attribute or `aria-readonly="true"`;
 * attribute-based, so checkboxes, radios and selects are covered). Read-only fields are readable
 * context but never written or advertised.
 */
export function isReadOnly(el: Element): boolean {
  return (
    el.hasAttribute('readonly') || getAttr(el, 'aria-readonly')?.trim().toLowerCase() === 'true'
  )
}

/**
 * @internal Parses a control `name` into path segments: `a.b` → `[a, b]`; `a[b]` → `[a, b]`;
 * `a[0][b]` → `[a, 0, b]`; a trailing `[]` marks an array. `undefined` for anything else (empty
 * segments, `[]` in the middle, prototype keys).
 */
export function parseName(name: string): { segments: string[]; array: boolean } | undefined {
  const m = /^([^[\]]+)((?:\[[^[\]]*\])*)$/.exec(name)
  if (!m) return undefined
  const segments = m[1]!.split('.')
  const brackets = [...m[2]!.matchAll(/\[([^[\]]*)\]/g)].map((b) => b[1]!)
  let array = false
  brackets.forEach((b, i) => {
    if (b === '' && i === brackets.length - 1) array = true
    else segments.push(b)
  })
  if (brackets.slice(0, -1).includes('')) return undefined
  if (segments.some((s) => s === '' || s.includes('.') || UNSAFE_SEGMENTS.has(s))) return undefined
  return { segments, array }
}

type Category = 'checkbox' | 'radio' | 'other'
function categoryOf(el: HTMLElement): Category {
  if (el.localName !== 'input') return 'other'
  const type = inputType(el)
  return type === 'checkbox' || type === 'radio' ? type : 'other'
}

/** A control whose own value is an array (`select[multiple]`, `input[type=file][multiple]`). */
function ownArray(el: HTMLElement): boolean {
  if (el.localName === 'select') return (el as HTMLSelectElement).multiple
  return el.localName === 'input' && inputType(el) === 'file' && (el as HTMLInputElement).multiple
}

const isPrefix = (a: string, b: string): boolean => b.startsWith(`${a}.`)

/**
 * @internal Discovers a form's fields: the named, non-excluded controls listed in `form.elements`
 * (which includes `form=`-associated controls and form-associated custom elements, but not controls
 * inside shadow roots). Names map to dot paths (`fieldset[name]` prefixes its descendants); `a[]`,
 * or several non-radio controls sharing a name, form an array. A path that collides with another
 * field's path (`a` and `a.b`) is skipped (the first one in document order wins).
 */
export function discover(form: HTMLFormElement): Discovery {
  const skipped: SkippedControl[] = []
  const groups = new Map<string, { controls: HTMLElement[]; array: boolean; name: string }>()
  for (const el of formElements(form) as HTMLElement[]) {
    if (kindOf(el) === undefined) continue
    const name = el.getAttribute('name') ?? ''
    if (name === '' || isExcluded(el)) continue
    const parsed = parseName(name)
    const prefix = fieldsetPrefix(el, form)
    if (!parsed || !prefix) {
      skipped.push({ path: name, reason: 'Invalid field name' })
      continue
    }
    const path = [...prefix, ...parsed.segments].join('.')
    const group = groups.get(path)
    if (group) {
      group.controls.push(el)
      group.array ||= parsed.array
    } else {
      groups.set(path, { controls: [el], array: parsed.array, name })
    }
  }
  const fields: FormField[] = []
  for (const [path, group] of groups) {
    if (fields.some((f) => isPrefix(f.path, path) || isPrefix(path, f.path))) {
      skipped.push({ path: group.name, reason: 'Field path conflicts with another field' })
      continue
    }
    const category = categoryOf(group.controls[0]!)
    const controls = group.controls.filter((c) => categoryOf(c) === category)
    if (controls.length !== group.controls.length) {
      skipped.push({ path: group.name, reason: 'Controls of different kinds share a name' })
    }
    let shape: FieldShape
    if (category === 'radio') shape = 'radio-group'
    else if (category === 'checkbox') {
      shape = controls.length === 1 && !group.array ? 'single' : 'checkbox-group'
    } else {
      shape = controls.length === 1 && (!group.array || ownArray(controls[0]!)) ? 'single' : 'list'
    }
    fields.push({ path, shape, controls, name: group.name })
  }
  return { fields, skipped }
}

/** Segments contributed by named ancestor fieldsets owned by `form` (outermost first). */
function fieldsetPrefix(el: HTMLElement, form: HTMLFormElement): string[] | undefined {
  const out: string[][] = []
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (p.localName !== 'fieldset') continue
    const fs = p as HTMLFieldSetElement
    const name = fs.getAttribute('name')
    if (!name || fs.form !== form) continue
    const parsed = parseName(name)
    if (!parsed || parsed.array) return undefined
    out.unshift(parsed.segments)
  }
  return out.flat()
}

/**
 * Discovers the fields of a form, one entry per control (see {@link discover}).
 * @param form - The form.
 * @returns Every field control with its dot path, kind and shape (list items carry `index`).
 * @internal
 */
export function discoverFields(form: HTMLFormElement): DiscoveredField[] {
  return discover(form).fields.flatMap((f) =>
    f.controls.map((element, i) => ({
      path: f.path,
      element,
      kind: kindOf(element)!,
      shape: f.shape,
      ...(f.shape === 'list' ? { index: i } : {}),
    })),
  )
}

// ---------------------------------------------------------------------------------------------
// Values

/** @internal Reads one control's value (`undefined` = no value). */
export function readControl(el: HTMLElement): unknown {
  switch (kindOf(el)) {
    case 'custom': {
      const v = (el as unknown as { value?: unknown }).value
      return typeof v === 'string' ? v : undefined
    }
    case 'select': {
      const select = el as HTMLSelectElement
      if (select.multiple) {
        return Array.from(select.selectedOptions)
          .map((o) => o.value)
          .filter((v) => v !== '')
      }
      return select.value === '' ? undefined : select.value
    }
    case 'textarea':
      return (el as HTMLTextAreaElement).value
    case 'input': {
      const input = el as HTMLInputElement
      switch (inputType(el)) {
        case 'checkbox':
          return input.checked
        case 'radio':
          return input.checked ? input.value : undefined
        case 'number':
        case 'range': {
          if (input.value === '') return undefined
          const n = Number(input.value)
          return Number.isFinite(n) ? n : undefined
        }
        case 'file': {
          const files = Array.from(input.files ?? [])
          return input.multiple ? files : files[0]
        }
        default:
          return input.value
      }
    }
    default:
      return undefined
  }
}

/** @internal Reads a field's value. */
export function readField(field: FormField): unknown {
  switch (field.shape) {
    case 'single':
      return readControl(field.controls[0]!)
    case 'checkbox-group':
      return field.controls
        .filter((c) => (c as HTMLInputElement).checked)
        .map((c) => (c as HTMLInputElement).value)
    case 'radio-group':
      return (field.controls.find((c) => (c as HTMLInputElement).checked) as HTMLInputElement)
        ?.value
    case 'list':
      return field.controls.map(readControl)
  }
}

/** Calls the prototype's native setter so frameworks that wrap the property (React) see a change. */
function setNative(el: HTMLElement, proto: object, prop: string, value: unknown): void {
  // `Reflect.set` with `el` as receiver runs the prototype's accessor, not an own override.
  Reflect.set(proto, prop, value, el)
}

function dispatchInputAndChange(el: HTMLElement): void {
  el.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

/**
 * Sets a checkbox/radio `checked` state with `click()` (React derives `onChange` from it; the
 * activation fires `input` and `change`). When the page cancels or reverts the click, the control
 * is left as the page wants it (never forced). Unchecking a radio cannot be done by clicking, so
 * it uses the native setter.
 */
function setChecked(input: HTMLInputElement, checked: boolean): void {
  if (input.checked === checked) return
  if (input.type === 'radio' && !checked) {
    setNative(input, HTMLInputElement.prototype, 'checked', false)
    dispatchInputAndChange(input)
    return
  }
  input.click()
}

const scalar = (v: unknown): string | undefined =>
  typeof v === 'string'
    ? v
    : typeof v === 'number' || typeof v === 'boolean'
      ? String(v)
      : undefined

/**
 * @internal Writes one control; `null` / `undefined` clears it. Text-like controls go through the
 * prototype's native `value` setter, then bubbling `input` and `change` are dispatched.
 */
export function writeControl(el: HTMLElement, value: unknown): void {
  const clear = value === null || value === undefined
  switch (kindOf(el)) {
    case 'custom': {
      const v = clear ? '' : scalar(value)
      if (v === undefined) return
      ;(el as unknown as { value: string }).value = v
      dispatchInputAndChange(el)
      return
    }
    case 'select': {
      const select = el as HTMLSelectElement
      if (select.multiple) {
        const want = new Set((Array.isArray(value) ? value : []).map(scalar))
        for (const option of Array.from(select.options)) {
          setNative(option, HTMLOptionElement.prototype, 'selected', want.has(option.value))
        }
      } else {
        const v = clear ? '' : scalar(value)
        if (v === undefined) return
        setNative(select, HTMLSelectElement.prototype, 'value', v)
      }
      dispatchInputAndChange(select)
      return
    }
    case 'textarea': {
      const v = clear ? '' : scalar(value)
      if (v === undefined) return
      setNative(el, HTMLTextAreaElement.prototype, 'value', v)
      dispatchInputAndChange(el)
      return
    }
    case 'input': {
      const input = el as HTMLInputElement
      const type = inputType(el)
      if (type === 'checkbox') return setChecked(input, value === true)
      if (type === 'radio') return setChecked(input, !clear && scalar(value) === input.value)
      if (type === 'file') {
        const files = (Array.isArray(value) ? value : clear ? [] : [value]).filter(
          (f): f is File => f instanceof File,
        )
        const dt = new DataTransfer()
        for (const f of input.multiple ? files : files.slice(0, 1)) dt.items.add(f)
        setNative(input, HTMLInputElement.prototype, 'files', dt.files)
        dispatchInputAndChange(input)
        return
      }
      const v = clear ? '' : scalar(value)
      if (v === undefined) return
      setNative(input, HTMLInputElement.prototype, 'value', v)
      dispatchInputAndChange(input)
      return
    }
    default:
      return
  }
}

/** @internal Writes a field's value; `null` / `undefined` clears it. */
export function writeField(field: FormField, value: unknown): void {
  const clear = value === null || value === undefined
  switch (field.shape) {
    case 'single':
      writeControl(field.controls[0]!, value)
      return
    case 'checkbox-group': {
      const want = new Set((Array.isArray(value) ? value : []).map(scalar))
      for (const c of field.controls) {
        setChecked(c as HTMLInputElement, want.has((c as HTMLInputElement).value))
      }
      return
    }
    case 'radio-group': {
      const v = clear ? undefined : scalar(value)
      const target = field.controls.find((c) => (c as HTMLInputElement).value === v)
      if (target) setChecked(target as HTMLInputElement, true)
      else if (clear) {
        for (const c of field.controls) setChecked(c as HTMLInputElement, false)
      }
      return
    }
    case 'list': {
      const items = Array.isArray(value) ? (value as unknown[]) : []
      field.controls.forEach((c, i) => writeControl(c, items[i] ?? null))
      return
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Paths → nested values

/** @internal Keys `0..n-1` (any order): the node is an array. */
export function isDenseIndexKeys(keys: string[]): boolean {
  return keys.length > 0 && keys.every((k) => /^(?:0|[1-9]\d*)$/.test(k) && Number(k) < keys.length)
}

/** @internal A tree of path segments (leaves carry a value). */
export type PathTree<L> = Map<string, PathTree<L> | { leaf: L }>

/** @internal Builds a segment tree from `[path, leaf]` pairs (paths never collide, see {@link discover}). */
export function pathTree<L>(entries: Array<[string, L]>): PathTree<L> {
  const root: PathTree<L> = new Map()
  for (const [path, leaf] of entries) {
    const segs = path.split('.')
    let node = root
    segs.forEach((seg, i) => {
      if (i === segs.length - 1) {
        node.set(seg, { leaf })
        return
      }
      let next = node.get(seg)
      if (!(next instanceof Map)) node.set(seg, (next = new Map()))
      node = next
    })
  }
  return root
}

/**
 * @internal Nests `[path, value]` pairs: nodes whose keys are dense indexes become arrays, others
 * plain objects (the root is always an object). `undefined` values are omitted from objects.
 */
export function nestValues(entries: Array<[string, unknown]>): Record<string, unknown> {
  const build = (tree: PathTree<unknown>, root: boolean): unknown => {
    const keys = [...tree.keys()]
    const valueOf = (k: string): unknown => {
      const child = tree.get(k)!
      return child instanceof Map ? build(child, false) : child.leaf
    }
    if (!root && isDenseIndexKeys(keys)) {
      return keys
        .map(Number)
        .sort((a, b) => a - b)
        .map((i) => valueOf(String(i)))
    }
    const out: Record<string, unknown> = {}
    for (const k of keys) {
      const v = valueOf(k)
      if (v !== undefined) {
        Object.defineProperty(out, k, {
          value: v,
          enumerable: true,
          writable: true,
          configurable: true,
        })
      }
    }
    return out
  }
  return build(pathTree(entries), true) as Record<string, unknown>
}

// ---------------------------------------------------------------------------------------------
// Labels

const SKIP_IN_LABEL = new Set([
  'input',
  'select',
  'textarea',
  'button',
  'script',
  'style',
  'template',
])

function textOf(node: Node, control: Element): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
  if (node.nodeType !== Node.ELEMENT_NODE) return ''
  const el = node as Element
  if (el === control || SKIP_IN_LABEL.has(el.localName) || el.hasAttribute('data-tool-ignore')) {
    return ''
  }
  return Array.from(el.childNodes, (c) => textOf(c, control)).join('')
}

/** Labels inside these regions are page/user content, never field descriptions. */
const UNTRUSTED_LABEL_REGION = '[data-tool-ignore],[contenteditable]:not([contenteditable="false"])'

/**
 * @internal The text of a control's associated `<label>`s (nested controls and
 * `[data-tool-ignore]` content left out, whitespace collapsed, capped at {@link MAX_DESCRIPTION}),
 * or `''`. Labels under `[data-tool-ignore]` or an editable (`contenteditable`) region are dropped;
 * when `form` is given and some labels are inside it, only those count.
 */
export function labelText(el: HTMLElement, form?: HTMLFormElement): string {
  let labels: Element[]
  const own = (el as HTMLInputElement).labels as NodeListOf<HTMLLabelElement> | null | undefined
  if (own) {
    labels = Array.from(own)
  } else {
    // Custom elements expose labels only through their ElementInternals.
    labels = []
    const wrapping = el.closest('label')
    if (wrapping) labels.push(wrapping)
    if (el.id) {
      const root = rootOf(el)
      for (const l of Array.from(root.querySelectorAll(`label[for="${CSS.escape(el.id)}"]`))) {
        if (!labels.includes(l)) labels.push(l)
      }
    }
  }
  labels = labels.filter((l) => l.closest(UNTRUSTED_LABEL_REGION) === null)
  if (form) {
    const inside = labels.filter((l) => containsNode(form, l))
    if (inside.length > 0) labels = inside
  }
  const text = labels
    .map((l) => textOf(l, el))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  return cap(text, MAX_DESCRIPTION)
}
