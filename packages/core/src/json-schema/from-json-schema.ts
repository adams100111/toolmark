import { ToolmarkError } from '../errors.js'
import type { StandardJSONSchemaV1, StandardSchemaV1 } from '../standard-schema.js'
import type { JsonSchema } from '../tool.js'
import { compileJsonSchema } from './validate.js'

/**
 * Turns a JSON Schema into a Standard Schema validator that also implements Standard JSON Schema,
 * so tools that only have a JSON Schema (DOM-synthesized forms, server-declared tools) validate
 * their input like any other tool, and M1's schema resolution reads the schema back unchanged.
 *
 * Supported keywords (exact list): `type` (string or array of types), `enum`, `const`,
 * `properties`, `required`, `additionalProperties` (boolean), `items`, `minItems`, `maxItems`,
 * `uniqueItems`, `minLength`, `maxLength` (code points), `pattern` (unanchored, `u` flag),
 * `minimum`, `maximum`, `multipleOf`, `format` (`date`, `time`, `date-time`, `email`, `uri`),
 * `anyOf`, `oneOf`, `allOf`, `$defs`, `$ref` (local `#/$defs/<name>` only), and the annotations
 * `default`, `title`, `description` (`default` is not applied: the output is the input value).
 * Every other keyword is ignored. Issue paths are property names and array indexes (numbers).
 *
 * @example
 * ```ts
 * const input = fromJsonSchema<{ title: string }>({
 *   type: 'object',
 *   properties: { title: { type: 'string', minLength: 1 } },
 *   required: ['title'],
 * })
 * ```
 * @param schema - A draft 2020-12 JSON Schema using the supported subset. It is deep-copied, so
 *   later changes to the argument have no effect.
 * @returns A synchronous Standard Schema (vendor `'toolmark'`) whose `jsonSchema.input()` and
 *   `.output()` return a deep copy of `schema` for target `'draft-2020-12'` and throw for any
 *   other target.
 * @throws ToolmarkError `schema_conversion_failed` when the schema has a `$ref` other than a
 *   resolvable `#/$defs/<name>`, an invalid `pattern`, or is not a JSON object.
 */
export function fromJsonSchema<T = unknown>(
  schema: JsonSchema,
): StandardSchemaV1<unknown, T> & StandardJSONSchemaV1<unknown, T> {
  let copy: JsonSchema
  try {
    copy = structuredClone(schema)
  } catch (cause) {
    throw new ToolmarkError(
      'schema_conversion_failed',
      'Unsupported JSON Schema: the schema is not plain JSON data',
      { cause },
    )
  }
  const validator = compileJsonSchema(copy)
  const toJson = (options: StandardJSONSchemaV1.Options): Record<string, unknown> => {
    if (options.target !== 'draft-2020-12') {
      throw new ToolmarkError(
        'schema_conversion_failed',
        `fromJsonSchema only provides target "draft-2020-12" (got "${String(options.target)}")`,
      )
    }
    return structuredClone(copy)
  }
  const props: StandardSchemaV1.Props<unknown, T> & StandardJSONSchemaV1.Props<unknown, T> = {
    version: 1,
    vendor: 'toolmark',
    validate(value: unknown): StandardSchemaV1.Result<T> {
      const issues = validator(value)
      if (issues.length === 0) return { value: value as T }
      return { issues: issues.map((i) => ({ message: i.message, path: i.path })) }
    },
    jsonSchema: { input: toJson, output: toJson },
  }
  return { '~standard': props }
}
