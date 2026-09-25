import type { NextConfig } from 'next'

// Turbopack has no custom resolve condition (unlike Vite in examples/react-vite), so
// `@toolmark/*` resolve through the plain `import` condition to their built `dist/`: the task gate
// builds `packages/*` before this example. `transpilePackages` makes Turbopack process the
// workspace packages' emitted ESM instead of treating them as pre-bundled externals.
const nextConfig: NextConfig = {
  transpilePackages: ['@toolmark/core', '@toolmark/react'],
}

export default nextConfig
