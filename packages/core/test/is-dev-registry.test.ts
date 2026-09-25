import { describe, expect, it } from 'vitest'
import { createToolmark, isDevRegistry, type Toolmark } from '@toolmark/core'

describe('isDevRegistry', () => {
  it('is_dev_registry_reads_dev_option', () => {
    expect(isDevRegistry(createToolmark({ dev: true, __environment: 'browser' }))).toBe(true)
    expect(isDevRegistry(createToolmark({ dev: false, __environment: 'browser' }))).toBe(false)
    expect(isDevRegistry(createToolmark({ __environment: 'browser' }))).toBe(false)
  })

  it('is_dev_registry_false_for_ssr_and_unknown', () => {
    expect(isDevRegistry(createToolmark({ dev: true, __environment: 'server' }))).toBe(false)
    expect(isDevRegistry({} as Toolmark)).toBe(false)
  })
})
