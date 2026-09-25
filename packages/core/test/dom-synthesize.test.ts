import { afterEach, describe, expect, it } from 'vitest'
import { fileFieldSchema, fromJsonSchema } from '@toolmark/core'
import { synthesizeFormSchema } from '@toolmark/core/dom'
import { synthesizeForm } from '../src/dom/synthesize.js'
import { descriptionsForm, excludedForm, typesForm } from './fixtures/dom/forms.js'

const mounted: HTMLElement[] = []
function mount(html: string): HTMLFormElement {
  const host = document.createElement('div')
  host.innerHTML = html
  document.body.append(host)
  mounted.push(host)
  const form = host.querySelector('form')
  if (!form) throw new Error('fixture has no form')
  return form
}
afterEach(() => {
  for (const el of mounted.splice(0)) el.remove()
})

describe('synthesizeFormSchema', () => {
  it('synthesize_types_table', () => {
    const schema = synthesizeFormSchema(mount(typesForm))
    expect(schema).toEqual({
      type: 'object',
      properties: {
        title: {
          type: 'string',
          minLength: 2,
          maxLength: 40,
          pattern: '^(?:[A-Z].*)$',
          default: 'Hello',
        },
        q: { type: 'string' },
        notes: { type: 'string', maxLength: 500, default: 'Some notes' },
        email: { type: 'string', format: 'email' },
        site: { type: 'string', format: 'uri' },
        phone: { type: 'string' },
        qty: { type: 'integer', minimum: 1, maximum: 10 },
        price: { type: 'number', minimum: 0, multipleOf: 0.01 },
        ratio: { type: 'number', minimum: 0, maximum: 1 },
        odd: { type: 'integer', minimum: 1 },
        even: { type: 'integer', multipleOf: 2, default: 4 },
        half: { type: 'number', minimum: 0.5 },
        day: { type: 'string', format: 'date', description: '(min 2026-01-01, max 2026-12-31)' },
        at: { type: 'string', format: 'time', description: '(min 09:00)' },
        when: {
          type: 'string',
          // Ruling: the brief's `(:\d{2}(\.\d{1,3})?)?` fails the ReDoS check; same language.
          pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}(|:\\d{2}|:\\d{2}\\.\\d{1,3})$',
        },
        agree: { type: 'boolean', default: true },
        optin: { type: 'boolean' },
        tags: { type: 'array', items: { enum: ['a', 'b'] }, uniqueItems: true, default: ['a'] },
        size: { enum: ['s', 'm'], description: 'Options: s = Small; m = Medium', default: 'm' },
        color: { enum: ['r', 'g'], description: 'Options: r = Red; g = Green' },
        langs: {
          type: 'array',
          items: { enum: ['en', 'ar'] },
          uniqueItems: true,
          description: 'Options: en = English; ar = Arabic',
          default: ['en'],
        },
        doc: fileFieldSchema({ accept: ['application/pdf', 'image/*'] }),
        photos: fileFieldSchema({ multiple: true }),
        address: {
          type: 'object',
          properties: {
            city: { type: 'string' },
            zip: { type: 'string', pattern: '^(?:\\d{5})$' },
          },
          additionalProperties: false,
        },
      },
      required: ['title', 'color'],
      additionalProperties: false,
    })
    // The synthesized schema is accepted by the JSON-Schema-subset validator.
    expect(() => fromJsonSchema(schema)).not.toThrow()
  })

  it('synthesize_file_specs_for_form_tools', () => {
    const { files } = synthesizeForm(mount(typesForm))
    expect(files).toEqual({
      doc: { accept: ['application/pdf', 'image/*'] },
      photos: { multiple: true },
    })
  })

  it('synthesize_unsafe_or_invalid_pattern_skipped', () => {
    const form = mount(`<form>
      <input name="evil" pattern="(a+)+" maxlength="9">
      <input name="broken" pattern="[">
      <input name="fine" pattern="[a-z]+">
    </form>`)
    const { schema, skipped } = synthesizeForm(form)
    expect(schema.properties).toEqual({
      evil: { type: 'string', maxLength: 9 },
      broken: { type: 'string' },
      fine: { type: 'string', pattern: '^(?:[a-z]+)$' },
    })
    expect(skipped.map((s) => s.path)).toEqual(['evil', 'broken'])
    expect(() => fromJsonSchema(schema)).not.toThrow()
  })

  it('synthesize_descriptions_precedence', () => {
    const schema = synthesizeFormSchema(mount(descriptionsForm))
    expect(schema.properties).toEqual({
      a: { type: 'string', description: 'From attribute A' },
      b: { type: 'string', description: 'From form B' },
      c: { type: 'string', description: 'Label C' },
      d: { type: 'string', description: 'Aria D' },
      e: { type: 'string' },
    })
  })

  it('synthesize_excludes_password_and_cc', () => {
    const schema = synthesizeFormSchema(mount(excludedForm))
    const keys = Object.keys(schema.properties as object)
    expect(keys).not.toContain('password')
    expect(keys).not.toContain('card')
    expect(keys).not.toContain('cvc')
    expect(JSON.stringify(schema)).not.toMatch(/hunter2|4111/)
  })

  it('synthesize_excludes_hidden_and_disabled', () => {
    const schema = synthesizeFormSchema(mount(excludedForm))
    expect(schema).toEqual({
      type: 'object',
      properties: { visible: { type: 'string', default: 'ok' } },
      additionalProperties: false,
    })
    expect(JSON.stringify(schema)).not.toContain('csrf-secret')
  })
})
