#!/usr/bin/env node
// Tarball smoke test (M1 Task 16): installs every packed tarball in `<dir>` into a fresh project
// outside the workspace and checks what a consumer would see.
//
//   node scripts/tarball-smoke.mjs <dir> [--keep]
//
// (a) every `exports` target exists (wildcards expanded against the packed files); every JS entry
//     is dynamically imported by `node` (entries listed in BROWSER_ONLY are only resolved with
//     `import.meta.resolve`) and must declare a `types` condition; JSON entries are parsed;
// (b) a generated `smoke.ts` importing every entry's types is type-checked with TypeScript 6.0.3
//     and 7.0.2, each in `nodenext` and `preserve`/`bundler` mode (`strict`, `skipLibCheck: false`,
//     `types: ['node']`, no `customConditions`);
// (c) every declared `bin` runs with `--help`.
//
// Prints one line per check and exits 0 (all passed) or 1. Dependencies: Node and pnpm only.
// pnpm >= 11 no longer reads the `pnpm` field of package.json, so the tarball overrides are
// written to the temp project's `pnpm-workspace.yaml` (`overrides:`).
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'

/** Entries that need a DOM to evaluate; resolved, never imported. Empty in M1 (D24). */
const BROWSER_ONLY = []

const TYPESCRIPT_6 = '6.0.3'
const TYPESCRIPT_7 = '7.0.2'
const MODES = [
  { label: 'nodenext', module: 'nodenext', moduleResolution: 'nodenext' },
  { label: 'bundler', module: 'preserve', moduleResolution: 'bundler' },
]

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const results = []

function pass(check, detail) {
  results.push({ ok: true })
  console.log(`PASS ${check}${detail ? ` (${detail})` : ''}`)
}

function fail(check, detail) {
  results.push({ ok: false })
  console.log(`FAIL ${check}: ${detail}`)
}

function firstLines(text, n = 20) {
  return text
    .split('\n')
    .map((l) => l.trimEnd())
    .filter(Boolean)
    .slice(0, n)
    .join('\n    ')
}

/** Reads `package/package.json` from a `.tgz` (gzip + ustar) without extracting it. */
function readPackedManifest(file) {
  const tar = gunzipSync(readFileSync(file))
  let offset = 0
  let longName = null
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512)
    if (header.every((b) => b === 0)) break
    const field = (start, len) =>
      header
        .subarray(start, start + len)
        .toString('utf8')
        .replace(/\0.*$/s, '')
    const size = parseInt(field(124, 12).trim() || '0', 8)
    const type = field(156, 1)
    const prefix = field(345, 155)
    let name = longName ?? (prefix ? `${prefix}/${field(0, 100)}` : field(0, 100))
    longName = null
    const body = tar.subarray(offset + 512, offset + 512 + size)
    offset += 512 + Math.ceil(size / 512) * 512
    if (type === 'L') {
      longName = body.toString('utf8').replace(/\0.*$/s, '')
      continue
    }
    if (type === 'x' || type === 'g') continue
    name = name.replace(/^\.\//, '')
    if (/^[^/]+\/package\.json$/.test(name)) return JSON.parse(body.toString('utf8'))
  }
  throw new Error('no package.json in tarball')
}

/** The workspace's default catalog (`catalog:` block of pnpm-workspace.yaml), if any. */
function readCatalog() {
  const file = join(repoRoot, 'pnpm-workspace.yaml')
  const catalog = {}
  if (!existsSync(file)) return catalog
  let inCatalog = false
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (/^catalog:\s*$/.test(line)) {
      inCatalog = true
      continue
    }
    if (!inCatalog) continue
    if (/^\S/.test(line)) break
    const m = /^\s+(['"]?)([^'":\s]+)\1:\s*['"]?([^'"#\s]+)['"]?/.exec(line)
    if (m) catalog[m[2]] = m[3]
  }
  return catalog
}

function readRootPackageManager() {
  try {
    return JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).packageManager
  } catch {
    return undefined
  }
}

/** Every file under `dir`, as `./`-prefixed POSIX paths relative to `dir`. */
async function listFiles(dir, base = dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue
      out.push(...(await listFiles(full, base)))
    } else {
      out.push(`./${relative(base, full).split(sep).join('/')}`)
    }
  }
  return out
}

