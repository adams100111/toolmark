import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createFormTools,
  fromJsonSchema,
  ok,
  setPath,
  type FormAdapter,
  type JsonSchema,
  type OptionsProvider,
  type ToolmarkErrorEvent,
} from '@toolmark/core'
import { createTestRegistry } from './helpers/create-test-registry.js'

const HINT = ' (use f.options to find valid values)'

const inputJson: JsonSchema = {
  type: 'object',
  properties: {
    owner: { type: 'string', description: 'Owner member id' },
    count: { type: 'number' },
    sponsors: {
      type: 'array',
      items: {
        type: 'object',
        properties: { memberId: { type: 'string' }, role: { type: 'string' } },
        required: ['memberId'],
      },
    },
  },
  required: ['owner'],
}

function makeAdapter(): FormAdapter {
  let values: Record<string, unknown> = { owner: '', sponsors: [] }
  return {
    getValues: () => values,
    setValues: (v) => {
      for (const [p, x] of Object.entries(v)) values = setPath(values, p, x)
    },
    dirtyPaths: () => [],
    submit: () => Promise.resolve(ok(null)),
    fields: () => [],
  }
}

function setup(options: Record<string, OptionsProvider>) {
  const tm = createTestRegistry()
  const errors: ToolmarkErrorEvent[] = []
  tm.events.on('error', (e) => errors.push(e))
  const handle = createFormTools(tm, makeAdapter(), {
    name: 'f',
    description: 'Form.',
    input: fromJsonSchema(inputJson),
    options,
  })
  const lookup = (input: unknown, signal?: AbortSignal) =>
    tm.call('f.options', input, { caller: 'inapp', ...(signal ? { signal } : {}) })
  return { tm, handle, lookup, errors }
}

const items = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ value: `m${i}`, title: `M ${i}` }))

