import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { collectFromUrl, LintUsageError, MISSING_HOOK_MESSAGE } from '../src/collect.js'
import {
  startHangingServer,
  startStaticServer,
  type StaticServer,
} from './support/static-server.js'

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url))

let server: StaticServer | undefined
let tmpDir: string | undefined

afterEach(async () => {
  await server?.close()
  server = undefined
  if (tmpDir) await rm(tmpDir, { recursive: true, force: true })
  tmpDir = undefined
})

describe('collectFromUrl', () => {
  it('url_collects_manifest', async () => {
    server = await startStaticServer(join(FIXTURES, 'page-with-hook.html'))
    const manifest = await collectFromUrl(server.url)
    expect(manifest.page).toBe(server.url)
    expect(manifest.tools.map((t) => t.name)).toEqual(['demo.run'])
  })

  it('url_without_hook_exit_2', async () => {
    server = await startStaticServer(join(FIXTURES, 'page-without-hook.html'))
    const rejection = collectFromUrl(server.url).catch((e: unknown) => e)
    const error = await rejection
    expect(error).toBeInstanceOf(LintUsageError)
    expect(error).toHaveProperty('message', MISSING_HOOK_MESSAGE)
  }, 15_000)

  it('m2_non_responding_url_fails_clearly_within_30s', async () => {
    server = await startHangingServer()
    const rejection = collectFromUrl(server.url).catch((e: unknown) => e)
    const error = await rejection
    expect(error).toBeInstanceOf(LintUsageError)
    expect((error as Error).message).toContain(server.url)
    expect((error as Error).message.toLowerCase()).toMatch(/time(d)? ?out|did not respond/)
  }, 35_000)

  it('storage_state_passed_to_context', async () => {
    server = await startStaticServer(join(FIXTURES, 'page-with-hook.html'))
    tmpDir = await mkdtemp(join(tmpdir(), 'toolmark-lint-'))
    const storageStatePath = join(tmpDir, 'state.json')
    await writeFile(
      storageStatePath,
      JSON.stringify({
        cookies: [],
        origins: [
          {
            origin: server.url.replace(/\/$/, ''),
            localStorage: [{ name: 'toolmark-lint-fixture', value: 'seeded' }],
          },
        ],
      }),
    )

    const manifest = await collectFromUrl(server.url, { storageStatePath })
    expect(manifest.tools.map((t) => t.name).sort()).toEqual(['demo.run', 'seeded.run'])
  })
})
