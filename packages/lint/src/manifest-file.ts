import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import type { ToolManifest } from '@toolmark/core'
import type { ManifestFile } from './types.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isToolArray(value: unknown): value is ToolManifest[] {
  return Array.isArray(value)
}

function isManifestFileShape(value: unknown): value is { page: string; tools: ToolManifest[] } {
  return isRecord(value) && typeof value['page'] === 'string' && isToolArray(value['tools'])
}

function isTestHookShape(value: unknown): value is { rev: number; tools: ToolManifest[] } {
  return isRecord(value) && typeof value['rev'] === 'number' && isToolArray(value['tools'])
}

/**
 * Parses one `--manifest` file's already-`JSON.parse`d content into pages. Accepts
 * `{ page, tools }`, an array of those, or the test-hook shape `{ rev, tools }` (page = the
 * file's basename without extension). See `manifest.schema.json`.
 * @param filePath - The file's path; used in the error message and as the test-hook shape's page.
 * @throws {Error} `invalid manifest file: <filePath>` when `content` matches none of the shapes.
 */
export function parseManifestFile(filePath: string, content: unknown): ManifestFile[] {
  if (Array.isArray(content)) {
    if (content.every(isManifestFileShape)) {
      return content.map((entry) => ({ page: entry.page, tools: entry.tools }))
    }
    throw new Error(`invalid manifest file: ${filePath}`)
  }
  if (isManifestFileShape(content)) {
    return [{ page: content.page, tools: content.tools }]
  }
  if (isTestHookShape(content)) {
    return [{ page: basename(filePath, extname(filePath)), tools: content.tools }]
  }
  throw new Error(`invalid manifest file: ${filePath}`)
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
