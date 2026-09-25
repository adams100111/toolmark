import { ToolmarkError } from './errors.js'
import type { JsonSchema } from './tool.js'

/**
 * A reference to a file an agent hands to a tool (spec §8.4, D27): `{ ref }` is resolved by the
 * app's `files.resolve` hook (e.g. an attachment uploaded in chat); `{ url }` is fetched only from
 * allow-listed origins (off by default). `ref` must be a non-empty string of at most
 * {@link MAX_FILE_REF_LENGTH} characters and `url` at most {@link MAX_FILE_URL_LENGTH}; anything
 * else is refused before the resolver or `fetch` runs.
 */
export type FileRef = { ref: string } | { url: string }

/**
 * Registry-wide file settings (`createToolmark({ files })`, spec §8.4). Misconfiguration (an
 * `allowOrigins` entry that is not exactly an origin, contains `*`, or is `http:` on a host other
 * than `localhost` / `127.0.0.1` / `[::1]`; a non-positive `maxBytes` or `timeoutMs`) is
 * `files_misconfigured`: thrown in development; in production an `error` event is emitted and URL
 * fetching stays disabled.
 */
export interface FilesOptions {
  /**
   * Resolves a `{ ref }` to a `File`. Receives the call's `signal`. Without it, every `{ ref }` is
   * refused `file_rejected` ("File references are not configured").
   */
  resolve?: (ref: string, ctx: { signal: AbortSignal }) => Promise<File>
  /**
   * Exact origins (`https://cdn.example.com`) `{ url }` references may be fetched from. Empty or
   * absent (the default) disables URL fetching. No wildcards; `http:` origins only for `localhost`,
   * `127.0.0.1` and `[::1]`. Only `https:` URLs (or `http:` on those loopback hosts) without
   * userinfo are fetched, with credentials omitted, redirects refused, no
   * referrer and no cache.
   */
  allowOrigins?: string[]
  /** Size limit for every resolved file, in bytes (default `10485760`, 10 MiB). */
  maxBytes?: number
  /** URL fetch timeout in milliseconds (default `30000`). */
  timeoutMs?: number
}

/**
 * Limits of one form file field (`createFormTools({ files: { [path]: spec } })`). A field limit can
 * only narrow the registry's `files.maxBytes`.
 */
export interface FileFieldSpec {
  /** Accepted MIME types (`image/png`) or families (`image/*`); absent or empty accepts any type. */
  accept?: string[]
  /** Size limit in bytes (the effective limit is the smaller of this and `files.maxBytes`). */
  maxBytes?: number
  /** The field holds a list of files (`File[]`, given as an array of references). */
  multiple?: boolean
  /**
   * Most references a `multiple` field accepts in one fill (a positive integer ≤ 100, default
   * {@link DEFAULT_MAX_FILES}); advertised as `maxItems`. More is `invalid` ("Too many files")
   * before anything is resolved or fetched.
   */
  maxFiles?: number
}

/** Default size limit (10 MiB, M2 constraints). */
export const DEFAULT_FILE_MAX_BYTES = 10485760
/** Default URL fetch timeout (M2 constraints). */
export const DEFAULT_FILE_TIMEOUT_MS = 30000

/** Default {@link FileFieldSpec.maxFiles} of a `multiple` file field. */
export const DEFAULT_MAX_FILES = 10
/** Largest allowed {@link FileFieldSpec.maxFiles}. */
const MAX_MAX_FILES = 100
/** Most characters (code points) of a `{ ref }` value. */
export const MAX_FILE_REF_LENGTH = 2048
/** Most characters (code points) of a `{ url }` value. */
export const MAX_FILE_URL_LENGTH = 8192

/**
 * Most file references one fill may carry in total, across every file field (each item of a `[]`
 * array path and each reference of a `multiple` field counts once; a wizard `fill` counts all its
 * steps together). More is `invalid` ("Too many files") at the root, before any reference is
 * resolved or fetched.
 */
export const MAX_FILE_REFS_PER_FILL = 100

const MAX_NAME_LENGTH = 255

/** Non-empty and at most `max` code points (cheap UTF-16 bound first, no huge spreads). */
function withinLength(s: string, max: number): boolean {
  if (s.length === 0 || s.length > 2 * max) return false
  if (s.length <= max) return true
  let n = 0
  for (const _ of s) if (++n > max) return false
  return true
}

