import { describe, expect, it } from 'vitest'
import type { ToolmarkErrorEvent } from '@toolmark/core'
import { createTestRegistry } from './helpers/create-test-registry.js'
import { tool } from './helpers/tools.js'

describe('tm.info sensitivePaths', () => {
  it('info_exposes_sensitive_paths', () => {
    const tm = createTestRegistry()
    tm.register(tool('plain'))
    expect(tm.info('plain')).toEqual({ origin: 'code', sensitivePaths: [] })

    // Evaluated per call.
    let paths = ['password']
    tm.register(tool('form', undefined, { sensitivePaths: () => paths }))
    expect(tm.info('form')!.sensitivePaths).toEqual(['password'])
    paths = ['password', 'card.number']
    expect(tm.info('form')!.sensitivePaths).toEqual(['password', 'card.number'])

    // The returned list is a copy.
    tm.info('form')!.sensitivePaths.push('x')
    expect(paths).toEqual(['password', 'card.number'])

    // Non-string entries are dropped; a throwing or non-array function yields [] + tool_threw.
    const errors: ToolmarkErrorEvent[] = []
    tm.events.on('error', (e) => errors.push(e))
    tm.register(
      tool('mixed', undefined, {
        sensitivePaths: () => ['a', 1, null, 'b'] as unknown as string[],
      }),
    )
    expect(tm.info('mixed')!.sensitivePaths).toEqual(['a', 'b'])
    tm.register(
      tool('broken', undefined, {
        sensitivePaths: () => {
          throw new Error('boom')
        },
      }),
    )
    expect(tm.info('broken')).toEqual({ origin: 'code', sensitivePaths: [] })
    expect(errors).toMatchObject([{ code: 'tool_threw', tool: 'broken' }])

    // Never part of a manifest.
    expect(JSON.stringify(tm.manifest({ detail: 'full' }))).not.toContain('sensitivePaths')
    expect(tm.info('missing')).toBeUndefined()
  })
})
