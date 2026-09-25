import { fileFieldSchema, type FileFieldSpec } from '../files.js'
import { unsafePatternReason } from '../json-schema/pattern-safety.js'
import type { JsonSchema } from '../tool.js'
import {
  cap,
  discover,
  getAttr,
  inputType,
  isDenseIndexKeys,
  isReadOnly,
  kindOf,
  labelText,
  MAX_DESCRIPTION,
  MAX_OPTION_TITLE,
  pathTree,
  type FormField,
  type PathTree,
  type SkippedControl,
} from './elements.js'

/**
 * `datetime-local` value shape (the browser's normalized form; seconds, and milliseconds after
 * seconds, optional). Written as an unquantified alternation because the brief's nested form
 * `(:\d{2}(\.\d{1,3})?)?` is rejected by the validator's ReDoS check (same language).
 */
const DATETIME_LOCAL_PATTERN = '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}(|:\\d{2}|:\\d{2}\\.\\d{1,3})$'

const STRING_CONSTRAINED = new Set(['text', 'search', 'url', 'tel', 'email', 'password'])

/** @internal Everything a scanner needs to turn a DOM form into form tools. */
export interface SynthesizedForm {
  /** The advertised JSON Schema (file fields as `fileFieldSchema`), see {@link synthesizeFormSchema}. */
  schema: JsonSchema
  /**
   * The schema to validate filled values with: `schema` with every file field replaced by `{}`
   * (resolved `File`s are checked by the file pipeline, not by JSON Schema).
   */
  validationSchema: JsonSchema
  /** File fields by dot path, for `FormToolOptions.files`. */
  files: Record<string, FileFieldSpec>
  /**
   * Named controls left out (invalid names, colliding paths, read-only fields — reason
   * `read-only`) and `pattern`s that were dropped.
   */
  skipped: SkippedControl[]
}

interface Leaf {
  schema: JsonSchema
  required: boolean
  file?: FileFieldSpec
}

const collapse = (s: string): string => s.replace(/\s+/g, ' ').trim()
/** Page text used as a description: collapsed and capped. */
const pageText = (s: string): string => cap(collapse(s), MAX_DESCRIPTION)

function attrNumber(el: Element, name: string): number | undefined {
  const raw = el.getAttribute(name)
  if (raw === null || raw.trim() === '') return undefined
  const n = Number(raw)
  return Number.isFinite(n) ? n : undefined
}

function attrLength(el: Element, name: string): number | undefined {
  const n = attrNumber(el, name)
  return n !== undefined && Number.isInteger(n) && n >= 0 ? n : undefined
}

function isMultipleOf(value: number, step: number): boolean {
  const r = value / step
  return Math.abs(r - Math.round(r)) < 1e-9
}

/**
 * Field description (each source capped at {@link MAX_DESCRIPTION} characters):
 * `toolparamdescription` → form `data-tool-param-<name>` → label → `aria-description`.
 */
function describe(field: FormField, form: HTMLFormElement): string {
  for (const c of field.controls) {
    const own = getAttr(c, 'toolparamdescription')
    if (own !== null && collapse(own) !== '') return pageText(own)
  }
  // Through the prototype: a control named `getAttribute` clobbers the form's own.
  const fromForm = getAttr(form, `data-tool-param-${field.name}`)
  if (fromForm !== null && collapse(fromForm) !== '') return pageText(fromForm)
  // Labels of radios / grouped checkboxes are option titles, not the field's description.
  if (field.shape === 'single' || field.shape === 'list') {
    const label = labelText(field.controls[0]!, form)
    if (label !== '') return label
  }
  for (const c of field.controls) {
    const aria = getAttr(c, 'aria-description')
    if (aria !== null && collapse(aria) !== '') return pageText(aria)
  }
  return ''
}

/** Options of a select (`value=""` placeholders and disabled options excluded). */
function selectOptions(
  select: HTMLSelectElement,
): Array<{ value: string; title: string; selected: boolean }> {
  const seen = new Set<string>()
  const out: Array<{ value: string; title: string; selected: boolean }> = []
  for (const o of Array.from(select.options)) {
    if (o.value === '' || o.matches(':disabled') || seen.has(o.value)) continue
    seen.add(o.value)
    out.push({
      value: o.value,
      title: cap(collapse(o.label) || o.value, MAX_OPTION_TITLE),
      selected: o.defaultSelected,
    })
  }
  return out
}

const optionsText = (options: Array<{ value: string; title: string }>): string =>
  options.length === 0 ? '' : `Options: ${options.map((o) => `${o.value} = ${o.title}`).join('; ')}`

