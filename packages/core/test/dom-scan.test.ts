import { afterEach, describe, expect, it, vi } from 'vitest'
import { createToolmark, type Toolmark, type ToolmarkErrorEvent } from '@toolmark/core'
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
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function setup(
  opts?: Parameters<typeof scanDom>[0],
  tmOpts?: Parameters<typeof createToolmark>[0],
) {
  const errors: ToolmarkErrorEvent[] = []
  const tm = createToolmark(tmOpts)
  tm.events.on('error', (e) => errors.push(e))
  const off = tm.use(scanDom(opts))
  cleanups.push(off)
  return { tm, errors, off }
}
const names = (tm: Toolmark) => tm.manifest().tools.map((t) => t.name)
// Captured before any spy, so waiting for frames is not counted as the scanner's scheduling.
const nativeRaf = window.requestAnimationFrame.bind(window)
const frames = async (n = 2) => {
  for (let i = 0; i < n; i++) await new Promise<void>((r) => nativeRaf(() => r()))
  await new Promise<void>((r) => setTimeout(r, 0))
}
const preventSubmit = (form: Element, onSubmit?: () => void) =>
  form.addEventListener('submit', (e) => {
    e.preventDefault()
    onSubmit?.()
  })

describe('scanDom — forms', () => {
  it('native_form_registered_with_origin', async () => {
    const host = mount(`<form toolname="search_flights" tooldescription="Search for flights">
      <input name="from" toolparamdescription="Origin airport" required>
    </form>`)
    const { tm } = setup({ observe: false })
    expect(names(tm)).toEqual(['search_flights.fill', 'search_flights.submit'])
    expect(tm.info('search_flights.fill')).toMatchObject({ origin: 'native-form' })
    expect(tm.info('search_flights.submit')).toMatchObject({ origin: 'native-form' })
    const fill = tm.describe('search_flights.fill')!
    expect(fill.description).toContain('Search for flights')
    expect(JSON.stringify(fill.inputSchema)).toContain('Origin airport')
    const r = await tm.call('search_flights.fill', { values: { from: 'CAI' } }, { caller: 'inapp' })
    expect(r).toMatchObject({ status: 'ok', data: { changes: [{ path: 'from', after: 'CAI' }] } })
    expect(host.querySelector('input')!.value).toBe('CAI')
    // DOM-derived fill results are page content.
    expect(fill.hints).toMatchObject({ untrustedContent: true })
  })

  it('native_form_info_exposes_native_name', () => {
    mount(`<form toolname="book" tooldescription="Book a room"><input name="n"></form>
      <form data-tool="contact" data-tool-description="Contact us"><input name="m"></form>`)
    const { tm } = setup({ observe: false })
    expect(tm.info('book.fill')).toMatchObject({ origin: 'native-form', nativeName: 'book' })
    expect(tm.info('book.submit')).toMatchObject({ origin: 'native-form', nativeName: 'book' })
    expect(tm.info('contact.fill')).toMatchObject({ origin: 'dom' })
    expect(tm.info('contact.fill')?.nativeName).toBeUndefined()
    const full = JSON.stringify(tm.manifest({ detail: 'full' }))
    expect(full).not.toContain('native-form')
    expect(full).not.toContain('nativeName')
  })

  it('data_tool_form_and_group_scope', async () => {
    const host = mount(`<section data-tool-group="billing">
        <div><form data-tool="address" data-tool-description="Billing address">
          <input name="city"><input name="zip" readonly value="123">
        </form></div>
      </section>
      <section data-tool-group="bad group!"><form data-tool="x" data-tool-description="X"><input name="a"></form></section>
      <form data-tool="bad name!" data-tool-description="Y"><input name="a"></form>
      <form data-tool="nodesc"><input name="a"></form>`)
    const { tm, errors } = setup({ observe: false })
    expect(names(tm)).toEqual(['billing.address.fill', 'billing.address.submit'])
    expect(tm.info('billing.address.submit')).toMatchObject({ origin: 'dom' })
    expect(errors.filter((e) => e.code === 'invalid_name')).toHaveLength(2)
    const r = await tm.call(
      'billing.address.fill',
      { values: { city: 'Giza' } },
      { caller: 'inapp' },
    )
    expect(r.status).toBe('ok')
    expect(host.querySelector<HTMLInputElement>('input[name=city]')!.value).toBe('Giza')
    // Read-only fields are not in the schema.
    const ro = await tm.call('billing.address.fill', { values: { zip: '9' } }, { caller: 'inapp' })
    expect(ro.status).toBe('invalid')
  })

  it('autosubmit_controls_confirmation', async () => {
    const host = mount(`<form toolname="manual" tooldescription="Manual"><input name="a"></form>
      <form toolname="auto" tooldescription="Auto" toolautosubmit><input name="a"></form>`)
    let submitted = 0
    for (const f of host.querySelectorAll('form')) preventSubmit(f, () => submitted++)
    const { tm } = setup({ observe: false })
    expect(tm.describe('manual.submit')!.hints).toMatchObject({ consequential: true })
    expect(tm.describe('auto.submit')!.hints?.consequential).toBeUndefined()
    expect(tm.describe('auto.submit')!.hints?.destructive).toBeUndefined()
    const manual = await tm.call('manual.submit', {}, { caller: 'inapp' })
    expect(manual.status).toBe('needs_confirmation')
    expect(submitted).toBe(0)
    const auto = await tm.call('auto.submit', {}, { caller: 'inapp' })
    expect(auto).toMatchObject({ status: 'ok', data: { submitted: true } })
    expect(submitted).toBe(1)
  })

  it('dropped_pattern_and_invalid_field_emit_dev_events', () => {
    mount(`<form data-tool="p" data-tool-description="P">
      <input name="a" pattern="(a+)+"><input name="b[">
    </form>`)
    const { tm, errors } = setup({ observe: false }, { dev: true })
    expect(names(tm)).toEqual(['p.fill', 'p.submit'])
    const pattern = errors.find((e) => e.code === 'schema_conversion_failed')
    expect(pattern?.message).toContain('"a"')
    expect(errors.some((e) => e.code === 'invalid_name' && e.message.includes('b['))).toBe(true)
  })

  it('ignored_subtree_not_scanned', () => {
    mount(`<div data-tool-ignore>
        <form data-tool="f1" data-tool-description="x"><input name="a"></form>
        <button data-tool="b1" data-tool-description="x">b</button>
        <table data-tool="t1"><thead><tr><th data-tool-column="a">A</th></tr></thead><tbody></tbody></table>
      </div>
      <div contenteditable="true"><form data-tool="f2" data-tool-description="x"><input name="a"></form>
        <div contenteditable="false"><button data-tool="b2" data-tool-description="x">b</button></div></div>
      <div contenteditable=""><button data-tool="b3" data-tool-description="x">b</button></div>
      <div contenteditable="plaintext-only"><button data-tool="b4" data-tool-description="x">b</button></div>
      <iframe srcdoc="<form data-tool='f3' data-tool-description='x'><input name='a'></form>"></iframe>
      <template><button data-tool="b5" data-tool-description="x">b</button></template>
      <div contenteditable="false"><button type="button" data-tool="ok" data-tool-description="Fine">b</button></div>`)
    const tpl = document.querySelector('template')!
    const scripted = document.createElement('button')
    scripted.setAttribute('data-tool', 'b6')
    scripted.setAttribute('data-tool-description', 'x')
    tpl.append(scripted) // a child of the template element itself (not its content)
    const { tm } = setup({ observe: false })
    expect(names(tm)).toEqual(['ok'])
  })

  it('element_root_inside_ignored_region_scans_nothing', () => {
    const host = mount(`<div data-tool-ignore><div id="r">
      <button type="button" data-tool="b" data-tool-description="x">b</button></div></div>`)
    const { tm } = setup({ root: host.querySelector('#r')!, observe: false })
    expect(names(tm)).toEqual([])
  })
})