/** Property schema of the fill tool's `values` at a JSON-Schema property chain. */
function fillProp(tm: ReturnType<typeof createTestRegistry>, ...keys: string[]): JsonSchema {
  let node = (tm.describe('f.fill')?.inputSchema.properties as Record<string, JsonSchema>).values!
  for (const k of keys) node = (node.properties as Record<string, JsonSchema>)[k]!
  return node
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('form options', () => {
  it('options_tool_registered_and_truncated', async () => {
    const calls: { query: string; signal: AbortSignal }[] = []
    const owner: OptionsProvider = (args) => {
      calls.push(args)
      return Promise.resolve(items(60))
    }
    const { tm, handle, lookup } = setup({ owner, 'sponsors[].memberId': owner })

    const summary = tm.manifest().tools.find((t) => t.name === 'f.options')
    expect(summary?.hints).toMatchObject({ readOnly: true, untrustedContent: true })
    const described = tm.describe('f.options')
    expect(described?.inputSchema).toMatchObject({
      type: 'object',
      properties: {
        field: { type: 'string', enum: ['owner', 'sponsors[].memberId'] },
        query: { type: 'string' },
      },
      required: ['field'],
    })

    const result = await lookup({ field: 'owner', query: 'ab' })
    expect(result).toEqual(ok({ options: items(50) }))
    expect(calls[0]?.query).toBe('ab')
    expect(calls[0]?.signal).toBeInstanceOf(AbortSignal)
    await lookup({ field: 'owner' })
    expect(calls[1]?.query).toBe('')

    expect((await lookup({ field: 'nope' })).status).toBe('invalid')
    expect((await lookup({ field: 'owner', query: 5 })).status).toBe('invalid')
    expect((await lookup({ field: 'owner', extra: 1 })).status).toBe('invalid')

    handle.dispose()
    expect(tm.manifest().tools.map((t) => t.name)).toEqual([])

    // No `options` (or an empty map) → no options tool.
    const plain = createTestRegistry()
    createFormTools(plain, makeAdapter(), {
      name: 'f',
      description: 'F.',
      input: fromJsonSchema(inputJson),
    })
    createFormTools(plain, makeAdapter(), {
      name: 'g',
      description: 'G.',
      input: fromJsonSchema(inputJson),
      options: {},
    })
    expect(plain.manifest().tools.map((t) => t.name)).toEqual([
      'f.fill',
      'f.submit',
      'g.fill',
      'g.submit',
    ])
  })

  it('options_provider_error_result', async () => {
    const boom = new Error('db down: secret detail')
    const { lookup, errors } = setup({
      owner: () => Promise.reject(boom),
      count: () => {
        throw boom
      },
      'sponsors[].memberId': () => Promise.resolve('not an array' as never),
    })
    const failed = { status: 'error', message: 'Options lookup failed' }
    expect(await lookup({ field: 'owner' })).toEqual(failed)
    expect(await lookup({ field: 'count' })).toEqual(failed)
    expect(await lookup({ field: 'sponsors[].memberId' })).toEqual(failed)
    // Details go to events only.
    const lookupErrors = errors.filter((e) => e.tool === 'f.options')
    expect(lookupErrors.map((e) => e.code)).toEqual(['tool_threw', 'tool_threw', 'tool_threw'])
    expect(lookupErrors.filter((e) => e.cause === boom)).toHaveLength(2)
  })

  it('options_provider_timeout', async () => {
    const timeout = new AbortController()
    const spy = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => timeout.signal)
    let seen: AbortSignal | undefined
    const lastSignal = (): AbortSignal | undefined => seen
    // The provider ignores its signal and never settles: the lookup must still end.
    const { lookup } = setup({
      owner: ({ signal }) => {
        seen = signal
        return new Promise(() => {})
      },
    })
    const pending = lookup({ field: 'owner' })
    await vi.waitFor(() => expect(seen).toBeDefined())
    expect(spy).toHaveBeenCalledWith(10000)
    timeout.abort(new DOMException('The operation timed out.', 'TimeoutError'))
    expect(await pending).toEqual({ status: 'error', message: 'Options lookup timed out' })
    expect(seen?.aborted).toBe(true)

    // A caller abort cancels the lookup and reaches the provider's signal.
    spy.mockImplementation(() => new AbortController().signal)
    const caller = new AbortController()
    seen = undefined
    const cancelledCall = lookup({ field: 'owner' }, caller.signal)
    await vi.waitFor(() => expect(seen).toBeDefined())
    caller.abort()
    expect(await cancelledCall).toEqual({ status: 'cancelled', by: 'signal' })
    expect(lastSignal()?.aborted).toBe(true)
  })

  it('options_invalid_items_dropped', async () => {
    const { lookup } = setup({
      owner: () =>
        Promise.resolve([
          { value: 'a', title: 'A' },
          { value: 2, title: 'Two' },
          { value: false, title: 'No', extra: 'dropped key' },
          { value: null, title: 'null value' },
          { value: {}, title: 'object value' },
          { value: 'x' },
          { value: 'y', title: 5 },
          { value: Number.NaN, title: 'NaN' },
          null,
          'str',
          [],
        ] as never),
    })
    expect(await lookup({ field: 'owner' })).toEqual(
      ok({
        options: [
          { value: 'a', title: 'A' },
          { value: 2, title: 'Two' },
          { value: false, title: 'No' },
        ],
      }),
    )
  })

  it('options_array_row_path', async () => {
    const seen: string[] = []
    const { tm, lookup } = setup({
      'sponsors[].memberId': ({ query }) => {
        seen.push(query)
        return Promise.resolve([{ value: 'm1', title: 'Member 1' }])
      },
    })
    expect(await lookup({ field: 'sponsors[].memberId', query: 'mem' })).toEqual(
      ok({ options: [{ value: 'm1', title: 'Member 1' }] }),
    )
    expect(seen).toEqual(['mem'])

    // The fill schema annotates the row field in the replace branch and the `$append` branch.
    const sponsors = fillProp(tm, 'sponsors')
    const [replace, append] = sponsors.anyOf as JsonSchema[]
    const rowReplace = ((replace!.items as JsonSchema).properties as Record<string, JsonSchema>)
      .memberId!
    const rowAppend = (
      ((append!.properties as Record<string, JsonSchema>).$append!.items as JsonSchema)
        .properties as Record<string, JsonSchema>
    ).memberId!
    for (const row of [rowReplace, rowAppend]) {
      expect(row).toEqual({ type: 'string', description: HINT.trimStart() })
    }
    expect(fillProp(tm, 'owner').description).toBe('Owner member id')

    // Filling a row with an option value works as a normal array fill.
    expect(
      (
        await tm.call(
          'f.fill',
          { values: { sponsors: { $append: [{ memberId: 'm1' }] } } },
          { caller: 'inapp' },
        )
      ).status,
    ).toBe('ok')
  })

  it('options_description_hint_in_fill_schema', () => {
    const noop: OptionsProvider = () => Promise.resolve([])
    const { tm } = setup({ owner: noop, count: noop })
    expect(fillProp(tm, 'owner')).toEqual({
      type: 'string',
      description: `Owner member id${HINT}`,
    })
    expect(fillProp(tm, 'count')).toEqual({ type: 'number', description: HINT.trimStart() })
    // The validation schema is untouched.
    expect((inputJson.properties as Record<string, JsonSchema>).owner).toEqual({
      type: 'string',
      description: 'Owner member id',
    })
    expect(tm.describe('f.options')?.description).toMatch(/owner/)
  })
})
