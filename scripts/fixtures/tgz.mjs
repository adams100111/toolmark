// Test helpers shared by the check-* script tests: a minimal ustar + gzip writer (fixture
// tarballs without npm/pnpm, so a fixture can contain what a packer would rewrite, such as
// `workspace:` ranges) and a scratch-directory writer.
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { gzipSync } from 'node:zlib'

function header(name, size) {
  const h = Buffer.alloc(512)
  h.write(name, 0, 100, 'utf8')
  h.write('0000644\0', 100)
  h.write('0000000\0', 108)
  h.write('0000000\0', 116)
  h.write(`${size.toString(8).padStart(11, '0')}\0`, 124)
  h.write('00000000000\0', 136)
  h.write('        ', 148)
  h.write('0', 156)
  h.write('ustar\0', 257)
  h.write('00', 263)
  let sum = 0
  for (const b of h) sum += b
  h.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148)
  return h
}

/** Writes `files` (`{ 'package/x': string }`) as a gzipped tarball at `file`. */
export async function writeTgz(file, files) {
  const parts = []
  for (const [name, content] of Object.entries(files)) {
    const body = Buffer.from(content)
    parts.push(header(name, body.length), body, Buffer.alloc((512 - (body.length % 512)) % 512))
  }
  parts.push(Buffer.alloc(1024))
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, gzipSync(Buffer.concat(parts)))
}

/** Writes `files` (`{ 'relative/path': string | object }`) under a fresh temp directory. */
export async function scratch(prefix, files) {
  const root = await mkdtemp(join(tmpdir(), prefix))
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path)
    await mkdir(dirname(full), { recursive: true })
    await writeFile(
      full,
      typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`,
    )
  }
  return root
}
