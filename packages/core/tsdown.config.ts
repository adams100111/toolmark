import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'protocol/index': 'src/protocol/index.ts',
    'bridge/index': 'src/bridge/index.ts',
    'bridge/echo': 'src/bridge/echo.ts',
    'bridge/websocket': 'src/bridge/websocket.ts',
    'bridge/post-message': 'src/bridge/post-message.ts',
    'bridge/in-page': 'src/bridge/in-page.ts',
  },
  format: ['esm'],
  dts: true,
  fixedExtension: false,
  target: 'es2022',
  platform: 'neutral',
  clean: true,
})
