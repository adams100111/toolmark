import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { ok } from '@toolmark/core'
import { createTestRegistry } from './helpers/create-test-registry.js'

function setup() {
  const tm = createTestRegistry()
  tm.register({
    name: 'create',
    title: 'Create challenge',
    description: 'Creates a challenge',
    input: z.object({ title: z.string(), when: z.string().optional() }),
    output: z.object({ id: z.number() }),
    hints: { consequential: true },
    run: () => ok({ id: 1 }),
  })
  tm.register({ name: 'list', description: 'Lists', hints: { readOnly: true }, run: () => ok([]) })
  return tm
}

describe('manifest', () => {
  it('summary_omits_schema', () => {
    const m = setup().manifest()
    expect(m.rev).toBe(1)
    expect(m.tools[0]).toEqual({
      name: 'create',
      llmName: 'create',
      title: 'Create challenge',
      description: 'Creates a challenge',
      hints: { consequential: true },
    })
    expect(m.tools[1]).not.toHaveProperty('title')
    expect(m.tools[1]).not.toHaveProperty('inputSchema')
  })

  it('full_includes_schema', () => {
    const m = setup().manifest({ detail: 'full' })
    expect(m.tools[0]!.inputSchema).toMatchObject({
      type: 'object',
      properties: { title: { type: 'string' } },
      required: ['title'],
    })
    expect(m.tools[0]!.outputSchema).toMatchObject({ type: 'object' })
    expect(m.tools[1]!.inputSchema).toEqual({
      type: 'object',
      properties: {},
      additionalProperties: false,
    })
    expect(m.tools[1]).not.toHaveProperty('outputSchema')
  })

  it('describe_unknown_undefined', () => {
    const tm = setup()
    expect(tm.describe('nope')).toBeUndefined()
    expect(tm.describe('list')).toMatchObject({ name: 'list', inputSchema: { type: 'object' } })
  })

  it('manifest_is_json_safe', () => {
    const tm = setup()
    for (const m of [tm.manifest(), tm.manifest({ detail: 'full' }), tm.describe('create')]) {
      expect(JSON.parse(JSON.stringify(m))).toEqual(m)
    }
  })

  it('manifest_returns_copies', () => {
    const tm = setup()
    const full = tm.describe('create')!
    ;(full.inputSchema as Record<string, unknown>).type = 'mutated'
    full.hints.readOnly = true
    expect(tm.describe('create')!.inputSchema.type).toBe('object')
    expect(tm.describe('create')!.hints).toEqual({ consequential: true })
  })
})
