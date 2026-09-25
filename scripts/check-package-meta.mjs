#!/usr/bin/env node
// Package metadata and packed-tarball contents (spec §17 / R8; M5 Task 2).
//
//   node scripts/check-package-meta.mjs [<tarball-dir>] [--root <repo>]
//
// For every `packages/*/package.json` under the repo root:
//   - license MIT, author, description (one line), keywords (the shared five first), homepage,
//     bugs.url, repository { type: git, url, directory: packages/<dir> } exactly as npm
//     provenance needs them, publishConfig { access: public, provenance: true },
//     files ["dist", "src", "CHANGELOG.md"], engines.node ">=22.12", and every
//     peerDependenciesMeta entry names a declared peer with `optional: true`;
//   - every `exports` subpath except `./package.json` has a `.size-limit.json` entry whose `name`
//     is the import specifier, and every size entry sets `"gzip": true` (the chosen compression).
// With <tarball-dir>, for every `.tgz` in it: `package/LICENSE`, `package/README.md` and every file
// named by `exports` / `bin` are present, and `package/package.json` contains no `workspace:`.
// Prints one FAIL line per problem (a PASS line per clean package/tarball) and exits 0 or 1.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'

const REPO_URL = 'git+https://github.com/adams100111/toolmark.git'
const HOMEPAGE = (dir) => `https://github.com/adams100111/toolmark/tree/main/packages/${dir}#readme`
const BUGS_URL = 'https://github.com/adams100111/toolmark/issues'
const KEYWORDS = ['toolmark', 'ai', 'agents', 'llm', 'tools']
const FILES = ['dist', 'src', 'CHANGELOG.md']
const NODE_RANGE = '>=22.12'

const args = process.argv.slice(2)
const rootIndex = args.indexOf('--root')
const root =
  rootIndex >= 0
    ? resolve(args[rootIndex + 1])
    : resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tarballDir = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--root')

let failures = 0
function report(label, problems) {
  for (const p of problems) console.log(`FAIL ${label}: ${p}`)
  if (problems.length === 0) console.log(`PASS ${label}`)
  failures += problems.length
}

const specifierOf = (name, subpath) => (subpath === '.' ? name : `${name}${subpath.slice(1)}`)

/** Every string target in an `exports` value. */
function targets(value) {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(targets)
  if (value && typeof value === 'object') return Object.values(value).flatMap(targets)
  return []
}

function checkManifest(dir, pkg, sizeNames) {
  const problems = []
  const is = (field, actual, expected) => {
    if (actual !== expected) {
      problems.push(`${field} is ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`)
    }
  }
  is('license', pkg.license, 'MIT')
  if (typeof pkg.author !== 'string' || !pkg.author) problems.push('author is missing')
  if (typeof pkg.description !== 'string' || !pkg.description.trim()) {
    problems.push('description is missing')
  } else if (pkg.description.includes('\n')) {
    problems.push('description must be one line')
  }
  if (!Array.isArray(pkg.keywords) || KEYWORDS.some((k, i) => pkg.keywords[i] !== k)) {
    problems.push(`keywords must start with ${JSON.stringify(KEYWORDS)}`)
  }
  is('homepage', pkg.homepage, HOMEPAGE(dir))
  if (!pkg.bugs) problems.push('bugs is missing')
  else is('bugs.url', pkg.bugs.url, BUGS_URL)
  if (!pkg.repository || typeof pkg.repository !== 'object') {
    problems.push('repository is missing (object with type, url, directory)')
  } else {
    is('repository.type', pkg.repository.type, 'git')
    is('repository.url', pkg.repository.url, REPO_URL)
    is('repository.directory', pkg.repository.directory, `packages/${dir}`)
  }
  if (!pkg.publishConfig) problems.push('publishConfig is missing')
  else {
    is('publishConfig.access', pkg.publishConfig.access, 'public')
    is('publishConfig.provenance', pkg.publishConfig.provenance, true)
  }
  if (JSON.stringify(pkg.files) !== JSON.stringify(FILES)) {
    problems.push(`files is ${JSON.stringify(pkg.files)}, expected ${JSON.stringify(FILES)}`)
  }
  is('engines.node', pkg.engines?.node, NODE_RANGE)
  for (const [peer, meta] of Object.entries(pkg.peerDependenciesMeta ?? {})) {
    if (!(peer in (pkg.peerDependencies ?? {}))) {
      problems.push(`peerDependenciesMeta.${peer} names an undeclared peer`)
    }
    if (meta?.optional !== true) problems.push(`peerDependenciesMeta.${peer}.optional is not true`)
  }
  for (const subpath of Object.keys(pkg.exports ?? {})) {
    if (subpath === './package.json') continue
    const spec = specifierOf(pkg.name, subpath)
    if (!sizeNames.has(spec)) problems.push(`export "${spec}" has no .size-limit.json entry`)
  }
  return problems
}

