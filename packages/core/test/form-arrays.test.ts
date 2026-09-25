import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  createFormTools,
  flatten,
  ok,
  setPath,
  type FieldInfo,
  type FormAdapter,
  type JsonSchema,
} from '@toolmark/core'
import { createTestRegistry } from './helpers/create-test-registry.js'

type Item = { name: string }
type Values = { title: string; tags: Item[]; nums?: number[] }

const schema = z.object({
  title: z.string(),
  tags: z.array(z.object({ name: z.string().min(1) })),
  nums: z.array(z.number()).optional(),
})

/** In-memory adapter: agent writes mark the written path dirty, user edits mark leaves dirty. */
class FakeAdapter implements FormAdapter<Values> {
  values: Values = { title: '', tags: [{ name: 'a' }, { name: 'b' }] }
  dirty = new Set<string>()
  getValues(): Values {
    return this.values
  }
  setValues(values: Record<string, unknown>): void {
    for (const [path, v] of Object.entries(values)) {
      this.values = setPath(this.values, path, v === null ? [] : v)
      this.dirty.add(path)
    }
  }
  dirtyPaths(): string[] {
    return [...this.dirty]
  }
  submit() {
    return Promise.resolve(ok(null))
  }
  fields(): FieldInfo[] {
    return []
  }
  userTypes(path: string, value: unknown): void {
    this.values = setPath(this.values, path, value)
    this.dirty.add(path)
  }
}

function setup() {
  const tm = createTestRegistry()
  const adapter = new FakeAdapter()
  createFormTools(tm, adapter, { name: 'f', description: 'Form.', input: schema })
  const fill = (values: unknown, overwrite?: boolean) =>
    tm.call('f.fill', overwrite === undefined ? { values } : { values, overwrite }, {
      caller: 'inapp',
    })
  return { tm, adapter, fill }
}

const names = (a: FakeAdapter) => a.values.tags.map((t) => t.name)

