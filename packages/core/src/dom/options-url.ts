import type { OptionsProvider } from '../forms/types.js'

/** @internal Largest options response body read, in bytes (1 MiB); a larger body fails the lookup. */
export const MAX_OPTIONS_RESPONSE_BYTES = 1_048_576

/** @internal Longest `data-tool-options-url` value honoured. */
export const MAX_OPTIONS_URL_LENGTH = 2048

/**
 * @internal Resolves a `data-tool-options-url` value against the element's document: the URL is
 * `new URL(value, document.baseURI)` and must be `http:`/`https:`, carry no username/password and
 * have the page's own origin. Returns the resolved URL, or the reason it was rejected.
 * @param value - The attribute value.
 * @param el - The field that carries it.
 */
export function resolveOptionsUrl(value: string, el: Element): { url: URL } | { rejected: string } {
  const doc = el.ownerDocument
  if (value.length > MAX_OPTIONS_URL_LENGTH) return { rejected: 'the URL is too long' }
  let url: URL
  try {
    url = new URL(value, doc.baseURI)
  } catch {
    return { rejected: 'the URL is invalid' }
  }
  const pageOrigin = doc.defaultView?.location.origin ?? globalThis.location?.origin
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { rejected: 'only http(s) URLs are allowed' }
  }
  if (url.username !== '' || url.password !== '') {
    return { rejected: 'URLs with credentials are not allowed' }
  }
  if (pageOrigin === undefined || pageOrigin === 'null' || url.origin !== pageOrigin) {
    return { rejected: 'only same-origin URLs are allowed' }
  }
  return { url }
}

/** Reads at most `max` bytes of a response body as text; a larger body throws. */
async function readCapped(res: Response, max: number): Promise<string> {
  const declared = Number(res.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > max) throw new Error('Options response too large')
  if (!res.body) {
    const text = await res.text()
    if (text.length > max) throw new Error('Options response too large')
    return text
  }
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > max) {
      await reader.cancel().catch(() => undefined)
      throw new Error('Options response too large')
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

/**
 * @internal An {@link OptionsProvider} backed by a same-origin JSON endpoint (spec §10.2,
 * `data-tool-options-url`). Each lookup fetches `url` with `q` set to the query, `credentials:
 * 'same-origin'` and `mode: 'same-origin'` (a cross-origin redirect fails), under the provider's
 * signal (call cancellation or the 10 s options timeout). A non-2xx status, a body over
 * {@link MAX_OPTIONS_RESPONSE_BYTES}, invalid JSON or a non-array rejects, which the options tool
 * reports as "Options lookup failed"; item validation and the 50-item cap are the options tool's.
 * @param url - A URL accepted by {@link resolveOptionsUrl}.
 */
export function optionsUrlProvider(url: URL): OptionsProvider {
  const base = url.href
  return async ({ query, signal }) => {
    const target = new URL(base)
    target.searchParams.set('q', query)
    const res = await fetch(target.href, {
      method: 'GET',
      credentials: 'same-origin',
      mode: 'same-origin',
      headers: { Accept: 'application/json' },
      signal,
    })
    if (!res.ok) throw new Error(`Options request failed with status ${res.status}`)
    const data: unknown = JSON.parse(await readCapped(res, MAX_OPTIONS_RESPONSE_BYTES))
    if (!Array.isArray(data)) throw new Error('Options response is not a JSON array')
    return data as Awaited<ReturnType<OptionsProvider>>
  }
}
