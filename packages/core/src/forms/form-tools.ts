import type { Toolmark } from '../registry.js'
import { registryState } from '../registry.js'
import { invalid, ok, type FieldChange, type ToolResult } from '../result.js'
import { resolveJsonSchema, stripRequired, validateInput } from '../schema.js'
import type { Scope } from '../scope.js'
import type { StandardSchemaV1 } from '../standard-schema.js'
import type { JsonSchema } from '../tool.js'
import {
  deepEqual,
  flatten,
  flattenWithRejected,
  getPath,
  isPlainObject,
  setPath,
} from './paths.js'
import type { FieldInfo, FormAdapter, FormToolOptions } from './types.js'

const REDACTED = '[redacted]'

interface FillInput {
  values: Record<string, unknown>
  overwrite?: boolean
}

/** Strict validator for the `fill` tool's own input shape. */
const fillInputSchema: StandardSchemaV1<unknown, FillInput> = {
  '~standard': {
    version: 1,
    vendor: 'toolmark',
    validate(value) {
      if (!isPlainObject(value)) return { issues: [{ message: 'Expected an object' }] }
      const issues: { message: string; path: PropertyKey[] }[] = []
      for (const key of Object.keys(value)) {
        if (key !== 'values' && key !== 'overwrite') {
          issues.push({ message: 'Unknown field', path: [key] })
        }
      }
      if (!isPlainObject(value.values)) {
        issues.push({ message: 'Expected an object of field values', path: ['values'] })
      }
      if (value.overwrite !== undefined && typeof value.overwrite !== 'boolean') {
        issues.push({ message: 'Expected a boolean', path: ['overwrite'] })
      }
      if (issues.length > 0) return { issues }
      const out: FillInput = { values: value.values as Record<string, unknown> }
      if (typeof value.overwrite === 'boolean') out.overwrite = value.overwrite
      return { value: out }
    },
  },
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Every property path the JSON Schema declares (object nodes and leaves). */
function declaredPaths(root: JsonSchema): Set<string> {
  const out = new Set<string>()
  const deref = (node: unknown): unknown => {
    if (!isRecord(node) || typeof node.$ref !== 'string') return node
    const m = /^#\/(\$defs|definitions)\/(.+)$/.exec(node.$ref)
    const defs = m ? root[m[1]!] : undefined
    return m && isRecord(defs) ? defs[m[2]!] : node
  }
  const walk = (raw: unknown, prefix: string, depth: number): void => {
    const node = deref(raw)
    if (!isRecord(node) || depth > 32) return
    for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
      const branches = node[key]
      if (Array.isArray(branches)) for (const b of branches) walk(b, prefix, depth + 1)
    }
    if (isRecord(node.properties)) {
      for (const [key, child] of Object.entries(node.properties)) {
        const path = prefix === '' ? key : `${prefix}.${key}`
        out.add(path)
        walk(child, path, depth + 1)
      }
    }
  }
  walk(root, '', 0)
  return out
}

/** The `fill` manifest schema (M1 rulings): input schema without `required`, `$defs` hoisted. */
function fillJsonSchema(inputSchema: JsonSchema): JsonSchema {
  const values = stripRequired(inputSchema)
  const defs = values.$defs
  delete values.$defs
  delete values.$schema
  const schema: JsonSchema = {
    type: 'object',
    properties: { values, overwrite: { type: 'boolean' } },
    required: ['values'],
  }
  if (defs !== undefined) schema.$defs = defs
  return schema
}

function isSensitiveElement(el: Element | null | undefined): boolean {
  if (!el || typeof el !== 'object') return false
  const loose = el as unknown as {
    tagName?: unknown
    type?: unknown
    autocomplete?: unknown
    getAttribute?: (name: string) => string | null
  }
  const attr = (name: string): unknown =>
    typeof loose.getAttribute === 'function' ? loose.getAttribute(name) : null
  const type = attr('type') ?? loose.type
  if (
    typeof loose.tagName === 'string' &&
    loose.tagName.toUpperCase() === 'INPUT' &&
    typeof type === 'string' &&
    type.toLowerCase() === 'password'
  ) {
    return true
  }
  const ac = attr('autocomplete') ?? loose.autocomplete
  return (
    typeof ac === 'string' &&
    ac
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .some((token) => token.startsWith('cc-'))
  )
}

function sensitivePaths(opts: { sensitive?: string[] }, fields: FieldInfo[]): string[] {
  const out = [...(opts.sensitive ?? [])]
  for (const f of fields)
    if (f.sensitive === true || isSensitiveElement(f.element)) out.push(f.path)
  return out
}

function isUnder(path: string, base: string): boolean {
  return path === base || path.startsWith(`${base}.`)
}

function redact(changes: FieldChange[], sensitive: string[]): FieldChange[] {
  return changes.map((c) =>
    sensitive.some((s) => isUnder(c.path, s))
      ? { path: c.path, before: REDACTED, after: REDACTED }
      : c,
  )
}

const byPath = (a: { path: string }, b: { path: string }): number =>
  a.path < b.path ? -1 : a.path > b.path ? 1 : 0

/**
 * Registers `<name>.fill` (partial, skips user-edited fields, undoable) and `<name>.submit`
 * (`consequential`) for a form (spec §8.1, D19).
 * @param tm - The registry.
 * @param adapter - The form adapter.
 * @param opts - Form tool options plus an optional target `scope`.
 * @returns A handle whose `dispose()` removes both tools.
 */
