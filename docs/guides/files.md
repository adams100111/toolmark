# Files

Agents cannot type bytes. A file field instead takes a **reference** that the page turns into a
`File` (spec §8.4, D27):

```ts
type FileRef = { ref: string } | { url: string }
```

- `{ ref }` is resolved by your app's `files.resolve` hook (for example an attachment the user
  uploaded in the chat or the tour UI).
- `{ url }` is fetched from an allow-listed origin. **URL fetching is off by default.**

## Setup

```ts
import { createToolmark, type FilesOptions } from '@toolmark/core'

declare function attachmentFile(id: string, signal: AbortSignal): Promise<File> // your app code

const files: FilesOptions = {
  resolve: (ref, { signal }) => attachmentFile(ref, signal),
  allowOrigins: ['https://cdn.example.com'], // omit to keep URL fetching off
  maxBytes: 5 * 1024 * 1024, // default 10485760 (10 MiB)
  timeoutMs: 20000, // default 30000
}

export const tm = createToolmark({ files })
```

A form declares its file fields with `FormToolOptions.files` (a `FileFieldSpec` per dot path; `[]`
stands for any array index, as for [options](forms.md#async-options-d26)):

```tsx
import { z } from 'zod'
import { useFormTool } from '@toolmark/react'
import { rhfAdapter } from '@toolmark/react/rhf'
import { useForm } from 'react-hook-form'

const schema = z.object({
  title: z.string(),
  cover: z.instanceof(File),
  attachments: z.array(z.instanceof(File)),
})
type Upload = z.infer<typeof schema>

export function UploadForm({ save }: { save: (v: Upload) => Promise<void> }) {
  const form = useForm<Upload>()
  useFormTool(rhfAdapter(form, { onSubmit: save }), {
    name: 'upload',
    description: 'Upload a document with a cover image.',
    input: schema,
    files: {
      cover: { accept: ['image/png', 'image/jpeg'], maxBytes: 2_000_000 },
      attachments: { multiple: true, maxFiles: 5, accept: ['application/pdf'] },
    },
  })
  return null
}
```

The agent fills `{ "values": { "cover": { "ref": "att_1" }, "attachments": [{ "ref": "att_2" }] } }`.
Code-defined tools can resolve references themselves with `ctx.files.resolve(ref)` (same rules;
failures reject with `ToolmarkError` `file_rejected`, which the call reports as `refused`
`file_rejected`).

## `FileFieldSpec` and the advertised schema

| Field      | Meaning                                                                                                         |
| ---------- | --------------------------------------------------------------------------------------------------------------- |
| `accept`   | MIME types (`image/png`) or families (`image/*`); absent or empty accepts any type.                             |
| `maxBytes` | Field size limit. The effective limit is the **smaller** of this and `files.maxBytes` (a field narrows).        |
| `multiple` | The field holds a list (`File[]`), given as an array of references.                                             |
| `maxFiles` | Most references in one fill for a `multiple` field: a positive integer ≤ 100, default `DEFAULT_MAX_FILES` (10). |

`fileFieldSchema(spec)` returns the JSON Schema the fill manifest uses for a file field: an object
with exactly one of `ref` (1–`MAX_FILE_REF_LENGTH` = 2048 characters) or `url` (`format: 'uri'`,
1–`MAX_FILE_URL_LENGTH` = 8192 characters), `additionalProperties: false`, and a description
naming the accepted types and the size limit. For `multiple`, it is an array of those with
`maxItems` = `maxFiles`. File fields take whole values: no `$append`/`$remove`.

## Rules

Every rule below applies to both `ref` and `url` files unless it says otherwise.

1. **Shape first.** One fill carries at most `MAX_FILE_REFS_PER_FILL` (100) file references in
   total — every file field, every item of a `[]` array path and every entry of a `multiple` list
   counted together (a wizard `fill` counts all its steps together); more → `invalid` at the root
   (`"Too many files (at most 100 per fill)"`) before anything is resolved or fetched. More than
   `maxFiles` references in one `multiple` field → `invalid` at the field
   (`"Too many files (at most N)"`), also before anything is resolved or fetched. An empty or
   over-long `ref`/`url` → `invalid` at `<path>.ref` / `<path>.url`. A dotted key running through a file path → `invalid`
   (`"Expected a file reference"`). `null` clears the field.
2. **Resolution.** All references of one fill are resolved (sequentially) before anything is
   written. Any failure → `refused` `file_rejected` and **nothing** is set. Resolution happens
   before the unknown-field and schema checks, so a fill that later turns out `invalid` may already
   have fetched its files (nothing is written).
3. **`{ ref }`.** Without `files.resolve` → `refused` `file_rejected` (`"File references are not configured"`) plus the development event `files_not_configured`. The resolver receives the
   call's `signal`. There is **no Toolmark timeout** for refs (a resolver may wait for the user):
   it is bounded only by the call signal (cancellation and the registry's abort grace period).
   Resolver errors never reach the agent (`"the file reference could not be resolved"`), except a
   `ToolmarkError('file_rejected', message)` your resolver throws on purpose.
4. **`{ url }` is off by default.** It is fetched only when `files.allowOrigins` is non-empty and
   the URL's origin **exactly** equals an entry (scheme, host and port; no suffix matching).
5. **Protocol and userinfo.** Only `https:` URLs, or `http:` whose host is exactly `localhost`,
   `127.0.0.1` or `[::1]`, are fetched. A URL with a username or password is refused. `data:`,
   `ftp:` and every other scheme are refused. All checks run before `fetch`.
6. **Fetch options** are exactly `{ credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', cache: 'no-store', mode: 'cors', signal }` with no extra headers. A redirect
   fails the fetch (and a response reporting `redirected` or `opaqueredirect` is refused as well).
7. **Timeout.** `files.timeoutMs` (default 30000 ms) covers the request and reading the body; the
   call signal aborts it too.
8. **Size.** The effective limit is checked on `Content-Length` before reading and again while the
   body streams; reading stops (the stream is cancelled) as soon as the limit is passed. Non-2xx
   bodies are never read. Resolved `ref` files are checked against the same limit.
9. **Type.** `accept` is checked on the MIME essence (parameters dropped, lower-cased) of the
   `Content-Type` header before reading, and on the resulting `File.type`. `*/*` accepts anything;
   an empty type fails a non-empty `accept`.
10. **File names** of fetched files come from the last URL path segment, decoded, with control
    characters, path separators and bidi/zero-width characters removed, at most 255 characters;
    `"download"` when nothing usable remains.
11. **Error texts** name the field path, the reason and at most the limit, accepted types or HTTP
    status. The URL, resolver messages and response bodies never appear.
12. **JSON-safe results.** `changes` (in `fill` and undo results) report files as
    `{ file: { name, size, type } }`. The real `File` objects only reach `adapter.setValues` and the
    undo restorer.

## Misconfiguration: `files_misconfigured`

These `files` options or specs are rejected when the registry or form is created: an
`allowOrigins` entry that is not exactly `new URL(entry).origin` (trailing slash, path, missing
scheme), contains `*` (`https://*.example.com`), or is `http:` on a host other than the loopback
hosts above; a non-positive `maxBytes` or `timeoutMs`; a `resolve` that is not a function; a
`FileFieldSpec` with a non-positive `maxBytes`, an `accept` entry that is not `type/sub` or
`type/*`, a non-boolean `multiple`, or a `maxFiles` outside 1–100; an unsafe `files` key.

- Development: `createToolmark`/`createFormTools` throws `ToolmarkError` `files_misconfigured`.
- Production: an `error` event. A bad registry option turns URL fetching off (invalid numbers fall
  back to the defaults); a bad field spec means the form registers **no** tools.

## When the file schema cannot be converted

The form's JSON Schema is derived with the converter option `unrepresentable: 'any'`, so zod's
`z.instanceof(File)` converts (to `{}`) and each file path is then advertised as
`fileFieldSchema(spec)`. If your schema library cannot convert a file field at all (conversion
fails with `schema_conversion_failed`), pass the form's JSON Schema yourself with
`FormToolOptions.jsonSchema`; file paths in it are still replaced by `fileFieldSchema(spec)`.
Validation still runs your `input` schema against the resolved `File` values.

For JSON-Schema-only forms (`fromJsonSchema`), validate file fields with `{}` (any value) in the
`input` schema and advertise `fileFieldSchema(spec)` in `jsonSchema`: a resolved `File` does not
match the `{ ref } | { url }` object shape. The DOM scanner does exactly this
([DOM forms](dom.md#using-the-adapter-directly)).

## Known limits

- In Node (server-side use), `fetch` ignores `mode` and `referrerPolicy`; there the scheme, origin
  and userinfo checks are the protection.
- References of a `multiple` field are fetched one after another, each bounded by the timeout.
