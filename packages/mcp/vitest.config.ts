import { defineProject } from 'vitest/config'

// Vite's default conditions, prefixed with the internal source-first condition (no build needed).
const clientConditions = ['@toolmark/source', 'module', 'browser', 'development|production']
const serverConditions = ['@toolmark/source', 'module', 'node', 'development|production']

export default defineProject({
  resolve: { conditions: clientConditions },
  ssr: { resolve: { conditions: serverConditions } },
  test: {
    name: 'mcp',
    root: import.meta.dirname,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Builds `@toolmark/mcp` and its workspace dependencies once, for tests that spawn the CLI.
    globalSetup: ['test/global-setup.ts'],
  },
})
