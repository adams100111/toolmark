import { afterEach, describe, expect, it } from 'vitest'
import { createToolmark } from '@toolmark/core'
import { scanDom } from '@toolmark/core/dom'

const mounted: Element[] = []
const cleanups: Array<() => void> = []
afterEach(() => {
  for (const off of cleanups.splice(0)) off()
  for (const el of mounted.splice(0)) el.remove()
})

describe('DOM form anchors', () => {
  it('dom_field_anchor_resolves_element', () => {
    const host = document.createElement('div')
    host.innerHTML = `<form id="addr" data-tool="address" data-tool-description="Address.">
        <label>City <input name="address[city]"></label>
        <label>Password <input name="password" type="password"></label>
        <button type="submit">Save</button>
      </form>
      <input name="zip" form="addr">`
    document.body.append(host)
    mounted.push(host)
    const tm = createToolmark({ dev: true })
    cleanups.push(tm.use(scanDom({ observe: false })))
    const form = host.querySelector('form')!
    expect(tm.anchor('address.fill', 'address.city')).toBe(
      host.querySelector('input[name="address[city]"]'),
    )
    // A `form=`-associated control outside the form resolves too.
    expect(tm.anchor('address.fill', 'zip')).toBe(host.querySelector('input[name="zip"]'))
    // Excluded controls are never anchors.
    expect(tm.anchor('address.fill', 'password')).toBeNull()
    expect(tm.anchor('address.fill')).toBe(form)
    expect(tm.anchor('address.submit')).toBe(form)
    // The DOM state never carries excluded fields.
    expect(tm.state('address.fill')?.values).toEqual({ address: { city: '' }, zip: '' })

    // A `setAnchor` override wins over the adapter's element.
    const other = document.createElement('span')
    tm.setAnchor('address.fill', 'address.city', other)
    expect(tm.anchor('address.fill', 'address.city')).toBe(other)
  })
})
