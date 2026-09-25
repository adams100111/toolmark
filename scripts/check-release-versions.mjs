#!/usr/bin/env node
// Release version gate (M5 Task 7a). The eight `@toolmark/*` packages are one changesets `fixed`
// group (spec §17), so every check below is about the whole train.
//
//   node scripts/check-release-versions.mjs --pre <tag> [--root <dir>]
//       all 8 versions are equal and match ^1.0.0-<tag>.<n>$ (release-candidate state);
//   node scripts/check-release-versions.mjs --exact <version> [--root <dir>]
//       all 8 versions are exactly <version>;
//   node scripts/check-release-versions.mjs --stable [--root <dir>]
//       all 8 versions are equal, with no prerelease tag (the publish job's second step);
//   node scripts/check-release-versions.mjs --tarballs <dir>
//       every packed `package.json` in <dir> (searched recursively for `.tgz`) names its
//       `@toolmark/*` dependencies with a concrete version or a `^`/`~` range of the package's own
//       version — never `workspace:` or any other version.
//
// `--root` (default: the repository root) is the workspace whose `packages/*/package.json` are read.
// Prints PASS/FAIL lines and exits 0 (pass), 1 (fail) or 2 (usage).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGE_COUNT = 8
const SCOPE = '@toolmark/'
const DEP_FIELDS = ['dependencies', 'peerDependencies', 'optionalDependencies', 'devDependencies']
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

const USAGE =
  'usage: check-release-versions.mjs (--pre <tag> | --exact <version> | --stable) [--root <dir>]\n' +
  '       check-release-versions.mjs --tarballs <dir>'

function usage(message) {
  if (message) console.error(message)
  console.error(USAGE)
  process.exit(2)
}

function parseArgs(argv) {
  const opts = { root: repoRoot }
  const modes = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const value = () => {
      const v = argv[++i]
      if (v === undefined || v.startsWith('--')) usage(`${arg} needs a value`)
      return v
    }
    if (arg === '--stable') modes.push({ mode: 'stable' })
    else if (arg === '--pre') modes.push({ mode: 'pre', value: value() })
    else if (arg === '--exact') modes.push({ mode: 'exact', value: value() })
    else if (arg === '--tarballs') modes.push({ mode: 'tarballs', value: value() })
    else if (arg === '--root') opts.root = resolve(value())
    else usage(`unknown argument: ${arg}`)
  }
  if (modes.length !== 1) usage(modes.length === 0 ? 'no mode given' : 'give exactly one mode')
  return { ...opts, ...modes[0] }
}

/** `{ name, version }` of every `@toolmark/*` package under `<root>/packages/*`. */
function workspacePackages(root) {
  const dir = join(root, 'packages')
  if (!existsSync(dir)) return []
  const out = []
  for (const entry of readdirSync(dir).sort()) {
    const file = join(dir, entry, 'package.json')
    if (!existsSync(file)) continue
    const pkg = JSON.parse(readFileSync(file, 'utf8'))
    if (typeof pkg.name === 'string' && pkg.name.startsWith(SCOPE)) {
      out.push({ name: pkg.name, version: String(pkg.version) })
    }
  }
  return out
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function checkWorkspace({ mode, value, root }) {
  const pkgs = workspacePackages(root)
  const problems = []
  if (pkgs.length !== PACKAGE_COUNT) {
    problems.push(
      `expected ${PACKAGE_COUNT} @toolmark/* packages, found ${pkgs.length}` +
        (pkgs.length ? ` (${pkgs.map((p) => p.name).join(', ')})` : ''),
    )
  }
  const versions = [...new Set(pkgs.map((p) => p.version))]
  // The train version is the most common one; every package off it is named.
  const counts = new Map()
  for (const p of pkgs) counts.set(p.version, (counts.get(p.version) ?? 0) + 1)
  const train = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  if (versions.length > 1) {
    for (const p of pkgs) {
      if (p.version !== train) problems.push(`${p.name}@${p.version} differs from ${train}`)
    }
  }
  for (const p of pkgs) {
    const m = SEMVER.exec(p.version)
    if (!m) {
      problems.push(`${p.name}@${p.version} is not a valid semver version`)
      continue
    }
    if (mode === 'stable' && m[4] !== undefined) {
      problems.push(`${p.name}@${p.version} has a prerelease tag (-${m[4]})`)
    }
    if (mode === 'exact' && p.version !== value) {
      problems.push(`${p.name}@${p.version} is not ${value}`)
    }
    if (
      mode === 'pre' &&
      !new RegExp(`^1\\.0\\.0-${escapeRegExp(value)}\\.\\d+$`).test(p.version)
    ) {
      problems.push(`${p.name}@${p.version} does not match 1.0.0-${value}.<n>`)
    }
  }
  const label = `--${mode}${value ? ` ${value}` : ''}`
  if (problems.length === 0) {
    console.log(`PASS ${label}: ${pkgs.length} @toolmark/* packages at ${train}`)
    return 0
  }
  for (const p of problems) console.log(`FAIL ${label}: ${p}`)
  return 1
}

/** Every `.tgz` under `dir`, recursively. */
function findTarballs(dir) {
  const out = []
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...findTarballs(full))
    else if (entry.endsWith('.tgz')) out.push(full)
  }
  return out
}

/** The text of `package/package.json` inside a gzipped ustar archive, or null. */
function packedManifest(file) {
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
    const name = (longName ?? (prefix ? `${prefix}/${field(0, 100)}` : field(0, 100))).replace(
      /^\.\//,
      '',
    )
    longName = null
    const body = tar.subarray(offset + 512, offset + 512 + size)
    offset += 512 + Math.ceil(size / 512) * 512
    if (type === 'L') {
      longName = body.toString('utf8').replace(/\0.*$/s, '')
      continue
    }
    if (name === 'package/package.json') return body.toString('utf8')
  }
  return null
}

function checkTarballs(dir) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    console.log(`FAIL --tarballs: ${dir} is not a directory`)
    return 1
  }
  const tarballs = findTarballs(dir)
  if (tarballs.length === 0) {
    console.log(`FAIL --tarballs: no .tgz files under ${dir}`)
    return 1
  }
  let failed = 0
  for (const file of tarballs) {
    const label = relative(process.cwd(), file) || file
    const problems = []
    const text = packedManifest(file)
    let pkg = null
    try {
      pkg = text === null ? null : JSON.parse(text)
    } catch {
      /* reported below */
    }
    if (!pkg) problems.push('no readable package/package.json')
    else {
      const version = String(pkg.version)
      const allowed = new Set([version, `^${version}`, `~${version}`])
      for (const field of DEP_FIELDS) {
        for (const [dep, range] of Object.entries(pkg[field] ?? {})) {
          if (!dep.startsWith(SCOPE)) continue
          if (!allowed.has(String(range))) {
            problems.push(
              `${pkg.name} ${field}.${dep} is "${range}" (expected ${version}, ^${version} or ~${version})`,
            )
          }
        }
      }
    }
    if (problems.length === 0) console.log(`PASS ${label}: ${pkg.name}@${pkg.version}`)
    else failed++
    for (const p of problems) console.log(`FAIL ${label}: ${p}`)
  }
  console.log(
    `check-release-versions --tarballs: ${tarballs.length - failed} passed, ${failed} failed`,
  )
  return failed === 0 ? 0 : 1
}

const opts = parseArgs(process.argv.slice(2))
process.exit(opts.mode === 'tarballs' ? checkTarballs(resolve(opts.value)) : checkWorkspace(opts))
