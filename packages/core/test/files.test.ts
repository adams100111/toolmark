import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  createFormTools,
  createToolmark,
  ok,
  setPath,
  ToolmarkError,
  type FieldInfo,
  type FileRef,
  type FilesOptions,
  type ToolmarkErrorEvent,
} from '@toolmark/core'
import { createTestRegistry } from './helpers/create-test-registry.js'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

type Outcome =
  | { file: { name: string; size: number; type: string; text: string } }
  | { error: { code: unknown; message: string } }

/** Registers a tool that resolves `ref` through `ctx.files` and reports the outcome. */
async function resolveThrough(files: FilesOptions | undefined, ref: FileRef): Promise<Outcome> {
  const tm = createTestRegistry(files ? { files } : {})
  let outcome: Outcome | undefined
  tm.register({
    name: 'x',
    description: 'd',
    run: async (_i, ctx) => {
      try {
        const f = await ctx.files.resolve(ref)
        outcome = { file: { name: f.name, size: f.size, type: f.type, text: await f.text() } }
      } catch (e) {
        outcome = { error: { code: (e as ToolmarkError).code, message: (e as Error).message } }
      }
      return ok(null)
    },
  })
  await tm.call('x', {}, { caller: 'inapp' })
  return outcome!
}

const ORIGIN = 'https://files.example.com'

function stubFetch(impl: (url: string, init: RequestInit) => Promise<Response>) {
  const fetch = vi.fn(impl)
  vi.stubGlobal('fetch', fetch)
  return fetch
}

const code = (o: Outcome) => ('error' in o ? o.error.code : 'ok')

describe('files: refs', () => {
  it('ref_resolves_via_app_resolver', async () => {
    const resolve = vi.fn((ref: string, ctx: { signal: AbortSignal }) => {
      expect(ctx.signal).toBeInstanceOf(AbortSignal)
      return Promise.resolve(new File(['hello'], `${ref}.txt`, { type: 'text/plain' }))
    })
    const o = await resolveThrough({ resolve }, { ref: 'a1' })
    expect(o).toEqual({ file: { name: 'a1.txt', size: 5, type: 'text/plain', text: 'hello' } })
    expect(resolve).toHaveBeenCalledOnce()
  })

  it('ref_without_resolver_rejected', async () => {
    const tm = createTestRegistry()
    const errors: ToolmarkErrorEvent[] = []
    tm.events.on('error', (e) => errors.push(e))
    let caught: unknown
    tm.register({
      name: 'x',
      description: 'd',
      run: async (_i, ctx) => {
        try {
          await ctx.files.resolve({ ref: 'x' })
        } catch (e) {
          caught = e
        }
        return ok(null)
      },
    })
    await tm.call('x', {}, { caller: 'inapp' })
    expect(caught).toBeInstanceOf(ToolmarkError)
    expect(caught).toMatchObject({
      code: 'file_rejected',
      message: 'File references are not configured',
    })
    expect(errors.map((e) => e.code)).toEqual(['files_not_configured'])
  })

  it('ref_file_size_limit', async () => {
    const resolve = () => Promise.resolve(new File(['0123456789'], 'a.bin'))
    const o = await resolveThrough({ resolve, maxBytes: 5 }, { ref: 'a' })
    expect(o).toEqual({
      error: { code: 'file_rejected', message: 'File rejected: exceeds the 5-byte limit' },
    })
    expect(code(await resolveThrough({ resolve, maxBytes: 10 }, { ref: 'a' }))).toBe('ok')
  })

  it('ref_file_mime_accept', async () => {
    const png = new File(['x'], 'a.png', { type: 'image/png' })
    const pdf = new File(['x'], 'a.pdf', { type: 'application/pdf' })
    const tm = createTestRegistry({
      files: { resolve: (r) => Promise.resolve(r === 'png' ? png : pdf) },
    })
    const adapter = memoryAdapter()
    createFormTools(tm, adapter, {
      name: 'f',
      description: 'F.',
      input: z.object({ pic: z.instanceof(File).optional(), any: z.instanceof(File).optional() }),
      files: { pic: { accept: ['image/*'] }, any: {} },
    })
    const fill = (values: unknown) => tm.call('f.fill', { values }, { caller: 'inapp' })
    expect((await fill({ pic: { ref: 'png' } })).status).toBe('ok')
    expect(await fill({ pic: { ref: 'pdf' } })).toEqual({
      status: 'refused',
      code: 'file_rejected',
      message: 'File "pic" rejected: type is not accepted (accepts: image/*)',
    })
    expect((await fill({ any: { ref: 'pdf' } })).status).toBe('ok')
    expect(adapter.values.pic).toBe(png)
  })

  it('field_max_bytes_cannot_exceed_global', async () => {
    const big = new File(['x'.repeat(200)], 'big.txt', { type: 'text/plain' })
    const tm = createTestRegistry({ files: { resolve: () => Promise.resolve(big), maxBytes: 100 } })
    createFormTools(tm, memoryAdapter(), {
      name: 'f',
      description: 'F.',
      input: z.object({ doc: z.instanceof(File).optional() }),
      files: { doc: { maxBytes: 1_000_000 } },
    })
    const r = await tm.call('f.fill', { values: { doc: { ref: 'a' } } }, { caller: 'inapp' })
    expect(r).toEqual({
      status: 'refused',
      code: 'file_rejected',
      message: 'File "doc" rejected: exceeds the 100-byte limit',
    })
    const props = tm.describe('f.fill')!.inputSchema.properties as Record<string, unknown>
    const values = props.values as { properties: Record<string, { description: string }> }
    expect(values.properties.doc!.description).toBe(
      'File reference. Accepts: any type; max 100 bytes',
    )
  })
})