describe('form arrays', () => {
  it('array_replace_append_remove', async () => {
    const { adapter, fill } = setup()
    expect(await fill({ tags: [{ name: 'x' }, { name: 'y' }, { name: 'z' }] })).toEqual(
      ok({
        changes: [
          {
            path: 'tags',
            before: [{ name: 'a' }, { name: 'b' }],
            after: [{ name: 'x' }, { name: 'y' }, { name: 'z' }],
          },
        ],
        skipped: [],
      }),
    )
    const appended = await fill({ tags: { $append: [{ name: 'w' }] } })
    expect(appended.status).toBe('ok')
    expect(names(adapter)).toEqual(['x', 'y', 'z', 'w'])
    // Indexes refer to the current array; order in the op does not matter.
    expect((await fill({ tags: { $remove: [0, 2] } })).status).toBe('ok')
    expect(names(adapter)).toEqual(['y', 'w'])
    // Appended items are validated by the merged full-schema run.
    const bad = await fill({ tags: { $append: [{ name: '' }] } })
    expect(bad.status).toBe('invalid')
    expect(bad.status === 'invalid' && bad.issues.map((i) => i.path)).toEqual(['tags.2.name'])
    expect(names(adapter)).toEqual(['y', 'w'])
    // Primitive arrays and appending to an absent array.
    expect((await fill({ nums: { $append: [1, 2] } })).status).toBe('ok')
    expect(adapter.values.nums).toEqual([1, 2])
    expect((await fill({ nums: { $append: ['3'] } })).status).toBe('invalid')
  })

  it('array_remove_out_of_range_invalid', async () => {
    const { adapter, fill } = setup()
    for (const indexes of [[2], [-1], [0.5], [0, 0], ['0'], [Number.NaN]]) {
      const r = await fill({ tags: { $remove: indexes } })
      expect(r.status, JSON.stringify(indexes)).toBe('invalid')
      expect(r.status === 'invalid' && r.issues.map((i) => i.path)).toEqual(['tags'])
    }
    expect((await fill({ tags: { $remove: 'nope' } })).status).toBe('invalid')
    expect((await fill({ nums: { $remove: [0] } })).status).toBe('invalid')
    expect(names(adapter)).toEqual(['a', 'b'])
    // Nothing else in the same fill is set either.
    expect((await fill({ title: 'T', tags: { $remove: [9] } })).status).toBe('invalid')
    expect(adapter.values.title).toBe('')
  })

  it('array_op_both_keys_invalid', async () => {
    const { adapter, fill } = setup()
    for (const op of [
      { $append: [{ name: 'c' }], $remove: [0] },
      { $append: [{ name: 'c' }], extra: 1 },
      { $prepend: [{ name: 'c' }] },
      { $append: { name: 'c' } },
      {},
    ]) {
      const r = await fill({ tags: op })
      expect(r.status, JSON.stringify(op)).toBe('invalid')
      expect(r.status === 'invalid' && r.issues.map((i) => i.path)).toEqual(['tags'])
    }
    // An array op on a non-array field is invalid too.
    const r = await fill({ title: { $append: ['x'] } })
    expect(r.status === 'invalid' && r.issues.map((i) => i.path)).toEqual(['title'])
    expect(names(adapter)).toEqual(['a', 'b'])
    expect(adapter.values.title).toBe('')
  })

  it('array_ops_in_fill_schema', () => {
    const { tm } = setup()
    const values = (tm.describe('f.fill')!.inputSchema.properties as Record<string, JsonSchema>)
      .values!
    const tags = (values.properties as Record<string, JsonSchema>).tags!
    const item = {
      type: 'object',
      properties: { name: { type: 'string', minLength: 1 } },
      required: ['name'],
    }
    expect(tags).toMatchObject({
      anyOf: [
        { type: 'array', items: { type: 'object', properties: { name: { type: 'string' } } } },
        {
          type: 'object',
          properties: { $append: { type: 'array', items: item } },
          required: ['$append'],
          additionalProperties: false,
        },
        {
          type: 'object',
          properties: {
            $remove: { type: 'array', items: { type: 'integer', minimum: 0 }, uniqueItems: true },
          },
          required: ['$remove'],
          additionalProperties: false,
        },
      ],
    })
    // The replace branch is the stripped schema (no `required`).
    expect(JSON.stringify((tags.anyOf as unknown[])[0])).not.toContain('"required"')
    expect(values).not.toHaveProperty('required')
    const nums = (values.properties as Record<string, JsonSchema>).nums!
    expect((nums.anyOf as JsonSchema[])[1]).toMatchObject({
      properties: { $append: { type: 'array', items: { type: 'number' } } },
    })
    expect((values.properties as Record<string, JsonSchema>).title).toEqual({ type: 'string' })
  })

  it('array_changes_whole_unit', async () => {
    const { fill } = setup()
    const r = await fill({ tags: [{ name: 'a' }, { name: 'B' }] })
    expect(r).toEqual(
      ok({
        changes: [
          {
            path: 'tags',
            before: [{ name: 'a' }, { name: 'b' }],
            after: [{ name: 'a' }, { name: 'B' }],
          },
        ],
        skipped: [],
      }),
    )
    // Structurally equal array → no change.
    expect(await fill({ tags: [{ name: 'a' }, { name: 'B' }] })).toEqual(
      ok({ changes: [], skipped: [] }),
    )
    expect(flatten({ tags: [{ name: 'a' }] })).toEqual({ tags: [{ name: 'a' }] })
    expect(flatten({ tags: [{ name: 'a' }], n: [] }, { arraysAsLeaves: false })).toEqual({
      'tags.0.name': 'a',
    })
  })

  it('array_user_edited_when_child_dirty', async () => {
    const { adapter, fill } = setup()
    adapter.userTypes('tags.1.name', 'mine')
    expect(await fill({ tags: [{ name: 'x' }] })).toEqual(ok({ changes: [], skipped: ['tags'] }))
    expect(await fill({ tags: { $remove: [0] } })).toEqual(ok({ changes: [], skipped: ['tags'] }))
    expect(names(adapter)).toEqual(['a', 'mine'])
    const forced = await fill({ tags: { $remove: [0] } }, true)
    expect(forced.status).toBe('ok')
    expect(names(adapter)).toEqual(['mine'])
    // Once the agent wrote the array and nothing changed since, it is no longer user-edited.
    expect((await fill({ tags: [{ name: 'q' }] })).status).toBe('ok')
    expect(names(adapter)).toEqual(['q'])
    // A later user edit under the agent-set array marks it user-edited again.
    adapter.userTypes('tags.0.name', 'again')
    expect(await fill({ tags: [{ name: 'r' }] })).toEqual(ok({ changes: [], skipped: ['tags'] }))
  })

  it('array_append_allowed_when_user_edited', async () => {
    const { adapter, fill } = setup()
    adapter.userTypes('tags.0.name', 'mine')
    const r = await fill({ tags: { $append: [{ name: 'c' }] } })
    expect(r).toEqual(
      ok({
        changes: [
          {
            path: 'tags',
            before: [{ name: 'mine' }, { name: 'b' }],
            after: [{ name: 'mine' }, { name: 'b' }, { name: 'c' }],
          },
        ],
        skipped: [],
      }),
    )
    expect(names(adapter)).toEqual(['mine', 'b', 'c'])
  })

  it('array_undo_restores_whole_array', async () => {
    const { tm, adapter } = setup()
    let callId = ''
    tm.events.on('call', (e) => (callId = e.callId))
    await tm.call('f.fill', { values: { tags: { $append: [{ name: 'c' }] } } }, { caller: 'inapp' })
    expect(names(adapter)).toEqual(['a', 'b', 'c'])
    const undo = await tm.undo(callId)
    expect(undo.status).toBe('ok')
    expect(names(adapter)).toEqual(['a', 'b'])
    expect(undo).toEqual(
      ok({
        changes: [
          {
            path: 'tags',
            before: [{ name: 'a' }, { name: 'b' }, { name: 'c' }],
            after: [{ name: 'a' }, { name: 'b' }],
          },
        ],
        skipped: [],
      }),
    )
  })
})
