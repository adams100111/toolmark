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
//       version — never `workspace:` or any other version;
//   node scripts/check-release-versions.mjs --plan <dir>
//       <dir> is a `changesets/action/pack` output (`publish-plan.json` + `packages/*.tgz`). Every
//       plan entry is a `publish` of an `@toolmark/*` name whose `tarball.path` matches
//       `packages/<name>-<version>.tgz` (no traversal), whose tarball's sha256 equals the plan's
//       `integrity`, and whose packed `package.json` has the plan's exact `name` and `version`
//       and no install lifecycle script (npm publishes what the tarball says, not the plan). A
//       tarball npm's tar reader could read differently is refused (SEC-22): a second
//       `package/package.json`, PAX/GNU headers, links, entries outside `package/`, bad checksums;
//   node scripts/check-release-versions.mjs --npm-dry-run <dir>
//       for the same plan, `npm publish <tgz> --dry-run --json` (offline, no credentials) reports
//       each entry's name and version (SEC-22: npm's own parser agrees with the plan);
//
// `--root` (default: the repository root) is the workspace whose `packages/*/package.json` are read.
// Prints PASS/FAIL lines and exits 0 (pass), 1 (fail) or 2 (usage).
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, posix, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGE_COUNT = 8
const SCOPE = '@toolmark/'
const DEP_FIELDS = ['dependencies', 'peerDependencies', 'optionalDependencies', 'devDependencies']
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

const USAGE =
  'usage: check-release-versions.mjs (--pre <tag> | --exact <version> | --stable) [--root <dir>]\n' +
  '       check-release-versions.mjs (--tarballs | --plan | --npm-dry-run) <dir>'

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
    else if (arg === '--plan') modes.push({ mode: 'plan', value: value() })
    else if (arg === '--npm-dry-run') modes.push({ mode: 'npm-dry-run', value: value() })
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

// Typeflags allowed in a packed tarball: regular files (`0`, and the pre-POSIX NUL) and
// directories (`5`). PAX (`x`/`g`) and GNU long-name (`L`/`K`) headers are refused because they
// can rename the entry that follows, and links or devices have no place in an npm package.
const TAR_TYPES = new Set(['0', '', '5'])

/**
 * The text of `package/package.json` inside a gzipped ustar archive, or null when it has none.
 * Throws on anything npm's own tar reader (node-tar) could read differently (SEC-22): more than one
 * entry that normalises to `package/package.json` (node-tar keeps the last), a typeflag outside
 * {@link TAR_TYPES}, an entry whose normalised path is not under `package/`, a bad header
 * checksum, or an unreadable size. A lone null block does not end the scan (node-tar skips it).
 */
function packedManifest(file) {
  const tar = gunzipSync(readFileSync(file))
  let manifest = null
  let manifests = 0
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512)
    if (header.every((b) => b === 0)) {
      offset += 512
      continue
    }
    const field = (start, len) =>
      header
        .subarray(start, start + len)
        .toString('utf8')
        .replace(/\0.*$/s, '')
    let sum = 0
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : header[i]
    if (parseInt(field(148, 8).trim(), 8) !== sum) {
      throw new Error(`tar header at offset ${offset} has a bad checksum`)
    }
    const sizeField = field(124, 12).trim()
    if (!/^[0-7]*$/.test(sizeField)) {
      throw new Error(`tar header at offset ${offset} has an unreadable size`)
    }
    const size = parseInt(sizeField || '0', 8)
    const type = field(156, 1)
    const prefix = field(345, 155)
    const raw = prefix ? `${prefix}/${field(0, 100)}` : field(0, 100)
    if (!TAR_TYPES.has(type)) {
      throw new Error(`tar entry "${raw}" has typeflag "${type}" (only files and directories)`)
    }
    // node-tar strips the first path component on extract, so every entry must sit under
    // `package/` once `.`, `..` and repeated slashes are resolved; a backslash is refused outright.
    const name = posix.normalize(raw)
    const bare = name === 'package/'
    if (raw.includes('\\') || !name.startsWith('package/') || (bare && type !== '5')) {
      throw new Error(`tar entry "${raw}" is outside package/`)
    }
    const body = tar.subarray(offset + 512, offset + 512 + size)
    offset += 512 + Math.ceil(size / 512) * 512
    // Case-folded, so a case-insensitive extract cannot overwrite the manifest either.
    if (name.toLowerCase() === 'package/package.json') {
      manifests++
      manifest = body.toString('utf8')
    }
  }
  if (manifests > 1) throw new Error(`more than one package/package.json entry (${manifests})`)
  return manifest
}