function describeLimits(spec: FileFieldSpec): string {
  const accept = spec.accept && spec.accept.length > 0 ? spec.accept.join(', ') : 'any type'
  return `File reference. Accepts: ${accept}; max ${spec.maxBytes ?? DEFAULT_FILE_MAX_BYTES} bytes`
}

/**
 * The JSON Schema a form's `fill` manifest uses for a file field (spec §8.4): an object with
 * exactly one of `ref` (1–{@link MAX_FILE_REF_LENGTH} characters) / `url` (1–
 * {@link MAX_FILE_URL_LENGTH}), described with the accepted types and size limit; when
 * `spec.multiple`, an array of those with `maxItems` = `spec.maxFiles` (default
 * {@link DEFAULT_MAX_FILES}).
 * @param spec - The field's effective limits (`maxBytes` defaults to 10485760 in the description).
 * @returns A fresh JSON Schema object.
 */
export function fileFieldSchema(spec: FileFieldSpec): JsonSchema {
  const one: JsonSchema = {
    type: 'object',
    properties: {
      ref: { type: 'string', minLength: 1, maxLength: MAX_FILE_REF_LENGTH },
      url: { type: 'string', format: 'uri', minLength: 1, maxLength: MAX_FILE_URL_LENGTH },
    },
    oneOf: [{ required: ['ref'] }, { required: ['url'] }],
    additionalProperties: false,
    description: describeLimits(spec),
  }
  return spec.multiple === true
    ? { type: 'array', items: one, maxItems: spec.maxFiles ?? DEFAULT_MAX_FILES }
    : one
}

/** @internal Registry-validated file settings (see {@link filesConfig}). */
export interface FilesConfig {
  readonly resolve: FilesOptions['resolve'] | undefined
  /** Empty = URL fetching disabled. */
  readonly allowOrigins: readonly string[]
  readonly maxBytes: number
  readonly timeoutMs: number
  /** Called when a `{ ref }` meets no resolver (the registry emits the dev event). */
  readonly missingResolver: () => void
}

const isPositive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0

const isLoopbackHost = (hostname: string): boolean =>
  hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'

/**
 * @internal Validates `createToolmark({ files })`. Every problem is passed to `fail` (the registry
 * throws in dev); with any problem URL fetching is disabled and invalid numbers fall back to the
 * defaults.
 */
export function filesConfig(
  opts: FilesOptions | undefined,
  fail: (message: string) => void,
  missingResolver: () => void,
): FilesConfig {
  const problems: string[] = []
  const origins: string[] = []
  const raw = opts?.allowOrigins as unknown
  if (raw !== undefined && !Array.isArray(raw)) problems.push('files.allowOrigins must be an array')
  if (Array.isArray(raw)) {
    for (const entry of raw as unknown[]) {
      let origin: string | undefined
      try {
        origin = typeof entry === 'string' ? new URL(entry).origin : undefined
      } catch {
        origin = undefined
      }
      if (origin === undefined || origin === 'null' || origin !== entry || entry.includes('*')) {
        problems.push(
          `files.allowOrigins entry ${JSON.stringify(entry)} is not an exact origin ` +
            `(scheme://host[:port], no "*", path or trailing slash)`,
        )
      } else if (origin.startsWith('http:') && !isLoopbackHost(new URL(origin).hostname)) {
        problems.push(
          `files.allowOrigins entry ${JSON.stringify(entry)} uses http: on a non-loopback host ` +
            `(only localhost, 127.0.0.1 and [::1] may use http:)`,
        )
      } else {
        origins.push(origin)
      }
    }
  }
  for (const key of ['maxBytes', 'timeoutMs'] as const) {
    const v = opts?.[key]
    if (v !== undefined && !isPositive(v)) problems.push(`files.${key} must be a positive number`)
  }
  const resolve = opts?.resolve as unknown
  if (resolve !== undefined && typeof resolve !== 'function') {
    problems.push('files.resolve must be a function')
  }
  for (const p of problems) fail(p)
  return {
    resolve: typeof resolve === 'function' ? (resolve as FilesOptions['resolve']) : undefined,
    allowOrigins: problems.length > 0 ? [] : origins,
    maxBytes: isPositive(opts?.maxBytes) ? opts.maxBytes : DEFAULT_FILE_MAX_BYTES,
    timeoutMs: isPositive(opts?.timeoutMs) ? opts.timeoutMs : DEFAULT_FILE_TIMEOUT_MS,
    missingResolver,
  }
}

