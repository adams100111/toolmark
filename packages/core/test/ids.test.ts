import { afterEach, describe, expect, it, vi } from 'vitest'
import { newId } from '../src/ids.js'

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('newId', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('uses_random_uuid_when_available', () => {
    expect(newId()).toMatch(V4)
  })

  it('new_id_falls_back_without_random_uuid', () => {
    const getRandomValues = crypto.getRandomValues.bind(crypto)
    vi.stubGlobal('crypto', { getRandomValues, randomUUID: undefined })
    const ids = new Set<string>()
    for (let i = 0; i < 1000; i++) {
      const id = newId()
      expect(id).toMatch(V4)
      ids.add(id)
    }
    expect(ids.size).toBe(1000)
  })
})
