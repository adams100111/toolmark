import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    bin: 'src/bin.ts',
  },
  format: ['esm'],
  dts: true,
  fixedExtension: false,
  target: 'es2022',
  platform: 'node',
  clean: true,
  // `src/bin.ts` starts with `#!/usr/bin/env node`; tsdown preserves it and chmods dist/bin.js 755.
  copy: [{ from: 'src/manifest.schema.json', to: 'dist' }],
  deps: {
    neverBundle: [/^@toolmark\//, /^ajv$/, /^ajv-formats$/, /^@playwright\/test$/],
  },
})
