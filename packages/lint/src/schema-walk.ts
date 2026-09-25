import type { JsonSchema } from '@toolmark/core'

/** One leaf reached by {@link walkLeaves}: a schema node with no nested `properties`. */
export interface SchemaLeaf {
  /** Dot path from the walk's start point (`''` when the start point is itself a leaf). */
  path: string
  /** The leaf schema node. */
  node: JsonSchema
}

/**
 * A schema node is a container exactly when it declares `properties` and its `type` is
 * `"object"` (rule brief wording: a leaf is "no `properties`, or `type` ≠ `object`").
 */
export function isContainer(node: JsonSchema): boolean {
  const properties = node['properties']
  return Boolean(properties && typeof properties === 'object') && node['type'] === 'object'
}

/**
 * Walks a schema's `properties` tree, calling `visit` once per leaf with its dot path relative
 * to `prefix`. Numeric/array segments are not descended into (only object `properties`).
 */
export function walkLeaves(
  node: JsonSchema,
  prefix: string,
  visit: (leaf: SchemaLeaf) => void,
): void {
  if (!isContainer(node)) {
    visit({ path: prefix, node })
    return
  }
  const properties = node['properties'] as Record<string, JsonSchema>
  for (const [key, child] of Object.entries(properties)) {
    walkLeaves(child, prefix === '' ? key : `${prefix}.${key}`, visit)
  }
}

/** A schema node together with the dot-path prefix its own leaves should be reported under. */
export interface WalkStart {
  node: JsonSchema
  prefix: string
}

/**
 * Where a `.fill` tool's parameter walk starts (Task 3 brief): `properties.values` when present,
 * else one start per wizard step under `properties.steps.properties.<step>` (each prefixed with
 * the step name, matching the `<step>.<path>` convention M2's wizard fill uses), else the schema
 * itself. Non-`.fill` tools always start at the schema itself.
 */
function asSchemaRecord(value: unknown): Record<string, JsonSchema> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, JsonSchema>) : undefined
}

export function fillStartPoints(tool: { name: string; inputSchema: JsonSchema }): WalkStart[] {
  const schema = tool.inputSchema
  if (!tool.name.endsWith('.fill')) return [{ node: schema, prefix: '' }]

  const properties = asSchemaRecord(schema['properties'])
  const values = properties?.['values']
  if (values && typeof values === 'object') return [{ node: values, prefix: '' }]

  const stepsProperties = asSchemaRecord(asSchemaRecord(properties?.['steps'])?.['properties'])
  if (stepsProperties) {
    return Object.entries(stepsProperties).map(([step, node]) => ({ node, prefix: step }))
  }
  return [{ node: schema, prefix: '' }]
}
