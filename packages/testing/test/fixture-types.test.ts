import type { ToolManifest } from '@toolmark/core'
import { describe, expectTypeOf, it } from 'vitest'
import type { ToolsFixture } from '../src/index.js'

describe('ToolsFixture types', () => {
  it('get_resolves_undefined_for_unknown_or_hidden_tools', () => {
    expectTypeOf<ReturnType<ToolsFixture['get']>>().toEqualTypeOf<
      Promise<ToolManifest | undefined>
    >()
  })
})
