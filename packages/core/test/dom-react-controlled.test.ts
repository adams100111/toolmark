import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement as h, useState, type ChangeEvent } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { domFormAdapter } from '@toolmark/core/dom'

// React state seen by the fixtures (updated on every render).
const state: Record<string, unknown> = {}

let root: Root | undefined
let host: HTMLElement | undefined
afterEach(() => {
  root?.unmount()
  host?.remove()
  root = undefined
  host = undefined
  for (const k of Object.keys(state)) delete state[k]
})

async function render(el: ReturnType<typeof h>): Promise<HTMLFormElement> {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  root.render(el)
  await vi.waitFor(() => {
    if (!host?.querySelector('form')) throw new Error('not rendered')
  })
  return host.querySelector('form')!
}

function TextForm() {
  const [title, setTitle] = useState('')
  const [code, setCode] = useState('')
  state.title = title
  state.code = code
  return h(
    'form',
    null,
    h('input', {
      name: 'title',
      value: title,
      onChange: (e: ChangeEvent<HTMLInputElement>) => setTitle(e.target.value),
    }),
    // A controlled input that transforms what it receives.
    h('input', {
      name: 'code',
      value: code,
      onChange: (e: ChangeEvent<HTMLInputElement>) => setCode(e.target.value.toUpperCase()),
    }),
  )
}

function ChoiceForm() {
  const [agree, setAgree] = useState(false)
  const [size, setSize] = useState('s')
  const [color, setColor] = useState('r')
  const [langs, setLangs] = useState<string[]>([])
  state.agree = agree
  state.size = size
  state.color = color
  state.langs = langs
  const radio = (value: string) =>
    h('input', {
      key: value,
      type: 'radio',
      name: 'size',
      value,
      checked: size === value,
      onChange: (e: ChangeEvent<HTMLInputElement>) => setSize(e.target.value),
    })
  return h(
    'form',
    null,
    h('input', {
      type: 'checkbox',
      name: 'agree',
      checked: agree,
      onChange: (e: ChangeEvent<HTMLInputElement>) => setAgree(e.target.checked),
    }),
    radio('s'),
    radio('m'),
    h(
      'select',
      {
        name: 'color',
        value: color,
        onChange: (e: ChangeEvent<HTMLSelectElement>) => setColor(e.target.value),
      },
      h('option', { value: 'r' }, 'Red'),
      h('option', { value: 'g' }, 'Green'),
    ),
    h(
      'select',
      {
        name: 'langs',
        multiple: true,
        value: langs,
        onChange: (e: ChangeEvent<HTMLSelectElement>) =>
          setLangs([...e.target.selectedOptions].map((o) => o.value)),
      },
      h('option', { value: 'en' }, 'English'),
      h('option', { value: 'ar' }, 'Arabic'),
    ),
  )
}

describe('DOM adapter with React-controlled inputs (React 19)', () => {
  it('dom_fill_updates_react_controlled_input', async () => {
    const form = await render(h(TextForm))
    const adapter = domFormAdapter(form)
    adapter.setValues({ title: 'Agent', code: 'abc' }, { source: 'agent' })
    await vi.waitFor(() => {
      expect(state.title).toBe('Agent')
      expect(state.code).toBe('ABC')
    })
    const title = form.querySelector<HTMLInputElement>('[name=title]')!
    const code = form.querySelector<HTMLInputElement>('[name=code]')!
    expect(title.value).toBe('Agent')
    expect(code.value).toBe('ABC')
    expect(adapter.getValues()).toEqual({ title: 'Agent', code: 'ABC' })
    // Clearing goes through React too.
    adapter.setValues({ title: null }, { source: 'agent' })
    await vi.waitFor(() => expect(state.title).toBe(''))
    expect(title.value).toBe('')
    adapter.dispose()
  })

  it('dom_fill_react_checkbox_radio_select', async () => {
    const form = await render(h(ChoiceForm))
    const adapter = domFormAdapter(form)
    adapter.setValues({ agree: true, size: 'm', color: 'g', langs: ['ar'] }, { source: 'agent' })
    await vi.waitFor(() => {
      expect(state).toMatchObject({ agree: true, size: 'm', color: 'g', langs: ['ar'] })
    })
    expect(adapter.getValues()).toEqual({ agree: true, size: 'm', color: 'g', langs: ['ar'] })
    adapter.setValues({ agree: false, size: 's', langs: ['en', 'ar'] }, { source: 'agent' })
    await vi.waitFor(() => {
      expect(state).toMatchObject({ agree: false, size: 's', color: 'g', langs: ['en', 'ar'] })
    })
    expect(adapter.getValues()).toEqual({
      agree: false,
      size: 's',
      color: 'g',
      langs: ['en', 'ar'],
    })
    expect(adapter.dirtyPaths()).toEqual([])
    adapter.dispose()
  })
})
