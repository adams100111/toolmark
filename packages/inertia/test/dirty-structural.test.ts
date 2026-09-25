import { createFormTools, createToolmark, type StandardSchemaV1 } from '@toolmark/core'
import { describe, expect, it } from 'vitest'
import { inertiaAdapter, type InertiaFormLike, type InertiaVisitCallbacks } from '../src/index.js'

interface Values extends Record<string, unknown> {
  title: string
  tags: string[]
  due: Date
}

/**
 * A fake `useForm()` whose keyed `setData` deep-clones the data like Inertia does, so untouched
 * array and Date fields get new identities on every user edit.
 */
function fakeInertiaForm(initial: Values): {
  form: () => InertiaFormLike<Values>
  userSetData: (key: keyof Values, value: unknown) => void
} {
  let data = initial
  const setData = (d: Values): void => {
    data = d
  }
  return {
    form: () => ({
      data,
      setData,
      errors: {},
      transform: () => undefined,
      submit: (_m: string, _u: string, _o: InertiaVisitCallbacks) => undefined,
    }),
    userSetData: (key, value) => {
      data = { ...structuredClone(data), [key]: value }
    },
  }
}

const passthrough: StandardSchemaV1<Record<string, unknown>> = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate: (v: unknown) => ({ value: v as Record<string, unknown> }),
  },
}

describe('inertiaAdapter dirtyPaths (structural)', () => {
  it('dirty_paths_ignore_deep_cloned_untouched_array_and_date', async () => {
    const f = fakeInertiaForm({ title: '', tags: ['a'], due: new Date(0) })
    inertiaAdapter(f.form(), { submit: { method: 'post', url: '/x' } })
    f.userSetData('title', 'typed by user')
    const adapter = inertiaAdapter(f.form(), { submit: { method: 'post', url: '/x' } })
    expect(adapter.dirtyPaths()).toEqual(['title'])

    const tm = createToolmark({ __environment: 'browser' })
    createFormTools(tm, adapter, {
      name: 'f',
      description: 'd',
      input: passthrough,
      jsonSchema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
        },
      },
    })
    await new Promise((r) => setTimeout(r, 0))
    const result = await tm.call('f.fill', { values: { tags: ['b', 'c'] } }, { caller: 'inapp' })
    expect(result.status).toBe('ok')
    expect(adapter.getValues().tags).toEqual(['b', 'c'])
    expect(adapter.dirtyPaths().sort()).toEqual(['tags', 'title'])
  })
})
