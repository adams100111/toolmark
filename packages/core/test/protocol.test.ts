import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Ajv2020 } from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { describe, expect, it } from 'vitest'
import { PROTOCOL_VERSION, protocolSchemas, validateMessage } from '@toolmark/core/protocol'
import { emitProtocolSchemas } from '../scripts/emit-protocol-schemas.js'

type Fixture = { name: string; direction: 'toPage' | 'toAgent'; message: unknown }

const dir = join(import.meta.dirname, 'fixtures/protocol')

async function load(prefix: 'valid-' | 'invalid-'): Promise<Fixture[]> {
  const files = (await readdir(dir)).filter((f) => f.startsWith(prefix) && f.endsWith('.json'))
  return Promise.all(
    files.map(async (f) => {
      const raw = JSON.parse(await readFile(join(dir, f), 'utf8')) as Omit<Fixture, 'name'>
      return { name: f, ...raw }
    }),
  )
}

function ajvValidators() {
  const ajv = new Ajv2020({ strict: true, allErrors: true })
  ;(addFormats as unknown as (a: Ajv2020) => void)(ajv)
  return {
    toPage: ajv.compile(protocolSchemas.agentToPage),
    toAgent: ajv.compile(protocolSchemas.pageToAgent),
  }
}

describe('protocol v1', () => {
  it('valid_fixtures_pass_both_validators', async () => {
    const fixtures = await load('valid-')
    expect(fixtures.length).toBeGreaterThanOrEqual(10)
    const ajv = ajvValidators()
    for (const f of fixtures) {
      const r = validateMessage(f.message, f.direction)
      expect(r, `${f.name}: ${r.ok ? '' : r.reason}`).toMatchObject({ ok: true })
      expect(ajv[f.direction](f.message), `${f.name} (ajv)`).toBe(true)
    }
  })

  it('invalid_fixtures_fail_both_validators', async () => {
    const fixtures = await load('invalid-')
    expect(fixtures.length).toBeGreaterThanOrEqual(6)
    const ajv = ajvValidators()
    for (const f of fixtures) {
      expect(validateMessage(f.message, f.direction).ok, f.name).toBe(false)
      expect(ajv[f.direction](f.message), `${f.name} (ajv)`).toBe(false)
    }
  })

  it('unsupported_protocol_reports_id', () => {
    expect(
      validateMessage(
        { protocol: 2, type: 'call', clientId: 'k', id: 'c9', tool: 'x', input: {} },
        'toPage',
      ),
    ).toEqual({ ok: false, reason: 'unsupported protocol', unsupportedProtocol: true, id: 'c9' })
    expect(validateMessage({ protocol: '1', type: 'cancel' }, 'toPage')).toEqual({
      ok: false,
      reason: 'unsupported protocol',
      unsupportedProtocol: true,
    })
    expect(PROTOCOL_VERSION).toBe(1)
  })

  it('validate_message_returns_message', () => {
    const msg = { protocol: 1, type: 'cancel', clientId: 'k', id: 'c1' }
    expect(validateMessage(msg, 'toPage')).toEqual({ ok: true, message: msg })
    expect(validateMessage(msg, 'toAgent').ok).toBe(false)
  })

  it('schemas_have_ids', () => {
    expect(protocolSchemas.pageToAgent.$id).toBe('urn:toolmark:protocol:v1:page-to-agent')
    expect(protocolSchemas.agentToPage.$id).toBe('urn:toolmark:protocol:v1:agent-to-page')
    for (const s of Object.values(protocolSchemas)) {
      expect(s.$schema).toBe('https://json-schema.org/draft/2020-12/schema')
    }
  })

  it('emitted_schema_files_match_exports', async () => {
    const out = await mkdtemp(join(tmpdir(), 'toolmark-protocol-'))
    try {
      await emitProtocolSchemas(out)
      const p2a = JSON.parse(await readFile(join(out, 'page-to-agent.json'), 'utf8')) as unknown
      const a2p = JSON.parse(await readFile(join(out, 'agent-to-page.json'), 'utf8')) as unknown
      expect(p2a).toEqual(protocolSchemas.pageToAgent)
      expect(a2p).toEqual(protocolSchemas.agentToPage)
    } finally {
      await rm(out, { recursive: true, force: true })
    }
  })
})
