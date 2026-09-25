import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    overlay: 'src/overlay/index.ts',
    react: 'src/react/index.ts',
  },
  format: ['esm'],
  dts: true,
  fixedExtension: false,
  target: 'es2022',
  platform: 'neutral',
  clean: true,
  // The stylesheet has no source entry (no source condition, spec D-overview): copy it verbatim.
  copy: [{ from: 'src/styles.css', to: 'dist' }],
  deps: {
    neverBundle: [/^@toolmark\//, /^react($|\/)/, /^react-dom($|\/)/],
  },
})
