import { playwright } from '@vitest/browser-playwright'
import { defineProject } from 'vitest/config'

// Vite's default conditions, prefixed with the internal source-first condition (no build needed).
const clientConditions = ['@toolmark/source', 'module', 'browser', 'development|production']
const serverConditions = ['@toolmark/source', 'module', 'node', 'development|production']

export default defineProject({
  resolve: { conditions: clientConditions },
  ssr: { resolve: { conditions: serverConditions } },
  // Pre-bundle what DOM tests import up front so a mid-run dependency discovery cannot reload the
  // browser page (React fixtures use `React.createElement` + `react-dom/client`, no JSX).
  optimizeDeps: { include: ['react', 'react-dom/client'] },
  test: {
    name: 'core-browser',
    root: import.meta.dirname,
    include: ['test/{dom,browser}-*.test.ts'],
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [{ browser: 'chromium' }],
    },
  },
})
