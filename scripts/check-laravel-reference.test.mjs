// Tests for scripts/check-laravel-reference.mjs.
// Run with `node --test "scripts/*.test.mjs"` (Node >= 22.12). Fixtures are written to a temp dir.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const CHECK = join(here, 'check-laravel-reference.mjs')

const BRIDGE = [
  '<?php',
  '',
  'namespace App\\Toolmark;',
  '',
  'final class BrowserBridge',
  '{',
  '    public const PROTOCOL = 1;',
  '}',
  '',
].join('\n')

const PROPS = ['<?php', '', 'namespace App\\Toolmark;', '', 'final class Props {}', ''].join('\n')

/** A file whose own second line (after `<?php`) is the marker — a real synced file's shape. */
const RUNNER = [
  '<?php',
  '// file: app/Toolmark/AgentRunner.php',
  '',
  'namespace App\\Toolmark;',
  '',
  'interface AgentRunner {}',
  '',
].join('\n')

/** Renders a markdown doc whose php blocks carry a `// file:` marker as their own first line
 * (not part of the synced file: stripped before comparing). */
function doc(blocks) {
  const parts = ['# Laravel reference', '', 'Intro.', '']
  for (const { file, body } of blocks) {
    parts.push('```php', `// file: ${file}`, body.replace(/\n$/, ''), '```', '')
  }
  parts.push('An unmarked block is not checked:', '', '```php', '<?php echo 1;', '```', '')
  return parts.join('\n')
}

/** Renders a markdown doc whose php blocks are the file verbatim, `<?php` first and the marker
 * as the file's own second line (the real convention: the marker is part of the compared file). */
function docEmbeddedMarker(bodies) {
  const parts = ['# Laravel reference', '', 'Intro.', '']
  for (const body of bodies) {
    parts.push('```php', body.replace(/\n$/, ''), '```', '')
  }
  return parts.join('\n')
}

/** Writes an example root (`app/Toolmark/*.php`) and a doc; returns their paths. */
async function fixture({ files = {}, markdown }) {
  const dir = await mkdtemp(join(tmpdir(), 'toolmark-laravel-ref-'))
  const root = join(dir, 'example')
  await mkdir(join(root, 'app', 'Toolmark'), { recursive: true })
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(root, name), content)
  }
  const docPath = join(dir, 'laravel-reference.md')
  await writeFile(docPath, markdown)
  return { dir, root, docPath }
}

function run({ root, docPath }) {
  return spawnSync(process.execPath, [CHECK, '--doc', docPath, '--root', root], {
    encoding: 'utf8',
  })
}

const matching = () => ({
  files: {
    'app/Toolmark/BrowserBridge.php': BRIDGE,
    'app/Toolmark/Props.php': PROPS,
  },
  markdown: doc([
    { file: 'app/Toolmark/BrowserBridge.php', body: BRIDGE },
    { file: 'app/Toolmark/Props.php', body: PROPS },
  ]),
})

test('laravel_reference_matches_example: matching fixture exits 0', async () => {
  const f = await fixture(matching())
  try {
    const r = run(f)
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`)
    assert.match(r.stdout, /2 blocks match/)
  } finally {
    await rm(f.dir, { recursive: true, force: true })
  }
})

test('marker on line 2 (after <?php, the real file convention): matching fixture exits 0', async () => {
  const f = await fixture({
    files: { 'app/Toolmark/AgentRunner.php': RUNNER },
    markdown: docEmbeddedMarker([RUNNER]),
  })
  try {
    const r = run(f)
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`)
    assert.match(r.stdout, /1 blocks match/)
  } finally {
    await rm(f.dir, { recursive: true, force: true })
  }
})

test('marker on line 2: a changed byte (including in the marker line itself) exits 1', async () => {
  const f = await fixture({
    files: { 'app/Toolmark/AgentRunner.php': RUNNER },
    markdown: docEmbeddedMarker([
      RUNNER.replace('interface AgentRunner {}', 'interface AgentRunner2 {}'),
    ]),
  })
  try {
    const r = run(f)
    assert.equal(r.status, 1, `${r.stdout}\n${r.stderr}`)
    assert.match(r.stderr, /app\/Toolmark\/AgentRunner\.php/)
  } finally {
    await rm(f.dir, { recursive: true, force: true })
  }
})

test('laravel_reference_matches_example: one changed byte exits 1', async () => {
  const m = matching()
  m.files['app/Toolmark/BrowserBridge.php'] = BRIDGE.replace('PROTOCOL = 1', 'PROTOCOL = 2')
  const f = await fixture(m)
  try {
    const r = run(f)
    assert.equal(r.status, 1, `${r.stdout}\n${r.stderr}`)
    assert.match(r.stderr, /app\/Toolmark\/BrowserBridge\.php/)
    assert.match(r.stderr, /line 7/)
  } finally {
    await rm(f.dir, { recursive: true, force: true })
  }
})

test('CRLF line endings in the example file are normalised', async () => {
  const m = matching()
  m.files['app/Toolmark/Props.php'] = PROPS.replace(/\n/g, '\r\n')
  const f = await fixture(m)
  try {
    const r = run(f)
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`)
  } finally {
    await rm(f.dir, { recursive: true, force: true })
  }
})

test('a missing example file exits 1', async () => {
  const m = matching()
  delete m.files['app/Toolmark/Props.php']
  const f = await fixture(m)
  try {
    const r = run(f)
    assert.equal(r.status, 1)
    assert.match(r.stderr, /app\/Toolmark\/Props\.php.*(missing|not found)/i)
  } finally {
    await rm(f.dir, { recursive: true, force: true })
  }
})

test('a missing trailing line in the doc block exits 1', async () => {
  const m = matching()
  m.markdown = doc([
    { file: 'app/Toolmark/BrowserBridge.php', body: BRIDGE.replace('}\n', '') },
    { file: 'app/Toolmark/Props.php', body: PROPS },
  ])
  const f = await fixture(m)
  try {
    assert.equal(run(f).status, 1)
  } finally {
    await rm(f.dir, { recursive: true, force: true })
  }
})

test('a doc without marked blocks exits 1 (nothing checked is a failure)', async () => {
  const f = await fixture({ files: matching().files, markdown: doc([]) })
  try {
    const r = run(f)
    assert.equal(r.status, 1)
    assert.match(r.stderr, /no php blocks with a .*file:/i)
  } finally {
    await rm(f.dir, { recursive: true, force: true })
  }
})

test('a marker outside app/Toolmark (or with ..) exits 1', async () => {
  for (const file of ['app/Http/Kernel.php', 'app/Toolmark/../../.env.php']) {
    const f = await fixture({
      files: matching().files,
      markdown: doc([{ file, body: PROPS }]),
    })
    try {
      const r = run(f)
      assert.equal(r.status, 1, file)
      assert.match(r.stderr, /invalid file marker/i)
    } finally {
      await rm(f.dir, { recursive: true, force: true })
    }
  }
})

test('an unclosed php fence exits 1', async () => {
  const m = matching()
  m.markdown = '```php\n// file: app/Toolmark/Props.php\n' + PROPS
  const f = await fixture(m)
  try {
    const r = run(f)
    assert.equal(r.status, 1)
    assert.match(r.stderr, /unclosed/i)
  } finally {
    await rm(f.dir, { recursive: true, force: true })
  }
})
