import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defaultClientConditions, defaultServerConditions, defineConfig } from 'vite'

const root = fileURLToPath(new URL('.', import.meta.url))

// `TOOLMARK_DIST=1` (release-candidate evidence, spec §21): resolve the workspace packages through
// their built `import` targets (dist/) instead of `src/*.ts`, so the e2e exercises the RC build.
const source = process.env.TOOLMARK_DIST === '1' ? [] : ['@toolmark/source']

// `@toolmark/source` first (unless `TOOLMARK_DIST=1`): the example resolves the workspace packages
// straight to `src/*.ts`, no build required (overview "Source-first resolution").
export default defineConfig({
  plugins: [react()],
  resolve: {
    conditions: [...source, ...defaultClientConditions],
    // `@toolmark/tour/styles.css` exports only `dist/styles.css` (no `@toolmark/source` target):
    // point it at the source stylesheet so the example needs no build (dev and `vite build`).
    alias: [
      {
        find: /^@toolmark\/tour\/styles\.css$/,
        replacement: fileURLToPath(new URL('../../packages/tour/src/styles.css', import.meta.url)),
      },
    ],
  },
  ssr: {
    resolve: {
      conditions: [...source, ...defaultServerConditions],
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