describe('files: urls', () => {
  it('url_disabled_by_default', async () => {
    const fetch = stubFetch(() => Promise.resolve(new Response('x')))
    const o = await resolveThrough(undefined, { url: `${ORIGIN}/a.txt` })
    expect(o).toEqual({
      error: { code: 'file_rejected', message: 'File rejected: file URLs are not enabled' },
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('url_origin_not_allowed', async () => {
    const fetch = stubFetch(() => Promise.resolve(new Response('x')))
    const files = { allowOrigins: [ORIGIN] }
    for (const url of [
      'https://evil.example.com/a.txt',
      'https://files.example.com:8443/a.txt',
      'https://files.example.com.evil.com/a.txt',
    ]) {
      expect(await resolveThrough(files, { url })).toEqual({
        error: {
          code: 'file_rejected',
          message: 'File rejected: the file URL origin is not allowed',
        },
      })
    }
    expect(fetch).not.toHaveBeenCalled()
  })

  it('url_non_https_rejected', async () => {
    const fetch = stubFetch(() => Promise.resolve(new Response('x', { status: 200 })))
    const files = {
      allowOrigins: ['http://files.example.com', 'http://localhost:3000', 'http://127.0.0.1:3000'],
    }
    for (const url of ['http://files.example.com/a.txt', 'ftp://files.example.com/a', 'data:,x']) {
      expect(code(await resolveThrough(files, { url }))).toBe('file_rejected')
    }
    expect(fetch).not.toHaveBeenCalled()
    expect(code(await resolveThrough(files, { url: 'http://localhost:3000/a.txt' }))).toBe('ok')
    expect(code(await resolveThrough(files, { url: 'http://127.0.0.1:3000/a.txt' }))).toBe('ok')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('url_userinfo_rejected', async () => {
    const fetch = stubFetch(() => Promise.resolve(new Response('x')))
    const files = { allowOrigins: [ORIGIN] }
    for (const url of ['https://user@files.example.com/a', 'https://u:p@files.example.com/a']) {
      expect(await resolveThrough(files, { url })).toEqual({
        error: {
          code: 'file_rejected',
          message: 'File rejected: file URLs must not contain credentials',
        },
      })
    }
    expect(fetch).not.toHaveBeenCalled()
  })

  it('allow_origins_star_misconfigured', async () => {
    for (const entry of ['*', `${ORIGIN}/`, `${ORIGIN}/path`, 'files.example.com']) {
      expect(() => createTestRegistry({ files: { allowOrigins: [entry] } })).toThrow(
        expect.objectContaining({ code: 'files_misconfigured' }) as Error,
      )
    }
    for (const bad of [{ maxBytes: 0 }, { maxBytes: -1 }, { timeoutMs: 0 }]) {
      expect(() => createTestRegistry({ files: bad })).toThrow(
        expect.objectContaining({ code: 'files_misconfigured' }) as Error,
      )
    }
    // Production: an error event, and URL fetching stays disabled even for the valid entries.
    const events: ToolmarkErrorEvent[] = []
    const fetch = stubFetch(() => Promise.resolve(new Response('x')))
    const tm = createToolmark({
      __environment: 'browser',
      onError: (e) => events.push(e),
      files: { allowOrigins: [ORIGIN, '*'] },
    })
    expect(events.map((e) => e.code)).toEqual(['files_misconfigured'])
    let message = ''
    tm.register({
      name: 'x',
      description: 'd',
      run: async (_i, ctx) => {
        await ctx.files.resolve({ url: `${ORIGIN}/a.txt` }).catch((e: Error) => {
          message = e.message
        })
        return ok(null)
      },
    })
    await tm.call('x', {}, { caller: 'inapp' })
    expect(message).toBe('File rejected: file URLs are not enabled')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('url_redirect_rejected', async () => {
    const fetch = stubFetch((_url, init) =>
      init.redirect === 'error'
        ? Promise.reject(new TypeError('fetch failed: redirect'))
        : Promise.resolve(new Response('secret')),
    )
    const o = await resolveThrough({ allowOrigins: [ORIGIN] }, { url: `${ORIGIN}/moved` })
    expect(o).toEqual({
      error: { code: 'file_rejected', message: 'File rejected: the download failed' },
    })
    expect(fetch).toHaveBeenCalledOnce()
    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe(`${ORIGIN}/moved`)
    expect(Object.keys(init).sort()).toEqual(
      ['cache', 'credentials', 'mode', 'redirect', 'referrerPolicy', 'signal'].sort(),
    )
    expect(init).toEqual({
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      mode: 'cors',
      signal: expect.any(AbortSignal) as AbortSignal,
    })
    // A response that was redirected anyway (defence in depth) is refused too.
    stubFetch(() => {
      const r = new Response('x')
      Object.defineProperty(r, 'redirected', { value: true })
      return Promise.resolve(r)
    })
    expect(await resolveThrough({ allowOrigins: [ORIGIN] }, { url: `${ORIGIN}/a` })).toEqual({
      error: { code: 'file_rejected', message: 'File rejected: redirects are not followed' },
    })
  })

  it('url_fetch_no_referrer_no_store', async () => {
    const fetch = stubFetch(() =>
      Promise.resolve(new Response('hi', { headers: { 'content-type': 'text/plain' } })),
    )
    const o = await resolveThrough({ allowOrigins: [ORIGIN] }, { url: `${ORIGIN}/dir/a.txt` })
    expect(o).toEqual({ file: { name: 'a.txt', size: 2, type: 'text/plain', text: 'hi' } })
    const init = fetch.mock.calls[0]![1]
    expect(init).toMatchObject({
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
    })
    expect(init).not.toHaveProperty('headers')
  })

  it('url_fetch_timeout', async () => {
    stubFetch(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal!.addEventListener('abort', () => reject(new Error('aborted')))
        }),
    )
    const t0 = Date.now()
    const o = await resolveThrough(
      { allowOrigins: [ORIGIN], timeoutMs: 30 },
      { url: `${ORIGIN}/a` },
    )
    expect(o).toEqual({
      error: { code: 'file_rejected', message: 'File rejected: the download timed out' },
    })
    expect(Date.now() - t0).toBeLessThan(2000)
    // The default timeout is 30000 ms.
    const spy = vi.spyOn(AbortSignal, 'timeout')
    stubFetch(() => Promise.resolve(new Response('x')))
    await resolveThrough({ allowOrigins: [ORIGIN] }, { url: `${ORIGIN}/a` })
    expect(spy).toHaveBeenCalledWith(30000)
  })

  it('url_size_limit_header_and_stream', async () => {
    const files = { allowOrigins: [ORIGIN], maxBytes: 10 }
    const tooBig = {
      error: { code: 'file_rejected', message: 'File rejected: exceeds the 10-byte limit' },
    }
    // Declared length over the limit: refused before reading.
    let pulled = 0
    const lazy = () =>
      new ReadableStream<Uint8Array>({
        pull(c) {
          pulled++
          c.enqueue(new Uint8Array(4))
        },
      })
    stubFetch(() =>
      Promise.resolve(new Response(lazy(), { headers: { 'content-length': '1000' } })),
    )
    expect(await resolveThrough(files, { url: `${ORIGIN}/a` })).toEqual(tooBig)
    // No (or a lying) length: the stream is cut and cancelled once it passes the limit.
    let cancelled = false
    pulled = 0
    stubFetch(() =>
      Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            pull(c) {
              pulled++
              c.enqueue(new Uint8Array(4))
            },
            cancel() {
              cancelled = true
            },
          }),
          { headers: { 'content-length': '3' } },
        ),
      ),
    )
    expect(await resolveThrough(files, { url: `${ORIGIN}/a` })).toEqual(tooBig)
    expect(cancelled).toBe(true)
    expect(pulled).toBeLessThan(10)
  })

  it('url_mime_accept', async () => {
    const tm = createTestRegistry({ files: { allowOrigins: [ORIGIN] } })
    createFormTools(tm, memoryAdapter(), {
      name: 'f',
      description: 'F.',
      input: z.object({ pic: z.instanceof(File).optional() }),
      files: { pic: { accept: ['image/png'] } },
    })
    stubFetch(() =>
      Promise.resolve(new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } })),
    )
    expect(
      await tm.call('f.fill', { values: { pic: { url: `${ORIGIN}/a.svg` } } }, { caller: 'inapp' }),
    ).toEqual({
      status: 'refused',
      code: 'file_rejected',
      message: 'File "pic" rejected: type is not accepted (accepts: image/png)',
    })
    stubFetch(() =>
      Promise.resolve(
        new Response('png', { headers: { 'content-type': 'Image/PNG; charset=binary' } }),
      ),
    )
    const r = await tm.call(
      'f.fill',
      { values: { pic: { url: `${ORIGIN}/a.png` } } },
      { caller: 'inapp' },
    )
    expect(r.status).toBe('ok')
  })

  it('url_filename_sanitized', async () => {
    const name = async (path: string) => {
      stubFetch(() => Promise.resolve(new Response('x')))
      const o = await resolveThrough({ allowOrigins: [ORIGIN] }, { url: `${ORIGIN}${path}` })
      return 'file' in o ? o.file.name : o.error.message
    }
    expect(await name('/docs/report%20final.pdf')).toBe('report final.pdf')
    expect(await name('/docs/..%2F..%2Fetc%2Fpasswd')).toBe('....etcpasswd')
    expect(await name('/a%5Cb%00c%0Ad.txt')).toBe('abcd.txt')
    expect(await name('/evil%E2%80%AEfdp.exe')).toBe('evilfdp.exe')
    expect(await name('/')).toBe('download')
    expect(await name('/%2F')).toBe('download')
    expect(await name('/bad%E0%A4%A.txt')).toBe('bad%E0%A4%A.txt')
    expect((await name(`/${'a'.repeat(400)}.txt`)).length).toBe(255)
  })
})

/** Minimal adapter storing values in memory. */
function memoryAdapter() {
  return {
    values: {} as Record<string, unknown>,
    getValues() {
      return this.values
    },
    setValues(values: Record<string, unknown>) {
      for (const [path, v] of Object.entries(values)) this.values = setPath(this.values, path, v)
    },
    dirtyPaths: (): string[] => [],
    submit: () => Promise.resolve(ok(null)),
    fields: (): FieldInfo[] => [],
  }
}
