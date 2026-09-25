/**
 * `@toolmark/testing` — a Playwright fixture + matchers that drive page tools through the in-page
 * test hook, plus a re-export of `createTestToolmark` (see `@toolmark/testing/vitest`).
 * @packageDocumentation
 * @module @toolmark/testing
 */
export { HOOK_WAIT_MS, MISSING_HOOK_MESSAGE, test } from './fixture.js'
export type { ToolsFixture } from './fixture.js'
export { expect } from './matchers.js'
export { createTestToolmark } from './test-toolmark.js'
export type { CreateTestToolmarkOptions, RecordedCall, TestToolmark } from './test-toolmark.js'