/** Flattens a conditional exports value into `[conditionPath, target]` leaves. */
function leaves(value, conditions = []) {
  if (typeof value === 'string') return [[conditions, value]]
  if (Array.isArray(value)) return value.flatMap((v) => leaves(v, conditions))
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => leaves(v, [...conditions, k]))
  }
  return []
}

/**
 * Expands one `exports` entry into concrete entries `{ subpath, targets: [[conditions, file]] }`.
 * A wildcard entry yields one entry per packed file matching its first target pattern.
 */
function expandEntry(subpath, value, files) {
  const targets = leaves(value)
  if (!subpath.includes('*')) return [{ subpath, targets }]
  const pattern = targets[0]?.[1]
  if (!pattern || !pattern.includes('*')) return [{ subpath, targets }]
  const [prefix, suffix] = pattern.split('*')
  const out = []
  for (const file of files) {
    if (!file.startsWith(prefix) || !file.endsWith(suffix)) continue
    if (file.length < prefix.length + suffix.length) continue
    const star = file.slice(prefix.length, file.length - suffix.length)
    out.push({
      subpath: subpath.replace('*', star),
      targets: targets.map(([c, t]) => [c, t.replace('*', star)]),
    })
  }
  return out
}

function specifierOf(name, subpath) {
  return subpath === '.' ? name : `${name}${subpath.slice(1)}`
}

function run(command, args, cwd, timeout = 300000) {
  const r = spawnSync(command, args, { cwd, encoding: 'utf8', timeout, env: process.env })
  return {
    status: r.status,
    output: `${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? String(r.error) : ''}`,
  }
}

/** How to run a TypeScript package's `tsc` bin: `node <file>` for JS launchers, else directly. */
function tscCommand(project, pkgDir) {
  const manifest = JSON.parse(readFileSync(join(project, pkgDir, 'package.json'), 'utf8'))
  const bin =
    typeof manifest.bin === 'string' ? manifest.bin : (manifest.bin?.tsc ?? manifest.bin?.tsgo)
  if (!bin) throw new Error(`${pkgDir} declares no tsc/tsgo bin`)
  const file = join(project, pkgDir, bin)
  const head = readFileSync(file).subarray(0, 64).toString('utf8')
  const isNode = /\.(c|m)?js$/.test(bin) || /^#!.*\bnode\b/.test(head)
  const binName = Object.entries(manifest.bin ?? {}).find(([, v]) => v === bin)?.[0] ?? 'tsc'
  return {
    command: isNode ? process.execPath : file,
    prefix: isNode ? [file] : [],
    display: `${isNode ? 'node ' : ''}${pkgDir}/${bin.replace(/^\.\//, '')} (bin "${binName}", version ${manifest.version})`,
  }
}

