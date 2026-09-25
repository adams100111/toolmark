// Regression tests for the 2026 release security review (docs/security/review-2026.md).
import { describe, expect, it } from 'vitest'
import { ok, type ToolmarkErrorEvent } from '@toolmark/core'
import { createTestRegistry } from './helpers/create-test-registry.js'

describe('SEC-1: a tool with only jsonSchema validates its input', () => {
  const qtySchema = {
    type: 'object',
    properties: { qty: { type: 'integer', minimum: 1, maximum: 10 } },
    required: ['qty'],
    additionalProperties: false,
  }

  it('sec_1_json_schema_only_tool_validates_input', async () => {
    const tm = createTestRegistry()
    const seen: unknown[] = []
    tm.register({
      name: 'setQty',
      description: 'd',
      jsonSchema: qtySchema,
      run: (input) => {
        seen.push(input)
        return ok(true)
      },
    })
    for (const bad of [{ qty: -5 }, { qty: 3, extra: 'x' }, 'not an object', {}]) {
      const r = await tm.call('setQty', bad, { caller: 'inapp' })
      expect(r.status).toBe('invalid')
    }
    expect(seen).toEqual([])
    expect((await tm.call('setQty', { qty: 3 }, { caller: 'inapp' })).status).toBe('ok')
    expect(seen).toEqual([{ qty: 3 }])
    expect(tm.describe('setQty')?.inputSchema).toEqual(qtySchema)
  })

  it('sec_1_json_schema_only_unsupported_schema_dev_throws', () => {
    const tm = createTestRegistry()
    expect(() =>
      tm.register({
        name: 'bad',
        description: 'd',
        jsonSchema: { type: 'object', properties: { a: { type: 'string', pattern: '(a+)+' } } },
        run: () => ok(1),
      }),
    ).toThrow(expect.objectContaining({ code: 'schema_conversion_failed' }))
    expect(tm.manifest().tools).toEqual([])
  })

  it('sec_1_json_schema_only_unsupported_schema_prod_not_registered', async () => {
    const tm = createTestRegistry({ dev: false })
    const errs: ToolmarkErrorEvent[] = []
    tm.events.on('error', (e) => errs.push(e))
    let ran = false
    tm.register({
      name: 'bad',
      description: 'd',
      jsonSchema: { type: 'object', properties: { a: { $ref: 'https://example.com/x' } } },
      run: () => {
        ran = true
        return ok(1)
      },
    })
    expect(errs).toHaveLength(1)
    expect(errs[0]).toMatchObject({ code: 'schema_conversion_failed', tool: 'bad' })
    expect(tm.manifest().tools).toEqual([])
    expect((await tm.call('bad', { a: 'x' }, { caller: 'inapp' })).status).toBe('refused')
    expect(ran).toBe(false)
  })
})
