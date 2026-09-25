import type { JsonSchema, ToolHints, ToolManifest } from '@toolmark/core'
import { describe, expect, it } from 'vitest'
import { rules } from '../src/rules/index.js'
import type { RuleContext } from '../src/rules/rule.js'
import { lint } from '../src/run.js'
import type { Finding, ManifestFile } from '../src/types.js'

const CTX: RuleContext = { budget: 40 }
const LONG_DESCRIPTION = 'A tool with a sufficiently long, useful description for tests.'

function tool(o: {
  name: string
  llmName?: string
  description?: string
  hints?: ToolHints
  inputSchema?: JsonSchema
}): ToolManifest {
  return {
    name: o.name,
    llmName: o.llmName ?? o.name.replace(/[.]/g, '_'),
    description: o.description ?? LONG_DESCRIPTION,
    hints: o.hints ?? {},
    inputSchema: o.inputSchema ?? { type: 'object', properties: {} },
  }
}

function page(pageName: string, tools: ToolManifest[]): ManifestFile {
  return { page: pageName, tools }
}

function ruleById(id: string): { check(file: ManifestFile, ctx: RuleContext): Finding[] } {
  const rule = rules.find((r) => r.id === id)
  if (!rule) throw new Error(`no such rule: ${id}`)
  return rule
}

function findingRules(findings: Finding[]): string[] {
  return findings.map((f) => f.rule)
}

describe('name-format', () => {
  const rule = ruleById('name-format')

  it('name_format_positive', () => {
    const bad = page('p', [
      tool({ name: 'bad..name', llmName: 'ok' }),
      tool({ name: 'ok.name', llmName: 'bad llm name!' }),
      tool({ name: '.leading', llmName: 'ok2' }),
    ])
    const findings = rule.check(bad, CTX)
    expect(findings).toHaveLength(3)
    for (const f of findings) {
      expect(f.rule).toBe('name-format')
      expect(f.severity).toBe('error')
    }
  })

  it('name_format_negative', () => {
    const good = page('p', [tool({ name: 'checkout.submit.step', llmName: 'checkout_submit' })])
    expect(rule.check(good, CTX)).toEqual([])
  })
})

describe('description-missing', () => {
  const rule = ruleById('description-missing')

  it('description_missing_positive', () => {
    const findings = rule.check(page('p', [tool({ name: 'a', description: '   ' })]), CTX)
    expect(findings).toEqual([
      expect.objectContaining({ rule: 'description-missing', severity: 'warn', tool: 'a' }),
    ])
  })

  it('description_missing_negative', () => {
    expect(rule.check(page('p', [tool({ name: 'a' })]), CTX)).toEqual([])
  })
})

describe('description-short', () => {
  const rule = ruleById('description-short')

  it('description_short_positive', () => {
    const findings = rule.check(page('p', [tool({ name: 'a', description: 'too short' })]), CTX)
    expect(findings).toEqual([
      expect.objectContaining({ rule: 'description-short', severity: 'warn', tool: 'a' }),
    ])
  })

  it('description_short_negative', () => {
    expect(rule.check(page('p', [tool({ name: 'a' })]), CTX)).toEqual([])
  })

  it('does not also fire for an empty description (that is description-missing)', () => {
    expect(rule.check(page('p', [tool({ name: 'a', description: '' })]), CTX)).toEqual([])
  })
})

describe('param-description-missing', () => {
  const rule = ruleById('param-description-missing')

  it('param_description_missing_positive', () => {
    const t = tool({
      name: 'checkout.update',
      inputSchema: {
        type: 'object',
        properties: { email: { type: 'string' } },
      },
    })
    const findings = rule.check(page('p', [t]), CTX)
    expect(findings).toEqual([
      expect.objectContaining({
        rule: 'param-description-missing',
        severity: 'warn',
        tool: 'checkout.update',
        message: expect.stringContaining('"email"') as unknown as string,
      }),
    ])
  })

  it('param_description_missing_negative', () => {
    const t = tool({
      name: 'checkout.update',
      inputSchema: {
        type: 'object',
        properties: { email: { type: 'string', description: 'Contact email.' } },
      },
    })
    expect(rule.check(page('p', [t]), CTX)).toEqual([])
  })

  it('starts .fill tools at properties.values', () => {
    const t = tool({
      name: 'checkout.fill',
      inputSchema: {
        type: 'object',
        properties: {
          values: {
            type: 'object',
            properties: { email: { type: 'string' } },
          },
        },
      },
    })
    const findings = rule.check(page('p', [t]), CTX)
    expect(findings.map((f) => f.message)).toEqual([
      expect.stringContaining('"email"') as unknown as string,
    ])
  })

  it('starts wizard .fill tools per step, prefixed with the step name', () => {
    const t = tool({
      name: 'wizard.fill',
      inputSchema: {
        type: 'object',
        properties: {
          steps: {
            type: 'object',
            properties: {
              billing: {
                type: 'object',
                properties: { email: { type: 'string' } },
              },
            },
          },
        },
      },
    })
    const findings = rule.check(page('p', [t]), CTX)
    expect(findings.map((f) => f.message)).toEqual([
      expect.stringContaining('"billing.email"') as unknown as string,
    ])
  })
})

