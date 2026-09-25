import { afterEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { createFormTools, createToolmark, fromJsonSchema, ok } from '@toolmark/core'
import { domFormAdapter, synthesizeFormSchema } from '@toolmark/core/dom'
import { synthesizeForm } from '../src/dom/synthesize.js'
import { discoverFields } from '../src/dom/elements.js'
import { arraysForm, excludedForm, fillForm, pathsForm } from './fixtures/dom/forms.js'

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

const tick = () => new Promise<void>((r) => setTimeout(r, 0))
const q = <T extends Element = HTMLInputElement>(form: HTMLFormElement, sel: string): T => {
  const el = form.querySelector<T>(sel)
  if (!el) throw new Error(`missing ${sel}`)
  return el
}

class XRating extends HTMLElement {
  static formAssociated = true
  #internals = this.attachInternals()
  #value = ''
  get value(): string {
    return this.#value
  }
  set value(v: string) {
    this.#value = String(v)
    this.#internals.setFormValue(this.#value)
  }
}
if (!customElements.get('x-rating')) customElements.define('x-rating', XRating)

describe('DOM field discovery and paths', () => {
  it('dom_paths_dotted_and_bracket_names', () => {
    const form = mount(pathsForm)
    form.id = 'paths-form'
    const outside = document.createElement('input')
    outside.name = 'ext'
    outside.value = 'outside'
    outside.setAttribute('form', 'paths-form')
    mounted[0]!.append(outside)
    const adapter = domFormAdapter(form)
    expect(adapter.getValues()).toEqual({
      a: { b: 'ab' },
      c: { d: 'cd' },
      e: [{ f: 'e0' }, { f: 'e1' }],
      g: { h: { i: 'ghi' } },
      ext: 'outside',
    })
    expect(adapter.fields().map((f) => f.path)).toEqual([
      'a.b',
      'c.d',
      'e.0.f',
      'e.1.f',
      'g.h.i',
      'ext',
    ])
    adapter.setValues(
      { 'c.d': 'X', e: [{ f: 'one' }, { f: 'two' }], 'g.h.i': 'deep' },
      { source: 'agent' },
    )
    expect(q(form, '[name="c[d]"]').value).toBe('X')
    expect(q(form, '[name="e[0][f]"]').value).toBe('one')
    expect(q(form, '[name="e[1][f]"]').value).toBe('two')
    expect(q(form, '[name="h[i]"]').value).toBe('deep')
    const schema = synthesizeFormSchema(form)
    expect((schema.properties as Record<string, unknown>).e).toEqual({
      type: 'array',
      items: {
        type: 'object',
        properties: { f: { type: 'string' } },
        additionalProperties: false,
      },
      maxItems: 2,
    })
    adapter.dispose()
  })

  it('dom_array_names_map_to_arrays', () => {
    const form = mount(arraysForm)
    const adapter = domFormAdapter(form)
    expect(adapter.getValues()).toEqual({
      list: ['one', 'two'],
      dup: ['x', 'y'],
      sel: ['p'],
      flags: ['f2'],
    })
    const props = synthesizeFormSchema(form).properties as Record<string, unknown>
    expect(props.list).toEqual({
      type: 'array',
      items: { type: 'string' },
      maxItems: 2,
      default: ['one', 'two'],
    })
    expect(props.sel).toEqual({
      type: 'array',
      items: { enum: ['p', 'q'] },
      uniqueItems: true,
      description: 'Options: p = P; q = Q',
      default: ['p'],
    })
    expect(props.flags).toEqual({
      type: 'array',
      items: { enum: ['f1', 'f2'] },
      uniqueItems: true,
      default: ['f2'],
    })
    adapter.setValues(
      { list: ['A'], dup: ['1', '2'], sel: ['q'], flags: ['f1'] },
      { source: 'agent' },
    )
    expect(adapter.getValues()).toEqual({
      list: ['A', ''],
      dup: ['1', '2'],
      sel: ['q'],
      flags: ['f1'],
    })
    const kinds = discoverFields(form).map((f) => [f.path, f.kind])
    expect(kinds).toEqual([
      ['list', 'input'],
      ['list', 'input'],
      ['dup', 'input'],
      ['dup', 'input'],
      ['sel', 'select'],
      ['flags', 'input'],
      ['flags', 'input'],
    ])
    adapter.dispose()
  })

  it('form_associated_ce_is_field', () => {
    const form = mount(`<form><x-rating name="rating"></x-rating><div class="host"></div></form>`)
    const shadowHost = q<HTMLDivElement>(form, '.host')
    const shadow = shadowHost.attachShadow({ mode: 'open' })
    shadow.innerHTML = '<input name="shadowed" value="no">'
    const adapter = domFormAdapter(form)
    expect(adapter.fields().map((f) => f.path)).toEqual(['rating'])
    expect(discoverFields(form).map((f) => f.kind)).toEqual(['custom'])
    expect(adapter.getValues()).toEqual({ rating: '' })
    adapter.setValues({ rating: '5' }, { source: 'agent' })
    expect(q<XRating>(form, 'x-rating').value).toBe('5')
    expect(synthesizeFormSchema(form).properties).toEqual({ rating: { type: 'string' } })
    adapter.dispose()
  })
})

describe('DOM filling', () => {
  it('dom_fill_sets_native_controls', () => {
    const form = mount(fillForm)
    const seen: string[] = []
    form.addEventListener('input', (e) => seen.push(`input:${(e.target as HTMLInputElement).name}`))
    form.addEventListener('change', (e) =>
      seen.push(`change:${(e.target as HTMLInputElement).name}`),
    )
    const adapter = domFormAdapter(form)
    adapter.setValues(
      {
        title: 'Hi',
        notes: 'Long text',
        qty: 3,
        agree: true,
        tags: ['b'],
        size: 'm',
        color: 'g',
        langs: ['en', 'ar'],
      },
      { source: 'agent' },
    )
    expect(adapter.getValues()).toEqual({
      title: 'Hi',
      notes: 'Long text',
      qty: 3,
      agree: true,
      tags: ['b'],
      size: 'm',
      color: 'g',
      langs: ['en', 'ar'],
      photos: [],
    })
    expect(q(form, '[name=title]').value).toBe('Hi')
    expect(q<HTMLSelectElement>(form, '[name=color]').value).toBe('g')
    for (const name of ['title', 'notes', 'qty', 'agree', 'tags', 'size', 'color', 'langs']) {
      expect(seen).toContain(`input:${name}`)
      expect(seen).toContain(`change:${name}`)
    }
    // null clears.
    adapter.setValues(
      { title: null, agree: null, tags: null, size: null, color: null, langs: null, qty: null },
      { source: 'agent' },
    )
    expect(adapter.getValues()).toEqual({
      title: '',
      notes: 'Long text',
      agree: false,
      tags: [],
      langs: [],
      photos: [],
    })
    adapter.dispose()
  })

  it('dom_fill_files_via_datatransfer', async () => {
    const form = mount(fillForm)
    const adapter = domFormAdapter(form)
    const a = new File(['a'], 'a.pdf', { type: 'application/pdf' })
    const b = new File(['bb'], 'b.png', { type: 'image/png' })
    let changed = 0
    q(form, '[name=doc]').addEventListener('change', () => changed++)
    adapter.setValues({ doc: a, photos: [a, b] }, { source: 'agent' })
    expect(q(form, '[name=doc]').files?.[0]?.name).toBe('a.pdf')
    expect([...(q(form, '[name=photos]').files ?? [])].map((f) => f.name)).toEqual([
      'a.pdf',
      'b.png',
    ])
    expect(changed).toBe(1)
    const values = adapter.getValues()
    expect(values.doc).toBeInstanceOf(File)
    expect(adapter.dirtyPaths()).toEqual([])
    adapter.setValues({ doc: null }, { source: 'agent' })
    expect(q(form, '[name=doc]').files?.length).toBe(0)
    adapter.dispose()

    // Through form tools: a { ref } resolves to a File that lands in the input.
    const form2 = mount(
      `<form><input name="doc" type="file" accept="application/pdf"><input name="t"></form>`,
    )
    const tm = createToolmark({ dev: true, files: { resolve: () => Promise.resolve(a) } })
    const synth = synthesizeForm(form2)
    const adapter2 = domFormAdapter(form2)
    createFormTools(tm, adapter2, {
      name: 'upload',
      description: 'Upload.',
      input: fromJsonSchema(synth.validationSchema),
      jsonSchema: synth.schema,
      files: synth.files,
    })
    const r = await tm.call(
      'upload.fill',
      { values: { doc: { ref: 'x' }, t: 'hi' } },
      { caller: 'test' },
    )
    expect(r.status).toBe('ok')
    expect(q(form2, '[name=doc]').files?.[0]).toBe(a)
    expect(q(form2, '[name=t]').value).toBe('hi')
    adapter2.dispose()
  })

  it('excluded_controls_never_written', async () => {
    const form = mount(excludedForm)
    const adapter = domFormAdapter(form)
    expect(adapter.getValues()).toEqual({ visible: 'ok' })
    expect(adapter.fields().map((f) => f.path)).toEqual(['visible'])
    adapter.setValues(
      {
        _token: 'W',
        password: 'W',
        card: 'W',
        cvc: 'W',
        locked: 'W',
        inside: 'W',
        skipme: 'W',
        deep: 'W',
      },
      { source: 'agent' },
    )
    expect(q(form, '[name=_token]').value).toBe('csrf-secret')
    expect(q(form, '[name=password]').value).toBe('hunter2')
    expect(q(form, '[name=card]').value).toBe('4111')
    expect(q(form, '[name=cvc]').value).toBe('123')
    expect(q(form, '[name=locked]').value).toBe('x')
    expect(q(form, '[name=inside]').value).toBe('y')
    expect(q(form, '[name=skipme]').value).toBe('z')
    expect(q(form, '[name=deep]').value).toBe('w')
    // Changed after load by script: still excluded from dirty paths.
    q(form, '[name=password]').value = 'changed'
    expect(adapter.dirtyPaths()).toEqual([])

    // Through form tools: excluded paths are unknown and never reach changes.
    const tm = createToolmark({ dev: true })
    createFormTools(tm, adapter, {
      name: 'ex',
      description: 'Excluded.',
      input: fromJsonSchema(synthesizeFormSchema(form)),
    })
    const bad = await tm.call('ex.fill', { values: { _token: 'x' } }, { caller: 'test' })
    expect(bad.status).toBe('invalid')
    const good = await tm.call('ex.fill', { values: { visible: 'new' } }, { caller: 'test' })
    expect(good).toEqual(
      ok({ changes: [{ path: 'visible', before: 'ok', after: 'new' }], skipped: [] }),
    )
    expect(q(form, '[name=_token]').value).toBe('csrf-secret')
    adapter.dispose()
  })
})

describe('DOM dirty tracking', () => {
  it('dirty_only_from_trusted_events_or_snapshot_diff', async () => {
    const form = mount(
      `<form><input name="a" value="1"><input name="b" value="2"><input name="c"></form>`,
    )
    const adapter = domFormAdapter(form)
    expect(adapter.dirtyPaths()).toEqual([])
    // An untrusted event without a value change is not a user edit.
    q(form, '[name=a]').dispatchEvent(new Event('input', { bubbles: true }))
    expect(adapter.dirtyPaths()).toEqual([])
    // A script change back to the snapshot value is not dirty.
    q(form, '[name=b]').value = 'x'
    expect(adapter.dirtyPaths()).toEqual(['b'])
    q(form, '[name=b]').value = '2'
    expect(adapter.dirtyPaths()).toEqual([])
    // The agent's value is not dirty.
    adapter.setValues({ a: 'agent' }, { source: 'agent' })
    expect(adapter.dirtyPaths()).toEqual([])
    // A trusted user event marks the path dirty even when the value returns to the snapshot.
    await userEvent.type(q(form, '[name=c]'), 'z')
    expect(adapter.dirtyPaths()).toEqual(['c'])
    await userEvent.clear(q(form, '[name=c]'))
    expect(adapter.dirtyPaths()).toEqual(['c'])
    adapter.dispose()
  })

  it('dom_dirty_after_script_change_and_reset', async () => {
    const form = mount(`<form><input name="a" value="1"><input name="b"></form>`)
    const adapter = domFormAdapter(form)
    q(form, '[name=a]').value = 'script'
    await userEvent.type(q(form, '[name=b]'), 'user')
    expect(adapter.dirtyPaths().sort()).toEqual(['a', 'b'])
    adapter.setValues({ a: 'agent' }, { source: 'agent' })
    expect(adapter.dirtyPaths()).toEqual(['b'])
    q(form, '[name=a]').value = 'script again'
    expect(adapter.dirtyPaths().sort()).toEqual(['a', 'b'])
    form.reset()
    await tick()
    expect(adapter.getValues()).toEqual({ a: '1', b: '' })
    expect(adapter.dirtyPaths()).toEqual([])
    // A cancelled reset does not re-snapshot.
    q(form, '[name=a]').value = 'kept'
    form.addEventListener('reset', (e) => e.preventDefault(), { once: true })
    form.reset()
    await tick()
    expect(adapter.dirtyPaths()).toEqual(['a'])
    adapter.dispose()
  })

  it('dom_undo_restores_values', async () => {
    const form = mount(fillForm)
    const adapter = domFormAdapter(form)
    const tm = createToolmark({ dev: true })
    createFormTools(tm, adapter, {
      name: 'f',
      description: 'Fill form.',
      input: fromJsonSchema(synthesizeForm(form).validationSchema),
    })
    let callId = ''
    tm.events.on('call', (e) => (callId = e.callId))
    const r = await tm.call(
      'f.fill',
      { values: { title: 'T', tags: ['a', 'b'], size: 's', color: 'r', agree: true } },
      { caller: 'test' },
    )
    expect(r.status).toBe('ok')
    expect(adapter.getValues()).toMatchObject({
      title: 'T',
      tags: ['a', 'b'],
      size: 's',
      color: 'r',
      agree: true,
    })
    const u = await tm.undo(callId)
    expect(u.status).toBe('ok')
    expect(adapter.getValues()).toEqual({
      title: '',
      notes: '',
      agree: false,
      tags: [],
      langs: [],
      photos: [],
    })
    expect(adapter.dirtyPaths()).toEqual([])
    adapter.dispose()
  })

  it('dispose_removes_listeners', () => {
    const add = vi.spyOn(EventTarget.prototype, 'addEventListener')
    const remove = vi.spyOn(EventTarget.prototype, 'removeEventListener')
    const form = mount(`<form><input name="a"></form>`)
    const adapter = domFormAdapter(form)
    const added = add.mock.calls.map((c) => c.slice(0, 2))
    expect(added.length).toBeGreaterThan(0)
    adapter.dispose()
    const removed = remove.mock.calls.map((c) => c.slice(0, 2))
    for (const call of added) expect(removed).toContainEqual(call)
    add.mockRestore()
    remove.mockRestore()
  })
})

describe('DOM submit', () => {
  it('dom_submit_constraint_failure_invalid', async () => {
    const form = mount(`<form>
      <input name="title" required>
      <input name="n" type="number" max="5" value="9">
      <input type="password" name="pw" required>
    </form>`)
    let submitted = 0
    form.addEventListener('submit', (e) => {
      e.preventDefault()
      submitted++
    })
    const adapter = domFormAdapter(form)
    const r = await adapter.submit()
    expect(r.status).toBe('invalid')
    if (r.status !== 'invalid') throw new Error('expected invalid')
    expect(r.issues.map((i) => i.path)).toEqual(['', 'n', 'title'])
    expect(r.issues.find((i) => i.path === 'title')?.message).toBe(
      q(form, '[name=title]').validationMessage,
    )
    expect(JSON.stringify(r)).not.toContain('pw')
    expect(submitted).toBe(0)

    q(form, '[name=title]').value = 'ok'
    q(form, '[name=n]').value = '1'
    q(form, '[name=pw]').value = 'secret'
    await expect(adapter.submit()).resolves.toEqual(ok({ submitted: true }))
    expect(submitted).toBe(1)

    const custom = domFormAdapter(form, { submit: () => Promise.resolve(ok({ custom: true })) })
    await expect(custom.submit()).resolves.toEqual(ok({ custom: true }))
    expect(submitted).toBe(1)
    custom.dispose()
    adapter.dispose()
  })

  it('dom_subpath_resolves', async () => {
    const mod = await import('@toolmark/core/dom')
    expect(typeof mod.domFormAdapter).toBe('function')
    expect(typeof mod.synthesizeFormSchema).toBe('function')
  })
})
