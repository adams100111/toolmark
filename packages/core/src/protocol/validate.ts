import type { ProtocolMessage } from './messages.js'

type Result =
  | { ok: true; message: ProtocolMessage }
  | { ok: false; reason: string; unsupportedProtocol?: boolean; id?: string }

type Obj = Record<string, unknown>
type Check = (v: unknown) => string | null

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const hasOwn = (o: Obj, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k)

const str: Check = (v) => (typeof v === 'string' ? null : 'must be a string')
const nonEmpty: Check = (v) =>
  typeof v === 'string' && v.length > 0 ? null : 'must be a non-empty string'
const rev: Check = (v) =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 ? null : 'must be an integer >= 0'
const any: Check = () => null
const bool: Check = (v) => (typeof v === 'boolean' ? null : 'must be a boolean')

/** Validates `o` against a field spec; `strict` rejects unknown properties. */
function fields(
  o: Obj,
  spec: Record<string, { check: Check; required: boolean }>,
  strict: boolean,
  where: string,
): string | null {
  for (const [key, { check, required }] of Object.entries(spec)) {
    if (!hasOwn(o, key)) {
      if (required) return `${where}: missing "${key}"`
      continue
    }
    const problem = check(o[key])
    if (problem) return `${where}: "${key}" ${problem}`
  }
  if (strict) {
    for (const key of Object.keys(o)) {
      if (!hasOwn(spec, key)) return `${where}: unexpected property "${key}"`
    }
  }
  return null
}

const req = (check: Check) => ({ check, required: true })
const opt = (check: Check) => ({ check, required: false })

const arrayOf =
  (item: Check): Check =>
  (v) => {
    if (!Array.isArray(v)) return 'must be an array'
    for (let i = 0; i < v.length; i++) {
      const problem = item(v[i])
      if (problem) return `[${i}] ${problem}`
    }
    return null
  }

const object =
  (spec: Record<string, { check: Check; required: boolean }>, strict: boolean): Check =>
  (v) =>
    isObj(v) ? fields(v, spec, strict, 'object') : 'must be an object'

const issue = object({ path: req(str), message: req(str) }, true)
const fieldChange = object({ path: req(str), before: opt(any), after: opt(any) }, true)

const RESULT_SPECS: Record<string, Record<string, { check: Check; required: boolean }>> = {
  ok: { data: opt(any) },
  invalid: { issues: req(arrayOf(issue)) },
  refused: { code: req(str), message: req(str), rev: opt(rev) },
  needs_confirmation: {
    confirmId: req(nonEmpty),
    summary: req(str),
    changes: opt(arrayOf(fieldChange)),
  },
  cancelled: {
    by: req((v) => (v === 'operator' || v === 'signal' || v === 'policy' ? null : 'is invalid')),
  },
  error: { message: req(str) },
}

const toolResult: Check = (v) => {
  if (!isObj(v)) return 'must be an object'
  const status = v.status
  if (typeof status !== 'string' || !hasOwn(RESULT_SPECS, status)) return 'has an unknown status'
  return fields(v, { status: req(str), ...RESULT_SPECS[status] }, true, 'result')
}

const hints: Check = (v) =>
  isObj(v)
    ? fields(
        v,
        {
          readOnly: opt(bool),
          consequential: opt(bool),
          destructive: opt(bool),
          untrustedContent: opt(bool),
        },
        false,
        'hints',
      )
    : 'must be an object'

const toolSummary = object(
  {
    name: req(nonEmpty),
    llmName: req(nonEmpty),
    title: opt(str),
    description: req(str),
    hints: req(hints),
    mode: opt((v) => (v === 'stepwise' ? null : 'must be "stepwise"')),
  },
  false,
)

type Spec = Record<string, { check: Check; required: boolean }>

const TO_AGENT: Record<string, Spec> = {
  manifest: { rev: req(rev), tools: req(arrayOf(toolSummary)) },
  changed: { rev: req(rev) },
  result: { id: req(nonEmpty), result: req(toolResult) },
  confirmed: { confirmId: req(nonEmpty), result: req(toolResult) },
}

const TO_PAGE: Record<string, Spec> = {
  call: { id: req(nonEmpty), rev: opt(rev), tool: req(nonEmpty), input: req(any) },
  describe: { id: req(nonEmpty), tool: req(nonEmpty) },
  cancel: { id: req(nonEmpty) },
}

/**
 * Validates a bridge protocol v1 message (hand-written, dependency-free; agrees with
 * `protocolSchemas`). Top-level messages and `ToolResult`s are strict; manifest entries and hints
 * accept unknown properties; `input` and `result.data` are unconstrained.
 * @param value - The parsed message.
 * @param direction - `toPage` for agent→page messages, `toAgent` for page→agent messages.
 * @returns The typed message, or a `reason` (with `unsupportedProtocol` and the message `id` when
 * the protocol version is not 1).
 */
export function validateMessage(value: unknown, direction: 'toPage' | 'toAgent'): Result {
  if (!isObj(value)) return { ok: false, reason: 'message must be an object' }
  if (value.protocol !== 1) {
    const id = typeof value.id === 'string' ? { id: value.id } : {}
    return { ok: false, reason: 'unsupported protocol', unsupportedProtocol: true, ...id }
  }
  const specs = direction === 'toPage' ? TO_PAGE : TO_AGENT
  const type = value.type
  if (typeof type !== 'string' || !hasOwn(specs, type)) {
    return { ok: false, reason: `unknown message type ${JSON.stringify(type) ?? 'undefined'}` }
  }
  const problem = fields(
    value,
    {
      protocol: req(any),
      type: req(any),
      clientId: req(nonEmpty),
      ...specs[type],
    },
    true,
    type,
  )
  if (problem) return { ok: false, reason: problem }
  return { ok: true, message: value as unknown as ProtocolMessage }
}
