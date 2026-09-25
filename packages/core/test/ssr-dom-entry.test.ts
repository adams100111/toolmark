import { describe, expect, it } from 'vitest'

describe('@toolmark/core/dom under Node (SSR)', () => {
  it('ssr_dom_entry_imports_under_node', async () => {
    expect(typeof globalThis.document).toBe('undefined')
    const mod = await import('@toolmark/core/dom')
    expect(typeof mod.domFormAdapter).toBe('function')
    expect(typeof mod.synthesizeFormSchema).toBe('function')
  })
})
