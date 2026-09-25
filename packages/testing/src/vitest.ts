/**
 * `@toolmark/testing/vitest` — `createTestToolmark` for Vitest and other node-environment tests.
 * Never imports `@playwright/test` (verified by `test/vitest-entry.test.ts`).
 * @packageDocumentation
 */
export { createTestToolmark } from './test-toolmark.js'
export type { CreateTestToolmarkOptions, RecordedCall, TestToolmark } from './test-toolmark.js'
