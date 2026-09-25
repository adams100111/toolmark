import { describe, expect, it } from 'vitest'
import type { PageToAgentMessage } from '@toolmark/core/protocol'
import { validateMessage } from '@toolmark/core/protocol'
import { bridge, type BridgeTransport } from '@toolmark/core/bridge'
import { createTestRegistry } from './helpers/create-test-registry.js'
import { flushMicrotasks, tool } from './helpers/tools.js'

function recordingTransport() {
  const sent: PageToAgentMessage[] = []
  const transport: BridgeTransport = {
    send(message) {
      sent.push(message)
    },
    onMessage: () => () => undefined,
    close: () => undefined,
  }
  return { sent, transport }
}

describe('tool mode, origin and tm.info', () => {
  it('stepwise_mode_in_manifest', async () => {
    const tm = createTestRegistry()
    tm.register(tool('wizard.step.fill', undefined, { mode: 'stepwise' }))
    tm.register(tool('plain'))
    expect(tm.manifest().tools).toEqual([
      { name: 'plain', llmName: 'plain', description: 'Tool plain', hints: {} },
      {
        name: 'wizard.step.fill',
        llmName: 'wizard__step__fill',
        description: 'Tool wizard.step.fill',
        hints: {},
        mode: 'stepwise',
      },
    ])
    expect(tm.manifest({ detail: 'full' }).tools[1]).toMatchObject({ mode: 'stepwise' })
    expect(tm.describe('wizard.step.fill')).toMatchObject({ mode: 'stepwise' })
    expect(tm.describe('plain')).not.toHaveProperty('mode')

    await flushMicrotasks()
    const t = recordingTransport()
    tm.use(bridge({ transport: t.transport }))
    const manifest = t.sent.find((m) => m.type === 'manifest')
    expect(manifest).toMatchObject({ tools: [{ name: 'plain' }, { mode: 'stepwise' }] })
    expect(validateMessage(manifest, 'toAgent').ok).toBe(true)
  })

  it('origin_not_in_manifest', async () => {
    const tm = createTestRegistry()
    tm.register(tool('native', undefined, { origin: 'native-form', nativeName: 'book_table' }))
    tm.register(tool('dom', undefined, { origin: 'dom' }))
    const texts = [
      JSON.stringify(tm.manifest()),
      JSON.stringify(tm.manifest({ detail: 'full' })),
      JSON.stringify(tm.describe('native')),
    ]
    await flushMicrotasks()
    const t = recordingTransport()
    tm.use(bridge({ transport: t.transport }))
    texts.push(JSON.stringify(t.sent))
    for (const text of texts) {
      expect(text).not.toContain('origin')
      expect(text).not.toContain('nativeName')
      expect(text).not.toContain('book_table')
      expect(text).not.toContain('native-form')
    }
  })

  it('info_returns_origin_and_native_name', () => {
    const tm = createTestRegistry()
    const s = tm.scope('page')
    tm.register(tool('code'))
    tm.register(tool('book', undefined, { origin: 'native-form', nativeName: 'book_table' }), {
      scope: s,
    })
    tm.register(tool('srv', undefined, { origin: 'server' }))
    expect(tm.info('code')).toEqual({ origin: 'code' })
    expect(tm.info('page.book')).toEqual({ origin: 'native-form', nativeName: 'book_table' })
    expect(tm.info('srv')).toEqual({ origin: 'server' })
    expect(tm.info('book')).toBeUndefined()
    expect(tm.info('missing')).toBeUndefined()
    // Hidden (`when: false`) tools are still registered; disposed ones are gone.
    s.setWhen(false)
    expect(tm.info('page.book')).toEqual({ origin: 'native-form', nativeName: 'book_table' })
    s.dispose()
    expect(tm.info('page.book')).toBeUndefined()
    // The returned object is a copy.
    const info = tm.info('code')!
    info.origin = 'dom'
    expect(tm.info('code')).toEqual({ origin: 'code' })
  })
})