/** The value a single select shows at load (last `selected` option, else the first option). */
function selectLoadValue(select: HTMLSelectElement): string | undefined {
  const options = Array.from(select.options)
  const selected = options.filter((o) => o.defaultSelected)
  const chosen =
    selected.length > 0 ? selected[selected.length - 1] : options.find((o) => !o.disabled)
  return chosen && chosen.value !== '' ? chosen.value : undefined
}

/** Schema of one control (no description, no default), plus its load-time default. */
function controlSchema(
  el: HTMLElement,
  path: string,
  skipped: SkippedControl[],
): { schema: JsonSchema; loadDefault?: unknown; extra?: string; file?: FileFieldSpec } {
  const kind = kindOf(el)
  if (kind === 'custom') return { schema: { type: 'string' } }
  if (kind === 'select') {
    const select = el as HTMLSelectElement
    const options = selectOptions(select)
    const values = options.map((o) => o.value)
    if (select.multiple) {
      const defaults = options.filter((o) => o.selected).map((o) => o.value)
      return {
        schema: { type: 'array', items: { enum: values }, uniqueItems: true },
        ...(defaults.length > 0 ? { loadDefault: defaults } : {}),
        extra: optionsText(options),
      }
    }
    const load = selectLoadValue(select)
    return {
      schema: { enum: values },
      ...(load !== undefined && values.includes(load) ? { loadDefault: load } : {}),
      extra: optionsText(options),
    }
  }
  if (kind === 'textarea') {
    const ta = el as HTMLTextAreaElement
    const schema: JsonSchema = { type: 'string' }
    const min = attrLength(el, 'minlength')
    const max = attrLength(el, 'maxlength')
    if (min !== undefined) schema.minLength = min
    if (max !== undefined) schema.maxLength = max
    return { schema, ...(ta.defaultValue !== '' ? { loadDefault: ta.defaultValue } : {}) }
  }
  const input = el as HTMLInputElement
  const type = inputType(el)
  switch (type) {
    case 'checkbox':
      return { schema: { type: 'boolean' }, ...(input.defaultChecked ? { loadDefault: true } : {}) }
    case 'number':
    case 'range': {
      const stepAttr = el.getAttribute('step')
      let step: number | 'any' = 1
      let explicit = false
      if (stepAttr !== null) {
        if (stepAttr.trim().toLowerCase() === 'any') step = 'any'
        else {
          const n = Number(stepAttr)
          if (stepAttr.trim() !== '' && Number.isFinite(n) && n > 0) {
            step = n
            explicit = true
          }
        }
      }
      const min = attrNumber(el, 'min')
      const max = attrNumber(el, 'max')
      const integer =
        step !== 'any' && Number.isInteger(step) && (min === undefined || Number.isInteger(min))
      const schema: JsonSchema = { type: integer ? 'integer' : 'number' }
      if (min !== undefined) schema.minimum = min
      if (max !== undefined) schema.maximum = max
      if (explicit && step !== 'any' && (min === undefined || isMultipleOf(min, step))) {
        schema.multipleOf = step
      }
      const d = input.defaultValue.trim() === '' ? NaN : Number(input.defaultValue)
      return { schema, ...(Number.isFinite(d) ? { loadDefault: d } : {}) }
    }
    case 'date':
    case 'time':
    case 'datetime-local': {
      const schema: JsonSchema =
        type === 'datetime-local'
          ? { type: 'string', pattern: DATETIME_LOCAL_PATTERN }
          : { type: 'string', format: type }
      const bounds = [
        ...(input.min !== '' ? [`min ${input.min}`] : []),
        ...(input.max !== '' ? [`max ${input.max}`] : []),
      ]
      return {
        schema,
        ...(input.defaultValue !== '' ? { loadDefault: input.defaultValue } : {}),
        extra: bounds.length > 0 ? `(${bounds.join(', ')})` : '',
      }
    }
    case 'file': {
      const accept = (el.getAttribute('accept') ?? '')
        .split(',')
        .map((a) => a.trim().toLowerCase())
        .filter((a) => /^[\w.+-]+\/(?:[\w.+-]+|\*)$/.test(a))
      const spec: FileFieldSpec = {
        ...(accept.length > 0 ? { accept } : {}),
        ...(input.multiple ? { multiple: true } : {}),
      }
      return { schema: fileFieldSchema(spec), file: spec }
    }
    default: {
      const schema: JsonSchema = { type: 'string' }
      if (type === 'email') schema.format = 'email'
      if (type === 'url') schema.format = 'uri'
      if (STRING_CONSTRAINED.has(type)) {
        const min = attrLength(el, 'minlength')
        const max = attrLength(el, 'maxlength')
        if (min !== undefined) schema.minLength = min
        if (max !== undefined) schema.maxLength = max
        const pattern = el.getAttribute('pattern')
        if (pattern !== null) {
          const reason = patternProblem(pattern)
          if (reason === undefined) schema.pattern = `^(?:${pattern})$`
          else skipped.push({ path, reason: `pattern dropped: ${reason}` })
        }
      }
      return { schema, ...(input.defaultValue !== '' ? { loadDefault: input.defaultValue } : {}) }
    }
  }
}

