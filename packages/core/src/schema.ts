import type { StandardSchemaV1 } from './standard-schema.js'
import type { JsonSchema, ToolDefinition } from './tool.js'

/**
 * Global JSON Schema converter for input schemas that do not implement Standard JSON Schema
 * (e.g. zod 3 with `zod-to-json-schema`). Return `undefined` when the schema is not supported.
 */
export type JsonSchemaConverter = (schema: StandardSchemaV1) => JsonSchema | undefined

type Issue = { path: string; message: string }

/** Joins Standard Schema path segments with `.`; root issues use `""`. */
function issuePath(path: StandardSchemaV1.Issue['path']): string {
  if (!path || path.length === 0) return ''
  return path
    .map((seg) => {
      const key = typeof seg === 'object' && seg !== null ? seg.key : seg
      return typeof key === 'symbol' ? (key.description ?? '') : String(key)
    })
    .join('.')
}

/**
 * Validates `value` with a Standard Schema (awaiting async validators).
 * @internal
 */
export async function validateInput<T>(
  schema: StandardSchemaV1<unknown, T> | undefined,
  value: unknown,
): Promise<{ ok: true; value: T } | { ok: false; issues: Issue[] }> {
  if (!schema) return { ok: true, value: value as T }
  const result = await schema['~standard'].validate(value)
  if (result.issues) {
    return {
      ok: false,
      issues: result.issues.map((i) => ({ path: issuePath(i.path), message: i.message })),
    }
  }
  return { ok: true, value: result.value }
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Resolves a tool's input JSON Schema (spec §6): `tool.jsonSchema` → the schema's Standard JSON
 * Schema (`draft-2020-12`, with `opts.libraryOptions` passed through, e.g. zod's
 * `{ unrepresentable: 'any' }`) → the global `converter` → failure (with a reason).
 * @internal
 */
export function resolveJsonSchema(
  tool: ToolDefinition,
  converter: JsonSchemaConverter | undefined,
  opts?: { libraryOptions?: Record<string, unknown> },
): { ok: true; schema: JsonSchema } | { ok: false; reason: string } {
  if (tool.jsonSchema) return { ok: true, schema: tool.jsonSchema }
  const input = tool.input
  if (!input) {
    return { ok: true, schema: { type: 'object', properties: {}, additionalProperties: false } }
  }
  const reasons: string[] = []
  const props = (input as Partial<StandardSchemaV1>)['~standard'] as unknown
  if (typeof props !== 'object' || props === null) {
    return { ok: false, reason: 'input is not a Standard Schema (no "~standard" property)' }
  }
  const std = (input['~standard'] as { jsonSchema?: { input?: unknown } }).jsonSchema
  if (std && typeof std.input === 'function') {
    try {
      const out: unknown = (
        std.input as (o: { target: string; libraryOptions?: Record<string, unknown> }) => unknown
      )({
        target: 'draft-2020-12',
        ...(opts?.libraryOptions !== undefined ? { libraryOptions: opts.libraryOptions } : {}),
      })
      if (isRecord(out)) return { ok: true, schema: out }
      reasons.push('Standard JSON Schema returned no object')
    } catch (e) {
      reasons.push(`Standard JSON Schema failed: ${message(e)}`)
    }
  }
  if (converter) {
    try {
      const out = converter(input)
      if (isRecord(out)) return { ok: true, schema: out }
      reasons.push('jsonSchema converter returned no schema')
    } catch (e) {
      reasons.push(`jsonSchema converter failed: ${message(e)}`)
    }
  } else {
    reasons.push('no global jsonSchema converter configured')
  }
  return { ok: false, reason: reasons.join('; ') }
}

const SCHEMA_MAPS = ['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas']
const SCHEMA_LISTS = ['anyOf', 'oneOf', 'allOf', 'prefixItems']
const SCHEMA_SINGLE = [
  'items',
  'additionalProperties',
  'not',
  'if',
  'then',
  'else',
  'contains',
  'propertyNames',
  'unevaluatedProperties',
  'unevaluatedItems',
]

function strip(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strip)
  if (!isRecord(node)) return node
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(node)) {
    if (key === 'required' && Array.isArray(value)) continue
    if (SCHEMA_MAPS.includes(key) && isRecord(value)) {
      const map: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(value)) map[k] = strip(v)
      out[key] = map
    } else if (SCHEMA_LISTS.includes(key) && Array.isArray(value)) {
      out[key] = value.map(strip)
    } else if (SCHEMA_SINGLE.includes(key)) {
      out[key] = strip(value)
    } else {
      out[key] = structuredClone(value)
    }
  }
  return out
}

/**
 * Returns a copy of `schema` with every `required` array removed recursively (subschemas under
 * `properties`, `items`, `anyOf`/`oneOf`/`allOf`, `$defs`, …). Does not mutate its argument.
 * @internal
 */
export function stripRequired(schema: JsonSchema): JsonSchema {
  return strip(schema) as JsonSchema
}
