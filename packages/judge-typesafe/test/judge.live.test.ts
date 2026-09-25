import type { ToolManifest } from '@toolmark/core'
import { describe, expect, it } from 'vitest'
import { typesafeJudge } from '../src/index.js'

/**
 * Opt-in smoke test against the real TypeSafe API. `vitest.config.ts` excludes this file unless
 * `TYPESAFE_API_KEY` is set (never in CI) — the rest of the suite (`judge.test.ts`) stubs `fetch`
 * and never touches the network.
 */
describe.skipIf(!process.env['TYPESAFE_API_KEY'])('typesafeJudge (live)', () => {
  it('gets a real answer back from api.typesafe.ai', async () => {
    const tools: ToolManifest[] = [
      {
        name: 'search.run',
        llmName: 'search_run',
        description: 'Searches the product catalog for items matching a free-text query.',
        hints: { readOnly: true },
        inputSchema: {
          type: 'object',
          properties: { query: { type: 'string', description: 'Free-text search query.' } },
        },
      },
    ]
    const findings = await typesafeJudge().judge({ page: 'live-smoke-test', tools })
    // Any finding shape is acceptable; the point is that a real request round-tripped without
    // throwing and produced the documented finding shape.
    for (const finding of findings) {
      expect(typeof finding.rule).toBe('string')
      expect(['error', 'warn']).toContain(finding.severity)
    }
  }, 30_000)
})
