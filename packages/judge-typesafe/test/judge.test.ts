import type { JsonSchema, ToolHints, ToolManifest } from '@toolmark/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import typesafeJudgeDefault, { typesafeJudge } from '../src/index.js'
import { overlapPairs } from '../src/overlap-pairs.js'
import { collectParams } from '../src/schema-params.js'
import { fakeErrorFetch, fakeSystemOneFetch } from './support/fake-fetch.js'

function tool(o: {
  name: string
  description?: string
  hints?: ToolHints
  inputSchema?: JsonSchema
}): ToolManifest {
  return {
    name: o.name,
    llmName: o.name.replace(/[.]/g, '_'),
    description: o.description ?? 'A tool with a long enough description for tests to use.',
    hints: o.hints ?? {},
    inputSchema: o.inputSchema ?? { type: 'object', properties: {} },
  }
}

const ORIGINAL_ENV_KEY = process.env['TYPESAFE_API_KEY']

beforeEach(() => {
  delete process.env['TYPESAFE_API_KEY']
})

afterEach(() => {
  if (ORIGINAL_ENV_KEY === undefined) delete process.env['TYPESAFE_API_KEY']
  else process.env['TYPESAFE_API_KEY'] = ORIGINAL_ENV_KEY
  vi.restoreAllMocks()
})

describe('default_and_named_export_same', () => {
  it('exports the same function both ways', () => {
    expect(typesafeJudgeDefault).toBe(typesafeJudge)
  })
})

describe('no_key_never_constructs_client', () => {
  it('resolves to [] and warns once on stderr, without ever constructing TypeSafeClient', async () => {
    // The real TypeSafeClient constructor throws synchronously when the key is missing/blank, so
    // a clean `[]` resolution here is only possible if the judge never calls `new TypeSafeClient`.
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const judge = typesafeJudge({ apiKey: '   ' })

    const first = await judge.judge({ page: 'p', tools: [tool({ name: 'a' })] })
    const second = await judge.judge({ page: 'p', tools: [tool({ name: 'b' })] })

    expect(first).toEqual([])
    expect(second).toEqual([])
    const warnings = stderr.mock.calls.filter(([chunk]) =>
      String(chunk).includes('TYPESAFE_API_KEY not set'),
    )
    expect(warnings).toHaveLength(1)
  })

  it('also disables when TYPESAFE_API_KEY is unset and no apiKey option is given', async () => {
    const judge = typesafeJudge()
    await expect(judge.judge({ page: 'p', tools: [] })).resolves.toEqual([])
  })
})

describe('maps_scores_and_nouls_to_findings', () => {
  it('turns low quality, high hint-probability and high overlap answers into findings', async () => {
    const tools = [
      tool({ name: 'cart.fill' }),
      tool({ name: 'shipping.fill' }), // same overlap scope as cart.fill (both `.fill`, 2 segments)
    ]
    const { fetch } = fakeSystemOneFetch([
      {
        model: 'jev-test',
        usage: { input_tokens: 1, output_tokens: 1 },
        answers: {
          'q:0': { type: 'score', score: 0.5 },
          'h:0': { type: 'noul', noul: 0.95 },
          'q:1': { type: 'score', score: 3.9 },
          'h:1': { type: 'noul', noul: 0.1 },
          'o:0:1': { type: 'noul', noul: 0.9 },
        },
      },
    ])
    const judge = typesafeJudge({ apiKey: 'k', fetch })
    const findings = await judge.judge({ page: 'p', tools })

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule: 'judge/description-quality',
          tool: 'cart.fill',
          severity: 'warn',
        }),
        expect.objectContaining({
          rule: 'judge/consequential-hint',
          tool: 'cart.fill',
          severity: 'warn',
        }),
        expect.objectContaining({ rule: 'judge/overlap', severity: 'warn' }),
      ]),
    )
    expect(findings.some((f) => f.tool === 'shipping.fill')).toBe(false)
  })
})

describe('score_threshold_uses_expected_score', () => {
  it('fires only strictly below the (fractional, 0-indexed) threshold', async () => {
    const tools = [tool({ name: 'a', hints: { readOnly: true } })]
    const { fetch: belowFetch } = fakeSystemOneFetch([
      { answers: { 'q:0': { type: 'score', score: 1.4999 } } },
    ])
    const below = await typesafeJudge({ apiKey: 'k', fetch: belowFetch }).judge({
      page: 'p',
      tools,
    })
    expect(below).toEqual([
      expect.objectContaining({ rule: 'judge/description-quality', score: 1.4999 }),
    ])

    const { fetch: atThresholdFetch } = fakeSystemOneFetch([
      { answers: { 'q:0': { type: 'score', score: 1.5 } } },
    ])
    const atThreshold = await typesafeJudge({ apiKey: 'k', fetch: atThresholdFetch }).judge({
      page: 'p',
      tools,
    })
    expect(atThreshold).toEqual([])
  })
})

