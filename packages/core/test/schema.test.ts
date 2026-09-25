import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { z as z3 } from 'zod/v3'
import { zodToJsonSchema } from 'zod-to-json-schema'
import type { JsonSchema, StandardSchemaV1, ToolDefinition } from '@toolmark/core'
import { ok } from '@toolmark/core'
import { resolveJsonSchema, stripRequired, validateInput } from '../src/schema.js'

const run = () => ok(null)

describe('validateInput', () => {
  it('validates_zod4_ok_and_issues', async () => {
    const schema = z.object({ title: z.object({ en: z.string().min(1) }), n: z.coerce.number() })
    const good = await validateInput(schema, { title: { en: 'x' }, n: '2' })
    expect(good).toEqual({ ok: true, value: { title: { en: 'x' }, n: 2 } })
    const bad = await validateInput(schema, { title: { en: '' }, n: 1 })
    expect(bad.ok).toBe(false)
    if (!bad.ok) {
      expect(bad.issues).toHaveLength(1)
      expect(bad.issues[0]!.path).toBe('title.en')
      expect(typeof bad.issues[0]!.message).toBe('string')
    }
  })

  it('no_schema_passes_value_through', async () => {
    expect(await validateInput(undefined, { a: 1 })).toEqual({ ok: true, value: { a: 1 } })
  })

  it('async_validate_and_segment_objects_and_root_issue', async () => {
    const schema: StandardSchemaV1<unknown, unknown> = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: (v) =>
          Promise.resolve(
            v === 'root'
              ? { issues: [{ message: 'root bad' }] }
              : { issues: [{ message: 'deep', path: [{ key: 'a' }, 0, 'b'] }] },
          ),
      },
    }
    expect(await validateInput(schema, 'root')).toEqual({
      ok: false,
      issues: [{ path: '', message: 'root bad' }],
    })
    expect(await validateInput(schema, 'x')).toEqual({
      ok: false,
      issues: [{ path: 'a.0.b', message: 'deep' }],
    })
  })
})

describe('resolveJsonSchema', () => {
  it('resolve_prefers_tool_json_schema', () => {
    const jsonSchema: JsonSchema = { type: 'object', properties: { custom: { type: 'string' } } }
    const tool: ToolDefinition = {
      name: 't',
      description: 'd',
      input: z.object({ title: z.string() }),
      jsonSchema,
      run,
    }
    expect(resolveJsonSchema(tool, undefined)).toEqual({ ok: true, schema: jsonSchema })
  })

  it('resolve_uses_standard_json_schema', () => {
    const tool: ToolDefinition = {
      name: 't',
      description: 'd',
      input: z.object({ title: z.string(), count: z.number().optional() }),
      run,
    }
    const r = resolveJsonSchema(tool, undefined)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.schema.type).toBe('object')
      expect(Object.keys(r.schema.properties as object).sort()).toEqual(['count', 'title'])
    }
  })

  it('resolve_uses_global_converter_for_zod3', () => {
    const input = z3.object({ title: z3.string() })
    const tool: ToolDefinition = { name: 't', description: 'd', input, run }
    const converter = (s: StandardSchemaV1): JsonSchema | undefined =>
      s === (input as unknown) ? zodToJsonSchema(input) : undefined
    const r = resolveJsonSchema(tool, converter)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.schema.type).toBe('object')
      expect(Object.keys(r.schema.properties as object)).toEqual(['title'])
    }
  })

  it('resolve_fails_without_converter_for_zod3', () => {
    const tool: ToolDefinition = {
      name: 't',
      description: 'd',
      input: z3.object({ title: z3.string() }),
      run,
    }
    const r = resolveJsonSchema(tool, undefined)
    expect(r.ok).toBe(false)
  })

  it('resolve_throwing_converter_is_failure_with_message', () => {
    const tool: ToolDefinition = {
      name: 't',
      description: 'd',
      input: {
        '~standard': { version: 1, vendor: 'x', validate: (value) => ({ value }) },
      },
      run,
    }
    const r = resolveJsonSchema(tool, () => {
      throw new Error('boom')
    })
    expect(r).toEqual({ ok: false, reason: expect.stringContaining('boom') as string })
  })

  it('resolve_throwing_standard_json_schema_is_failure', () => {
    const input = {
      '~standard': {
        version: 1 as const,
        vendor: 'x',
        validate: (value: unknown) => ({ value }),
        jsonSchema: {
          input: () => {
            throw new Error('unsupported target')
          },
          output: () => ({}),
        },
      },
    }
    const r = resolveJsonSchema({ name: 't', description: 'd', input, run }, undefined)
    expect(r).toEqual({
      ok: false,
      reason: expect.stringContaining('unsupported target') as string,
    })
  })

  it('no_input_schema_is_empty_object', () => {
    expect(resolveJsonSchema({ name: 't', description: 'd', run }, undefined)).toEqual({
      ok: true,
      schema: { type: 'object', properties: {}, additionalProperties: false },
    })
  })
})

describe('stripRequired', () => {
  it('strip_required_recursive_and_pure', () => {
    const schema: JsonSchema = {
      type: 'object',
      required: ['a', 'b'],
      properties: {
        a: { type: 'object', required: ['x'], properties: { x: { type: 'string' } } },
        b: {
          type: 'array',
          items: { type: 'object', required: ['y'], properties: { y: { type: 'number' } } },
        },
        c: { anyOf: [{ type: 'object', required: ['z'] }, { type: 'null' }] },
        d: { oneOf: [{ required: ['q'] }], allOf: [{ required: ['r'] }] },
      },
      $defs: { Foo: { type: 'object', required: ['w'] } },
    }
    const original = structuredClone(schema)
    const stripped = stripRequired(schema)
    expect(schema).toEqual(original)
    expect(JSON.stringify(stripped)).not.toContain('"required"')
    expect(stripped).toEqual({
      type: 'object',
      properties: {
        a: { type: 'object', properties: { x: { type: 'string' } } },
        b: { type: 'array', items: { type: 'object', properties: { y: { type: 'number' } } } },
        c: { anyOf: [{ type: 'object' }, { type: 'null' }] },
        d: { oneOf: [{}], allOf: [{}] },
      },
      $defs: { Foo: { type: 'object' } },
    })
  })
})
