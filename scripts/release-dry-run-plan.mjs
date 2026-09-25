#!/usr/bin/env node
// The plan the `release-dry-run` job checks (M5 final review I-3, I-4).
//
//   node scripts/release-dry-run-plan.mjs <publish-plan.json> <out.json> [--root <dir>]
//
// `changeset publish-plan` lists only the versions that are not on npm yet, so after a release its
// plan is empty on every ordinary PR. Then there would be nothing to pack, and the publish-path
// checks (pack layout, `--plan`, `--npm-dry-run`, the publish loop) would never run before the
// next real publish. This script copies a non-empty plan to <out.json> unchanged. For an empty
// plan it prints a notice and writes a synthetic one instead: every public `@toolmark/*` package
// under <root>/packages at its workspace version, as a `publish` with tag `latest` (one group),
// so `changeset pack --from-publish-plan <out.json>` and every later check run on every PR.
// A malformed plan fails. With GITHUB_OUTPUT set it also writes `synthetic=true|false` there.
//
// Exits 0, 1 (malformed plan or no packages) or 2 (usage).
import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

function usage(message) {
  if (message) console.error(message)
  console.error('usage: release-dry-run-plan.mjs <publish-plan.json> <out.json> [--root <dir>]')
  process.exit(2)
}

/** Public `@toolmark/*` workspace packages under `<root>/packages`, sorted by name. */
export function workspaceEntries(root) {
  const dir = join(root, 'packages')
  const out = []
  for (const name of readdirSync(dir).sort()) {
    const file = join(dir, name, 'package.json')
    if (!existsSync(file)) continue
    const pkg = JSON.parse(readFileSync(file, 'utf8'))
    if (pkg.private === true || typeof pkg.name !== 'string') continue
    if (!pkg.name.startsWith('@toolmark/')) continue
    out.push({
      kind: 'publish',
      name: pkg.name,
      version: pkg.version,
      access: 'public',
      tag: 'latest',
    })
  }
  return out
}

/**
 * The plan to check: `{ plan, synthetic }`. Throws on a malformed plan.
 * @param {unknown} plan - The parsed `changeset publish-plan` output.
 * @param {string} root - The workspace root.
 */
export function dryRunPlan(plan, root) {
  if (
    typeof plan !== 'object' ||
    plan === null ||
    plan.version !== 1 ||
    !Array.isArray(plan.plan) ||
    !plan.plan.every(Array.isArray)
  ) {
    throw new Error('the publish plan is not a version 1 plan of entry groups')
  }
  if (plan.plan.flat().length > 0) return { plan, synthetic: false }
  const entries = workspaceEntries(root)
  if (entries.length === 0) throw new Error('no public @toolmark/* packages to synthesize a plan')
  return { plan: { version: 1, plan: [entries] }, synthetic: true }
}

function main() {
  const args = process.argv.slice(2)
  let root = process.cwd()
  const files = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--root') root = resolve(args[++i] ?? usage('--root needs a value'))
    else if (args[i].startsWith('-')) usage(`unknown option ${args[i]}`)
    else files.push(args[i])
  }
  if (files.length !== 2) usage()
  const [input, output] = files
  let result
  try {
    result = dryRunPlan(JSON.parse(readFileSync(input, 'utf8')), root)
  } catch (err) {
    console.error(`::error::${err.message}`)
    process.exit(1)
  }
  writeFileSync(output, `${JSON.stringify(result.plan, null, 2)}\n`)
  const count = result.plan.plan.flat().length
  if (result.synthetic) {
    console.log(
      `::notice::The publish plan is empty (every workspace version is already on npm). ` +
        `Skipping the real-plan checks; the pack, plan, npm and publish-loop checks run on a ` +
        `synthetic plan of all ${count} workspace packages.`,
    )
  } else {
    console.log(`publish plan: ${count} package(s) to publish`)
  }
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `synthetic=${result.synthetic}\n`)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
