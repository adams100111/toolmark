import { defineConfig, type UserConfig } from 'tsdown'

const shared = {
  format: ['esm'],
  dts: true,
  fixedExtension: false,
  target: 'es2022',
  deps: {
    neverBundle: [/^@toolmark\//, /^@playwright\/test($|\/)/, /^vite($|\/)/],
  },
} satisfies UserConfig

// Mixed platforms: the Playwright fixture entry is node-only; the Vitest and page entries are neutral.
export default defineConfig([
  {
    ...shared,
    entry: { index: 'src/index.ts' },
    platform: 'node',
    clean: true,
  },
  {
    ...shared,
    entry: {
      vitest: 'src/vitest.ts',
      'page/install-test-hook': 'src/page/install-test-hook.ts',
    },
    platform: 'neutral',
    clean: false,
  },
])
