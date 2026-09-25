#!/usr/bin/env node
// No application code in the packages (D3; M5 plan ruling "App-code check pattern").
//
//   node scripts/check-no-app-code.mjs [--root <repo>]
//
// Fails on /innovation|dits-sa|ChallengeForm|entry[ -]mode/i in `packages/*/src/**` and
// `packages/*/README.md`. A bare "challenge" is deliberately not matched (false positives).
// Prints one FAIL line per match (`<path>:<line>: <text>`) and exits 0 or 1.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PATTERN = /innovation|dits-sa|ChallengeForm|entry[ -]mode/i

const args = process.argv.slice(2)
const rootArg = args.indexOf('--root')
const root =
  rootArg >= 0 ? resolve(args[rootArg + 1]) : resolve(dirname(fileURLToPath(import.meta.url)), '..')

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}

const files = []
const packagesDir = join(root, 'packages')
for (const name of existsSync(packagesDir) ? readdirSync(packagesDir).sort() : []) {
  const pkg = join(packagesDir, name)
  if (!statSync(pkg).isDirectory()) continue
  if (existsSync(join(pkg, 'src'))) files.push(...walk(join(pkg, 'src')))
  if (existsSync(join(pkg, 'README.md'))) files.push(join(pkg, 'README.md'))
}

let matches = 0
for (const file of files) {
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      const m = PATTERN.exec(line)
      if (!m) return
      matches++
      console.log(
        `FAIL ${relative(root, file)}:${i + 1}: "${m[0]}" in ${line.trim().slice(0, 160)}`,
      )
    })
}
console.log(`check-no-app-code: ${files.length} file(s) scanned, ${matches} match(es)`)
process.exit(matches === 0 && files.length > 0 ? 0 : 1)
