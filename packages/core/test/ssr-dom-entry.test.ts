import { describe, expect, it } from 'vitest'

describe('@toolmark/core/dom under Node (SSR)', () => {
  it('ssr_dom_entry_imports_under_node', async () => {
    expect(typeof globalThis.document).toBe('undefined')
    const mod = await import('@toolmark/core/dom')
    expect(typeof mod.domFormAdapter).toBe('function')
    expect(typeof mod.synthesizeFormSchema).toBe('function')
  })

  it('scan_dom_ssr_noop', async () => {
    const { createToolmark } = await import('@toolmark/core')
    const { scanDom } = await import('@toolmark/core/dom')
    const tm = createToolmark()
    const off = scanDom()(tm)
    expect(tm.manifest().tools).toEqual([])
    expect(() => off()).not.toThrow()
    expect(() => tm.use(scanDom({ observe: true }))()).not.toThrow()
  })
})
