import type { JsonSchema } from '../tool.js'

const DRAFT = 'https://json-schema.org/draft/2020-12/schema'

const nonEmptyString = { type: 'string', minLength: 1 } as const
const revision = { type: 'integer', minimum: 0 } as const

function message(
  type: string,
  properties: Record<string, unknown>,
  required: string[],
): JsonSchema {
  return {
    type: 'object',
    properties: {
      protocol: { const: 1 },
      type: { const: type },
      clientId: nonEmptyString,
      ...properties,
    },
    required: ['protocol', 'type', 'clientId', ...required],
    additionalProperties: false,
  }
}

function strictObject(properties: Record<string, unknown>, required: string[]): JsonSchema {
  return { type: 'object', properties, required, additionalProperties: false }
}

const issue = strictObject({ path: { type: 'string' }, message: { type: 'string' } }, [
  'path',
  'message',
])

const fieldChange = strictObject({ path: { type: 'string' }, before: {}, after: {} }, ['path'])

const toolResult: JsonSchema = {
  oneOf: [
    strictObject({ status: { const: 'ok' }, data: {} }, ['status']),
    strictObject({ status: { const: 'invalid' }, issues: { type: 'array', items: issue } }, [
      'status',
      'issues',
    ]),
    strictObject(
      {
        status: { const: 'refused' },
        code: { type: 'string' },
        message: { type: 'string' },
        rev: revision,
      },
      ['status', 'code', 'message'],
    ),
    strictObject(
      {
        status: { const: 'needs_confirmation' },
        confirmId: nonEmptyString,
        summary: { type: 'string' },
        changes: { type: 'array', items: fieldChange },
      },
      ['status', 'confirmId', 'summary'],
    ),
    strictObject(
      { status: { const: 'cancelled' }, by: { enum: ['operator', 'signal', 'policy'] } },
      ['status', 'by'],
    ),
    strictObject({ status: { const: 'error' }, message: { type: 'string' } }, [
      'status',
      'message',
    ]),
  ],
}

const hints: JsonSchema = {
  type: 'object',
  properties: {
    readOnly: { type: 'boolean' },
    consequential: { type: 'boolean' },
    destructive: { type: 'boolean' },
    untrustedContent: { type: 'boolean' },
  },
}

// Manifest entries and hints accept unknown properties (forward-compatible additions).
const toolSummary: JsonSchema = {
  type: 'object',
  properties: {
    name: nonEmptyString,
    llmName: nonEmptyString,
    title: { type: 'string' },
    description: { type: 'string' },
    hints: { $ref: '#/$defs/hints' },
    mode: { const: 'stepwise' },
  },
  required: ['name', 'llmName', 'description', 'hints'],
}

const pageToAgent: JsonSchema = {
  $schema: DRAFT,
  $id: 'urn:toolmark:protocol:v1:page-to-agent',
  title: 'Toolmark bridge protocol v1: page to agent',
  oneOf: [
    message(
      'manifest',
      { rev: revision, tools: { type: 'array', items: { $ref: '#/$defs/toolSummary' } } },
      ['rev', 'tools'],
    ),
    message('changed', { rev: revision }, ['rev']),
    message('result', { id: nonEmptyString, result: { $ref: '#/$defs/toolResult' } }, [
      'id',
      'result',
    ]),
    message('confirmed', { confirmId: nonEmptyString, result: { $ref: '#/$defs/toolResult' } }, [
      'confirmId',
      'result',
    ]),
  ],
  $defs: { toolResult, toolSummary, hints },
}

const agentToPage: JsonSchema = {
  $schema: DRAFT,
  $id: 'urn:toolmark:protocol:v1:agent-to-page',
  title: 'Toolmark bridge protocol v1: agent to page',
  oneOf: [
    message('call', { id: nonEmptyString, rev: revision, tool: nonEmptyString, input: {} }, [
      'id',
      'tool',
      'input',
    ]),
    message('describe', { id: nonEmptyString, tool: nonEmptyString }, ['id', 'tool']),
    message('cancel', { id: nonEmptyString }, ['id']),
  ],
}

/** JSON Schemas (draft 2020-12) for every bridge protocol v1 message, per direction. */
export const protocolSchemas: { pageToAgent: JsonSchema; agentToPage: JsonSchema } = {
  pageToAgent,
  agentToPage,
}
