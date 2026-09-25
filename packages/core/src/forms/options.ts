import { fromJsonSchema } from '../json-schema/from-json-schema.js'
import { emitEvent, type Toolmark } from '../registry.js'
import { cancelled, errorResult, ok, type ToolResult } from '../result.js'
import type { JsonSchema, ToolDefinition } from '../tool.js'
import type { OptionsProvider } from './types.js'

/** At most this many options are returned per call (M2 constraints). */
const MAX_OPTIONS = 50
/** Provider timeout in milliseconds (M2 constraints). */
const OPTIONS_TIMEOUT_MS = 10000

type OptionItem = { value: string | number | boolean; title: string }

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Keeps `{ value, title }` items with a scalar value and a string title, projected to those keys. */
function cleanItems(raw: unknown[]): OptionItem[] {
  const out: OptionItem[] = []
  for (const item of raw) {
    if (out.length >= MAX_OPTIONS) break
    if (!isRecord(item) || typeof item.title !== 'string') continue
    const v = item.value
    if (
      typeof v === 'string' ||
      typeof v === 'boolean' ||
      (typeof v === 'number' && Number.isFinite(v))
    ) {
      out.push({ value: v, title: item.title })
    }
  }
  return out
}

type Settled<T> = { ok: true; value: T } | { ok: false; cause: unknown }

/**
 * Settles with the outcome of `p`, or as a failure as soon as `signal` aborts (a provider may
 * ignore its signal). Never rejects.
 */
function untilAbort<T>(p: Promise<T>, signal: AbortSignal): Promise<Settled<T>> {
  return new Promise<Settled<T>>((resolve) => {
    if (signal.aborted) {
      resolve({ ok: false, cause: signal.reason })
      return
    }
    const onAbort = (): void => {
      resolve({ ok: false, cause: signal.reason })
    }
    signal.addEventListener('abort', onAbort, { once: true })
    p.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve({ ok: true, value })
      },
      (cause: unknown) => {
        signal.removeEventListener('abort', onAbort)
        resolve({ ok: false, cause })
      },
    )
  })
}

/**
 * The `<name>.options` tool (spec §8.3): input `{ field, query? }`, `readOnly` and
 * `untrustedContent`, returns `ok({ options })` (≤ 50 valid items). Timeout → `error`
 * "Options lookup timed out"; a failing provider → `error` "Options lookup failed" (details in
 * a `tool_threw` event); caller cancellation → `cancelled` `signal`.
 * @internal
 */
export function optionsToolDefinition(
  tm: Toolmark,
  formName: string,
  formDescription: string,
  providers: Record<string, OptionsProvider>,
): ToolDefinition<{ field: string; query?: string }, { options: OptionItem[] }> {
  const toolName = `${formName}.options`
  const fields = Object.keys(providers)
  const input = fromJsonSchema<{ field: string; query?: string }>({
    type: 'object',
    properties: {
      field: {
        type: 'string',
        enum: fields,
        description: 'Field path ("[]" stands for any array index).',
      },
      query: {
        type: 'string',
        default: '',
        description: 'Search text; empty lists the first options.',
      },
    },
    required: ['field'],
    additionalProperties: false,
  })
  const report = (message: string, cause?: unknown): void => {
    emitEvent(tm, 'error', {
      code: 'tool_threw',
      message,
      tool: toolName,
      ...(cause !== undefined ? { cause } : {}),
    })
  }
  return {
    name: toolName,
    description:
      `${formDescription} Look up valid values for a field before filling it. "field" is one of: ` +
      `${fields.join(', ')}. "query" filters the candidates. Returns up to ${MAX_OPTIONS} ` +
      `options as { value, title }; fill the field with a "value".`,
    hints: { readOnly: true, untrustedContent: true },
    input,
    async run({ field, query }, ctx): Promise<ToolResult<{ options: OptionItem[] }>> {
      const provider = Object.hasOwn(providers, field) ? providers[field] : undefined
      if (!provider) return errorResult('Options lookup failed')
      const timeout = AbortSignal.timeout(OPTIONS_TIMEOUT_MS)
      const signal = AbortSignal.any([ctx.signal, timeout])
      const settled = await untilAbort(
        Promise.resolve().then(() => provider({ query: query ?? '', signal })),
        signal,
      )
      if (!settled.ok) {
        if (ctx.signal.aborted) return cancelled('signal')
        if (timeout.aborted) return errorResult('Options lookup timed out')
        report(`Options provider for field "${field}" failed`, settled.cause)
        return errorResult('Options lookup failed')
      }
      const raw: unknown = settled.value
      if (!Array.isArray(raw)) {
        report(`Options provider for field "${field}" returned something that is not an array`)
        return errorResult('Options lookup failed')
      }
      return ok({ options: cleanItems(raw) })
    },
  }
}

/** Follows a local `$ref` (`#/$defs/…`, `#/definitions/…`) of the fill schema. */
function deref(
  node: Record<string, unknown>,
  root: JsonSchema,
): Record<string, unknown> | undefined {
  if (typeof node.$ref !== 'string') return undefined
  const m = /^#\/(\$defs|definitions)\/([^/]+)$/.exec(node.$ref)
  const defs = m ? root[m[1]!] : undefined
  const target = m && isRecord(defs) && Object.hasOwn(defs, m[2]!) ? defs[m[2]!] : undefined
  return isRecord(target) ? target : undefined
}

/**
 * Appends `suffix` to the `description` of every node the option key `path` reaches in the fill
 * schema `values` node (in place): through `properties`, `items` for `[]` (and the `$append`
 * items of an array-op branch), unions, `allOf` and local `$ref`s. The field keeps its type.
 * @internal
 */
export function annotateOptionField(
  values: JsonSchema,
  root: JsonSchema,
  path: string,
  suffix: string,
): void {
  const segments = path
    .split('.')
    .flatMap((seg) => (seg.endsWith('[]') && seg !== '[]' ? [seg.slice(0, -2), '[]'] : [seg]))
  const done = new Set<unknown>()
  const visit = (node: unknown, rest: string[], depth: number): void => {
    if (!isRecord(node) || depth > 64) return
    if (rest.length === 0) {
      if (done.has(node)) return
      done.add(node)
      const current = typeof node.description === 'string' ? node.description : ''
      node.description = current === '' ? suffix.trimStart() : `${current}${suffix}`
      return
    }
    const target = deref(node, root)
    if (target) visit(target, rest, depth + 1)
    for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
      const list = node[key]
      if (Array.isArray(list)) for (const b of list) visit(b, rest, depth + 1)
    }
    const [head, ...tail] = rest as [string, ...string[]]
    const props = isRecord(node.properties) ? node.properties : undefined
    if (head === '[]') {
      if (node.items !== undefined) visit(node.items, tail, depth + 1)
      const append = props && Object.hasOwn(props, '$append') ? props.$append : undefined
      if (isRecord(append)) visit(append.items, tail, depth + 1)
    } else if (props && Object.hasOwn(props, head)) {
      visit(props[head], tail, depth + 1)
    }
  }
  visit(values, segments, 0)
}