/** `{ pkg }` (the parsed packed manifest, or null) or `{ problem }` when the tarball is refused. */
function readPackedManifest(file) {
  let text
  try {
    text = packedManifest(file)
  } catch (err) {
    return { problem: `tarball refused: ${err.message}` }
  }
  try {
    const pkg = text === null ? null : JSON.parse(text)
    return { pkg: pkg && typeof pkg === 'object' ? pkg : null }
  } catch {
    return { pkg: null }
  }
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
    const { pkg, problem } = readPackedManifest(file)
    if (problem) problems.push(problem)
    else if (!pkg) problems.push('no readable package/package.json')
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

const PLAN_NAME = /^@toolmark\/[a-z0-9-]+$/
const PLAN_PATH = /^packages\/[a-z0-9-]+-[0-9A-Za-z.-]+\.tgz$/
const INSTALL_SCRIPTS = ['preinstall', 'install', 'postinstall']

/**
 * The tarball of one publish-plan entry under `dir` as `{ file }`, or `{ problems }` when the
 * entry is not a `publish` of an `@toolmark/*` name with a semver version and a plain
 * `packages/<name>-<version>.tgz` path that exists.
 */
function planEntryTarball(dir, entry) {
  if (!entry || typeof entry !== 'object') return { problems: ['plan entry is not an object'] }
  const { kind, name, version } = entry
  if (kind !== 'publish') return { problems: [`${name}: unexpected plan entry kind "${kind}"`] }
  if (typeof name !== 'string' || !PLAN_NAME.test(name)) {
    return { problems: [`unexpected package name "${name}" (expected @toolmark/<name>)`] }
  }
  if (typeof version !== 'string' || !SEMVER.test(version)) {
    return { problems: [`${name}: plan version "${version}" is not a valid semver version`] }
  }
  const path = entry.tarball?.path
  if (
    typeof path !== 'string' ||
    !PLAN_PATH.test(path) ||
    path.includes('..') ||
    !resolve(dir, path).startsWith(resolve(dir) + sep)
  ) {
    return { problems: [`${name}: tarball path "${path}" is not packages/<name>-<version>.tgz`] }
  }
  const file = resolve(dir, path)
  if (!existsSync(file) || !statSync(file).isFile()) {
    return { problems: [`${name}: tarball ${path} is missing`] }
  }
  return { file }
}

/** Problems with one publish-plan entry and its tarball under `dir`. */
function checkPlanEntry(dir, entry) {
  const { file, problems: invalid } = planEntryTarball(dir, entry)
  if (invalid) return invalid
  const { name, version } = entry
  const problems = []
  const bytes = readFileSync(file)
  const integrity = `sha256-${createHash('sha256').update(bytes).digest('base64')}`
  if (integrity !== entry.tarball.integrity) {
    problems.push(`${name}: tarball integrity ${integrity} != plan ${entry.tarball.integrity}`)
  }
  const { pkg, problem } = readPackedManifest(file)
  if (problem) return [...problems, `${name}: ${problem}`]
  if (!pkg) return [...problems, `${name}: no readable package/package.json`]
  if (pkg.name !== name) problems.push(`${name}: packed name "${pkg.name}" != plan name ${name}`)
  if (pkg.version !== version) {
    problems.push(`${name}: packed version "${pkg.version}" != plan version ${version}`)
  }
  for (const script of INSTALL_SCRIPTS) {
    if (pkg.scripts && Object.hasOwn(pkg.scripts, script)) {
      problems.push(`${name}: packed manifest has install lifecycle script "${script}"`)
    }
  }
  return problems
}

/**
 * Problems with what npm itself reads from one plan entry's tarball (SEC-22): runs
 * `npm publish <tgz> --dry-run --json` and compares its `name`/`version` with the plan's. The run
 * is offline and credential-free: `--force` skips the registry version lookup, the registry is an
 * unreachable loopback address, npm gets only `PATH` and a scratch `HOME`/`TMPDIR` (so no
 * `NODE_AUTH_TOKEN`, no `ACTIONS_ID_TOKEN_REQUEST_*` for an OIDC exchange, no `GITHUB_ACTIONS`,
 * no `NPM_CONFIG_*`), and empty user/global configs from a scratch working directory.
 * `TOOLMARK_NPM` overrides the npm executable (tests).
 */
function checkNpmDryRunEntry(dir, entry, scratchDir) {
  const { file, problems: invalid } = planEntryTarball(dir, entry)
  if (invalid) return invalid
  const { name, version } = entry
  const userconfig = join(scratchDir, 'user-npmrc')
  const globalconfig = join(scratchDir, 'global-npmrc')
  writeFileSync(userconfig, '')
  writeFileSync(globalconfig, '')
  const args = [
    'publish',
    file,
    '--dry-run',
    '--json',
    '--force',
    '--ignore-scripts',
    '--provenance=false',
    '--access=public',
    '--tag=latest',
    '--registry=http://127.0.0.1:9/',
    `--userconfig=${userconfig}`,
    `--globalconfig=${globalconfig}`,
    `--cache=${join(scratchDir, 'cache')}`,
  ]
  const env = { PATH: process.env.PATH ?? '', HOME: scratchDir, TMPDIR: scratchDir }
  const r = spawnSync(process.env.TOOLMARK_NPM || 'npm', args, {
    cwd: scratchDir,
    env,
    encoding: 'utf8',
    timeout: 120_000,
  })
  if (r.error || r.status !== 0) {
    const why = r.error?.message ?? `exit ${r.status}: ${(r.stderr ?? '').trim().split('\n').pop()}`
    return [`${name}: npm publish --dry-run failed (${why})`]
  }
  let out = null
  try {
    out = JSON.parse(r.stdout)
  } catch {
    /* reported below */
  }
  // npm 10 prints the package object; npm 11+ keys it by package name.
  if (out && typeof out === 'object' && typeof out.name !== 'string') {
    const values = Object.values(out)
    out = values.length === 1 ? values[0] : null
  }
  if (!out || typeof out !== 'object' || typeof out.name !== 'string') {
    return [`${name}: unexpected npm --json output`]
  }
  const problems = []
  if (out.name !== name) problems.push(`${name}: npm reads name "${out.name}" != plan name ${name}`)
  if (out.version !== version) {
    problems.push(`${name}: npm reads version "${out.version}" != plan version ${version}`)
  }
  return problems
}

/** Loads `<dir>/publish-plan.json` and runs `checkEntry` over every entry, printing PASS/FAIL. */
function checkPlanEntries(dir, label, checkEntry) {
  const planFile = join(dir, 'publish-plan.json')
  let doc = null
  try {
    doc = JSON.parse(readFileSync(planFile, 'utf8'))
  } catch {
    /* reported below */
  }
  if (
    !doc ||
    doc.version !== 1 ||
    !Array.isArray(doc.plan) ||
    !doc.plan.every((group) => Array.isArray(group))
  ) {
    console.log(
      `FAIL ${label}: ${planFile} is not a version-1 publish-plan ({ version: 1, plan: [[...]] })`,
    )
    return 1
  }
  const entries = doc.plan.flat()
  if (entries.length === 0) {
    console.log(`FAIL ${label}: ${planFile} has no entries`)
    return 1
  }
  let failed = 0
  for (const entry of entries) {
    const problems = checkEntry(entry)
    if (problems.length === 0)
      console.log(`PASS ${label}: ${entry.name}@${entry.version} (${entry.tarball.path})`)
    else failed++
    for (const p of problems) console.log(`FAIL ${label}: ${p}`)
  }
  console.log(
    `check-release-versions ${label}: ${entries.length - failed} passed, ${failed} failed`,
  )
  return failed === 0 ? 0 : 1
}

function checkPlan(dir) {
  return checkPlanEntries(dir, '--plan', (entry) => checkPlanEntry(dir, entry))
}

function checkNpmDryRun(dir) {
  const scratchDir = mkdtempSync(join(tmpdir(), 'toolmark-npm-dry-run-'))
  try {
    return checkPlanEntries(dir, '--npm-dry-run', (entry) =>
      checkNpmDryRunEntry(dir, entry, scratchDir),
    )
  } finally {
    rmSync(scratchDir, { recursive: true, force: true })
  }
}

const opts = parseArgs(process.argv.slice(2))
const run = {
  tarballs: () => checkTarballs(resolve(opts.value)),
  plan: () => checkPlan(resolve(opts.value)),
  'npm-dry-run': () => checkNpmDryRun(resolve(opts.value)),
}
process.exit((run[opts.mode] ?? (() => checkWorkspace(opts)))())
