import { afterEach, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { createToolmark } from '@toolmark/core'
import { scanDom } from '@toolmark/core/dom'

const mounted: Element[] = []
const cleanups: Array<() => void> = []
function mount(html: string): HTMLElement {
  const host = document.createElement('div')
  host.innerHTML = html
  document.body.append(host)
  mounted.push(host)
  return host
}
afterEach(() => {
  for (const off of cleanups.splice(0)) off()
  for (const el of mounted.splice(0)) el.remove()
})

const tick = () => new Promise<void>((r) => setTimeout(r, 0))

function setup() {
  const tm = createToolmark({ dev: true, confirm: () => Promise.resolve({ approved: true }) })
  cleanups.push(tm.use(scanDom({ observe: false })))
  const events: unknown[] = []
  cleanups.push(tm.events.on('interaction', (e) => events.push(e)))
  return { tm, events }
}

const PROFILE = `<form data-tool="profile" data-tool-description="The profile form.">
  <label>Title <input name="title"></label>
  <label>Agree <input name="agree" type="checkbox" value="yes"></label>
  <label>Password <input name="password" type="password"></label>
  <label>Card <input name="card" autocomplete="cc-number"></label>
  <button type="submit">Save</button>
</form>`

describe('DOM interaction events', () => {
  it('interaction_only_for_user_changes_dom', async () => {
    const host = mount(PROFILE)
    const form = host.querySelector('form')!
    form.addEventListener('submit', (e) => e.preventDefault())
    const { tm, events } = setup()
    const title = host.querySelector<HTMLInputElement>('input[name="title"]')!

    // Agent writes (text and a checkbox `click()`) and an agent submit emit nothing.
    const filled = await tm.call(
      'profile.fill',
      { values: { title: 'Agent', agree: true } },
      { caller: 'inapp' },
    )
    expect(filled.status).toBe('ok')
    expect(title.value).toBe('Agent')
    const submitted = await tm.call('profile.submit', {}, { caller: 'human' })
    expect(submitted.status).toBe('ok')
    // Synthetic (untrusted) events from page scripts emit nothing either.
    title.dispatchEvent(new Event('input', { bubbles: true }))
    title.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await tick()
    expect(events).toEqual([])

    // Trusted user events emit (path only, never the value).
    await userEvent.click(title)
    await userEvent.type(title, 'x')
    await userEvent.click(host.querySelector('input[name="password"]')!)
    await userEvent.type(host.querySelector('input[name="password"]')!, 'hunter2')
    await userEvent.type(host.querySelector('input[name="card"]')!, '4111')
    await userEvent.click(host.querySelector('button')!)
    await tick()
    expect(events).toContainEqual({
      tool: 'profile.fill',
      param: 'title',
      kind: 'focus',
      caller: 'human',
    })
    expect(events).toContainEqual({
      tool: 'profile.fill',
      param: 'title',
      kind: 'input',
      caller: 'human',
    })
    expect(events).toContainEqual({ tool: 'profile.submit', kind: 'submit', caller: 'human' })
    // Excluded fields (password, cc-*) never surface, not even by path.
    const text = JSON.stringify(events)
    expect(text).not.toContain('password')
    expect(text).not.toContain('card')
    expect(text).not.toContain('hunter2')
  })

  it('dom_button_anchor', () => {
    const host = mount(
      `<button type="button" data-tool="refresh" data-tool-description="Refresh.">Go</button>`,
    )
    const { tm } = setup()
    expect(tm.anchor('refresh')).toBe(host.querySelector('button'))
  })

  it('dom_table_anchor', () => {
    const host = mount(`<table data-tool="fruit" data-tool-description="Fruit">
      <thead><tr><th data-tool-column="name">Name</th></tr></thead>
      <tbody><tr><td>Apple</td></tr></tbody></table>`)
    const { tm } = setup()
    expect(tm.anchor('fruit')).toBe(host.querySelector('table'))
  })
})
