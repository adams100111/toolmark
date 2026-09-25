import { defaultExclude, defineProject } from 'vitest/config'

// Vite's default conditions, prefixed with the internal source-first condition (no build needed).
const clientConditions = ['@toolmark/source', 'module', 'browser', 'development|production']
const serverConditions = ['@toolmark/source', 'module', 'node', 'development|production']

export default defineProject({
  resolve: { conditions: clientConditions },
  ssr: { resolve: { conditions: serverConditions } },
  test: {
    name: 'judge-typesafe',
    root: import.meta.dirname,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Live TypeSafe API calls only run when a real key is configured (CI secret or local env).
    exclude: process.env.TYPESAFE_API_KEY
      ? defaultExclude
      : [...defaultExclude, 'test/*.live.test.ts'],
  },
})
