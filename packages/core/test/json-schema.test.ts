import { describe, expect, it } from 'vitest'
import {
  createFormTools,
  fromJsonSchema,
  ok,
  setPath,
  ToolmarkError,
  type FormAdapter,
  type JsonSchema,
} from '@toolmark/core'
import { createTestRegistry } from './helpers/create-test-registry.js'

/** Validates synchronously and returns the issues as `{ path, message }` with dot paths. */
function check(schema: JsonSchema, value: unknown): { path: string; message: string }[] {
  const result = fromJsonSchema(schema)['~standard'].validate(value)
  if (result instanceof Promise) throw new Error('expected a synchronous result')
  return (result.issues ?? []).map((i) => ({
    path: (i.path ?? [])
      .map((s) => String(typeof s === 'object' && s !== null ? s.key : s))
      .join('.'),
    message: i.message,
  }))
}
const paths = (schema: JsonSchema, value: unknown): string[] =>
  check(schema, value)
    .map((i) => i.path)
    .sort()
const valid = (schema: JsonSchema, value: unknown): boolean => check(schema, value).length === 0

function expectRejected(schema: JsonSchema): void {
  let thrown: unknown
  try {
    fromJsonSchema(schema)
  } catch (e) {
    thrown = e
  }
  expect(thrown).toBeInstanceOf(ToolmarkError)
  expect((thrown as ToolmarkError).code).toBe('schema_conversion_failed')
}