describe('scanDom — buttons', () => {
  it('button_tool_clicks_and_hints', async () => {
    const host =
      mount(`<button type="button" data-tool="refresh" data-tool-description="Refresh the list" data-tool-readonly>Refresh</button>
      <button type="button" data-tool="wipe" data-tool-description="Delete everything" data-tool-destructive data-tool-confirm="Delete all items?">Wipe</button>
      <button type="button" data-tool="plain" data-tool-description="Plain">Plain</button>`)
    let clicks = 0
    host.querySelector('button')!.addEventListener('click', () => clicks++)
    const { tm } = setup({ observe: false })
    expect(tm.info('refresh')).toMatchObject({ origin: 'dom' })
    expect(tm.describe('refresh')!.hints).toMatchObject({ readOnly: true, untrustedContent: true })
    expect(tm.describe('plain')!.hints?.consequential).toBeUndefined()
    const r = await tm.call('refresh', {}, { caller: 'inapp' })
    expect(r).toEqual({ status: 'ok', data: { clicked: true } })
    expect(clicks).toBe(1)
    expect(tm.describe('wipe')!.hints).toMatchObject({ destructive: true })
    const w = await tm.call('wipe', {}, { caller: 'inapp' })
    expect(w).toMatchObject({ status: 'needs_confirmation', summary: 'Delete all items?' })
  })

  it('submit_button_tool_is_consequential', async () => {
    const host = mount(`<form id="f"><input name="a">
        <button data-tool="save" data-tool-description="Save">Save</button>
        <button data-tool="save_ro" data-tool-description="Save" data-tool-readonly>Save</button>
        <button type="reset" data-tool="clear" data-tool-description="Clear">Clear</button>
      </form>
      <button form="f" data-tool="outside" data-tool-description="Save from outside">Save</button>
      <input type="submit" form="f" data-tool="inp" data-tool-description="Submit input">
      <button data-tool="orphan" data-tool-description="No form">x</button>`)
    let submitted = 0
    preventSubmit(host.querySelector('form')!, () => submitted++)
    const { tm } = setup({ observe: false })
    for (const n of ['save', 'save_ro', 'clear', 'outside', 'inp']) {
      expect(tm.describe(n)!.hints, n).toMatchObject({ consequential: true })
      expect(tm.describe(n)!.hints?.readOnly, n).toBeUndefined()
    }
    expect(tm.describe('orphan')!.hints?.consequential).toBeUndefined()
    const r = await tm.call('save', {}, { caller: 'inapp' })
    expect(r.status).toBe('needs_confirmation')
    expect(submitted).toBe(0)
    if (r.status !== 'needs_confirmation') return
    const approved = await tm.confirmPending(r.confirmId, { approved: true })
    expect(approved).toEqual({ status: 'ok', data: { clicked: true } })
    expect(submitted).toBe(1)
  })

  it('disabled_button_refused', async () => {
    const host =
      mount(`<button type="button" disabled data-tool="d" data-tool-description="x">d</button>
      <button type="button" style="display:none" data-tool="h" data-tool-description="x">h</button>
      <fieldset disabled><button type="button" data-tool="fs" data-tool-description="x">f</button></fieldset>
      <div inert><button type="button" data-tool="in" data-tool-description="x">i</button></div>`)
    let clicks = 0
    for (const b of host.querySelectorAll('button')) b.addEventListener('click', () => clicks++)
    const { tm } = setup({ observe: false })
    for (const n of ['d', 'h', 'fs', 'in']) {
      const r = await tm.call(n, {}, { caller: 'inapp' })
      expect(r, n).toEqual({
        status: 'refused',
        code: 'not_allowed',
        message: 'Button is disabled or hidden',
      })
    }
    expect(clicks).toBe(0)
  })
})

