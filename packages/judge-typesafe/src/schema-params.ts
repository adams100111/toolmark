import type { JsonSchema } from '@toolmark/core'

/** One schema property's path and description, sent to TypeSafe as part of `state` (never a value). */
export interface StateParam {
  path: string
  description?: string
}

/**
 * The option list a DOM-synthesized select or radio description ends with (`Options: <value> =
 * <label>; …`, `@toolmark/core`'s DOM scanner). Option values and labels can be application data
 * (member names, ids), so they are never sent (SEC-10).
 */
const OPTION_LIST = /(?:^|\s)Options: [\s\S]*$/

/** `description` without a trailing DOM option list; `undefined` when nothing else remains. */
function withoutOptions(description: string): string | undefined {
  const text = description.replace(OPTION_LIST, '').trim()
  return text === '' ? undefined : text
}

/**
 * Walks `schema`'s `properties` tree (recursively, into any nested object property), collecting
 * every declared property's dot path and `description` — never `default`, `enum`, `examples` or
 * `const`, and never a value. A trailing DOM option list (`Options: <value> = <label>; …`) is
 * removed from each description, so option values and labels are never sent either. Both
 * container and leaf properties are included (a step's own object property may carry a useful
 * `description` too).
 */
export function collectParams(schema: JsonSchema, prefix = ''): StateParam[] {
  const properties = schema['properties']
  if (!(properties && typeof properties === 'object')) return []

  const out: StateParam[] = []
  for (const [key, value] of Object.entries(properties as Record<string, JsonSchema>)) {
    const path = prefix === '' ? key : `${prefix}.${key}`
    const raw = value['description']
    const description = typeof raw === 'string' ? withoutOptions(raw) : undefined
    out.push(description !== undefined ? { path, description } : { path })
    if (value['type'] === 'object') out.push(...collectParams(value, path))
  }
  return out
}
