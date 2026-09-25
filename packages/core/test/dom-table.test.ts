import { afterEach, describe, expect, it } from 'vitest'
import { createToolmark, type ToolmarkErrorEvent } from '@toolmark/core'
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
function setup() {
  const errors: ToolmarkErrorEvent[] = []
  const tm = createToolmark({ dev: true })
  tm.events.on('error', (e) => errors.push(e))
  cleanups.push(tm.use(scanDom({ observe: false })))
  return { tm, errors }
}

const FRUIT = `<table data-tool="fruit" data-tool-description="Fruit in stock">
  <thead><tr>
    <th data-tool-column="name">Name</th><th>Notes</th>
    <th data-tool-column="qty" data-tool-type="number">Qty</th>
    <th data-tool-column="__proto__">Bad</th><th data-tool-column="name">Dup</th>
  </tr></thead>
  <tbody>
    <tr><td> Apple </td><td>red</td><td>3</td><td>x</td><td>y</td></tr>
    <tr><td>Banana</td><td>yellow</td><td>n/a</td><td>x</td><td>y</td></tr>
    <tr><td colspan="2">Grape</td><td> 12.5 </td><td>x</td><td>y</td></tr>
    <tr><td>Pineapple</td><td></td><td></td><td>x</td><td>y</td></tr>
  </tbody>
</table>`

describe('scanDom — tables', () => {
  it('table_rows_shape_and_total', async () => {
    mount(FRUIT)
    const { tm, errors } = setup()
    const d = tm.describe('fruit')!
    expect(tm.info('fruit')).toMatchObject({ origin: 'dom' })
    expect(d.hints).toMatchObject({ readOnly: true, untrustedContent: true })
    expect(d.description).toContain('Fruit in stock')
    expect(errors.filter((e) => e.code === 'invalid_name')).toHaveLength(2)
    const r = await tm.call('fruit', {}, { caller: 'inapp' })
    expect(r).toEqual({
      status: 'ok',
      data: {
        rows: [
          { name: 'Apple', qty: 3 },
          { name: 'Banana', qty: null },
          { name: 'Grape', qty: 12.5 },
          { name: 'Pineapple', qty: null },
        ],
        total: 4,
      },
    })
    const unknown = await tm.call('fruit', { where: { notes: 'red' } }, { caller: 'inapp' })
    expect(unknown.status).toBe('invalid')
  })

  it('table_query_where_and_limit', async () => {
    mount(FRUIT)
    const { tm } = setup()
    const r = await tm.call('fruit', { where: { name: 'APP' } }, { caller: 'inapp' })
    expect(r).toEqual({
      status: 'ok',
      data: {
        rows: [
          { name: 'Apple', qty: 3 },
          { name: 'Pineapple', qty: null },
        ],
        total: 2,
      },
    })
    const limited = await tm.call(
      'fruit',
      { where: { name: 'app' }, limit: 1 },
      { caller: 'inapp' },
    )
    expect(limited).toEqual({ status: 'ok', data: { rows: [{ name: 'Apple', qty: 3 }], total: 2 } })
    const both = await tm.call('fruit', { where: { name: 'a', qty: '12' } }, { caller: 'inapp' })
    expect(both).toEqual({ status: 'ok', data: { rows: [{ name: 'Grape', qty: 12.5 }], total: 1 } })
    expect((await tm.call('fruit', { limit: 0 }, { caller: 'inapp' })).status).toBe('invalid')
    expect((await tm.call('fruit', { limit: 1.5 }, { caller: 'inapp' })).status).toBe('invalid')
  })

  it('table_limit_capped', async () => {
    const body = Array.from({ length: 600 }, (_, i) => `<tr><td>row ${i}</td></tr>`).join('')
    mount(`<table data-tool="big"><thead><tr><th data-tool-column="label">L</th></tr></thead>
      <tbody>${body}</tbody></table>`)
    const { tm } = setup()
    const def = await tm.call('big', {}, { caller: 'inapp' })
    expect(def).toMatchObject({ status: 'ok', data: { total: 600 } })
    if (def.status === 'ok') expect((def.data as { rows: unknown[] }).rows).toHaveLength(50)
    const capped = await tm.call('big', { limit: 100000 }, { caller: 'inapp' })
    expect(capped).toMatchObject({ status: 'ok', data: { total: 600 } })
    if (capped.status === 'ok') expect((capped.data as { rows: unknown[] }).rows).toHaveLength(500)
  })

  it('table_without_valid_columns_not_registered', () => {
    mount(`<table data-tool="empty"><thead><tr><th>A</th></tr></thead><tbody></tbody></table>`)
    const { tm } = setup()
    expect(tm.manifest().tools).toEqual([])
  })
})
