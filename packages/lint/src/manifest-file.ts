import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js'
import type { ToolManifest } from '@toolmark/core'
import type { ManifestFile } from './types.js'

interface ManifestFileShape {
  page: string
  tools: ToolManifest[]
}

interface TestHookShape {
  rev: number
  tools: ToolManifest[]
}

// Same import pattern as `rules/schema-invalid.ts`: `ajv/dist/2020.js`'s `Ajv2020` is a named
// export, unaffected by this workspace's lack of `esModuleInterop`.
// Read synchronously at module load (not top-level `await`): this is read from disk once, at
// import time, both from `src/` (tests, dev) and `dist/` (tsdown copies it there as a sibling of
// the bundled `index.js`/`cli.js` — see `tsdown.config.ts`), so a relative `import.meta.url` URL
// resolves correctly in both places.
const schemaDoc = JSON.parse(
  readFileSync(new URL('./manifest.schema.json', import.meta.url), 'utf8'),
) as { $id: string }

const ajv = new Ajv2020({ strict: false, allErrors: true })
ajv.addSchema(schemaDoc)

// Sub-validators for each of the three accepted shapes, compiled from the same schema document
// (and so sharing its `tool`/`toolHints` `$defs`) that `@toolmark/lint/manifest.schema.json`
// publishes — this is the one source of truth for "what a --manifest file may contain", including
// each tool's required `name`/`llmName`/`description`/`hints`/`inputSchema` shape.
const validateManifestFile = ajv.getSchema(
  `${schemaDoc.$id}#/$defs/manifestFile`,
) as ValidateFunction<ManifestFileShape>
const validateTestHookShape = ajv.getSchema(
  `${schemaDoc.$id}#/$defs/testHookShape`,
) as ValidateFunction<TestHookShape>
const validateManifestFileArray = ajv.compile<ManifestFileShape[]>({
  type: 'array',
  items: { $ref: `${schemaDoc.$id}#/$defs/manifestFile` },
})

/**
 * Parses one `--manifest` file's already-`JSON.parse`d content into pages. Accepts
 * `{ page, tools }`, an array of those, or the test-hook shape `{ rev, tools }` (page = the
 * file's basename without extension). Every shape — including each tool's
 * `name`/`llmName`/`description`/`hints`/`inputSchema` — is validated against
 * `manifest.schema.json` with Ajv, so a malformed tool (e.g. missing `hints` or `inputSchema`)
 * is rejected here rather than crashing a rule downstream. See `manifest.schema.json`.
 * @param filePath - The file's path; used in the error message and as the test-hook shape's page.
 * @throws {Error} `invalid manifest file: <filePath>` when `content` matches none of the shapes.
 */
export function parseManifestFile(filePath: string, content: unknown): ManifestFile[] {
  if (Array.isArray(content)) {
    if (validateManifestFileArray(content)) {
      return content.map((entry) => ({ page: entry.page, tools: entry.tools }))
    }
    throw new Error(`invalid manifest file: ${filePath}`)
  }
  if (validateManifestFile(content)) {
    return [{ page: content.page, tools: content.tools }]
  }
  if (validateTestHookShape(content)) {
    return [{ page: basename(filePath, extname(filePath)), tools: content.tools }]
  }
  throw new Error(`invalid manifest file: ${filePath}`)
}

/**
 * Validates a manifest collected from a live page (`--url`, the test hook's `{ rev, tools }`
 * shape) against the same `manifest.schema.json` as `--manifest` files, so a page-supplied
 * malformed tool is rejected here rather than crashing a rule downstream.
 * @throws {Error} `invalid manifest collected from <url>` when `content` is not that shape.
 */
export function parseCollectedManifest(url: string, content: unknown): ManifestFile {
  if (validateTestHookShape(content)) return { page: url, tools: content.tools }
  throw new Error(`invalid manifest collected from ${url}`)
}

/**
 * Reads and JSON-parses `filePath`, then {@link parseManifestFile}s it.
 * @throws {Error} `invalid manifest file: <filePath>` when the file cannot be read, is not valid
 * JSON, or does not match an accepted shape.
 */
export async function readManifestFile(filePath: string): Promise<ManifestFile[]> {
  let raw: string
  try {
    raw = await readFile(filePath, 'utf8')
  } catch {
    throw new Error(`invalid manifest file: ${filePath}`)
  }
  let content: unknown
  try {
    content = JSON.parse(raw)
  } catch {
    throw new Error(`invalid manifest file: ${filePath}`)
  }
  return parseManifestFile(filePath, content)
}
