import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'protocol/index': 'src/protocol/index.ts',
    'bridge/index': 'src/bridge/index.ts',
  },
  format: ['esm'],
  dts: true,
  fixedExtension: false,
  target: 'es2022',
  platform: 'neutral',
  clean: true,
})
