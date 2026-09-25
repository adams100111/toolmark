import { describe, expectTypeOf, it } from 'vitest'
import type { WebMCP } from 'webmcp-types'
import type { ModelContextLike } from '@toolmark/core/webmcp'

describe('webmcp types', () => {
  it('native_model_context_assignable', () => {
    // The live-spec `ModelContext` (webmcp-types) satisfies the adapter's local structural type.
    expectTypeOf<WebMCP.ModelContext>().toExtend<ModelContextLike>()
  })
})