/** Why a page `pattern` cannot be advertised (`undefined` when it can). */
function patternProblem(pattern: string): string | undefined {
  const wrapped = `^(?:${pattern})$`
  try {
    // The browser compiles `pattern` with the `v` flag and ignores it when that fails.
    new RegExp(pattern, 'v')
    new RegExp(wrapped, 'u')
  } catch {
    return 'invalid regular expression'
  }
  return unsafePatternReason(wrapped)
}

const withDescription = (schema: JsonSchema, ...parts: Array<string | undefined>): JsonSchema => {
  const text = parts.filter((p): p is string => p !== undefined && p !== '').join(' ')
  return text === '' ? schema : { ...schema, description: text }
}

function fieldLeaf(field: FormField, form: HTMLFormElement, skipped: SkippedControl[]): Leaf {
  const base = describe(field, form)
  const first = field.controls[0]!
  const isRequired = (el: HTMLElement): boolean =>
    kindOf(el) !== 'custom' && (el as HTMLInputElement).required
  switch (field.shape) {
    case 'single': {
      const c = controlSchema(first, field.path, skipped)
      let schema: JsonSchema
      if (c.file) {
        // Keep the file limits description; put the field's own description first.
        const desc = (c.schema.description as string | undefined) ?? ''
        schema = base === '' ? c.schema : { ...c.schema, description: `${base} ${desc}`.trim() }
      } else {
        schema = withDescription(c.schema, base, c.extra)
      }
      if (c.loadDefault !== undefined) schema = { ...schema, default: c.loadDefault }
      return { schema, required: isRequired(first), ...(c.file ? { file: c.file } : {}) }
    }
    case 'checkbox-group': {
      const values = [...new Set(field.controls.map((c) => (c as HTMLInputElement).value))]
      const defaults = field.controls
        .filter((c) => (c as HTMLInputElement).defaultChecked)
        .map((c) => (c as HTMLInputElement).value)
      let schema = withDescription(
        { type: 'array', items: { enum: values }, uniqueItems: true },
        base,
      )
      if (defaults.length > 0) schema = { ...schema, default: defaults }
      return { schema, required: false }
    }
    case 'radio-group': {
      const options: Array<{ value: string; title: string }> = []
      for (const c of field.controls) {
        const value = (c as HTMLInputElement).value
        if (value === '' || options.some((o) => o.value === value)) continue
        options.push({ value, title: cap(labelText(c, form) || value, MAX_OPTION_TITLE) })
      }
      const checked = field.controls.find((c) => (c as HTMLInputElement).defaultChecked)
      let schema = withDescription(
        { enum: options.map((o) => o.value) },
        base,
        optionsText(options),
      )
      const d = (checked as HTMLInputElement | undefined)?.value
      if (d !== undefined && d !== '') schema = { ...schema, default: d }
      return { schema, required: field.controls.some(isRequired) }
    }
    case 'list': {
      const items = field.controls.map((c) => controlSchema(c, field.path, skipped))
      const item = items[0]!
      let schema = withDescription(
        { type: 'array', items: item.schema, maxItems: field.controls.length },
        base,
        item.extra,
      )
      if (items.some((i) => i.loadDefault !== undefined)) {
        schema = { ...schema, default: items.map((i) => i.loadDefault ?? null) }
      }
      return { schema, required: false }
    }
  }
}

function stripDefaults(schema: JsonSchema): JsonSchema {
  const out: JsonSchema = {}
  for (const [k, v] of Object.entries(schema)) {
    if (k === 'default') continue
    if (k === 'properties' && typeof v === 'object' && v !== null) {
      out[k] = Object.fromEntries(
        Object.entries(v as Record<string, JsonSchema>).map(([p, s]) => [p, stripDefaults(s)]),
      )
    } else if (k === 'items' && typeof v === 'object' && v !== null) {
      out[k] = stripDefaults(v as JsonSchema)
    } else {
      out[k] = v
    }
  }
  return out
}

