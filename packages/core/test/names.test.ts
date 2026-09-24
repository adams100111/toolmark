import { describe, expect, it } from 'vitest'
import { isValidToolName, toLlmName } from '@toolmark/core'

const LLM_NAME = /^[a-zA-Z0-9_-]{1,64}$/

describe('tool names', () => {
  it('valid_names', () => {
    expect(isValidToolName('a')).toBe(true)
    expect(isValidToolName('challenges.create.fill')).toBe(true)
    expect(isValidToolName('x'.repeat(128))).toBe(true)
    expect(isValidToolName('A-z_0.9')).toBe(true)
    expect(isValidToolName('')).toBe(false)
    expect(isValidToolName('a b')).toBe(false)
    expect(isValidToolName('a/b')).toBe(false)
    expect(isValidToolName('x'.repeat(129))).toBe(false)
  })

  it('llm_name_replaces_dots', () => {
    expect(toLlmName('challenges.create.fill')).toBe('challenges__create__fill')
    expect(toLlmName('plain')).toBe('plain')
  })

  it('llm_name_long_is_hashed_and_stable', () => {
    const long = 'a'.repeat(100)
    const other = 'a'.repeat(99) + 'b'
    const llm = toLlmName(long)
    expect(llm).toHaveLength(64)
    expect(llm).toMatch(LLM_NAME)
    expect(toLlmName(long)).toBe(llm)
    expect(toLlmName(other)).not.toBe(llm)
    expect(llm.slice(0, 56)).toBe('a'.repeat(55) + '_')
    expect(llm.slice(56)).toMatch(/^[0-9a-f]{8}$/)
  })

  it('llm_name_hash_is_fnv1a_over_utf8_of_full_name', () => {
    // Dots expand to `__`, so this dotted name exceeds 64 after replacement.
    const dotted = Array.from({ length: 30 }, (_, i) => `s${i}`).join('.')
    const llm = toLlmName(dotted)
    expect(llm).toHaveLength(64)
    expect(llm).toMatch(LLM_NAME)
    const expected = fnv1a(dotted)
    expect(llm.slice(-8)).toBe(expected)
  })
})

function fnv1a(s: string): string {
  let h = 0x811c9dc5
  for (const b of new TextEncoder().encode(s)) {
    h ^= b
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}