describe('fromJsonSchema', () => {
  it('json_schema_types_enum_required_nested', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'integer' },
        score: { type: 'number' },
        active: { type: 'boolean' },
        nothing: { type: 'null' },
        kind: { enum: ['a', 'b', 1] },
        fixed: { const: { x: 1 } },
        owner: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            tags: { type: 'array', items: { type: 'string' } },
          },
          required: ['id'],
          additionalProperties: false,
        },
        rows: {
          type: 'array',
          items: { type: 'object', properties: { v: { type: 'number' } }, required: ['v'] },
        },
      },
      required: ['name', 'owner'],
    }
    const good = {
      name: 'n',
      age: 3,
      score: 1.5,
      active: true,
      nothing: null,
      kind: 1,
      fixed: { x: 1 },
      owner: { id: 'o', tags: ['t'] },
      rows: [{ v: 1 }],
      extra: 'allowed (additionalProperties not set)',
    }
    const result = fromJsonSchema<typeof good>(schema)['~standard'].validate(good)
    expect(result).toEqual({ value: good })
    expect(fromJsonSchema(schema)['~standard'].vendor).toBe('toolmark')
    expect(fromJsonSchema(schema)['~standard'].version).toBe(1)

    expect(
      paths(schema, {
        age: 1.5,
        score: 'x',
        active: 'yes',
        nothing: 0,
        kind: 'c',
        fixed: { x: 2 },
        owner: { tags: ['t', 2], other: true },
        rows: [{ v: 1 }, {}, { v: 'x' }],
      }),
    ).toEqual([
      'active',
      'age',
      'fixed',
      'kind',
      'name',
      'nothing',
      'owner.id',
      'owner.other',
      'owner.tags.1',
      'rows.1.v',
      'rows.2.v',
      'score',
    ])
    expect(check(schema, { owner: { id: 'x' } })).toEqual([{ path: 'name', message: 'Required' }])
    // Array indexes are numbers in the Standard Schema path.
    const r = fromJsonSchema(schema)['~standard'].validate({
      name: 'n',
      owner: { id: 'o' },
      rows: [{}],
    })
    expect(r instanceof Promise ? undefined : r.issues?.[0]?.path).toEqual(['rows', 0, 'v'])
    expect(paths({ type: 'object' }, [])).toEqual([''])
    expect(valid({ type: 'number' }, Number.NaN)).toBe(false)
    expect(valid({ type: 'integer' }, 2)).toBe(true)
    expect(valid(true as unknown as JsonSchema, 'anything')).toBe(true)
    expect(valid({ properties: { a: false } }, { a: 1 })).toBe(false)
    // A `__proto__` own key is checked like any other key and never read from the prototype.
    expect(
      valid(
        { type: 'object', properties: { a: { type: 'string' } }, additionalProperties: false },
        JSON.parse('{"__proto__": {"a": 1}}') as unknown,
      ),
    ).toBe(false)
    expect(valid({ type: 'object', required: ['toString'] }, {})).toBe(false)
  })

  it('json_schema_string_number_limits', () => {
    const s: JsonSchema = { type: 'string', minLength: 2, maxLength: 3, pattern: '^a' }
    expect(valid(s, 'ab')).toBe(true)
    expect(valid(s, 'a')).toBe(false)
    expect(valid(s, 'abcd')).toBe(false)
    expect(valid(s, 'ba')).toBe(false)
    // Length counts code points; the pattern uses the `u` flag.
    expect(valid({ type: 'string', maxLength: 1 }, '😀')).toBe(true)
    expect(valid({ type: 'string', pattern: '^.$' }, '😀')).toBe(true)
    // `pattern` is unanchored (search semantics).
    expect(valid({ type: 'string', pattern: 'b' }, 'abc')).toBe(true)

    const n: JsonSchema = { type: 'number', minimum: 1, maximum: 10, multipleOf: 0.5 }
    expect(valid(n, 1)).toBe(true)
    expect(valid(n, 10)).toBe(true)
    expect(valid(n, 2.5)).toBe(true)
    expect(valid(n, 0.5)).toBe(false)
    expect(valid(n, 10.5)).toBe(false)
    expect(valid(n, 2.3)).toBe(false)
    expect(valid({ type: 'number', multipleOf: 0.1 }, 0.3)).toBe(true)
    expect(valid({ type: 'number', multipleOf: 0.01 }, 19.99)).toBe(true)

    const a: JsonSchema = { type: 'array', minItems: 1, maxItems: 2, uniqueItems: true }
    expect(valid(a, [1])).toBe(true)
    expect(valid(a, [])).toBe(false)
    expect(valid(a, [1, 2, 3])).toBe(false)
    expect(valid(a, [{ x: 1 }, { x: 1 }])).toBe(false)
    expect(valid(a, [{ x: 1 }, { x: 2 }])).toBe(true)
    // Limits apply only to their own kind.
    expect(valid({ minLength: 5, minimum: 5, minItems: 5 }, true)).toBe(true)
  })

  it('json_schema_formats', () => {
    const f = (format: string) => (v: unknown) => valid({ type: 'string', format }, v)
    const date = f('date')
    expect(date('2024-02-29')).toBe(true)
    expect(date('2023-02-29')).toBe(false)
    expect(date('2024-13-01')).toBe(false)
    expect(date('2024-04-31')).toBe(false)
    expect(date('2024-1-01')).toBe(false)
    const time = f('time')
    expect(time('09:30')).toBe(true)
    expect(time('09:30:15')).toBe(true)
    expect(time('9:30')).toBe(false)
    const dt = f('date-time')
    expect(dt('2024-05-01T10:20:30Z')).toBe(true)
    expect(dt('2024-05-01T10:20:30.123+02:00')).toBe(true)
    expect(dt('2024-05-01 10:20:30Z')).toBe(false)
    expect(dt('2024-05-01T10:20:30')).toBe(false)
    expect(dt('2024-05-01T99:20:30Z')).toBe(false)
    const email = f('email')
    expect(email('a@b.co')).toBe(true)
    expect(email('a@b')).toBe(false)
    expect(email('a b@c.de')).toBe(false)
    const uri = f('uri')
    expect(uri('https://example.com/x?y=1')).toBe(true)
    expect(uri('mailto:a@b.co')).toBe(true)
    expect(uri('not a uri')).toBe(false)
    // Unknown formats are ignored; formats never reject non-strings.
    expect(f('hostname')('???')).toBe(true)
    expect(valid({ format: 'date' }, 5)).toBe(true)
  })

  it('json_schema_anyof_oneof', () => {
    const any: JsonSchema = { anyOf: [{ type: 'string' }, { type: 'number', minimum: 10 }] }
    expect(valid(any, 'x')).toBe(true)
    expect(valid(any, 11)).toBe(true)
    expect(valid(any, 5)).toBe(false)
    expect(valid(any, true)).toBe(false)

    const one: JsonSchema = { oneOf: [{ type: 'integer' }, { type: 'number', minimum: 2 }] }
    expect(valid(one, 1)).toBe(true) // integer only
    expect(valid(one, 2.5)).toBe(true) // number only
    expect(valid(one, 3)).toBe(false) // both
    expect(valid(one, 'x')).toBe(false) // none

    // An object union reports the issues of the closest branch, at their nested paths.
    const shapes: JsonSchema = {
      type: 'object',
      properties: {
        shape: {
          oneOf: [
            {
              type: 'object',
              properties: { kind: { const: 'circle' }, r: { type: 'number' } },
              required: ['kind', 'r'],
            },
            {
              type: 'object',
              properties: { kind: { const: 'rect' }, w: { type: 'number' }, h: { type: 'number' } },
              required: ['kind', 'w', 'h'],
            },
          ],
        },
      },
    }
    expect(valid(shapes, { shape: { kind: 'circle', r: 1 } })).toBe(true)
    expect(paths(shapes, { shape: { kind: 'rect', w: 1 } })).toEqual(['shape.h'])
    expect(paths(shapes, { shape: 'x' })).toEqual(['shape'])
  })

  it('json_schema_allof_type_array_ref', () => {
    const schema: JsonSchema = {
      $defs: {
        person: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            friends: { type: 'array', items: { $ref: '#/$defs/person' } },
          },
          required: ['name'],
        },
        'a/b': { type: 'string' },
      },
      type: 'object',
      properties: {
        who: { $ref: '#/$defs/person' },
        nullable: { type: ['string', 'null'] },
        both: { allOf: [{ type: 'string' }, { minLength: 2 }] },
        escaped: { $ref: '#/$defs/a~1b' },
        narrowed: { $ref: '#/$defs/person', required: ['friends'] },
      },
    }
    expect(valid(schema, { who: { name: 'a', friends: [{ name: 'b', friends: [] }] } })).toBe(true)
    expect(paths(schema, { who: { name: 'a', friends: [{ friends: [] }] } })).toEqual([
      'who.friends.0.name',
    ])
    expect(valid(schema, { nullable: null })).toBe(true)
    expect(valid(schema, { nullable: 'x' })).toBe(true)
    expect(valid(schema, { nullable: 1 })).toBe(false)
    expect(valid(schema, { both: 'ab' })).toBe(true)
    expect(valid(schema, { both: 'a' })).toBe(false)
    expect(valid(schema, { both: 12 })).toBe(false)
    expect(valid(schema, { escaped: 'x' })).toBe(true)
    expect(valid(schema, { escaped: 1 })).toBe(false)
    // `$ref` siblings apply too (draft 2020-12).
    expect(paths(schema, { narrowed: { name: 'a' } })).toEqual(['narrowed.friends'])
    // A ref cycle that consumes no input is bounded (no stack overflow).
    const loop: JsonSchema = { $defs: { a: { $ref: '#/$defs/a' } }, $ref: '#/$defs/a' }
    expect(valid(loop, 1)).toBe(false)
  })

  it('json_schema_external_ref_rejected', () => {
    expectRejected({ $ref: 'https://example.com/schema.json' })
    expectRejected({ properties: { a: { $ref: '#/definitions/x' } }, definitions: { x: {} } })
    expectRejected({ properties: { a: { $ref: '#/$defs/missing' } } })
    expectRejected({ items: { $ref: 'other.json#/$defs/x' } })
    expectRejected({ anyOf: [{ $ref: '#' }] })
    expectRejected({ $defs: { x: { $ref: '#/$defs/x/properties/a' } } })
    expect(() =>
      fromJsonSchema({ $defs: { x: { type: 'string' } }, $ref: '#/$defs/x' }),
    ).not.toThrow()
  })

  it('json_schema_invalid_pattern_rejected', () => {
    expectRejected({ type: 'string', pattern: '(' })
    expectRejected({ properties: { a: { pattern: '[' } } })
    // Invalid only with the `u` flag.
    expectRejected({ pattern: '\\-' })
    expectRejected({ $defs: { x: { pattern: 42 } } })
  })

  it('json_schema_unknown_keywords_ignored', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: { a: { type: 'string', 'x-custom': true, contentMediaType: 'text/plain' } },
      not: { type: 'object' },
      if: { required: ['a'] },
      then: { required: ['b'] },
      patternProperties: { '^z': { type: 'number' } },
      minProperties: 5,
      dependentRequired: { a: ['b'] },
      title: 'T',
      description: 'D',
      default: {},
      $schema: 'https://json-schema.org/draft/2020-12/schema',
    }
    expect(valid(schema, { a: 'x', z: 'not a number', other: 'x' })).toBe(true)
    expect(valid(schema, { a: 1 })).toBe(false)
    // A `$ref` inside an ignored keyword is never evaluated, so it does not reject the schema.
    expect(() => fromJsonSchema({ not: { $ref: 'https://example.com/x' } })).not.toThrow()
  })

  it('from_json_schema_resolves_via_standard_json_schema', async () => {
    const source: JsonSchema = {
      type: 'object',
      properties: {
        title: { type: 'string', minLength: 1 },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['title'],
    }
    const schema = fromJsonSchema<{ title: string; tags?: string[] }>(source)
    const std = schema['~standard'].jsonSchema
    const input = std.input({ target: 'draft-2020-12' })
    expect(input).toEqual(source)
    expect(input).not.toBe(source)
    input.mutated = true
    expect(std.input({ target: 'draft-2020-12' })).toEqual(source)
    expect(std.output({ target: 'draft-2020-12' })).toEqual(source)
    expect(() => std.input({ target: 'draft-07' })).toThrow()
    expect(() => std.output({ target: 'openapi-3.0' })).toThrow()
    // Mutating the source after construction changes nothing.
    ;(source.properties as Record<string, unknown>).title = { type: 'number' }
    expect(std.input({ target: 'draft-2020-12' })).toEqual({
      type: 'object',
      properties: {
        title: { type: 'string', minLength: 1 },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['title'],
    })

    // M1's resolveJsonSchema picks it up unchanged: a form tool needs no converter or jsonSchema.
    const tm = createTestRegistry()
    let values: Record<string, unknown> = { title: '' }
    const adapter: FormAdapter = {
      getValues: () => values,
      setValues: (v) => {
        for (const [p, x] of Object.entries(v)) values = setPath(values, p, x)
      },
      dirtyPaths: () => [],
      submit: () => Promise.resolve(ok(null)),
      fields: () => [],
    }
    createFormTools(tm, adapter, { name: 'f', description: 'Form.', input: schema })
    const fill = tm.describe('f.fill')
    expect(fill?.inputSchema).toMatchObject({
      properties: {
        values: {
          type: 'object',
          properties: { title: { type: 'string', minLength: 1 } },
        },
      },
    })
    expect(await tm.call('f.fill', { values: { title: '' } }, { caller: 'inapp' })).toEqual({
      status: 'invalid',
      issues: [{ path: 'title', message: expect.any(String) as string }],
    })
    expect((await tm.call('f.fill', { values: { title: 'x' } }, { caller: 'inapp' })).status).toBe(
      'ok',
    )
    expect(values.title).toBe('x')
  })
})