/** Array items of an indexed node: object items merge (property union, `required` intersection). */
function mergeItems(items: JsonSchema[]): JsonSchema {
  const stripped = items.map(stripDefaults)
  if (!stripped.every((s) => s.type === 'object')) return stripped[0]!
  const properties: Record<string, JsonSchema> = {}
  for (const s of stripped) {
    for (const [k, v] of Object.entries(s.properties as Record<string, JsonSchema>)) {
      if (!Object.hasOwn(properties, k)) properties[k] = v
    }
  }
  const requiredSets = stripped.map((s) => new Set((s.required as string[] | undefined) ?? []))
  const required = [...requiredSets[0]!].filter((k) => requiredSets.every((r) => r.has(k)))
  return {
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: false,
  }
}

function treeSchema(
  tree: PathTree<Leaf>,
  root: boolean,
): { schema: JsonSchema; required: boolean } {
  const keys = [...tree.keys()]
  const childOf = (k: string): { schema: JsonSchema; required: boolean } => {
    const child = tree.get(k)!
    return child instanceof Map ? treeSchema(child, false) : child.leaf
  }
  if (!root && isDenseIndexKeys(keys)) {
    const items = keys
      .map(Number)
      .sort((a, b) => a - b)
      .map((i) => childOf(String(i)).schema)
    return {
      schema: { type: 'array', items: mergeItems(items), maxItems: keys.length },
      required: false,
    }
  }
  const properties: Record<string, JsonSchema> = {}
  const required: string[] = []
  for (const k of keys) {
    const c = childOf(k)
    Object.defineProperty(properties, k, {
      value: c.schema,
      enumerable: true,
      writable: true,
      configurable: true,
    })
    if (c.required) required.push(k)
  }
  return {
    schema: {
      type: 'object',
      properties,
      ...(required.length > 0 ? { required } : {}),
      additionalProperties: false,
    },
    required: false,
  }
}

/**
 * @internal Synthesizes a form's schemas and file specs (see {@link synthesizeFormSchema}).
 * @param form - The form.
 */
export function synthesizeForm(form: HTMLFormElement): SynthesizedForm {
  const discovered = discover(form)
  const skipped = discovered.skipped
  // Read-only fields are context, not inputs: left out of the schema (so
  // `additionalProperties: false` rejects their paths) and reported.
  const fields = discovered.fields.filter((f) => {
    if (!f.controls.some(isReadOnly)) return true
    skipped.push({ path: f.name, reason: 'read-only' })
    return false
  })
  const leaves: Array<[string, Leaf]> = fields.map((f) => [f.path, fieldLeaf(f, form, skipped)])
  const files: Record<string, FileFieldSpec> = {}
  for (const [path, leaf] of leaves) {
    if (leaf.file)
      Object.defineProperty(files, path, {
        value: leaf.file,
        enumerable: true,
        writable: true,
        configurable: true,
      })
  }
  const schema = treeSchema(pathTree(leaves), true).schema
  const validationLeaves: Array<[string, Leaf]> = leaves.map(([path, leaf]) => [
    path,
    leaf.file ? { schema: {}, required: leaf.required } : leaf,
  ])
  const validationSchema = treeSchema(pathTree(validationLeaves), true).schema
  return { schema, validationSchema, files, skipped }
}

/**
 * Synthesizes a JSON Schema (draft 2020-12, the `fromJsonSchema` subset) for a DOM form (spec
 * §10.2). Only fields count: named controls of `form.elements`, minus hidden, password, `cc-*`
 * (and other secret `autocomplete` tokens), disabled, read-only and `[data-tool-ignore]` controls. Text controls map to strings with
 * `minLength`/`maxLength` and an anchored `pattern` (a pattern that is invalid or fails the ReDoS
 * safety check is left out); `email`/`url` add `format`; `number`/`range` map to `integer` or
 * `number` from `step` and `min`, with `minimum`/`maximum`/`multipleOf`; dates and times get a
 * format (or pattern) and their `min`/`max` in the description; checkboxes map to a boolean, or
 * an array of unique values when they share a name; radios and selects to an `enum` whose titles
 * are listed in the description (`"Options: <value> = <label>; …"`); `select[multiple]` to an
 * array; files to {@link fileFieldSchema}. `required` attributes become `required`, load-time
 * values `default`, and every object has `additionalProperties: false`. Descriptions come from
 * `toolparamdescription`, the form's `data-tool-param-<name>`, the control's `<label>`, then
 * `aria-description` (each capped at 500 characters, option titles at 200; labels inside
 * `[data-tool-ignore]` or editable regions are ignored) — the form must be app-authored markup
 * (spec §14).
 * @param form - The form to describe.
 * @returns The form values' JSON Schema.
 */
export function synthesizeFormSchema(form: HTMLFormElement): JsonSchema {
  return synthesizeForm(form).schema
}