describe('scanDom — options URL', () => {
  it('options_url_provider', async () => {
    mount(`<form data-tool="pick" data-tool-description="Pick an owner">
      <input name="owner" data-tool-options-url="/api/users?team=7">
      <input name="tags[]" data-tool-options-url="/api/tags"><input name="tags[]">
    </form>`)
    const calls: Array<{ url: string; init: RequestInit | undefined }> = []
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, init })
      const body = url.includes('/api/tags')
        ? '{"not":"an array"}'
        : JSON.stringify([
            { value: 1, title: 'Alice' },
            { value: {}, title: 'bad' },
          ])
      return Promise.resolve(
        new Response(body, { headers: { 'content-type': 'application/json' } }),
      )
    })
    vi.stubGlobal('fetch', fetchMock)
    const { tm } = setup({ observe: false })
    expect(tm.info('pick.options')).toMatchObject({ origin: 'dom' })
    const r = await tm.call(
      'pick.options',
      { field: 'owner', query: 'ali ce' },
      { caller: 'inapp' },
    )
    expect(r).toEqual({ status: 'ok', data: { options: [{ value: 1, title: 'Alice' }] } })
    const u = new URL(calls[0]!.url)
    expect(u.origin).toBe(location.origin)
    expect(u.pathname).toBe('/api/users')
    expect(u.searchParams.get('team')).toBe('7')
    expect(u.searchParams.get('q')).toBe('ali ce')
    expect(calls[0]!.init).toMatchObject({ credentials: 'same-origin', mode: 'same-origin' })
    expect(calls[0]!.init?.signal).toBeInstanceOf(AbortSignal)
    const tags = await tm.call('pick.options', { field: 'tags[]' }, { caller: 'inapp' })
    expect(tags).toEqual({ status: 'error', message: 'Options lookup failed' })
    expect(new URL(calls[1]!.url).searchParams.get('q')).toBe('')
  })

  it('options_url_response_capped', async () => {
    mount(
      `<form data-tool="pick" data-tool-description="Pick"><input name="o" data-tool-options-url="/big"></form>`,
    )
    const big = `[${'"x",'.repeat(400_000)}"x"]`
    vi.stubGlobal('fetch', () => Promise.resolve(new Response(big)))
    const { tm } = setup({ observe: false })
    const r = await tm.call('pick.options', { field: 'o' }, { caller: 'inapp' })
    expect(r).toEqual({ status: 'error', message: 'Options lookup failed' })
  })

  it('options_url_same_origin_only', async () => {
    mount(`<form data-tool="pick" data-tool-description="Pick">
      <input name="a" data-tool-options-url="https://evil.example/users">
      <input name="b" data-tool-options-url="//evil.example/users">
      <input name="c" data-tool-options-url="javascript:alert(1)">
      <input name="d" data-tool-options-url="data:application/json,[]">
    </form>`)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { tm, errors } = setup({ observe: false })
    expect(names(tm)).toEqual(['pick.fill', 'pick.submit'])
    expect(tm.info('pick.options')).toBeUndefined()
    expect(errors.filter((e) => e.code === 'options_url_rejected')).toHaveLength(4)
    expect(errors.every((e) => !e.message.includes('evil.example/users?'))).toBe(true)
    await Promise.resolve()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('scanDom — observation', () => {
  it('observer_adds_and_removes_tools', async () => {
    const host = mount('<div id="app"></div>')
    const { tm } = setup({ root: host })
    expect(names(tm)).toEqual([])
    host.insertAdjacentHTML(
      'beforeend',
      `<form data-tool="late" data-tool-description="Late form"><input name="a"></form>
       <button type="button" data-tool="go" data-tool-description="Go">Go</button>`,
    )
    await frames()
    expect(names(tm)).toEqual(['go', 'late.fill', 'late.submit'])
    host.querySelector('form')!.remove()
    await frames()
    expect(names(tm)).toEqual(['go'])
    // Removing the tool attribute unregisters it; renaming re-registers.
    const btn = host.querySelector('button')!
    btn.setAttribute('data-tool', 'went')
    await frames()
    expect(names(tm)).toEqual(['went'])
    btn.removeAttribute('data-tool')
    await frames()
    expect(names(tm)).toEqual([])
  })

  it('observer_batches_and_skips_unchanged', async () => {
    const host = mount(`<form data-tool="f" data-tool-description="F"><input name="a"></form>`)
    const raf = vi.spyOn(window, 'requestAnimationFrame')
    const { tm } = setup({ root: host })
    const form = host.querySelector('form')!
    const input = host.querySelector('input')!
    const rev = tm.rev
    const scheduled = raf.mock.calls.length
    // Many unrelated mutations in one task → one frame, no re-registration.
    for (let i = 0; i < 10; i++) form.setAttribute('class', `c${i}`)
    input.value = 'typed'
    await frames()
    expect(raf.mock.calls.length - scheduled).toBe(1)
    expect(tm.rev).toBe(rev)
    // A schema change re-registers the form's tools.
    input.setAttribute('maxlength', '3')
    await frames()
    expect(tm.rev).toBeGreaterThan(rev)
    const long = await tm.call('f.fill', { values: { a: 'abcd' } }, { caller: 'inapp' })
    expect(long.status).toBe('invalid')
    const rev2 = tm.rev
    // Toggling back and forth within one frame ends unchanged → no re-registration.
    input.removeAttribute('maxlength')
    input.setAttribute('maxlength', '3')
    await frames()
    expect(tm.rev).toBe(rev2)
  })

  it('form_in_shadow_root_scanned', async () => {
    const host = mount('<div id="h"></div><div id="c"></div>')
    const shadow = host.querySelector('#h')!.attachShadow({ mode: 'open' })
    shadow.innerHTML = `<form data-tool="shadowed" data-tool-description="In shadow"><input name="a"></form>`
    const closed = host.querySelector('#c')!.attachShadow({ mode: 'closed' })
    closed.innerHTML = `<form data-tool="hidden" data-tool-description="Closed"><input name="a"></form>`
    const { tm } = setup({ root: host })
    expect(names(tm)).toEqual(['shadowed.fill', 'shadowed.submit'])
    const r = await tm.call('shadowed.fill', { values: { a: 'x' } }, { caller: 'inapp' })
    expect(r.status).toBe('ok')
    expect(shadow.querySelector('input')!.value).toBe('x')
    // Mutations inside the open shadow root are observed.
    const inner = document.createElement('button')
    inner.type = 'button'
    inner.setAttribute('data-tool', 'inner')
    inner.setAttribute('data-tool-description', 'Inner')
    shadow.querySelector('form')!.after(inner)
    await frames()
    expect(names(tm)).toContain('inner')
  })

  it('dispose_disconnects_observers_and_listeners', async () => {
    const host = mount(`<form data-tool="f" data-tool-description="F"><input name="a"></form>`)
    const shadowHost = document.createElement('div')
    host.append(shadowHost)
    shadowHost.attachShadow({ mode: 'open' }).innerHTML =
      `<button type="button" data-tool="s" data-tool-description="S">s</button>`
    const added: string[] = []
    const removed: string[] = []
    // eslint-disable-next-line @typescript-eslint/unbound-method -- re-invoked with .call below
    const realAdd = EventTarget.prototype.addEventListener
    // eslint-disable-next-line @typescript-eslint/unbound-method -- re-invoked with .call below
    const realRemove = EventTarget.prototype.removeEventListener
    vi.spyOn(EventTarget.prototype, 'addEventListener').mockImplementation(function (
      this: EventTarget,
      type: string,
      fn: EventListenerOrEventListenerObject | null,
      o?: boolean | AddEventListenerOptions,
    ) {
      added.push(type)
      realAdd.call(this, type, fn, o)
    })
    vi.spyOn(EventTarget.prototype, 'removeEventListener').mockImplementation(function (
      this: EventTarget,
      type: string,
      fn: EventListenerOrEventListenerObject | null,
      o?: boolean | EventListenerOptions,
    ) {
      removed.push(type)
      realRemove.call(this, type, fn, o)
    })
    const spyDisconnect = vi.spyOn(MutationObserver.prototype, 'disconnect')
    const { tm, off } = setup({ root: host })
    expect(names(tm)).toEqual(['f.fill', 'f.submit', 's'])
    host.querySelector('form')!.setAttribute('class', 'pending') // a frame is pending at dispose
    off()
    expect(spyDisconnect).toHaveBeenCalled()
    expect(names(tm)).toEqual([])
    for (const type of ['input', 'change', 'reset']) {
      expect(removed.filter((t) => t === type).length, type).toBe(
        added.filter((t) => t === type).length,
      )
    }
    host.insertAdjacentHTML(
      'beforeend',
      `<button type="button" data-tool="after" data-tool-description="After">a</button>`,
    )
    await frames()
    expect(names(tm)).toEqual([])
  })

  it('scan_without_document_root_default_uses_document', () => {
    mount(`<button type="button" data-tool="doc_btn" data-tool-description="Doc">d</button>`)
    const { tm } = setup({ observe: false })
    expect(names(tm)).toContain('doc_btn')
  })
})