describe('schema-invalid', () => {
  const rule = ruleById('schema-invalid')

  it('schema_invalid_positive (bad JSON Schema)', () => {
    const t = tool({ name: 'a', inputSchema: { type: 'not-a-real-type' } })
    const findings = rule.check(page('p', [t]), CTX)
    expect(findings).toEqual([
      expect.objectContaining({ rule: 'schema-invalid', severity: 'error', tool: 'a' }),
    ])
  })

  it('schema_invalid_positive (root type is not object)', () => {
    const t = tool({ name: 'a', inputSchema: { type: 'string' } })
    const findings = rule.check(page('p', [t]), CTX)
    expect(findings).toEqual([
      expect.objectContaining({ rule: 'schema-invalid', severity: 'error', tool: 'a' }),
    ])
  })

  it('schema_invalid_negative', () => {
    const t = tool({ name: 'a', inputSchema: { type: 'object', properties: {} } })
    expect(rule.check(page('p', [t]), CTX)).toEqual([])
  })

  it('schema_invalid_duplicate_id_negative', () => {
    // Tools (and pages) commonly share a schema, `$id` included; each schema compiles on its own.
    const shared = {
      $id: 'https://example.com/schemas/address.json',
      type: 'object',
      properties: { city: { type: 'string' } },
    }
    const a = tool({ name: 'a', inputSchema: { ...shared } })
    const b = tool({ name: 'b', inputSchema: { ...shared } })
    expect(rule.check(page('p1', [a, b]), CTX)).toEqual([])
    expect(rule.check(page('p2', [tool({ name: 'c', inputSchema: { ...shared } })]), CTX)).toEqual(
      [],
    )
    // Same `$id`, different content, across two lint runs.
    const other = tool({ name: 'd', inputSchema: { ...shared, required: ['city'] } })
    expect(rule.check(page('p3', [other]), CTX)).toEqual([])
  })
})

describe('llm-name-collision', () => {
  const rule = ruleById('llm-name-collision')

  it('llm_name_collision_positive', () => {
    const findings = rule.check(
      page('p', [
        tool({ name: 'a.x', llmName: 'shared' }),
        tool({ name: 'b.x', llmName: 'shared' }),
      ]),
      CTX,
    )
    expect(findings).toHaveLength(2)
    expect(findingRules(findings)).toEqual(['llm-name-collision', 'llm-name-collision'])
    expect(findings.map((f) => f.tool).sort()).toEqual(['a.x', 'b.x'])
  })

  it('llm_name_collision_negative', () => {
    const findings = rule.check(
      page('p', [tool({ name: 'a.x', llmName: 'a' }), tool({ name: 'b.x', llmName: 'b' })]),
      CTX,
    )
    expect(findings).toEqual([])
  })
})

describe('tool-budget', () => {
  const rule = ruleById('tool-budget')

  it('tool_budget_positive', () => {
    const tools = [tool({ name: 'a' }), tool({ name: 'b' }), tool({ name: 'c' })]
    const findings = rule.check(page('p', tools), { budget: 2 })
    expect(findings).toEqual([
      expect.objectContaining({ rule: 'tool-budget', severity: 'warn', page: 'p' }),
    ])
  })

  it('tool_budget_negative', () => {
    const tools = [tool({ name: 'a' }), tool({ name: 'b' })]
    expect(rule.check(page('p', tools), { budget: 2 })).toEqual([])
  })
})

