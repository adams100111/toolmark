// Tests for scripts/check-package-meta.mjs. Run with `node --test "scripts/*.test.mjs"`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { scratch, writeTgz } from './fixtures/tgz.mjs'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'check-package-meta.mjs')

function manifest(overrides = {}) {
  return {
    name: '@toolmark/widget',
    version: '1.0.0',
    description: 'A fixture package.',
    keywords: ['toolmark', 'ai', 'agents', 'llm', 'tools', 'widget'],
    homepage: 'https://github.com/adams100111/toolmark/tree/main/packages/widget#readme',
    bugs: { url: 'https://github.com/adams100111/toolmark/issues' },
    license: 'MIT',
    author: 'adams100111',
    repository: {
      type: 'git',
      url: 'git+https://github.com/adams100111/toolmark.git',
      directory: 'packages/widget',
    },
    type: 'module',
    engines: { node: '>=22.12' },
    files: ['dist', 'src', 'CHANGELOG.md'],
    bin: { widget: './dist/cli.js' },
    exports: {
      '.': { types: './dist/index.d.ts', import: './dist/index.js' },
      './styles.css': './dist/styles.css',
      './package.json': './package.json',
    },
    dependencies: { '@toolmark/core': 'workspace:*' },
    peerDependencies: { react: '>=18.3.0 <20' },
    peerDependenciesMeta: { react: { optional: true } },
    publishConfig: { access: 'public', provenance: true },
    ...overrides,
  }
}

const SIZES = [
  { name: '@toolmark/widget', path: 'packages/widget/dist/index.js', gzip: true, limit: '1 kB' },
  {
    name: '@toolmark/widget/styles.css',
    path: 'packages/widget/dist/styles.css',
    rolldown: false,
    gzip: true,
    limit: '1 kB',
  },
]

function tarballFiles(pkg, { omit = [] } = {}) {
  const files = {
    'package/package.json': JSON.stringify(pkg),
    'package/LICENSE': 'MIT License\n',
    'package/README.md': '# widget\n',
    'package/dist/index.js': 'export {}\n',
    'package/dist/index.d.ts': 'export {}\n',
    'package/dist/styles.css': '.a{}\n',
    'package/dist/cli.js': '#!/usr/bin/env node\n',
  }
  for (const f of omit) delete files[f]
  return files
}

/** A fixture repo root; `tarball` adds `.quality/widget.tgz` built from `tarballFiles`. */
async function run({ pkg = manifest(), sizes = SIZES, tarball } = {}) {
  const root = await scratch('toolmark-package-meta-', {
    'packages/widget/package.json': pkg,
    '.size-limit.json': sizes,
  })
  try {
    const args = [SCRIPT, '--root', root]
    if (tarball) {
      await writeTgz(join(root, '.quality', 'widget.tgz'), tarball)
      args.push(join(root, '.quality'))
    }
    const r = spawnSync(process.execPath, args, { encoding: 'utf8' })
    return { status: r.status, output: `${r.stdout}${r.stderr}` }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

const published = () => manifest({ dependencies: { '@toolmark/core': '1.0.0' } })

test('check_package_meta_passes_complete_package_and_tarball', async () => {
  const r = await run({ tarball: tarballFiles(published()) })
  assert.equal(r.status, 0, r.output)
})

test('check_package_meta_rejects_wrong_repository_url', async () => {
  const pkg = manifest({
    repository: { type: 'git', url: 'https://github.com/x/y', directory: 'packages/widget' },
  })
  const r = await run({ pkg })
  assert.equal(r.status, 1, r.output)
  assert.match(r.output, /FAIL @toolmark\/widget: repository\.url/)
})

test('check_package_meta_rejects_wrong_repository_directory', async () => {
  const pkg = manifest({
    repository: {
      type: 'git',
      url: 'git+https://github.com/adams100111/toolmark.git',
      directory: 'packages/other',
    },
  })
  const r = await run({ pkg })
  assert.equal(r.status, 1, r.output)
  assert.match(r.output, /FAIL @toolmark\/widget: repository\.directory/)
})

test('check_package_meta_rejects_missing_fields', async () => {
  const pkg = manifest()
  delete pkg.bugs
  delete pkg.publishConfig
  pkg.keywords = ['widget']
  const r = await run({ pkg })
  assert.equal(r.status, 1, r.output)
  assert.match(r.output, /FAIL @toolmark\/widget: bugs/)
  assert.match(r.output, /FAIL @toolmark\/widget: publishConfig/)
  assert.match(r.output, /FAIL @toolmark\/widget: keywords/)
})

test('check_package_meta_rejects_export_without_size_entry', async () => {
  const r = await run({ sizes: SIZES.slice(0, 1) })
  assert.equal(r.status, 1, r.output)
  assert.match(
    r.output,
    /FAIL @toolmark\/widget: .*@toolmark\/widget\/styles\.css.*\.size-limit\.json/,
  )
})

test('check_package_meta_rejects_size_entry_without_gzip', async () => {
  const r = await run({ sizes: [{ ...SIZES[0], gzip: undefined }, SIZES[1]] })
  assert.equal(r.status, 1, r.output)
  assert.match(r.output, /FAIL .*gzip/)
})

test('check_package_meta_rejects_tarball_without_license', async () => {
  const r = await run({ tarball: tarballFiles(published(), { omit: ['package/LICENSE'] }) })
  assert.equal(r.status, 1, r.output)
  assert.match(r.output, /FAIL widget\.tgz: .*package\/LICENSE/)
})

test('check_package_meta_rejects_tarball_missing_export_or_bin_file', async () => {
  const r = await run({
    tarball: tarballFiles(published(), {
      omit: ['package/dist/styles.css', 'package/dist/cli.js'],
    }),
  })
  assert.equal(r.status, 1, r.output)
  assert.match(r.output, /FAIL widget\.tgz: .*dist\/styles\.css/)
  assert.match(r.output, /FAIL widget\.tgz: .*dist\/cli\.js/)
})

test('check_package_meta_rejects_workspace_protocol_in_tarball', async () => {
  const r = await run({ tarball: tarballFiles(manifest()) })
  assert.equal(r.status, 1, r.output)
  assert.match(r.output, /FAIL widget\.tgz: .*workspace:/)
})
