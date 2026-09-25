import { afterEach, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { createFormTools, createToolmark, fromJsonSchema } from '@toolmark/core'
import { inertiaFormComponentAdapter } from '../src/form-component.js'
import type { RouterLike } from '../src/router-like.js'

const mounted: Element[] = []
afterEach(() => {
  for (const el of mounted.splice(0)) el.remove()
})

const router: RouterLike = {
  on: () => () => undefined,
  visit: () => undefined,
}

describe('inertiaFormComponentAdapter interaction events', () => {
  it('inertia_form_component_interaction', async () => {
    const host = document.createElement('div')
    host.innerHTML = `<form><input name="name"><input name="secret" type="password"></form>`
    document.body.append(host)
    mounted.push(host)
    const element = host.querySelector('form')!
    element.addEventListener('submit', (e) => e.preventDefault())
    const adapter = inertiaFormComponentAdapter({ element, formRef: { current: null }, router })
    expect(typeof adapter.onUserInteraction).toBe('function')

    const tm = createToolmark({ dev: true })
    const events: unknown[] = []
    tm.events.on('interaction', (e) => events.push(e))
    const handle = createFormTools(tm, adapter, {
      name: 'contact',
      description: 'Contact.',
      input: fromJsonSchema({ type: 'object', properties: { name: { type: 'string' } } }),
    })
    // Agent fill emits nothing.
    const r = await tm.call('contact.fill', { values: { name: 'Agent' } }, { caller: 'inapp' })
    expect(r.status).toBe('ok')
    expect(events).toEqual([])

    const input = host.querySelector('input[name="name"]')!
    await userEvent.click(input)
    await userEvent.type(input, 'x')
    await userEvent.type(host.querySelector('input[name="secret"]')!, 'hunter2')
    expect(events).toContainEqual({
      tool: 'contact.fill',
      param: 'name',
      kind: 'focus',
      caller: 'human',
    })
    expect(events).toContainEqual({
      tool: 'contact.fill',
      param: 'name',
      kind: 'input',
      caller: 'human',
    })
    expect(JSON.stringify(events)).not.toContain('secret')

    // Disposing the adapter removes its listeners.
    handle.dispose()
    adapter.dispose()
    const count = events.length
    await userEvent.type(input, 'y')
    expect(events).toHaveLength(count)
  })
})
