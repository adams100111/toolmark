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
  // file in flight at the time. `@inertiajs/core` is deliberately omitted: it's only a transitive
  // dependency (via `@inertiajs/react`), not resolvable by bare specifier from this package's own
  // node_modules under pnpm's isolation, so listing it here just fails to resolve; Vite's scanner
  // still discovers and bundles it as part of `@inertiajs/react`'s own dependency graph.
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-dom/client',
      'react/jsx-runtime',
      'react/jsx-dev-runtime',
      '@testing-library/react',
      '@inertiajs/react',
    ],
  },
  test: {
    name: 'inertia',
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