/** Names of the entries in a gzipped ustar archive, plus the text of `package/package.json`. */
function readTarball(file) {
  const tar = gunzipSync(readFileSync(file))
  const names = new Set()
  let manifest = null
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
    if (type === 'x' || type === 'g' || type === '5') continue
    name = name.replace(/^\.\//, '')
    names.add(name)
    if (name === 'package/package.json') manifest = body.toString('utf8')
  }
  return { names, manifest }
}

function checkTarball(file) {
  const problems = []
  let names
  let manifest
  try {
    ;({ names, manifest } = readTarball(file))
  } catch (e) {
    return [`unreadable tarball: ${e.message}`]
  }
  for (const required of ['package/LICENSE', 'package/README.md', 'package/package.json']) {
    if (!names.has(required)) problems.push(`missing ${required}`)
  }
  if (manifest === null) return problems
  if (manifest.includes('workspace:')) {
    problems.push('package/package.json still contains a "workspace:" range')
  }
  const pkg = JSON.parse(manifest)
  const bins = typeof pkg.bin === 'string' ? [pkg.bin] : Object.values(pkg.bin ?? {})
  const files = new Set(
    [...Object.values(pkg.exports ?? {}).flatMap(targets), ...bins].filter(
      (t) => t !== './package.json',
    ),
  )
  for (const target of files) {
    const path = `package/${target.replace(/^\.\//, '')}`
    if (path.includes('*')) {
      const [prefix, suffix] = path.split('*')
      if (![...names].some((n) => n.startsWith(prefix) && n.endsWith(suffix))) {
        problems.push(`no packed file matches ${path}`)
      }
    } else if (!names.has(path)) {
      problems.push(`missing ${path} (named in exports/bin)`)
    }
  }
  return problems
}

// .size-limit.json: names, and the explicit gzip choice on every entry.
const sizeFile = join(root, '.size-limit.json')
const sizeNames = new Set()
if (!existsSync(sizeFile)) {
  report('.size-limit.json', ['file not found'])
} else {
  const entries = JSON.parse(readFileSync(sizeFile, 'utf8'))
  const problems = []
  for (const entry of entries) {
    sizeNames.add(entry.name)
    if (entry.gzip !== true) problems.push(`entry "${entry.name}" must set "gzip": true`)
  }
  report('.size-limit.json', problems)
}

const packagesDir = join(root, 'packages')
const dirs = existsSync(packagesDir)
  ? readdirSync(packagesDir)
      .filter((d) => existsSync(join(packagesDir, d, 'package.json')))
      .sort()
  : []
if (dirs.length === 0) report('packages', ['no packages/*/package.json found'])
for (const dir of dirs) {
  const pkg = JSON.parse(readFileSync(join(packagesDir, dir, 'package.json'), 'utf8'))
  report(pkg.name ?? dir, checkManifest(dir, pkg, sizeNames))
}

if (tarballDir) {
  const dir = resolve(tarballDir)
  const tarballs =
    existsSync(dir) && statSync(dir).isDirectory()
      ? readdirSync(dir)
          .filter((f) => f.endsWith('.tgz'))
          .sort()
      : []
  if (tarballs.length === 0) report(tarballDir, ['no .tgz files'])
  for (const t of tarballs) report(basename(t), checkTarball(join(dir, t)))
}

console.log(`check-package-meta: ${failures} problem(s)`)
process.exit(failures === 0 ? 0 : 1)