/** @internal Problems with a form's {@link FileFieldSpec} (empty when valid). */
export function fileSpecProblems(path: string, spec: unknown): string[] {
  if (typeof spec !== 'object' || spec === null) return [`files["${path}"] must be an object`]
  const s = spec as Record<string, unknown>
  const out: string[] = []
  if (s.maxBytes !== undefined && !isPositive(s.maxBytes)) {
    out.push(`files["${path}"].maxBytes must be a positive number`)
  }
  if (
    s.accept !== undefined &&
    (!Array.isArray(s.accept) ||
      !s.accept.every((a) => typeof a === 'string' && /^[\w.+-]+\/(?:[\w.+-]+|\*)$/.test(a)))
  ) {
    out.push(`files["${path}"].accept must list MIME types such as "image/png" or "image/*"`)
  }
  if (s.multiple !== undefined && typeof s.multiple !== 'boolean') {
    out.push(`files["${path}"].multiple must be a boolean`)
  }
  if (
    s.maxFiles !== undefined &&
    !(
      Number.isInteger(s.maxFiles) &&
      (s.maxFiles as number) > 0 &&
      (s.maxFiles as number) <= MAX_MAX_FILES
    )
  ) {
    out.push(`files["${path}"].maxFiles must be a positive integer of at most ${MAX_MAX_FILES}`)
  }
  return out
}

/** @internal The field limits narrowed by the registry's: `maxBytes = min(field, global)`. */
export function effectiveSpec(spec: FileFieldSpec, files: FilesConfig): FileFieldSpec {
  const out: FileFieldSpec = {
    maxBytes: Math.min(spec.maxBytes ?? Infinity, files.maxBytes),
  }
  if (spec.accept !== undefined) out.accept = [...spec.accept]
  if (spec.multiple !== undefined) out.multiple = spec.multiple
  if (spec.maxFiles !== undefined) out.maxFiles = spec.maxFiles
  return out
}

/** @internal JSON-safe description of a file (spec §8.4). */
export function describeFile(file: File): { file: { name: string; size: number; type: string } } {
  return { file: { name: file.name, size: file.size, type: file.type } }
}

const isFile = (v: unknown): v is File => typeof File !== 'undefined' && v instanceof File

/**
 * @internal Deep copy of `value` with every `File` replaced by {@link describeFile} (plain objects
 * and arrays only, depth-bounded). Returns `value` itself when it holds no file.
 */
export function jsonSafeFiles(value: unknown, depth = 0): unknown {
  if (isFile(value)) return describeFile(value)
  if (depth > 64 || typeof value !== 'object' || value === null) return value
  if (Array.isArray(value)) {
    let changed = false
    const out = value.map((v) => {
      const next = jsonSafeFiles(v, depth + 1)
      if (next !== v) changed = true
      return next
    })
    return changed ? out : value
  }
  const proto = Object.getPrototypeOf(value) as unknown
  if (proto !== Object.prototype && proto !== null) return value
  let changed = false
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value)) {
    const v = (value as Record<string, unknown>)[key]
    const next = jsonSafeFiles(v, depth + 1)
    if (next !== v) changed = true
    Object.defineProperty(out, key, {
      value: next,
      enumerable: true,
      writable: true,
      configurable: true,
    })
  }
  return changed ? out : value
}

/**
 * @internal Whether `v` has the {@link FileRef} shape: exactly one key, `ref` (a string of 1–
 * {@link MAX_FILE_REF_LENGTH} characters) or `url` (1–{@link MAX_FILE_URL_LENGTH}).
 */
export function isFileRef(v: unknown): v is FileRef {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  const keys = Object.keys(v)
  if (keys.length !== 1) return false
  const key = keys[0]
  const value = (v as Record<string, unknown>)[key!]
  if (typeof value !== 'string') return false
  if (key === 'ref') return withinLength(value, MAX_FILE_REF_LENGTH)
  if (key === 'url') return withinLength(value, MAX_FILE_URL_LENGTH)
  return false
}

/**
 * @internal Cheap pre-validation of a form file value (before the schema validator and before any
 * resolution): a `multiple` field over its `maxFiles` → "Too many files"; a `ref` / `url` string
 * that is empty or too long → an issue at that reference. Returns `[]` when these limits hold.
 */
export function fileLimitIssues(
  raw: unknown,
  spec: FileFieldSpec,
  path: string,
): { path: string; message: string }[] {
  if (spec.multiple === true) {
    if (!Array.isArray(raw)) return []
    const max = spec.maxFiles ?? DEFAULT_MAX_FILES
    if (raw.length > max) return [{ path, message: `Too many files (at most ${max})` }]
    return raw.flatMap((item, i) => refLengthIssues(item, `${path}.${i}`))
  }
  return refLengthIssues(raw, path)
}

