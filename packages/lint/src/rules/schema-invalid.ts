import { createRequire } from 'node:module'
import { Ajv2020 } from 'ajv/dist/2020.js'
import type { FormatsPlugin } from 'ajv-formats'
import type { Finding } from '../types.js'
import type { Rule } from './rule.js'

// No `esModuleInterop`: `ajv-formats`' only runtime export is a CJS default, which a static ESM
// default import mistypes as the whole module namespace (`ajv/dist/2020`'s `Ajv2020` is a named
// export and imports cleanly). `require` gets the real `module.exports` value; the named
// `FormatsPlugin` type import is unaffected by the same interop gap.
const addFormats = createRequire(import.meta.url)('ajv-formats') as FormatsPlugin

/**
 * A fresh compiler per schema, per the brief's exact options. Never reused: Ajv registers every
 * compiled schema's `$id`, so a second tool (or page, or lint run) whose schema carries the same
 * `$id` would fail with "schema with key or id … already exists" — a false `schema-invalid`.
 */
function newAjv(): Ajv2020 {
  const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: true })
  addFormats(ajv)
  return ajv
}

/**
 * `schema-invalid` (error): `inputSchema` fails to compile with Ajv 2020-12 (`strict: false`,
 * `allErrors: true`, `validateFormats: true`, formats from `ajv-formats`), or its root `type` is
 * not `"object"`.
 */
export const schemaInvalid: Rule = {
  id: 'schema-invalid',
  check(file): Finding[] {
    const findings: Finding[] = []
    for (const tool of file.tools) {
      let message: string | undefined
      try {
        newAjv().compile(tool.inputSchema)
        if (tool.inputSchema['type'] !== 'object') {
          message = 'inputSchema root type must be "object"'
        }
      } catch (e) {
        message = e instanceof Error ? e.message : String(e)
      }
      if (message !== undefined) {
        findings.push({
          rule: 'schema-invalid',
          severity: 'error',
          tool: tool.name,
          page: file.page,
          message,
        })
      }
    }
    return findings
  },
}
