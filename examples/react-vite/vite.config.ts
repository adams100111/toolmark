import react from '@vitejs/plugin-react'
import { defaultClientConditions, defaultServerConditions, defineConfig } from 'vite'

// `@toolmark/source` first: the example resolves the workspace packages straight to `src/*.ts`,
// no build required (overview "Source-first resolution").
export default defineConfig({
  plugins: [react()],
  resolve: {
    conditions: ['@toolmark/source', ...defaultClientConditions],
  },
  ssr: {
    resolve: {
      conditions: ['@toolmark/source', ...defaultServerConditions],
    },
  },
})
