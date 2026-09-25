import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { z as z3 } from 'zod/v3'
import { ok, type ToolmarkErrorEvent } from '@toolmark/core'
import { createTestRegistry } from './helpers/create-test-registry.js'

// A zod 3 schema has no Standard JSON Schema, so without a converter resolution fails.
const zod3Input = () => z3.object({ title: z3.string().min(1) })

describe('registry schema resolution', () => {
  it('resolve_fails_dev_throws', () => {
    const tm = createTestRegistry()
    let err: unknown
    try {
      tm.register({
        name: 'challenges.create',
        description: 'd',
        input: zod3Input(),
        run: () => ok(1),
      })
    } catch (e) {
      err = e
    }
    expect(err).toMatchObject({ code: 'schema_conversion_failed' })
    expect((err as Error).message).toContain('challenges.create')
    expect((err as Error).message).toContain('jsonSchema')
    expect(tm.manifest().tools).toEqual([])
  })

  it('resolve_fails_prod_event', async () => {
    const tm = createTestRegistry({ dev: false })
    const errs: ToolmarkErrorEvent[] = []
    tm.events.on('error', (e) => errs.push(e))
    let ran = false
    tm.register({
      name: 'challenges.create',
      description: 'd',
      input: zod3Input(),
      run: () => {
        ran = true
        return ok(1)
      },
    })
    expect(errs).toHaveLength(1)
    expect(errs[0]).toMatchObject({ code: 'schema_conversion_failed', tool: 'challenges.create' })
    expect(errs[0]!.message).toContain('jsonSchema')
    expect(tm.describe('challenges.create')?.inputSchema).toEqual({})
    const r = await tm.call('challenges.create', { title: '' }, { caller: 'inapp' })
    expect(r.status).toBe('invalid')
    expect(ran).toBe(false)
    expect((await tm.call('challenges.create', { title: 'x' }, { caller: 'inapp' })).status).toBe(
      'ok',
    )
  })

  it('zod4_schema_resolves_in_manifest', () => {
    const tm = createTestRegistry()
    tm.register({
      name: 'x',
      description: 'd',
      input: z.object({ a: z.string() }),
      run: () => ok(1),
    })
    const full = tm.describe('x')!
    expect(full.inputSchema).toMatchObject({
      type: 'object',
      properties: { a: { type: 'string' } },
    })
  })
})
