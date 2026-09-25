import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createFormTools, flatten, ok, setPath, type FieldInfo } from '@toolmark/core'
import { extractArrayOps, flattenWithRejected } from '../src/forms/paths.js'
import { createTestRegistry } from './helpers/create-test-registry.js'

const schema = z.object({
  title: z.string(),
  tags: z.array(z.object({ name: z.string() })),
  meta: z.record(z.string(), z.any()).optional(),
})

function setup() {
  const tm = createTestRegistry()
  const adapter = {
    values: { title: '', tags: [{ name: 'a' }] } as Record<string, unknown>,
    getValues() {
      return this.values
    },
    setValues(values: Record<string, unknown>) {
      for (const [path, v] of Object.entries(values)) this.values = setPath(this.values, path, v)
    },
    dirtyPaths: (): string[] => [],
    submit: () => Promise.resolve(ok(null)),
    fields: (): FieldInfo[] => [],
  }
  createFormTools(tm, adapter, { name: 'f', description: 'Form.', input: schema })
  const fill = (values: unknown) => tm.call('f.fill', { values }, { caller: 'inapp' })
  return { adapter, fill }
}

const cyclic = (): Record<string, unknown> => {
  const o: Record<string, unknown> = {}
  o.a = o
  o.b = o
  o.c = o
  return o
}

describe('array ops hardening', () => {
  it('extract_array_ops_passes_cycles_through_fast', () => {
    const o = cyclic()
    const t0 = performance.now()
    const { rest, ops } = extractArrayOps({ meta: o }, () => false)
    expect(performance.now() - t0).toBeLessThan(100)
    expect(ops.size).toBe(0)
    expect(flattenWithRejected(rest).rejected.length).toBeGreaterThan(0)
  })

  it('fill_with_cyclic_values_is_invalid_fast', async () => {
    const { fill } = setup()
    const t0 = performance.now()
    const res = await fill({ meta: cyclic() })
    expect(performance.now() - t0).toBeLessThan(100)
    expect(res.status).toBe('invalid')
  })

  it('flatten_expanded_skips_sparse_array_holes', () => {
    // eslint-disable-next-line no-sparse-arrays
    const sparse = [, { name: true }]
    expect(flatten({ tags: sparse }, { arraysAsLeaves: false })).toEqual({ 'tags.1.name': true })
    // eslint-disable-next-line no-sparse-arrays
    const leaf = [, 1]
    expect(flatten({ tags: leaf })).toEqual({ tags: leaf })
  })

  it('dollar_keys_are_ops_only_where_schema_declares_an_array', () => {
    const declaresArray = (path: string) => path === 'tags'
    const { rest, ops } = extractArrayOps(
      { meta: { $schema: 'x' }, tags: { $prepend: [1] } },
      () => false,
      declaresArray,
    )
    expect(rest).toEqual({ meta: { $schema: 'x' } })
    expect([...ops.keys()]).toEqual(['tags'])
    // An array-only path still takes any object as an op candidate.
    const arrayOnly = extractArrayOps({ tags: {} }, (p) => p === 'tags', declaresArray)
    expect([...arrayOnly.ops.keys()]).toEqual(['tags'])
  })

  it('fill_rejects_unknown_dollar_op_on_array_field', async () => {
    const { fill } = setup()
    expect((await fill({ tags: { $prepend: [{ name: 'x' }] } })).status).toBe('invalid')
  })
})
