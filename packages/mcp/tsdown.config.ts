import { defineConfig, type UserConfig } from 'tsdown'

const shared = {
  format: ['esm'],
  dts: true,
  fixedExtension: false,
  target: 'es2022',
  deps: {
    neverBundle: [/^@toolmark\//, /^@modelcontextprotocol\//, /^ws$/],
  },
} satisfies UserConfig

// Mixed platforms: the CLI and the server API are node-only; the browser pairing entry
// (`@toolmark/mcp/client`) is neutral and must never import `ws` or `node:*`.
export default defineConfig([
  {
    ...shared,
    entry: { cli: 'src/cli.ts' },
    platform: 'node',
    banner: { js: '#!/usr/bin/env node' },
    clean: true,
  },
  {
    ...shared,
    entry: { index: 'src/index.ts' },
    platform: 'node',
    clean: false,
  },
  {
    ...shared,
    entry: { client: 'src/client/index.ts' },
    platform: 'neutral',
    clean: false,
  },
])
