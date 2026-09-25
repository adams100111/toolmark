/**
 * Internal: resolves a tour step's `param` to the JSON Schema node that declares it, so planned
 * steps can be validated against the tool's input schema. Not exported from the package.
 */

type Node = Record<string, unknown>

const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor'])
const MAX_DEPTH = 32
const INDEX = /^(0|[1-9]\d*)$/

function isNode(v: unknown): v is Node {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function own(obj: unknown, key: string): unknown {
  return isNode(obj) && Object.hasOwn(obj, key) ? obj[key] : undefined
}

/** Resolves a local `$ref` (`#/…` JSON pointer) against `root`; other refs are unresolvable. */
function deref(root: Node, node: Node, depth: number): Node | undefined {
  let current: Node = node
  for (let hops = 0; typeof current.$ref === 'string'; hops++) {
    if (hops > MAX_DEPTH || depth > MAX_DEPTH) return undefined
    const ref = current.$ref
    if (!ref.startsWith('#')) return undefined
    let target: unknown = root
    const tokens = ref === '#' ? [] : ref.slice(1).split('/').slice(1)
    for (const raw of tokens) {
      let decoded: string
      try {
        decoded = decodeURIComponent(raw)
      } catch {
        return undefined // malformed percent-escape: unresolved
      }
      const token = decoded.replace(/~1/g, '/').replace(/~0/g, '~')
      if (FORBIDDEN.has(token)) return undefined
      target = Array.isArray(target) ? target[Number(token)] : own(target, token)
    }
    if (!isNode(target)) return undefined
    current = target
  }
  return current
}

/**
 * The child schema of `node` for one path segment, searching `allOf`/`anyOf`/`oneOf` branches.
 * `seen` holds the nodes already searched for this segment, so self-referential branches are
 * visited once (no exponential search).
 */
function child(
  root: Node,
  node: Node,
  seg: string,
  depth: number,
  seen: Set<Node> = new Set(),
): Node | undefined {
  if (depth > MAX_DEPTH || seen.has(node)) return undefined
  seen.add(node)
  const resolved = deref(root, node, depth)
  if (!resolved || (resolved !== node && seen.has(resolved))) return undefined
  seen.add(resolved)
  const prop = own(resolved.properties, seg)
  if (isNode(prop)) return prop
  if (INDEX.test(seg)) {
    const tuple = resolved.prefixItems
    if (Array.isArray(tuple) && isNode(tuple[Number(seg)])) return tuple[Number(seg)] as Node
    if (isNode(resolved.items)) return resolved.items
  } else if (isNode(resolved.additionalProperties)) {
    return resolved.additionalProperties
  }
  for (const key of ['allOf', 'anyOf', 'oneOf'] as const) {
    const branches = resolved[key]
    if (!Array.isArray(branches)) continue
    for (const branch of branches) {
      if (!isNode(branch)) continue
      const found = child(root, branch, seg, depth + 1, seen)
      if (found) return found
    }
  }
  return undefined
}

/**
 * The schema node declaring `param` in a tool's input schema, or `undefined` when the path is not
 * declared. Walks dot segments through `properties` (numeric segments through `items` /
 * `prefixItems`), resolving local `$ref`s and `allOf`/`anyOf`/`oneOf` branches. For tools whose
 * name ends in `.fill`, the walk starts at `properties.values` when present (form fills); otherwise
 * at `properties.steps`, whose first segment is the wizard step name.
 * @param inputSchema - The tool's input JSON Schema (from `describe`).
 * @param param - Dot path, e.g. `address.city`, `items.0.qty` or `<step>.<path>`.
 * @param toolName - Full tool name.
 */
export function paramSchema(
  inputSchema: unknown,
  param: string,
  toolName: string,
): Node | undefined {
  if (!isNode(inputSchema) || typeof param !== 'string' || param === '') return undefined
  const segments = param.split('.')
  if (segments.some((s) => s === '' || FORBIDDEN.has(s))) return undefined
  const root = inputSchema
  let node: Node | undefined = root
  if (toolName.endsWith('.fill')) {
    const base = deref(root, root, 0)
    const values = own(base?.properties, 'values')
    const steps = own(base?.properties, 'steps')
    if (isNode(values)) node = values
    else if (isNode(steps)) node = steps
    else return undefined
  }
  for (const seg of segments) {
    node = child(root, node, seg, 0)
    if (!node) return undefined
  }
  return node
}
