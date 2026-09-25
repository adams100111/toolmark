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

describe('DOM interaction events (fix round 1)', () => {
  it('agent_button_click_submit_is_not_a_user_submit', async () => {
    const host = mount(`<form data-tool="profile" data-tool-description="The profile form.">
      <label>Title <input name="title"></label>
      <button type="submit" data-tool="save" data-tool-description="Save the profile">Save</button>
    </form>`)
    let submits = 0
    host.querySelector('form')!.addEventListener('submit', (e) => {
      submits++
      e.preventDefault()
    })
    const { tm, events } = setup()
    const r = await tm.call('save', {}, { caller: 'human' })
    expect(r.status).toBe('ok')
    await tick()
    expect(submits).toBe(1)
    expect(events).toEqual([])

    // A real user click on the same button still reports a submit.
    await userEvent.click(host.querySelector('button')!)
    await tick()
    expect(events).toEqual([{ tool: 'profile.submit', kind: 'submit', caller: 'human' }])
  })

  it('interaction_paths_follow_dom_changes', async () => {
    const host = mount(`<form data-tool="profile" data-tool-description="The profile form.">
      <label>Title <input name="title"></label>
      <label>City <input name="city"></label>
    </form>`)
    const { events } = setup()
    const title = host.querySelector<HTMLInputElement>('input[name="title"]')!
    const city = host.querySelector<HTMLInputElement>('input[name="city"]')!
    await userEvent.type(title, 'a')
    await userEvent.type(title, 'b')
    // Rename a field, add one, and turn one into a password: the next keystrokes map anew.
    title.setAttribute('name', 'headline')
    const extra = document.createElement('input')
    extra.name = 'extra'
    host.querySelector('form')!.append(extra)
    city.type = 'password'
    events.length = 0
    await userEvent.type(title, 'c')
    await userEvent.type(extra, 'd')
    await userEvent.type(city, 'secret')
    await tick()
    const inputs = events.filter((e) => (e as { kind: string }).kind === 'input')
    expect(inputs).toContainEqual({
      tool: 'profile.fill',
      param: 'headline',
      kind: 'input',
      caller: 'human',
    })
    expect(inputs).toContainEqual({
      tool: 'profile.fill',
      param: 'extra',
      kind: 'input',
      caller: 'human',
    })
    const text = JSON.stringify(events)
    expect(text).not.toContain('"title"')
    expect(text).not.toContain('city')
  })
})