/** @internal The number of references a form file value counts toward {@link MAX_FILE_REFS_PER_FILL}. */
export function fileRefCount(raw: unknown, spec: FileFieldSpec): number {
  return spec.multiple === true && Array.isArray(raw) ? raw.length : 1
}

/** @internal The root issue of a fill over {@link MAX_FILE_REFS_PER_FILL}. */
export const TOO_MANY_FILES_PER_FILL = {
  path: '',
  message: `Too many files (at most ${MAX_FILE_REFS_PER_FILL} per fill)`,
} as const

function refLengthIssues(v: unknown, path: string): { path: string; message: string }[] {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return []
  const out: { path: string; message: string }[] = []
  for (const [key, max] of [
    ['ref', MAX_FILE_REF_LENGTH],
    ['url', MAX_FILE_URL_LENGTH],
  ] as const) {
    const value = Object.hasOwn(v, key) ? (v as Record<string, unknown>)[key] : undefined
    if (typeof value === 'string' && !withinLength(value, max)) {
      out.push({
        path: `${path}.${key}`,
        message: value.length === 0 ? 'Must not be empty' : `Must be at most ${max} characters`,
      })
    }
  }
  return out
}

function rejected(path: string | undefined, reason: string): ToolmarkError {
  return new ToolmarkError(
    'file_rejected',
    path === undefined ? `File rejected: ${reason}` : `File "${path}" rejected: ${reason}`,
  )
}

/** MIME type without parameters, lower-cased (`Text/Plain; charset=x` → `text/plain`). */
function essence(type: string): string {
  return type.split(';')[0]!.trim().toLowerCase()
}

function accepts(accept: string[] | undefined, type: string): boolean {
  if (!accept || accept.length === 0) return true
  const t = essence(type)
  if (t === '') return false
  return accept.some((a) => {
    const want = a.toLowerCase()
    if (want === '*/*') return true
    return want.endsWith('/*') ? t.startsWith(want.slice(0, -1)) : t === want
  })
}

/** Checks a resolved file against the effective limits. */
function checkFile(file: File, spec: FileFieldSpec, path: string | undefined): File {
  const max = spec.maxBytes ?? DEFAULT_FILE_MAX_BYTES
  if (file.size > max) throw rejected(path, `exceeds the ${max}-byte limit`)
  if (!accepts(spec.accept, file.type)) {
    throw rejected(path, `type is not accepted (accepts: ${spec.accept!.join(', ')})`)
  }
  return file
}

// Controls (C0, DEL, C1), path separators and bidi / zero-width format characters.
// eslint-disable-next-line no-control-regex
const UNSAFE_NAME_CHARS = /[\u0000-\u001f\u007f-\u009f/\\\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g

/**
 * @internal File name for a fetched URL: the decoded last path segment without `/`, `\`, control
 * or bidi characters, at most 255 characters; `"download"` when nothing usable remains.
 */
export function fileNameFromUrl(url: URL): string {
  const segment = url.pathname.split('/').pop() ?? ''
  let decoded: string
  try {
    decoded = decodeURIComponent(segment)
  } catch {
    decoded = segment
  }
  const cleaned = Array.from(decoded.replace(UNSAFE_NAME_CHARS, '').trim())
    .slice(0, MAX_NAME_LENGTH)
    .join('')
  return cleaned === '' || cleaned === '.' || cleaned === '..' ? 'download' : cleaned
}

/** Rejects as soon as `signal` aborts (a resolver may ignore its signal). */
function untilAbort<T>(p: Promise<T>, signal: AbortSignal, onAbort: () => Error): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(onAbort())
      return
    }
    const abort = (): void => reject(onAbort())
    signal.addEventListener('abort', abort, { once: true })
    p.then(
      (v) => {
        signal.removeEventListener('abort', abort)
        resolve(v)
      },
      (e: unknown) => {
        signal.removeEventListener('abort', abort)
        reject(e instanceof Error ? e : new Error(String(e)))
      },
    )
  })
}

