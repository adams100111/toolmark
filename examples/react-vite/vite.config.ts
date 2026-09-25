import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defaultClientConditions, defaultServerConditions, defineConfig } from 'vite'

const root = fileURLToPath(new URL('.', import.meta.url))

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
  build: {
    // Multi-page build (Vite): `plain-form.html` (the DOM-scan example, Task 10) alongside the
    // React app's `index.html`, so both are built and their test hooks stripped from `dist`.
    rollupOptions: {
      input: {
        main: `${root}index.html`,
        plainForm: `${root}plain-form.html`,
      },
    },
  },
})
