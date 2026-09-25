import { defineProject } from 'vitest/config'

// Vite's default conditions, prefixed with the internal source-first condition (no build needed).
const clientConditions = ['@toolmark/source', 'module', 'browser', 'development|production']
const serverConditions = ['@toolmark/source', 'module', 'node', 'development|production']

export default defineProject({
  resolve: { conditions: clientConditions },
  ssr: { resolve: { conditions: serverConditions } },
  test: {
    name: 'core-node',
    root: import.meta.dirname,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    exclude: ['test/{dom,browser}-*.test.ts'],
  },
})
