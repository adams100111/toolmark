import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  createFormTools,
  fileFieldSchema,
  ok,
  setPath,
  type FieldInfo,
  type FileFieldSpec,
  type JsonSchema,
  type StandardSchemaV1,
  type ToolmarkErrorEvent,
} from '@toolmark/core'
import { createTestRegistry } from './helpers/create-test-registry.js'

const txt = (name: string, body = 'data') => new File([body], name, { type: 'text/plain' })

function setup(opts: {
  input?: StandardSchemaV1<unknown, Record<string, unknown>>
  files?: Record<string, FileFieldSpec>
  resolve?: (ref: string) => Promise<File>
}) {
  const files = new Map([
    ['a', txt('a.txt', 'aaa')],
    ['b', txt('b.txt', 'bb')],
  ])
  const resolve = vi.fn(
    opts.resolve ??
      ((ref: string) => {
        const f = files.get(ref)
        return f ? Promise.resolve(f) : Promise.reject(new Error(`no such ref ${ref} (secret)`))
      }),
  )
  const tm = createTestRegistry({ files: { resolve } })
  const errors: ToolmarkErrorEvent[] = []
  tm.events.on('error', (e) => {
    if (e.code !== 'missing_confirm_handler') errors.push(e)
  })
  const adapter = {
    values: { title: '' } as Record<string, unknown>,
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
  createFormTools(tm, adapter, {
    name: 'f',
    description: 'F.',
    input:
      opts.input ??
      z.object({
        title: z.string(),
        doc: z.instanceof(File).nullish(),
        docs: z.array(z.instanceof(File)).optional(),
        attachments: z.array(z.object({ label: z.string(), file: z.instanceof(File) })).optional(),
      }),
    files: opts.files ?? {
      doc: { accept: ['text/plain'], maxBytes: 100 },
      docs: { multiple: true },
      'attachments[].file': {},
    },
  })
  const fill = (values: unknown) => tm.call('f.fill', { values }, { caller: 'inapp' })
  return { tm, adapter, fill, resolve, errors, files }
}

describe('form files', () => {
  it('form_fill_with_file_sets_file_value', async () => {
    const { adapter, fill, files } = setup({})
    const r = await fill({
      title: 'T',
      doc: { ref: 'a' },
      docs: [{ ref: 'a' }, { ref: 'b' }],
      attachments: [{ label: 'x', file: { ref: 'b' } }],
    })
    expect(r.status).toBe('ok')
    expect(adapter.values.doc).toBe(files.get('a'))
    expect(adapter.values.docs).toEqual([files.get('a'), files.get('b')])
    expect((adapter.values.attachments as { file: File }[])[0]!.file).toBe(files.get('b'))
    const aDesc = { file: { name: 'a.txt', size: 3, type: 'text/plain' } }
    const bDesc = { file: { name: 'b.txt', size: 2, type: 'text/plain' } }
    expect(r).toEqual(
      ok({
        changes: [
          { path: 'attachments', before: undefined, after: [{ label: 'x', file: bDesc }] },
          { path: 'doc', before: undefined, after: aDesc },
          { path: 'docs', before: undefined, after: [aDesc, bDesc] },
          { path: 'title', before: '', after: 'T' },
        ],
        skipped: [],
      }),
    )
    // null clears a file field.
    const cleared = await fill({ doc: null })
    expect(cleared.status).toBe('ok')
    expect(adapter.values.doc).toBeNull()
  })

  it('form_fill_file_failure_sets_nothing', async () => {
    const { adapter, fill, errors } = setup({})
    const before = adapter.values
    const r = await fill({
      title: 'T',
      doc: { ref: 'a' },
      docs: [{ ref: 'a' }, { ref: 'missing' }],
    })
    expect(r).toEqual({
      status: 'refused',
      code: 'file_rejected',
      message: 'File "docs.1" rejected: the file reference could not be resolved',
    })
    expect(JSON.stringify(r)).not.toContain('secret')
    expect(adapter.values).toBe(before)
    expect(errors).toEqual([])
  })

  it('file_ref_shape_invalid_issue_at_path', async () => {
    const { adapter, fill, resolve } = setup({})
    const before = adapter.values
    for (const [values, path] of [
      [{ doc: { ref: 1 } }, 'doc.ref'],
      [{ doc: 'a' }, 'doc'],
      [{ doc: { ref: 'a', url: 'https://x.test/a' } }, 'doc'],
      [{ doc: { ref: 'a', extra: 1 } }, 'doc'],
      [{ docs: { ref: 'a' } }, 'docs'],
      [{ 'doc.ref': 'a' }, 'doc'],
      [{ attachments: [{ label: 'x', file: { path: '/etc/passwd' } }] }, 'attachments.0.file'],
    ] as const) {
      const r = await fill(values)
      expect(r.status, JSON.stringify(values)).toBe('invalid')
      const paths = r.status === 'invalid' ? r.issues.map((i) => i.path) : []
      expect(
        paths.every((p) => p === path || p.startsWith(`${path}.`)),
        JSON.stringify(paths),
      ).toBe(true)
    }
    expect(resolve).not.toHaveBeenCalled()
    expect(adapter.values).toBe(before)
  })

  it('file_field_with_zod_file_schema_fills', async () => {
    const { tm, adapter, fill, files } = setup({
      input: z.object({ title: z.string(), doc: z.file().max(100).optional() }),
      files: { doc: { accept: ['text/*'] } },
    })
    const r = await fill({ doc: { ref: 'a' } })
    expect(r.status).toBe('ok')
    expect(adapter.values.doc).toBe(files.get('a'))
    const values = (tm.describe('f.fill')!.inputSchema.properties as Record<string, JsonSchema>)
      .values as { properties: Record<string, unknown> }
    expect(values.properties.doc).toEqual(
      fileFieldSchema({ accept: ['text/*'], maxBytes: 10485760 }),
    )
  })

  it('file_field_with_instanceof_file_registers', () => {
    const { tm, errors } = setup({})
    expect(errors).toEqual([])
    const fill = tm.describe('f.fill')!
    const values = (fill.inputSchema.properties as Record<string, JsonSchema>).values as {
      properties: Record<string, JsonSchema>
    }
    expect(values.properties.doc).toEqual(
      fileFieldSchema({ accept: ['text/plain'], maxBytes: 100 }),
    )
    expect(values.properties.docs).toEqual(fileFieldSchema({ multiple: true, maxBytes: 10485760 }))
    expect(values.properties.doc).toMatchObject({
      type: 'object',
      properties: { ref: { type: 'string' }, url: { type: 'string', format: 'uri' } },
      oneOf: [{ required: ['ref'] }, { required: ['url'] }],
      additionalProperties: false,
      description: 'File reference. Accepts: text/plain; max 100 bytes',
    })
    const text = JSON.stringify(values)
    expect(text).toContain('"file":')
    const attachments = values.properties.attachments as {
      anyOf: { items?: JsonSchema; properties?: Record<string, { items: JsonSchema }> }[]
    }
    const replace = attachments.anyOf[0]!.items as { properties: Record<string, unknown> }
    const append = attachments.anyOf[1]!.properties!.$append!.items as {
      properties: Record<string, unknown>
    }
    expect(replace.properties.file).toEqual(fileFieldSchema({ maxBytes: 10485760 }))
    expect(append.properties.file).toEqual(fileFieldSchema({ maxBytes: 10485760 }))
    // Without `files`, an instanceof(File) schema is still a conversion failure (M1 path).
    const tm2 = createTestRegistry()
    expect(() =>
      createFormTools(
        tm2,
        { ...stubAdapter() },
        {
          name: 'g',
          description: 'G.',
          input: z.object({ doc: z.instanceof(File) }),
        },
      ),
    ).toThrow(expect.objectContaining({ code: 'schema_conversion_failed' }) as Error)
  })

  it('file_changes_are_json_safe', async () => {
    const { tm, fill } = setup({})
    const r = await fill({ doc: { ref: 'a' }, docs: [{ ref: 'b' }] })
    expect(r.status).toBe('ok')
    expect(JSON.parse(JSON.stringify(r))).toEqual(r)
    const second = await fill({ doc: { ref: 'b' } })
    expect(JSON.parse(JSON.stringify(second))).toEqual(second)
    expect(second).toEqual(
      ok({
        changes: [
          {
            path: 'doc',
            before: { file: { name: 'a.txt', size: 3, type: 'text/plain' } },
            after: { file: { name: 'b.txt', size: 2, type: 'text/plain' } },
          },
        ],
        skipped: [],
      }),
    )
    expect(tm).toBeDefined()
  })

  it('file_undo_restores_previous_files', async () => {
    const { tm, adapter, files } = setup({})
    const previous = txt('old.txt', 'old')
    adapter.values = { title: '', doc: previous, docs: [previous] }
    let callId = ''
    tm.events.on('result', (e) => {
      if (e.tool === 'f.fill') callId = e.callId
    })
    const r = await tm.call(
      'f.fill',
      { values: { doc: { ref: 'a' }, docs: [{ ref: 'b' }] } },
      { caller: 'inapp' },
    )
    expect(r.status).toBe('ok')
    expect(adapter.values.doc).toBe(files.get('a'))
    const u = await tm.undo(callId)
    expect(adapter.values.doc).toBe(previous)
    expect(adapter.values.docs).toEqual([previous])
    expect(JSON.parse(JSON.stringify(u))).toEqual(u)
    expect(u).toEqual(
      ok({
        changes: [
          {
            path: 'doc',
            before: { file: { name: 'a.txt', size: 3, type: 'text/plain' } },
            after: { file: { name: 'old.txt', size: 3, type: 'text/plain' } },
          },
          {
            path: 'docs',
            before: [{ file: { name: 'b.txt', size: 2, type: 'text/plain' } }],
            after: [{ file: { name: 'old.txt', size: 3, type: 'text/plain' } }],
          },
        ],
        skipped: [],
      }),
    )
  })
})

describe('form files: misconfiguration', () => {
  it('file_spec_misconfigured', () => {
    for (const files of [
      { doc: { maxBytes: 0 } },
      { doc: { accept: ['*'] } },
      { 'a.__proto__': {} },
    ] as Record<string, FileFieldSpec>[]) {
      const tm = createTestRegistry()
      expect(() =>
        createFormTools(tm, stubAdapter(), {
          name: 'f',
          description: 'F.',
          input: z.object({ doc: z.instanceof(File).optional() }),
          files,
        }),
      ).toThrow(expect.objectContaining({ code: 'files_misconfigured' }) as Error)
      expect(tm.manifest().tools).toEqual([])
    }
  })
})

function stubAdapter() {
  return {
    getValues: () => ({}),
    setValues: () => undefined,
    dirtyPaths: (): string[] => [],
    submit: () => Promise.resolve(ok(null)),
    fields: (): FieldInfo[] => [],
  }
}