async function main() {
  const args = process.argv.slice(2)
  const keep = args.includes('--keep') || process.env.TOOLMARK_SMOKE_KEEP === '1'
  const dirArg = args.find((a) => !a.startsWith('--'))
  if (!dirArg) {
    console.log('usage: node scripts/tarball-smoke.mjs <dir> [--keep]')
    return 1
  }
  const dir = resolve(dirArg)
  const tarballs = existsSync(dir)
    ? (await readdir(dir))
        .filter((f) => f.endsWith('.tgz'))
        .sort()
        .map((f) => join(dir, f))
    : []
  if (tarballs.length === 0) {
    fail('tarballs', `no .tgz files in ${dir}`)
    return 1
  }

  const packages = []
  for (const file of tarballs) {
    try {
      packages.push({ file, manifest: readPackedManifest(file) })
    } catch (e) {
      fail(`read ${file}`, e.message)
      return 1
    }
  }
  const names = new Set(packages.map((p) => p.manifest.name))
  const catalog = readCatalog()
  const versionOf = (name, fallback) => catalog[name] ?? fallback

  const dependencies = {}
  const overrides = {}
  for (const { file, manifest } of packages) {
    dependencies[manifest.name] = `file:${file}`
    overrides[manifest.name] = `file:${file}`
  }
  for (const { manifest } of packages) {
    for (const [peer, range] of Object.entries(manifest.peerDependencies ?? {})) {
      if (!names.has(peer) && !(peer in dependencies)) dependencies[peer] = versionOf(peer, range)
    }
  }
  const devDependencies = {
    '@types/node': versionOf('@types/node', '22'),
    '@types/react': versionOf('@types/react', '19'),
    typescript: TYPESCRIPT_6,
    'typescript-7': `npm:typescript@${TYPESCRIPT_7}`,
  }

  const project = await mkdtemp(join(tmpdir(), 'toolmark-tarball-smoke-'))
  console.log(`info: temp project ${project}`)
  try {
    const packageManager = readRootPackageManager()
    await writeFile(
      join(project, 'package.json'),
      `${JSON.stringify(
        {
          name: 'toolmark-tarball-smoke',
          private: true,
          type: 'module',
          ...(packageManager ? { packageManager } : {}),
          dependencies,
          devDependencies,
        },
        null,
        2,
      )}\n`,
    )
    const overrideLines = Object.entries(overrides).map(
      ([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`,
    )
    await writeFile(
      join(project, 'pnpm-workspace.yaml'),
      `overrides:\n${overrideLines.join('\n')}\n`,
    )

    const install = run('pnpm', ['install', '--no-frozen-lockfile'], project, 600000)
    if (install.status !== 0) {
      fail('pnpm install', firstLines(install.output, 40))
      return 1
    }
    pass('pnpm install', `${packages.length} tarball(s)`)

    // (a) exports: files exist, JS entries import, JSON entries parse.
    const typeSpecifiers = []
    for (const { manifest } of packages) {
      const pkgDir = join(project, 'node_modules', ...manifest.name.split('/'))
      const installed = JSON.parse(await readFile(join(pkgDir, 'package.json'), 'utf8'))
      if (installed.version !== manifest.version) {
        fail(`installed ${manifest.name}`, `expected ${manifest.version}, got ${installed.version}`)
        continue
      }
      const files = await listFiles(pkgDir)
      const exportsMap =
        typeof installed.exports === 'string' || Array.isArray(installed.exports)
          ? { '.': installed.exports }
          : Object.keys(installed.exports ?? {}).every((k) => k.startsWith('.'))
            ? (installed.exports ?? {})
            : { '.': installed.exports }
      if (Object.keys(exportsMap).length === 0) {
        fail(`exports ${manifest.name}`, 'package has no "exports"')
        continue
      }
      for (const [subpath, value] of Object.entries(exportsMap)) {
        const entries = expandEntry(subpath, value, files)
        if (entries.length === 0) {
          fail(`exports ${specifierOf(manifest.name, subpath)}`, 'wildcard matches no packed file')
          continue
        }
        for (const entry of entries) {
          const spec = specifierOf(manifest.name, entry.subpath)
          const missing = entry.targets
            .filter(([, target]) => !existsSync(join(pkgDir, target)))
            .map(([conditions, target]) => `${conditions.join('/') || 'default'} -> ${target}`)
          if (missing.length > 0) {
            fail(`exports ${spec}`, `missing ${missing.join(', ')}`)
            continue
          }
          pass(`exports ${spec}`, `${entry.targets.length} target(s)`)

          const runtime = entry.targets.find(
            ([c]) => c.includes('import') || c.includes('default') || c.length === 0,
          )
          const types = entry.targets.find(([c]) => c.includes('types'))
          if (runtime && /\.json$/.test(runtime[1])) {
            try {
              JSON.parse(await readFile(join(pkgDir, runtime[1]), 'utf8'))
              pass(`json ${spec}`)
            } catch (e) {
              fail(`json ${spec}`, e.message)
            }
          } else if (runtime && /\.(m|c)?js$/.test(runtime[1])) {
            const browserOnly = BROWSER_ONLY.includes(spec)
            const code = browserOnly
              ? `import.meta.resolve(${JSON.stringify(spec)})`
              : `await import(${JSON.stringify(spec)})`
            const r = run(process.execPath, ['--input-type=module', '-e', code], project, 60000)
            if (r.status === 0) pass(`${browserOnly ? 'resolve' : 'import'} ${spec}`)
            else fail(`${browserOnly ? 'resolve' : 'import'} ${spec}`, firstLines(r.output, 8))
            if (types) {
              typeSpecifiers.push(spec)
              pass(`types ${spec}`, types[1])
            } else {
              fail(`types ${spec}`, 'JS entry has no "types" condition')
            }
          }
        }
      }
    }

    // (b) types with TypeScript 6 and 7, nodenext and bundler.
    const smoke = [
      '// Generated by scripts/tarball-smoke.mjs: loads the types of every packed JS entry.',
      ...typeSpecifiers.map((s, i) => `import type * as m${i} from ${JSON.stringify(s)}`),
      `export type Smoke = [${typeSpecifiers.map((_, i) => `typeof m${i}`).join(', ')}]`,
      '',
    ].join('\n')
    await writeFile(join(project, 'smoke.ts'), smoke)
    const compilers = [
      { version: TYPESCRIPT_6, dir: 'node_modules/typescript' },
      { version: TYPESCRIPT_7, dir: 'node_modules/typescript-7' },
    ]
    for (const ts of compilers) {
      let cmd
      try {
        cmd = tscCommand(project, ts.dir)
      } catch (e) {
        fail(`tsc ${ts.version}`, e.message)
        continue
      }
      console.log(`info: TypeScript ${ts.version} via ${cmd.display}`)
      for (const mode of MODES) {
        const config = `tsconfig.${ts.version}.${mode.label}.json`
        await writeFile(
          join(project, config),
          `${JSON.stringify(
            {
              compilerOptions: {
                target: 'es2022',
                lib: ['es2022', 'dom'],
                module: mode.module,
                moduleResolution: mode.moduleResolution,
                strict: true,
                skipLibCheck: false,
                types: ['node'],
                noEmit: true,
              },
              files: ['smoke.ts'],
            },
            null,
            2,
          )}\n`,
        )
        const r = run(cmd.command, [...cmd.prefix, '-p', config], project)
        const check = `tsc ${ts.version} ${mode.label}`
        if (r.status === 0) pass(check, `${typeSpecifiers.length} entries`)
        else fail(check, firstLines(r.output))
      }
    }

    // (c) bins.
    for (const { manifest } of packages) {
      const pkgDir = join(project, 'node_modules', ...manifest.name.split('/'))
      const bins =
        typeof manifest.bin === 'string'
          ? { [manifest.name.split('/').pop()]: manifest.bin }
          : (manifest.bin ?? {})
      for (const [bin, file] of Object.entries(bins)) {
        const r = run(process.execPath, [join(pkgDir, file), '--help'], project, 60000)
        if (r.status === 0) pass(`bin ${bin} --help`)
        else fail(`bin ${bin} --help`, firstLines(r.output, 8))
      }
    }
  } finally {
    if (keep) console.log(`info: kept ${project}`)
    else await rm(project, { recursive: true, force: true })
  }
  return results.every((r) => r.ok) ? 0 : 1
}

let code = 1
try {
  code = await main()
} catch (e) {
  fail('tarball-smoke', e instanceof Error ? (e.stack ?? e.message) : String(e))
  code = 1
}
const failed = results.filter((r) => !r.ok).length
console.log(`tarball-smoke: ${results.length - failed} passed, ${failed} failed`)
process.exit(code)