describe('consequential-hint-missing', () => {
  const rule = ruleById('consequential-hint-missing')

  it('consequential_hint_missing_positive (matches a name segment)', () => {
    const t = tool({ name: 'cart.delete', description: 'Removes the whole cart contents now.' })
    const findings = rule.check(page('p', [t]), CTX)
    expect(findings).toEqual([
      expect.objectContaining({
        rule: 'consequential-hint-missing',
        severity: 'error',
        tool: 'cart.delete',
      }),
    ])
  })

  it('consequential_hint_missing_positive (matches the first sentence of the description)', () => {
    const t = tool({
      name: 'orders.finish',
      description: 'Submit the order for processing. Nothing else happens after this.',
    })
    const findings = rule.check(page('p', [t]), CTX)
    expect(findings).toHaveLength(1)
  })

  it('consequential_hint_missing_negative (has the hint)', () => {
    const t = tool({
      name: 'cart.delete',
      description: 'Removes the whole cart contents now.',
      hints: { destructive: true },
    })
    expect(rule.check(page('p', [t]), CTX)).toEqual([])
  })

  it('consequential_hint_missing_negative (readOnly is exempt)', () => {
    const t = tool({
      name: 'orders.cancelledReport',
      description: 'Reports which orders were cancelled last week, read-only.',
      hints: { readOnly: true },
    })
    expect(rule.check(page('p', [t]), CTX)).toEqual([])
  })

  it('consequential_hint_missing_negative (no trigger word)', () => {
    const t = tool({ name: 'search.run', description: 'Searches products by free text.' })
    expect(rule.check(page('p', [t]), CTX)).toEqual([])
  })
})

describe('options-without-hint', () => {
  const rule = ruleById('options-without-hint')

  function formTools(o: { optionsReadOnly: boolean; fieldEnumSuffix: boolean }): ToolManifest[] {
    return [
      tool({
        name: 'shipping.options',
        hints: o.optionsReadOnly ? { readOnly: true } : {},
        inputSchema: { type: 'object', properties: {} },
      }),
      tool({
        name: 'shipping.fill',
        inputSchema: {
          type: 'object',
          properties: {
            values: {
              type: 'object',
              properties: {
                method: {
                  type: 'string',
                  enum: ['standard', 'express'],
                  description: o.fieldEnumSuffix
                    ? 'Shipping method (use shipping.options to find valid values).'
                    : 'Shipping method.',
                },
              },
            },
          },
        },
      }),
    ]
  }

  it('options_without_hint_missing_suffix', () => {
    const findings = rule.check(
      page('p', formTools({ optionsReadOnly: true, fieldEnumSuffix: false })),
      CTX,
    )
    expect(findings).toEqual([
      expect.objectContaining({
        rule: 'options-without-hint',
        severity: 'warn',
        tool: 'shipping.fill',
        message: expect.stringContaining('"method"') as unknown as string,
      }),
    ])
  })

  it('options_without_hint_not_readonly', () => {
    const findings = rule.check(
      page('p', formTools({ optionsReadOnly: false, fieldEnumSuffix: true })),
      CTX,
    )
    expect(findings).toEqual([
      expect.objectContaining({
        rule: 'options-without-hint',
        severity: 'warn',
        tool: 'shipping.options',
      }),
    ])
  })

  it('options_without_hint_negative', () => {
    const findings = rule.check(
      page('p', formTools({ optionsReadOnly: true, fieldEnumSuffix: true })),
      CTX,
    )
    expect(findings).toEqual([])
  })
})

describe('lint()', () => {
  it('aggregates every rule and applies the budget option', async () => {
    const findings = await lint({
      manifests: [page('p', [tool({ name: 'a' }), tool({ name: 'b' })])],
      budget: 1,
    })
    expect(findingRules(findings)).toContain('tool-budget')
  })

  it('turns a throwing judge into a judge-failed warning instead of rejecting', async () => {
    const findings = await lint({
      manifests: [page('p', [tool({ name: 'a' })])],
      judges: [
        {
          name: 'boom',
          judge: () => {
            throw new Error('kaboom')
          },
        },
      ],
    })
    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule: 'judge-failed',
          severity: 'warn',
          message: expect.stringContaining('boom') as unknown as string,
        }),
      ]),
    )
  })
})
