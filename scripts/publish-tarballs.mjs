#!/usr/bin/env node
// The release workflow's publish loop (M5 final review I-4), as a tested script so that the
// `release-dry-run` job runs the same code as `publish`.
//
//   node scripts/publish-tarballs.mjs [--dry-run] <pack-dir> [--released <file>] [--root <dir>]
//
// <pack-dir> is a `changesets pack` output (`publish-plan.json` + `packages/*.tgz`). The script:
//   1. requires npm >= 11.5.1 (trusted publishing with provenance);
//   2. validates the whole plan before publishing anything: `version: 1`, every entry a `publish`
//      of an `@toolmark/<name>` with dist-tag `latest`, a `packages/<file>.tgz` path, the version
//      of the workspace's `packages/<name>/package.json` (under --root, default the current
//      directory) and a tarball whose sha256 equals the plan's `integrity`;
//   3. per entry, in plan order: skips a version already on the registry (`npm view`), else runs
//      `npm publish <tgz> --access public --tag latest --provenance --ignore-scripts` — or, with
//      --dry-run, only prints what it would publish (it never calls `npm publish`);
//   4. appends `<name>\t<version>\tpackages/<name>` per entry to --released (the tags step input).
// With NPM_BOOTSTRAP_TOKEN set, `npm publish` gets it as NODE_AUTH_TOKEN (first publish);
// otherwise npm uses OIDC trusted publishing.
//
// Exits 0 (done), 1 (a check or a publish failed; nothing after it is published) or 2 (usage).
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const NAME = /^@toolmark\/([a-z0-9-]+)$/
const PATH = /^packages\/[a-z0-9-]+-[0-9A-Za-z.-]+\.tgz$/
const MIN_NPM = [11, 5, 1]

function usage(message) {
  if (message) console.error(message)
  console.error(
    'usage: publish-tarballs.mjs [--dry-run] <pack-dir> [--released <file>] [--root <dir>]',
  )
  process.exit(2)
}

function parseArgs(argv) {
  const out = { dryRun: false, dir: undefined, released: undefined, root: process.cwd() }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const value = () => (i + 1 < argv.length ? argv[++i] : usage(`${arg} needs a value`))
    if (arg === '--dry-run') out.dryRun = true
    else if (arg === '--released') out.released = value()
    else if (arg === '--root') out.root = resolve(value())
    else if (arg.startsWith('-')) usage(`unknown option ${arg}`)
    else if (out.dir === undefined) out.dir = arg
    else usage(`unexpected argument ${arg}`)
  }
  if (out.dir === undefined) usage('missing <pack-dir>')
  return out
}

function fail(message) {
  console.error(`::error::${message}`)
  process.exit(1)
}

/** `npm <args>` with the given extra environment; never throws. */
function npm(args, env = {}, stdio = 'pipe') {
  return spawnSync('npm', args, {
    encoding: 'utf8',
    stdio,
    env: { ...process.env, ...env },
  })
}

/** Whether `version` (x.y.z…) is at least `min`. */
export function atLeast(version, min) {
  const parts = String(version).trim().split('.').map(Number)
  for (let i = 0; i < min.length; i++) {
    const v = parts[i] ?? 0
    if (!Number.isInteger(v)) return false
    if (v !== min[i]) return v > min[i]
  }
  return true
}

/**
 * The plan's entries in publish order, validated; throws an Error naming the first problem.
 * @param {string} dir - The pack dir.
 * @param {string} root - The workspace root.
 */
export function validatedEntries(dir, root) {
  const planFile = join(dir, 'publish-plan.json')
  if (!existsSync(planFile)) throw new Error(`${planFile} is missing`)
  let plan
  try {
    plan = JSON.parse(readFileSync(planFile, 'utf8'))
  } catch {
    throw new Error(`${planFile} is not JSON`)
  }
  if (plan?.version !== 1 || !Array.isArray(plan.plan) || !plan.plan.every(Array.isArray)) {
    throw new Error('publish-plan.json is not a version 1 plan of entry groups')
  }
  const entries = []
  for (const e of plan.plan.flat()) {
    const label = typeof e?.name === 'string' ? e.name : '(unnamed entry)'
    if (e?.kind !== 'publish') throw new Error(`${label}: unexpected plan entry kind '${e?.kind}'`)
    const m = NAME.exec(e.name ?? '')
    if (!m) throw new Error(`unexpected package name '${e.name}'`)
    if (e.tag !== 'latest')
      throw new Error(`${e.name}@${e.version}: dist-tag '${e.tag}' is not latest`)
    const path = e.tarball?.path
    if (typeof path !== 'string' || !PATH.test(path)) {
      throw new Error(`${e.name}: unexpected tarball path '${path}'`)
    }
    const pkgDir = `packages/${m[1]}`
    const manifest = join(root, pkgDir, 'package.json')
    if (!existsSync(manifest)) throw new Error(`${e.name}: no workspace package at ${pkgDir}`)
    const ws = JSON.parse(readFileSync(manifest, 'utf8')).version
    if (ws !== e.version) throw new Error(`${e.name}: plan ${e.version} != workspace ${ws}`)
    const tgz = join(dir, path)
    if (!existsSync(tgz)) throw new Error(`${e.name}: ${path} is missing`)
    const got = `sha256-${createHash('sha256').update(readFileSync(tgz)).digest('base64')}`
    if (got !== e.tarball.integrity) throw new Error(`${e.name}: tarball integrity mismatch`)
    entries.push({ name: e.name, version: e.version, tgz, pkgDir })
  }
  return entries
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const mode = args.dryRun ? 'dry run' : 'publish'

  const v = npm(['--version'])
  const npmVersion = (v.stdout ?? '').trim()
  if (v.status !== 0 || !atLeast(npmVersion, MIN_NPM)) {
    fail(`npm ${npmVersion || '(not found)'} is older than ${MIN_NPM.join('.')}`)
  }
  console.log(`npm ${npmVersion}`)

  let entries
  try {
    entries = validatedEntries(args.dir, args.root)
  } catch (err) {
    fail(err.message)
  }
  console.log(`${mode}: ${entries.length} planned package(s)`)

  const token = process.env.NPM_BOOTSTRAP_TOKEN
  if (!args.dryRun) {
    console.log(token ? 'auth: bootstrap token (first publish)' : 'auth: OIDC trusted publishing')
  }
  if (args.released !== undefined) writeFileSync(args.released, '')

  for (const e of entries) {
    const view = npm(['view', `${e.name}@${e.version}`, 'version'])
    if (view.status === 0 && (view.stdout ?? '').trim() === e.version) {
      console.log(`${e.name}@${e.version} is already on the registry; skipping`)
    } else if (args.dryRun) {
      console.log(`would publish ${e.name}@${e.version} from ${e.tgz} (tag latest, provenance)`)
    } else {
      const r = npm(
        [
          'publish',
          e.tgz,
          '--access',
          'public',
          '--tag',
          'latest',
          '--provenance',
          '--ignore-scripts',
        ],
        token ? { NODE_AUTH_TOKEN: token } : {},
        'inherit',
      )
      if (r.status !== 0) fail(`${e.name}@${e.version}: npm publish failed`)
    }
    if (args.released !== undefined) {
      appendFileSync(args.released, `${e.name}\t${e.version}\t${e.pkgDir}\n`)
    }
  }
  console.log(`${mode}: done`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
