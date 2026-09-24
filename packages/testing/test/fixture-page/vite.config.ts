import { defineConfig } from 'vite'

// Vite's default client conditions, prefixed with the internal source-first condition: this dev
// page resolves `@toolmark/core` straight to `src/*.ts`, no build required.
export default defineConfig({
  resolve: {
    conditions: ['@toolmark/source', 'module', 'browser', 'development|production'],
  },
})
