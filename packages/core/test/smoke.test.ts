import { describe, expect, it } from 'vitest'
import * as core from '@toolmark/core'

describe('smoke', () => {
  it('smoke_imports_core', () => {
    expect(core).toBeDefined()
    expect(typeof core).toBe('object')
  })
})
