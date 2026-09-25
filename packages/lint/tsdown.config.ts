import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    cli: 'src/cli.ts',
  },
  format: ['esm'],
  dts: true,
  fixedExtension: false,
  target: 'es2022',
  platform: 'node',
  clean: true,
  // `src/cli.ts` starts with `#!/usr/bin/env node`; tsdown preserves it and chmods dist/cli.js 755.
  copy: [{ from: 'src/manifest.schema.json', to: 'dist' }],
  deps: {
    neverBundle: [/^@toolmark\//, /^ajv$/, /^ajv-formats$/, /^@playwright\/test$/],
  },
})
