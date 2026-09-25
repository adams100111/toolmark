import { describe, expect, it } from 'vitest'
import { createToolmark, ok } from '@toolmark/core'

describe('core-browser project', () => {
  it('browser_smoke_document_defined', async () => {
    expect(typeof document).toBe('object')
    // Without `__environment`, a real browser registry is live (not the SSR-inert one).
    const tm = createToolmark()
    tm.register({ name: 'ping', description: 'Ping.', run: () => ok('pong') })
    expect(tm.manifest().tools.map((t) => t.name)).toEqual(['ping'])
    await expect(tm.call('ping', undefined, { caller: 'test' })).resolves.toEqual(ok('pong'))
  })
})
