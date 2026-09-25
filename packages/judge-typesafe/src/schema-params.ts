import type { JsonSchema } from '@toolmark/core'

/** One schema property's path and description, sent to TypeSafe as part of `state` (never a value). */
export interface StateParam {
  path: string
  description?: string
}

/**
 * Walks `schema`'s `properties` tree (recursively, into any nested object property), collecting
 * every declared property's dot path and `description` — never `default`, `enum`, `examples` or
 * `const`, and never a value. Both container and leaf properties are included (a step's own
 * object property may carry a useful `description` too).
 */
export function collectParams(schema: JsonSchema, prefix = ''): StateParam[] {
  const properties = schema['properties']
  if (!(properties && typeof properties === 'object')) return []

  const out: StateParam[] = []
  for (const [key, value] of Object.entries(properties as Record<string, JsonSchema>)) {
    const path = prefix === '' ? key : `${prefix}.${key}`
    const description = value['description']
    out.push(typeof description === 'string' ? { path, description } : { path })
    if (value['type'] === 'object') out.push(...collectParams(value, path))
  }
  return out
}
