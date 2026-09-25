import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createFormTools, flatten, ok, setPath, type FieldInfo } from '@toolmark/core'
import { extractArrayOps, flattenWithRejected } from '../src/forms/paths.js'
import { createTestRegistry } from './helpers/create-test-registry.js'

const schema = z.object({
  title: z.string(),
  tags: z.array(z.object({ name: z.string() })),
  meta: z.record(z.string(), z.any()).optional(),
  group: z.object({ list: z.array(z.string()) }).optional(),
  grid: z.array(z.object({ cells: z.array(z.string()) })).optional(),
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

/** o0 = { a: o1, b: o1 }, o1 = { a: o2, b: o2 }, …: 2^depth paths through shared references. */
const dag = (depth: number): Record<string, unknown> => {
  let node: Record<string, unknown> = { leaf: 1 }
  for (let i = 0; i < depth; i++) node = { a: node, b: node }
  return node
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

  it('fill_record_field_accepts_dollar_keyed_data', async () => {
    const { adapter, fill } = setup()
    const res = await fill({ meta: { $schema: 'x', inner: { $ref: 'y' } } })
    expect(res.status).toBe('ok')
    expect(adapter.values.meta).toEqual({ $schema: 'x', inner: { $ref: 'y' } })
  })

  it('fill_duplicate_path_is_invalid_and_sets_nothing', async () => {
    const { adapter, fill } = setup()
    const before = adapter.values
    const plain = await fill({ 'group.list': ['a'], group: { list: ['b'] } })
    expect(plain).toEqual({
      status: 'invalid',
      issues: [{ path: 'group.list', message: 'Duplicate field path' }],
    })
    const twoOps = await fill({
      'group.list': { $append: ['a'] },
      group: { list: { $append: ['b'] } },
    })
    expect(twoOps).toEqual({
      status: 'invalid',
      issues: [{ path: 'group.list', message: 'Duplicate field path' }],
    })
    const opAndPlain = await fill({ 'group.list': ['a'], group: { list: { $append: ['b'] } } })
    expect(opAndPlain).toEqual({
      status: 'invalid',
      issues: [{ path: 'group.list', message: 'Duplicate field path' }],
    })
    expect(adapter.values).toBe(before)
  })

  it('fill_op_on_array_nested_in_array_fails_closed', async () => {
    const { adapter, fill } = setup()
    adapter.values = { ...adapter.values, grid: [{ cells: ['a'] }] }
    expect((await fill({ 'grid.0.cells': { $append: ['b'] } })).status).toBe('invalid')
    expect(adapter.values.grid).toEqual([{ cells: ['a'] }])
  })

  it('walkers_bound_dag_input', () => {
    const t0 = performance.now()
    const flat = flattenWithRejected({ meta: dag(30) })
    const extracted = extractArrayOps({ meta: dag(30) }, () => false)
    expect(performance.now() - t0).toBeLessThan(100)
    expect(flat.rejected.length).toBeGreaterThan(0)
    expect(extracted.ops.size).toBe(0)
  })

  it('fill_with_dag_values_is_too_complex_fast', async () => {
    const { adapter, fill } = setup()
    const before = adapter.values
    const t0 = performance.now()
    const res = await fill({ meta: dag(30) })
    const appended = await fill({ tags: { $append: [dag(30)] } })
    expect(performance.now() - t0).toBeLessThan(100)
    const tooComplex = { status: 'invalid', issues: [{ path: '', message: 'Input too complex' }] }
    expect(res).toEqual(tooComplex)
    expect(appended).toEqual(tooComplex)
    expect(adapter.values).toBe(before)
  })
})
