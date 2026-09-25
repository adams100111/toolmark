import { defineProject } from 'vitest/config'

// Vite's default conditions, prefixed with the internal source-first condition (no build needed).
const clientConditions = ['@toolmark/source', 'module', 'browser', 'development|production']
// `module` dropped server-side (M3 T6): the OTel SDK packages' `module`/`esnext` build uses
// extension-less relative imports (bundler-only; invalid under strict Node ESM). With `module`
// enabled, Vite resolves the bare specifier to that build and then hands it straight to Node's
// native loader (it is already valid JS, so Vite does not transform it), which fails to resolve
// those bare relative specifiers ("Cannot find module '.../baggage/utils'"). Node's own default
// resolution (no custom conditions, as `node`/`development|production` already give here) picks
// each package's working `main`/`default` (CommonJS) build instead. No other package in this
// project's dependency graph is known to rely on the `module` condition server-side.
const serverConditions = ['@toolmark/source', 'node', 'development|production']

export default defineProject({
  resolve: { conditions: clientConditions },
  ssr: { resolve: { conditions: serverConditions } },
  test: {
    name: 'core-node',
    root: import.meta.dirname,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    exclude: ['test/{dom,browser}-*.test.ts'],
  },
})
