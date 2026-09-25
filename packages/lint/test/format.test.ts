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

  it('strips control characters (ESC, BEL, C1, bidi overrides) from every printed field', () => {
    const finding: Finding = {
      rule: 'name-format',
      severity: 'error',
      tool: 'evil\u001b[2J.tool',
      page: 'pa\u0007ge',
      message: 'bad \u009bname \u202etxt.exe\r\nforged line',
    }
    const pretty = formatFindings([finding], 'pretty')
    expect(pretty).toBe(
      'error name-format page evil[2J.tool: bad name txt.exeforged line\n1 error(s), 0 warning(s)',
    )
    const json = formatFindings([finding], 'json')
    expect(json).not.toMatch(/\\u00(1b|07|9b)|\\u202e|\\r|\\n/i)
    const parsed = JSON.parse(json) as { findings: Finding[] }
    expect(parsed.findings[0]).toEqual({
      rule: 'name-format',
      severity: 'error',
      tool: 'evil[2J.tool',
      page: 'page',
      message: 'bad name txt.exeforged line',
    })
  })
})
