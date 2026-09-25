import { playwright } from '@vitest/browser-playwright'
import { defineProject } from 'vitest/config'

// Vite's default conditions, prefixed with the internal source-first condition (no build needed).
const clientConditions = ['@toolmark/source', 'module', 'browser', 'development|production']
const serverConditions = ['@toolmark/source', 'module', 'node', 'development|production']

export default defineProject({
  resolve: { conditions: clientConditions },
  ssr: { resolve: { conditions: serverConditions } },
  // Pre-bundle every dependency the test files and sources import in the browser up front. Without
  // this, Vite's initial dependency scan can miss one (esp. ones only reached through JSX's
  // implicit runtime import), discover it mid-run, and reload the browser page — which Vitest
  // surfaces as "Failed to import test file … Vitest failed to find the current suite" for every
  // file in flight at the time.
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-dom/client',
      'react/jsx-runtime',
      'react/jsx-dev-runtime',
      'react-hook-form',
      '@testing-library/react',
      'zod',
    ],
  },
  test: {
    name: 'react',
    root: import.meta.dirname,
    include: ['test/**/*.test.{ts,tsx}'],
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      // Spec §21: every DOM suite runs on Chromium, Firefox and WebKit (CI selects one instance per
      // job with `--project '<name> (<browser>)'`).
      instances: [{ browser: 'chromium' }, { browser: 'firefox' }, { browser: 'webkit' }],
    },
  },
})
