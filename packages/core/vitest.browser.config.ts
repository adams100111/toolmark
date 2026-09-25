import { playwright } from '@vitest/browser-playwright'
import { defaultExclude, defineProject } from 'vitest/config'

// Vite's default conditions, prefixed with the internal source-first condition (no build needed).
const clientConditions = ['@toolmark/source', 'module', 'browser', 'development|production']
const serverConditions = ['@toolmark/source', 'module', 'node', 'development|production']

// WebMCP is Chromium-only (spec §18, §21).
const chromiumOnly = ['test/browser-webmcp-*.test.ts']

export default defineProject({
  resolve: { conditions: clientConditions },
  ssr: { resolve: { conditions: serverConditions } },
  // Pre-bundle what DOM tests import up front so a mid-run dependency discovery cannot reload the
  // browser page (React fixtures use `React.createElement` + `react-dom/client`, no JSX).
  optimizeDeps: { include: ['react', 'react-dom/client', 'zod', '@mcp-b/webmcp-polyfill'] },
  test: {
    name: 'core-browser',
    root: import.meta.dirname,
    include: ['test/{dom,browser}-*.test.ts'],
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      // Spec §21: DOM suites run on Chromium, Firefox and WebKit (CI selects one instance per job with
      // `--project 'core-browser (<browser>)'`); the WebMCP suite gates on Chromium only.
      instances: [
        { browser: 'chromium' },
        { browser: 'firefox', exclude: [...defaultExclude, ...chromiumOnly] },
        { browser: 'webkit', exclude: [...defaultExclude, ...chromiumOnly] },
      ],
    },
  },
})
