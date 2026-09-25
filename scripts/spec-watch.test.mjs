// Tests for scripts/spec-watch.mjs.
// Run with `node --test "scripts/*.test.mjs"` (Node >= 22.12).
//
// No network: the fixture "sources" list points at `file://` URLs over the checked-in text files
// under `.spec-watch/fixtures/` (read from disk by spec-watch.mjs's fetchText, never fetched). A
// stub `gh` script is written to PATH for the duration of each test and logs every invocation to a
// file, so assertions can check exactly what `gh issue create/edit` calls (if any) were made,
// without a real GitHub token or network access.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const SCRIPT = join(here, 'spec-watch.mjs')
const FIXTURES = join(here, '..', '.spec-watch', 'fixtures')

const OLD_TEXT = await readFile(join(FIXTURES, 'example-old.txt'), 'utf8')
const NEW_TEXT = await readFile(join(FIXTURES, 'example-new.txt'), 'utf8')

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/** A temp dir with: a `sources.json` pointing (via `file://`) at the new fixture text, a prior
 * `state.json` (unless `withPriorState: false`) recording the old fixture text as the last-seen
 * content/hash, and a stub `gh` on its own `bin/` directory that appends `argv.join(' ')` to
 * `gh-calls.log` for every invocation and always exits 0 (echoing `[]` for `issue list`, so
 * spec-watch.mjs always takes the "create" branch, never "edit"). */
async function fixture({ withPriorState = true } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'toolmark-spec-watch-'))

  const sourcesFile = join(dir, 'sources.json')
  await writeFile(
    sourcesFile,
    JSON.stringify([
      { key: 'example.md', url: pathToFileURL(join(FIXTURES, 'example-new.txt')).href },
    ]),
  )

  const statePath = join(dir, 'state.json')
  if (withPriorState) {
    await writeFile(
      statePath,
      JSON.stringify({
        sources: {
          'example.md': {
            url: pathToFileURL(join(FIXTURES, 'example-old.txt')).href,
            sha256: sha256(OLD_TEXT),
            checkedAt: '2026-01-01T00:00:00.000Z',
            content: OLD_TEXT,
          },
        },
      }),
    )
  }

  const binDir = join(dir, 'bin')
  await mkdir(binDir)
  const ghLog = join(dir, 'gh-calls.log')
  const ghStub = [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    `printf '%s\\n' "$*" >> "${ghLog}"`,
    'if [ "$1" = "issue" ] && [ "$2" = "list" ]; then echo "[]"; fi',
    'exit 0',
  ].join('\n')
  await writeFile(join(binDir, 'gh'), ghStub, { mode: 0o755 })

  return { dir, statePath, sourcesFile, binDir, ghLog }
}

function run({ statePath, sourcesFile, binDir }, { dryRun = false } = {}) {
  return spawnSync(process.execPath, [SCRIPT, '--sources', sourcesFile, '--state', statePath], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      SPEC_WATCH_DRY_RUN: dryRun ? '1' : '',
    },
  })
}

async function readGhLog(ghLog) {
  try {
    return (await readFile(ghLog, 'utf8')).trim()
  } catch {
    return ''
  }
}

test('spec_watch_detects_change_and_formats_issue', async () => {
  const f = await fixture()
  try {
    const r = run(f)
    assert.equal(r.status, 0, `spec-watch.mjs exited ${r.status}\n${r.stdout}\n${r.stderr}`)

    // Each `gh` invocation is one entry in the log, but a --body value itself contains newlines
    // (the diff excerpt), so entries are separated on the "issue <verb>" line that starts each
    // call rather than on every newline.
    const log = await readGhLog(f.ghLog)
    assert.match(
      log,
      /^issue list --state open --search/m,
      `expected a "gh issue list" call, got:\n${log}`,
    )
    assert.match(
      log,
      /^issue create --title WebMCP spec changed: example\.md --body/m,
      `expected a "gh issue create" call, got:\n${log}`,
    )
    // The diff excerpt is passed as the --body argument: a removed and an added line.
    assert.match(log, /-The registerTool\(\) method accepts a name, a description and a handler\./)
    assert.match(log, /\+New in this revision: tools may declare/)
    assert.doesNotMatch(
      log,
      /^issue edit/m,
      'no prior open issue in this fixture, so it must create, not edit',
    )

    const state = JSON.parse(await readFile(f.statePath, 'utf8'))
    assert.equal(state.sources['example.md'].sha256, sha256(NEW_TEXT))
    assert.equal(state.sources['example.md'].content, NEW_TEXT)
  } finally {
    await rm(f.dir, { recursive: true, force: true })
  }
})

test('spec_watch_detects_no_change_when_hash_matches', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'toolmark-spec-watch-'))
  try {
    const sourcesFile = join(dir, 'sources.json')
    await writeFile(
      sourcesFile,
      JSON.stringify([
        { key: 'example.md', url: pathToFileURL(join(FIXTURES, 'example-old.txt')).href },
      ]),
    )
    const statePath = join(dir, 'state.json')
    await writeFile(
      statePath,
      JSON.stringify({
        sources: {
          'example.md': {
            url: pathToFileURL(join(FIXTURES, 'example-old.txt')).href,
            sha256: sha256(OLD_TEXT),
            checkedAt: '2026-01-01T00:00:00.000Z',
            content: OLD_TEXT,
          },
        },
      }),
    )
    const binDir = join(dir, 'bin')
    await mkdir(binDir)
    const ghLog = join(dir, 'gh-calls.log')
    await writeFile(
      join(binDir, 'gh'),
      `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> "${ghLog}"\nexit 0\n`,
      { mode: 0o755 },
    )

    const r = run({ statePath, sourcesFile, binDir })
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`)
    const log = await readGhLog(ghLog)
    assert.equal(log, '', `expected no gh calls when the hash is unchanged, got:\n${log}`)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('spec_watch_dry_run_makes_no_gh_writes', async () => {
  const f = await fixture()
  try {
    const before = await readFile(f.statePath, 'utf8')
    const r = run(f, { dryRun: true })
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`)

    const log = await readGhLog(f.ghLog)
    assert.equal(log, '', `dry run must make zero gh calls, got:\n${log}`)

    const after = await readFile(f.statePath, 'utf8')
    assert.equal(after, before, 'dry run must not modify state.json')

    assert.match(r.stdout, /WebMCP spec changed: example\.md/)
    assert.match(r.stdout, /dry run/)
  } finally {
    await rm(f.dir, { recursive: true, force: true })
  }
})

test('spec_watch_first_run_records_a_baseline_without_opening_an_issue', async () => {
  const f = await fixture({ withPriorState: false })
  try {
    const r = run(f)
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`)
    const log = await readGhLog(f.ghLog)
    assert.equal(log, '', `a first run must not open an issue, got:\n${log}`)
    const state = JSON.parse(await readFile(f.statePath, 'utf8'))
    assert.equal(state.sources['example.md'].sha256, sha256(NEW_TEXT))
  } finally {
    await rm(f.dir, { recursive: true, force: true })
  }
})
