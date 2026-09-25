#!/usr/bin/env node
// Checks that the Laravel reference guide shows the example's code byte for byte.
//
// A fenced `php` block is marked when its first line is `// file: app/Toolmark/<Name>.php`, or
// when its first line is `<?php` and its second line is that marker (a real PHP file cannot open
// with anything before `<?php`, so a synced file's own first two lines are `<?php` then the
// marker — the marker is then part of the compared content). A marked block must equal that file
// under the example root (line endings normalised to LF; the file's final newline is not part of
// the block). Unmarked php blocks are not checked. Exit codes: 0 all marked blocks match; 1 a
// mismatch, a missing file, an invalid marker, an unclosed fence or no marked block at all; 2
// usage error.
//
// Usage: node scripts/check-laravel-reference.mjs
//          [--doc docs/guides/laravel-reference.md] [--root examples/inertia-laravel]
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MARKER = /^\/\/ file: (\S+)\s*$/
const VALID_PATH = /^app\/Toolmark\/[A-Za-z0-9_]+(?:\/[A-Za-z0-9_]+)*\.php$/

/** Splits LF/CRLF text into lines (a final newline does not add an empty line). */
function lines(text) {
  return text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n')
}

/** Every fenced `php` block: `{ line, body }` with `line` the 1-based opening-fence line. */
export function phpBlocks(markdown) {
  const src = lines(markdown)
  const blocks = []
  for (let i = 0; i < src.length; i++) {
    const open = /^(`{3,}|~{3,})php\s*$/.exec(src[i])
    if (!open) continue
    const fence = open[1]
    const start = i
    const body = []
    for (i++; i < src.length; i++) {
      const close = /^(`{3,}|~{3,})\s*$/.exec(src[i])
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length) break
      body.push(src[i])
    }
    if (i >= src.length) throw new Error(`unclosed php fence opened at line ${start + 1}`)
    blocks.push({ line: start + 1, body })
  }
  return blocks
}

/**
 * Finds a block's `// file: ...` marker: on its own first line (stripped before comparing, since
 * it is not part of the synced file), or on its second line when the first is `<?php` (kept,
 * since a real PHP file's own second line is that marker). Returns `{ rel, strip }` or null.
 */
function findMarker(body) {
  const first = MARKER.exec(body[0] ?? '')
  if (first) return { rel: first[1], strip: 1 }
  if (body[0] === '<?php') {
    const second = MARKER.exec(body[1] ?? '')
    if (second) return { rel: second[1], strip: 0 }
  }
  return null
}

/** Compares the doc's marked blocks with the example files; returns `{ checked, errors }`. */
export function checkLaravelReference({ doc, root }) {
  const errors = []
  let blocks
  try {
    blocks = phpBlocks(readFileSync(doc, 'utf8'))
  } catch (err) {
    return { checked: 0, errors: [`${doc}: ${err instanceof Error ? err.message : String(err)}`] }
  }
  let checked = 0
  for (const block of blocks) {
    const marker = findMarker(block.body)
    if (!marker) continue
    const rel = marker.rel
    const where = `${doc}:${block.line}`
    if (!VALID_PATH.test(rel)) {
      errors.push(`${where}: invalid file marker "${rel}" (expected app/Toolmark/<Name>.php)`)
      continue
    }
    checked++
    const file = join(root, rel)
    if (!existsSync(file)) {
      errors.push(`${where}: ${rel} is missing from ${root}`)
      continue
    }
    const expected = lines(readFileSync(file, 'utf8'))
    const actual = block.body.slice(marker.strip)
    const n = Math.max(expected.length, actual.length)
    for (let k = 0; k < n; k++) {
      if (expected[k] !== actual[k]) {
        errors.push(
          `${where}: ${rel} differs at line ${k + 1}\n` +
            `  example: ${JSON.stringify(expected[k] ?? '<end of file>')}\n` +
            `  doc:     ${JSON.stringify(actual[k] ?? '<end of block>')}`,
        )
        break
      }
    }
  }
  if (checked === 0 && errors.length === 0) {
    errors.push(`${doc}: no php blocks with a "// file: app/Toolmark/<Name>.php" first line`)
  }
  return { checked, errors }
}

function parseArgs(argv) {
  const opts = {
    doc: join(repoRoot, 'docs/guides/laravel-reference.md'),
    root: join(repoRoot, 'examples/inertia-laravel'),
  }
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    const value = argv[i + 1]
    if ((flag === '--doc' || flag === '--root') && value !== undefined) {
      opts[flag.slice(2)] = resolve(value)
      i++
    } else {
      throw new Error(`unknown or incomplete argument: ${flag}`)
    }
  }
  return opts
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let opts
  try {
    opts = parseArgs(process.argv.slice(2))
  } catch (err) {
    console.error(`check-laravel-reference: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(2)
  }
  const { checked, errors } = checkLaravelReference(opts)
  if (errors.length > 0) {
    for (const e of errors) console.error(e)
    process.exit(1)
  }
  console.log(`check-laravel-reference: ${checked} blocks match ${opts.root}`)
}