export function createFormTools<V extends Record<string, unknown>>(
  tm: Toolmark,
  adapter: FormAdapter<V>,
  opts: FormToolOptions<V> & { scope?: Scope },
): { dispose(): void } {
  const state = registryState(tm)
  const fillName = `${opts.name}.fill`

  let inputSchema: JsonSchema = {}
  const resolved = resolveJsonSchema(
    {
      name: fillName,
      description: opts.description,
      input: opts.input,
      ...(opts.jsonSchema !== undefined ? { jsonSchema: opts.jsonSchema } : {}),
      run: () => ok(null),
    },
    state?.options.jsonSchema,
  )
  if (resolved.ok) {
    inputSchema = resolved.schema
  } else if (state?.browser) {
    state.fail(
      'schema_conversion_failed',
      `Form "${opts.name}": cannot derive a JSON Schema for its input (${resolved.reason}). ` +
        `Set the form's jsonSchema or a global jsonSchema converter.`,
      fillName,
    )
  }
  const declared = declaredPaths(inputSchema)

  /** The value the agent last stored at each path (as read back from the adapter). */
  const agentSet = new Map<string, unknown>()

  const isUserEdited = (path: string, current: unknown, dirty: string[]): boolean => {
    if (!dirty.some((d) => isUnder(path, d))) return false
    return !agentSet.has(path) || !deepEqual(current, agentSet.get(path))
  }

  async function fill(
    input: FillInput,
    registerUndo: (restore: () => ToolResult<unknown>) => void,
  ) {
    const { values: flat, rejected } = flattenWithRejected(input.values)
    if (rejected.length > 0) {
      return invalid(rejected.sort().map((path) => ({ path, message: 'Invalid field path' })))
    }
    const current = adapter.getValues()
    const dirty = adapter.dirtyPaths()
    const skipped: string[] = []
    const touched: string[] = []
    for (const path of Object.keys(flat)) {
      if (flat[path] === undefined) continue
      if (input.overwrite !== true && isUserEdited(path, getPath(current, path), dirty)) {
        skipped.push(path)
      } else {
        touched.push(path)
      }
    }

    // Merge-based validation: only issues on touched paths count (M1 rulings).
    let merged: unknown = current
    for (const path of touched)
      merged = setPath(merged, path, flat[path] === null ? undefined : flat[path])
    const checked = await validateInput(opts.input, merged)
    if (!checked.ok) {
      const relevant = checked.issues.filter((i) => touched.some((p) => isUnder(i.path, p)))
      if (relevant.length > 0) return invalid(relevant)
    }

    // Declared paths only (spec §14).
    const parsedPaths = checked.ok
      ? new Set(Object.keys(flatten(checked.value)))
      : new Set<string>()
    const unknown = touched.filter((p) => !declared.has(p) && !parsedPaths.has(p))
    if (unknown.length > 0) {
      return invalid(unknown.sort().map((path) => ({ path, message: 'Unknown field' })))
    }

    const before = new Map(touched.map((p) => [p, getPath(current, p)] as const))
    const toWrite: Record<string, unknown> = {}
    for (const path of touched) {
      const next = flat[path]
      const prev = before.get(path)
      const changes = next === null ? prev !== undefined && prev !== null : !deepEqual(prev, next)
      if (changes) toWrite[path] = next
    }
    if (Object.keys(toWrite).length > 0) adapter.setValues(toWrite, { source: 'agent' })
    const after = adapter.getValues()
    const changes: FieldChange[] = []
    const stored = new Map<string, unknown>()
    for (const path of touched) {
      const value = getPath(after, path)
      agentSet.set(path, value)
      stored.set(path, value)
      if (!deepEqual(before.get(path), value)) {
        changes.push({ path, before: before.get(path), after: value })
      }
    }

    if (changes.length > 0) {
      const restorable = changes.map((c) => c.path)
      registerUndo(() => {
        const now = adapter.getValues()
        const restore: Record<string, unknown> = {}
        const undoSkipped: string[] = []
        for (const path of restorable) {
          if (deepEqual(getPath(now, path), stored.get(path))) {
            const prev = before.get(path)
            restore[path] = prev === undefined ? null : prev
          } else {
            undoSkipped.push(path)
          }
        }
        if (Object.keys(restore).length > 0) adapter.setValues(restore, { source: 'undo' })
        const restored = adapter.getValues()
        const undoChanges: FieldChange[] = []
        for (const path of Object.keys(restore)) {
          agentSet.delete(path)
          undoChanges.push({ path, before: getPath(now, path), after: getPath(restored, path) })
        }
        return ok({
          changes: redact(undoChanges, sensitivePaths(opts, adapter.fields())).sort(byPath),
          skipped: undoSkipped.sort(),
        })
      })
    }

    return ok({
      changes: redact(changes, sensitivePaths(opts, adapter.fields())).sort(byPath),
      skipped: skipped.sort(),
    })
  }

  const title = opts.title !== undefined ? { title: opts.title } : {}
  const fillReg = tm.register(
    {
      name: fillName,
      ...title,
      description:
        `${opts.description} Fill form fields: pass a partial object in "values" (null clears a ` +
        `field). Fields the user edited are skipped unless "overwrite" is true.`,
      input: fillInputSchema,
      jsonSchema: fillJsonSchema(inputSchema),
      run: (input, ctx) => fill(input, (restore) => ctx.registerUndo(restore)),
    },
    opts.scope ? { scope: opts.scope } : undefined,
  )
  let submitReg: { dispose(): void }
  try {
    submitReg = tm.register(
      {
        name: `${opts.name}.submit`,
        ...title,
        description: `${opts.description} Submit the form.`,
        hints: { consequential: true },
        summary: () =>
          opts.submitSummary?.(adapter.getValues()) ?? `Submit ${opts.title ?? opts.name}`,
        run: () => adapter.submit(),
      },
      opts.scope ? { scope: opts.scope } : undefined,
    )
  } catch (e) {
    fillReg.dispose()
    throw e
  }
  return {
    dispose() {
      fillReg.dispose()
      submitReg.dispose()
    },
  }
}
