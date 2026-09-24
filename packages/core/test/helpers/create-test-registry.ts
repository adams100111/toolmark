import { createToolmark, type Toolmark, type ToolmarkOptions } from '@toolmark/core'

/**
 * Test-only registry factory for node-environment tests: development mode on by default and the
 * browser environment forced (`__environment: 'browser'`), so registration is not inert.
 * @param opts - Options merged over `{ dev: true }`.
 */
export function createTestRegistry(opts?: ToolmarkOptions): Toolmark {
  return createToolmark({ dev: true, ...opts, __environment: 'browser' })
}
