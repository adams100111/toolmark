import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { protocolSchemas } from '../src/protocol/schemas.js'

/**
 * Writes the protocol v1 JSON Schemas to `outDir` as `page-to-agent.json` and
 * `agent-to-page.json` (shipped as `@toolmark/core/protocol/v1/*.json`).
 * @param outDir - Target directory (created if missing).
 */
export async function emitProtocolSchemas(outDir: string): Promise<void> {
  await mkdir(outDir, { recursive: true })
  await writeFile(
    join(outDir, 'page-to-agent.json'),
    `${JSON.stringify(protocolSchemas.pageToAgent, null, 2)}\n`,
  )
  await writeFile(
    join(outDir, 'agent-to-page.json'),
    `${JSON.stringify(protocolSchemas.agentToPage, null, 2)}\n`,
  )
}

const entry = process.argv[1]
if (entry !== undefined && import.meta.url === pathToFileURL(resolve(entry)).href) {
  const i = process.argv.indexOf('--out')
  const out = i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : 'dist/protocol/v1'
  await emitProtocolSchemas(resolve(out))
  console.log(`protocol schemas written to ${out}`)
}
