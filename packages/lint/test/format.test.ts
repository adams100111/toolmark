import { describe, expect, it } from 'vitest'
import { formatFindings } from '../src/format.js'
import type { Finding } from '../src/types.js'

describe('formatFindings (pretty)', () => {
  it('m1_no_stray_space_for_tool_less_findings', () => {
    const finding: Finding = {
      rule: 'judge-failed',
      severity: 'warn',
      page: 'checkout',
      message: 'judge "typesafe" failed: boom',
    }
    const output = formatFindings([finding], 'pretty')
    const [line] = output.split('\n')
    // Exactly `<severity> <rule> <page>: <message>` — no tool segment, and critically no stray
    // space before the colon (the bug printed `checkout : ...` for tool-less findings).
    expect(line).toBe('warn judge-failed checkout: judge "typesafe" failed: boom')
    expect(line).not.toContain(' :')
  })

  it('keeps the tool segment when a finding is scoped to a tool', () => {
    const finding: Finding = {
      rule: 'name-format',
      severity: 'error',
      tool: 'cart.add',
      page: 'checkout',
      message: 'bad name',
    }
    const output = formatFindings([finding], 'pretty')
    const [line] = output.split('\n')
    expect(line).toBe('error name-format checkout cart.add: bad name')
  })
})
