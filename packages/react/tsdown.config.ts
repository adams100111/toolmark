import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'rhf/index': 'src/rhf/index.ts',
  },
  format: ['esm'],
  dts: true,
  fixedExtension: false,
  target: 'es2022',
  platform: 'neutral',
  clean: true,
  deps: {
    neverBundle: [/^@toolmark\//, /^react($|\/)/, /^react-dom($|\/)/, /^react-hook-form($|\/)/],
  },
})
