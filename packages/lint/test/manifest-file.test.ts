import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseManifestFile, readManifestFile } from '../src/manifest-file.js'

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url))

describe('manifest_file_shapes', () => {
  it('parses a { page, tools } object', () => {
    const files = parseManifestFile('irrelevant.json', {
      page: 'checkout',
      tools: [],
    })
    expect(files).toEqual([{ page: 'checkout', tools: [] }])
  })

  it('parses an array of { page, tools } objects', () => {
    const files = parseManifestFile('irrelevant.json', [
      { page: 'a', tools: [] },
      { page: 'b', tools: [] },
    ])
    expect(files).toEqual([
      { page: 'a', tools: [] },
      { page: 'b', tools: [] },
    ])
  })

  it('parses the test-hook shape, using the basename (no extension) as the page', () => {
    const files = parseManifestFile('/some/dir/checkout.manifest.json', {
      rev: 3,
      tools: [],
    })
    expect(files).toEqual([{ page: 'checkout.manifest', tools: [] }])
  })

  it('rejects anything else', () => {
    expect(() => parseManifestFile('bad.json', { foo: 'bar' })).toThrow(
      'invalid manifest file: bad.json',
    )
    expect(() => parseManifestFile('bad.json', [{ foo: 'bar' }])).toThrow(
      'invalid manifest file: bad.json',
    )
    expect(() => parseManifestFile('bad.json', null)).toThrow('invalid manifest file: bad.json')
  })

  it('readManifestFile reads real fixture files on disk', async () => {
    const shape = await readManifestFile(`${FIXTURES}manifest-shape.json`)
    expect(shape).toHaveLength(1)
    expect(shape[0]?.page).toBe('checkout')

    const array = await readManifestFile(`${FIXTURES}manifest-array.json`)
    expect(array.map((f) => f.page)).toEqual(['page-a', 'page-b'])

    const testHook = await readManifestFile(`${FIXTURES}manifest-testhook.json`)
    expect(testHook).toEqual([{ page: 'manifest-testhook', tools: testHook[0]?.tools }])
  })

  it('readManifestFile rejects an unrecognized shape with the file path', async () => {
    await expect(readManifestFile(`${FIXTURES}manifest-invalid.json`)).rejects.toThrow(
      `invalid manifest file: ${FIXTURES}manifest-invalid.json`,
    )
  })

  it('readManifestFile rejects a missing file', async () => {
    await expect(readManifestFile(`${FIXTURES}does-not-exist.json`)).rejects.toThrow(
      `invalid manifest file: ${FIXTURES}does-not-exist.json`,
    )
  })
})