/** Reads `body` up to `max` bytes; more → rejection and the stream is cancelled. */
async function readLimited(
  body: ReadableStream<Uint8Array> | null,
  max: number,
  signal: AbortSignal,
  path: string | undefined,
): Promise<Uint8Array[]> {
  if (body === null) return []
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  const onAbort = (): void => {
    reader.cancel().catch(() => undefined)
  }
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    for (;;) {
      if (signal.aborted) throw new Error('aborted')
      const { done, value } = await reader.read()
      if (signal.aborted) throw new Error('aborted')
      if (done) return chunks
      total += value.byteLength
      if (total > max) {
        await reader.cancel().catch(() => undefined)
        throw rejected(path, `exceeds the ${max}-byte limit`)
      }
      chunks.push(value)
    }
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

/** Fetches an allow-listed URL under every constraint of spec §8.4 / the M2 files bullet. */
async function fetchUrl(
  raw: string,
  spec: FileFieldSpec,
  files: FilesConfig,
  signal: AbortSignal,
  path: string | undefined,
): Promise<File> {
  if (files.allowOrigins.length === 0) throw rejected(path, 'file URLs are not enabled')
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw rejected(path, 'invalid file URL')
  }
  const localHttp = url.protocol === 'http:' && isLoopbackHost(url.hostname)
  if (url.protocol !== 'https:' && !localHttp) throw rejected(path, 'file URLs must use https')
  if (url.username !== '' || url.password !== '') {
    throw rejected(path, 'file URLs must not contain credentials')
  }
  if (!files.allowOrigins.includes(url.origin)) {
    throw rejected(path, 'the file URL origin is not allowed')
  }
  const timeout = AbortSignal.timeout(files.timeoutMs)
  const combined = AbortSignal.any([signal, timeout])
  const failed = (): ToolmarkError =>
    timeout.aborted && !signal.aborted
      ? rejected(path, 'the download timed out')
      : signal.aborted
        ? rejected(path, 'the download was cancelled')
        : rejected(path, 'the download failed')
  let response: Response
  try {
    response = await untilAbort(
      globalThis.fetch(url.href, {
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
        mode: 'cors',
        signal: combined,
      }),
      combined,
      failed,
    )
  } catch {
    throw failed()
  }
  const discard = (): void => {
    response.body?.cancel().catch(() => undefined)
  }
  if (response.redirected || response.type === 'opaqueredirect') {
    discard()
    throw rejected(path, 'redirects are not followed')
  }
  if (!response.ok) {
    discard()
    throw rejected(path, `the download failed (HTTP ${response.status})`)
  }
  const max = spec.maxBytes ?? DEFAULT_FILE_MAX_BYTES
  const length = response.headers.get('content-length')
  if (length !== null && /^\d+$/.test(length.trim()) && Number(length) > max) {
    discard()
    throw rejected(path, `exceeds the ${max}-byte limit`)
  }
  const type = essence(response.headers.get('content-type') ?? '')
  if (!accepts(spec.accept, type)) {
    discard()
    throw rejected(path, `type is not accepted (accepts: ${spec.accept!.join(', ')})`)
  }
  let chunks: Uint8Array[]
  try {
    chunks = await readLimited(response.body, max, combined, path)
  } catch (e) {
    if (e instanceof ToolmarkError) throw e
    throw failed()
  }
  return new File(chunks as BlobPart[], fileNameFromUrl(url), { type })
}

/**
 * @internal Resolves a {@link FileRef} and checks it against `spec` (already narrowed by the
 * registry limits). Every failure rejects with `ToolmarkError('file_rejected')` whose message names
 * `opts.path` (when given) and the reason; resolver errors and response bodies never reach it.
 */
export async function resolveFileRef(
  ref: FileRef,
  spec: FileFieldSpec,
  files: FilesConfig,
  signal: AbortSignal,
  opts: { path?: string } = {},
): Promise<File> {
  const path = opts.path
  const effective = effectiveSpec(spec, files)
  if (!isFileRef(ref)) throw rejected(path, 'expected { ref } or { url }')
  if ('url' in ref) {
    return checkFile(await fetchUrl(ref.url, effective, files, signal, path), effective, path)
  }
  const resolve = files.resolve
  if (!resolve) {
    files.missingResolver()
    throw new ToolmarkError('file_rejected', 'File references are not configured')
  }
  let file: unknown
  try {
    file = await untilAbort(
      Promise.resolve().then(() => resolve(ref.ref, { signal })),
      signal,
      () => rejected(path, 'resolution was cancelled'),
    )
  } catch (e) {
    if (e instanceof ToolmarkError && e.code === 'file_rejected') throw e
    throw rejected(path, 'the file reference could not be resolved')
  }
  if (!isFile(file)) throw rejected(path, 'the file reference could not be resolved')
  return checkFile(file, effective, path)
}
