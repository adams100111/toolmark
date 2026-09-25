import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      'packages/core/vitest.node.config.ts',
      'packages/core/vitest.browser.config.ts',
      'packages/react/vitest.config.ts',
      'packages/inertia/vitest.config.ts',
      'packages/testing/vitest.config.ts',
      'packages/mcp/vitest.config.ts',
    ],
  },
})
