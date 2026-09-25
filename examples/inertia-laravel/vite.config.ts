import { fileURLToPath } from 'node:url'
import { wayfinder } from '@laravel/vite-plugin-wayfinder'
import react from '@vitejs/plugin-react'
import laravel from 'laravel-vite-plugin'
import { defaultClientConditions, defaultServerConditions, defineConfig } from 'vite'

// `@toolmark/source` first: the example resolves the workspace packages straight to `src/*.ts`
// (overview "Source-first resolution"); `@toolmark/tour/styles.css` comes from the built package.
export default defineConfig({
  plugins: [
    laravel({ input: 'resources/js/app.tsx' }),
    react(),
    // Route/action files are generated at build (git-ignored). `php` may run in Docker.
    wayfinder({ command: 'scripts/php.sh php artisan wayfinder:generate' }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./resources/js', import.meta.url)) },
    conditions: ['@toolmark/source', ...defaultClientConditions],
  },
  // One app chunk is fine for an example.
  build: { chunkSizeWarningLimit: 1024 },
  ssr: {
    resolve: {
      conditions: ['@toolmark/source', ...defaultServerConditions],
    },
  },
})
