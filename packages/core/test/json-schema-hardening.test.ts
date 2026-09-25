import { describe, expect, it } from 'vitest'
import { fromJsonSchema, ToolmarkError, type JsonSchema } from '@toolmark/core'
import { MAX_PATTERN_INPUT_LENGTH, MAX_SCHEMA_EVALUATIONS } from '../src/json-schema/validate.js'

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

function rejection(schema: JsonSchema): ToolmarkError {
  let thrown: unknown
  try {
    fromJsonSchema(schema)
  } catch (e) {
    thrown = e
  }
  expect(thrown).toBeInstanceOf(ToolmarkError)
  expect((thrown as ToolmarkError).code).toBe('schema_conversion_failed')
  return thrown as ToolmarkError
}

const UNSAFE = [
  '^(a+)+$',
  '(a*)*',
  '(a|a)*$',
  '(\\d+)*x',
  '(.*a){11}',
  '((a+))*',
  '(?:x+y?)+',
  '((a|a)c)*',
  '(ab|ac)+',
  '(a|ab)*',
  '(\\d|x)*',
  '(a)\\1',
  '(?<q>a)\\k<q>',
]

const SAFE = [
  '^[A-Z]{2}-\\d{4}$',
  '^\\S+@\\S+$',
  '^(ab|cd)$',
  '^(a|b)*$',
  '^(?:ab|cd)+$',
  '^\\d{3}(-\\d{4})?$',
  '^(\\d{4}){2}$',
  '^(?=.*\\d)[a-z0-9]+$',
  '^[(|)*+]+$',
  '^\\(\\d+\\)$',
]

describe('json schema pattern safety (fix round 1, C1)', () => {
  it('rejects_redos_prone_patterns_at_construction', () => {
    for (const pattern of UNSAFE) {
      const err = rejection({ type: 'string', pattern })
      expect(err.message, pattern).toMatch(/pattern/)
    }
    // Nested positions are checked too.
    rejection({ properties: { a: { pattern: '^(a+)+$' } } })
    rejection({ $defs: { x: { pattern: '(a*)*' } } })
    rejection({ additionalProperties: { pattern: '(a|a)*$' } })
  })

  it('accepts_safe_patterns', () => {
    for (const pattern of SAFE) {
      expect(() => fromJsonSchema({ type: 'string', pattern }), pattern).not.toThrow()
    }
    expect(check({ pattern: '^[A-Z]{2}-\\d{4}$' }, 'AB-1234')).toEqual([])
    expect(check({ pattern: '^(ab|cd)$' }, 'ef')).toHaveLength(1)
  })

  it('evil_input_against_accepted_patterns_is_fast', () => {
    const evil = ['a'.repeat(35) + '!', '@'.repeat(35) + ' ', 'ab'.repeat(18) + '!', '1'.repeat(36)]
    for (const pattern of SAFE) {
      const s = fromJsonSchema({ type: 'string', pattern })['~standard']
      for (const value of evil) {
        const t0 = performance.now()
        expect(s.validate(value)).not.toBeInstanceOf(Promise)
        expect(performance.now() - t0, `${pattern} vs ${value}`).toBeLessThan(1000)
      }
    }
  })

  it('long_value_is_never_run_against_a_pattern', () => {
    expect(MAX_PATTERN_INPUT_LENGTH).toBe(10000)
    const schema: JsonSchema = { type: 'string', pattern: '^a+$' }
    expect(check(schema, 'a'.repeat(10000))).toEqual([])
    expect(check(schema, 'a'.repeat(10001))).toEqual([
      { path: '', message: 'Value too long for pattern' },
    ])
    // Without a pattern, long strings are fine.
    expect(check({ type: 'string' }, 'a'.repeat(10001))).toEqual([])
  })
})

describe('json schema additionalProperties as a schema (fix round 1, I1)', () => {
  const schema: JsonSchema = {
    type: 'object',
    properties: { name: { type: 'string' } },
    additionalProperties: { type: 'number', minimum: 0 },
  }

  it('validates_extra_keys_against_the_subschema', () => {
    expect(check(schema, { name: 'x', a: 1, b: 2 })).toEqual([])
    expect(check(schema, { name: 'x', a: 'no', b: -1 })).toEqual([
      { path: 'a', message: 'Expected number, received string' },
      { path: 'b', message: 'Must be at least 0' },
    ])
    // Declared properties are not checked against additionalProperties.
    expect(check(schema, { name: 'x' })).toEqual([])
  })

  it('nested_paths', () => {
    const nested: JsonSchema = {
      type: 'object',
      properties: { tags: { type: 'object', additionalProperties: { type: 'string' } } },
    }
    expect(check(nested, { tags: { a: 'x', b: 3 } })).toEqual([
      { path: 'tags.b', message: 'Expected string, received number' },
    ])
  })

  it('true_absent_false', () => {
    const base = { type: 'object', properties: { a: { type: 'string' } } } as const
    expect(check({ ...base, additionalProperties: true }, { a: 'x', z: 1 })).toEqual([])
    expect(check(base, { a: 'x', z: 1 })).toEqual([])
    expect(check({ ...base, additionalProperties: false }, { a: 'x', z: 1 })).toEqual([
      { path: 'z', message: 'Unknown field' },
    ])
  })

  it('subschema_is_checked_at_construction', () => {
    rejection({ additionalProperties: { $ref: 'https://example.com/x' } })
    rejection({ additionalProperties: { pattern: '(' } })
    rejection({ additionalProperties: 'nope' })
  })
})

describe('json schema evaluation budget (final review M1)', () => {
  // Two-branch unions reached recursively: every nesting level doubles the work without a budget.
  const bomb = {
    $defs: {
      x: { anyOf: [{ $ref: '#/$defs/y' }, { $ref: '#/$defs/y' }] },
      y: { anyOf: [{ $ref: '#/$defs/z' }, { $ref: '#/$defs/z' }] },
      z: { type: 'array', items: { $ref: '#/$defs/x' } },
    },
    $ref: '#/$defs/x',
  } as JsonSchema

  it('recursive_unions_stop_at_the_budget_with_input_too_complex', () => {
    expect(MAX_SCHEMA_EVALUATIONS).toBe(100000)
    let nest: unknown = 1
    for (let i = 0; i < 11; i++) nest = [nest]
    const t0 = performance.now()
    expect(check(bomb, nest)).toEqual([{ path: '', message: 'Input too complex' }])
    expect(performance.now() - t0).toBeLessThan(1000)
  })

  it('shallow_inputs_still_validate_normally', () => {
    expect(check(bomb, [[[1]]])).toEqual([{ path: '0.0.0', message: expect.any(String) as string }])
    expect(check(bomb, [[[]]])).toEqual([])
    // The budget is per validation: a later call starts afresh.
    expect(check({ type: 'array', items: { type: 'number' } }, [1, 2, 3])).toEqual([])
  })
})