describe('hint_severity_warn_unless_strict', () => {
  const tools = [tool({ name: 'orders.cancel' })]

  it('is a warn by default', async () => {
    const { fetch } = fakeSystemOneFetch([
      { answers: { 'q:0': { type: 'score', score: 4 }, 'h:0': { type: 'noul', noul: 0.99 } } },
    ])
    const findings = await typesafeJudge({ apiKey: 'k', fetch }).judge({ page: 'p', tools })
    expect(findings).toEqual([
      expect.objectContaining({ rule: 'judge/consequential-hint', severity: 'warn' }),
    ])
  })

  it('is an error with strictHints', async () => {
    const { fetch } = fakeSystemOneFetch([
      { answers: { 'q:0': { type: 'score', score: 4 }, 'h:0': { type: 'noul', noul: 0.99 } } },
    ])
    const findings = await typesafeJudge({ apiKey: 'k', fetch, strictHints: true }).judge({
      page: 'p',
      tools,
    })
    expect(findings).toEqual([
      expect.objectContaining({ rule: 'judge/consequential-hint', severity: 'error' }),
    ])
  })
})

describe('pairs_only_within_scope_excluding_siblings', () => {
  it('excludes siblings of the same form (equal name minus the last segment)', () => {
    const names = ['checkout.fill', 'checkout.submit', 'checkout.options']
    expect(overlapPairs(names.map((name) => ({ name })))).toEqual([])
  })

  it('compares two different forms that share the reduced scope', () => {
    const names = ['cart.fill', 'shipping.fill']
    const pairs = overlapPairs(names.map((name) => ({ name })))
    expect(pairs).toEqual([{ i: 0, j: 1 }])
  })

  it('compares different wizard steps under the same wizard prefix', () => {
    const names = ['wizard.billing.fill', 'wizard.shipping.fill']
    const pairs = overlapPairs(names.map((name) => ({ name })))
    expect(pairs).toEqual([{ i: 0, j: 1 }])
  })

  it('never pairs tools in different scopes', () => {
    const names = ['search.run', 'reports.run']
    expect(overlapPairs(names.map((name) => ({ name })))).toEqual([])
  })
})

describe('pairs_capped_at_max', () => {
  it('sends only maxPairs overlap questions and reports the rest as overlap-truncated', async () => {
    const tools = [
      tool({ name: 'a.fill' }),
      tool({ name: 'b.fill' }),
      tool({ name: 'c.fill' }),
      tool({ name: 'd.fill' }),
    ] // 4 tools, same scope (''), pairwise distinct parents -> 6 candidate pairs
    const { fetch, calls } = fakeSystemOneFetch([{ answers: {} }])
    const findings = await typesafeJudge({ apiKey: 'k', fetch, maxPairs: 2 }).judge({
      page: 'p',
      tools,
    })

    const sentOverlapKeys = Object.keys(calls[0]!.body.questions).filter((k) => k.startsWith('o:'))
    expect(sentOverlapKeys).toHaveLength(2)
    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule: 'judge/overlap-truncated',
          message: expect.stringContaining('4') as unknown as string,
        }),
      ]),
    )
  })
})

describe('questions_chunked_at_100', () => {
  it('splits more than 100 questions into several same-state requests', async () => {
    const tools = Array.from({ length: 60 }, (_, i) => tool({ name: `page.tool${i}` }))
    const { fetch, calls } = fakeSystemOneFetch([{ answers: {} }, { answers: {} }])
    await typesafeJudge({ apiKey: 'k', fetch }).judge({ page: 'p', tools })

    // 60 tools x (quality + hint, none hinted) = 120 questions -> two requests of 100 and 20.
    expect(calls).toHaveLength(2)
    expect(Object.keys(calls[0]!.body.questions)).toHaveLength(100)
    expect(Object.keys(calls[1]!.body.questions)).toHaveLength(20)
    expect(calls[0]!.body.state).toEqual(calls[1]!.body.state)
  })
})

describe('sdk_error_becomes_warning', () => {
  it('turns a non-2xx APIError into one judge/unavailable warning', async () => {
    const fetch = fakeErrorFetch(400, { error: 'bad request' })
    const findings = await typesafeJudge({ apiKey: 'k', fetch }).judge({
      page: 'p',
      tools: [tool({ name: 'a' })],
    })
    expect(findings).toEqual([
      expect.objectContaining({
        rule: 'judge/unavailable',
        severity: 'warn',
        message: expect.stringContaining('Error') as unknown as string,
      }),
    ])
  })
})

describe('state_contains_no_values', () => {
  it('sends only names, descriptions and schema paths, never enum/default/const/examples/values', async () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: {
        method: {
          type: 'string',
          description: 'Shipping method.',
          enum: ['standard', 'express'],
          default: 'standard',
        },
        note: { type: 'string', const: 'ignored', examples: ['x'] },
      },
    }
    const tools = [tool({ name: 'shipping.fill', inputSchema: schema })]
    const { fetch, calls } = fakeSystemOneFetch([{ answers: {} }])
    await typesafeJudge({ apiKey: 'k', fetch }).judge({ page: 'p', tools })

    const serialized = JSON.stringify(calls[0]!.body.state)
    for (const forbidden of ['enum', 'default', 'const', 'examples', 'standard', 'express']) {
      expect(serialized).not.toContain(forbidden)
    }
  })

  it('collectParams never carries a value, only path and description', () => {
    const params = collectParams({
      type: 'object',
      properties: { a: { type: 'string', description: 'd', enum: ['x'], default: 'x' } },
    })
    expect(params).toEqual([{ path: 'a', description: 'd' }])
  })
})
