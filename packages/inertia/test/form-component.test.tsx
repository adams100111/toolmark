import { Form, router } from '@inertiajs/react'
import type { ComponentRef } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { inertiaFormComponentAdapter } from '../src/form-component.js'
import type { InertiaEventName, RouterLike } from '../src/router-like.js'

type FormRef = { current: ComponentRef<typeof Form> | null }

/**
 * A `RouterLike` this suite drives directly, decoupled from the real Inertia singleton `router`
 * (whose `.visit` is separately mocked below so the real `<Form>` this suite renders never makes a
 * network call). `fire` accepts the full event-name union (not just `RouterLike`'s typed subset) so
 * the suite can simulate both majors' request-failure events.
 */
interface FakeRouter extends RouterLike {
  fire(event: InertiaEventName, detail?: unknown): void
}

function fakeRouter(): FakeRouter {
  const listeners = new Map<string, Set<(e: CustomEvent) => void>>()
  return {
    on(event, cb) {
      let set = listeners.get(event)
      if (!set) listeners.set(event, (set = new Set()))
      set.add(cb)
      return () => {
        set.delete(cb)
      }
    },
    visit() {
      // Never called: the real `<Form>` drives its own visit through the singleton `router`
      // (mocked per-test below), not through this fake.
    },
    fire(event, detail) {
      for (const cb of [...(listeners.get(event) ?? [])]) cb(new CustomEvent(event, { detail }))
    },
  }
}

/** Renders a real `@inertiajs/react` `<Form>` and returns its `<form>` element and ref. */
function mountForm(): { element: HTMLFormElement; formRef: FormRef } {
  const formRef: FormRef = { current: null }
  render(
    <Form ref={formRef} method="post" action="/things" data-testid="f">
      <input name="title" defaultValue="" />
    </Form>,
  )
  return { element: screen.getByTestId('f'), formRef }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('inertiaFormComponentAdapter', () => {
  it('form_component_fill_and_submit_success', async () => {
    vi.spyOn(router, 'visit').mockImplementation(() => undefined)
    const { element, formRef } = mountForm()
    const fake = fakeRouter()
    const adapter = inertiaFormComponentAdapter({ element, formRef, router: fake })

    adapter.setValues({ title: 'Ada' }, { source: 'agent' })
    expect(adapter.getValues()).toEqual({ title: 'Ada' })

    const pending = adapter.submit()
    fake.fire('start', { visit: {} })
    fake.fire('success', { page: {} })
    fake.fire('finish', { visit: { cancelled: false, interrupted: false } })

    await expect(pending).resolves.toEqual({ status: 'ok', data: {} })
    adapter.dispose()
  })

  it('form_component_submit_errors_invalid', async () => {
    vi.spyOn(router, 'visit').mockImplementation(() => undefined)
    const { element, formRef } = mountForm()
    const fake = fakeRouter()
    const adapter = inertiaFormComponentAdapter({ element, formRef, router: fake })

    const pending = adapter.submit()
    fake.fire('start', { visit: {} })
    fake.fire('error', { errors: { title: 'The title field is required.' } })
    fake.fire('finish', { visit: { cancelled: false, interrupted: false } })

    await expect(pending).resolves.toEqual({
      status: 'invalid',
      issues: [{ path: 'title', message: 'The title field is required.' }],
    })
    adapter.dispose()
  })

  it('form_component_http_exception_is_error', async () => {
    vi.spyOn(router, 'visit').mockImplementation(() => undefined)
    const { element, formRef } = mountForm()
    const fake = fakeRouter()
    const adapter = inertiaFormComponentAdapter({ element, formRef, router: fake })

    const pending = adapter.submit()
    fake.fire('start', { visit: {} })
    fake.fire('httpException', { response: { status: 500 } })
    fake.fire('finish', { visit: { cancelled: false, interrupted: false } })

    await expect(pending).resolves.toEqual({ status: 'error', message: 'Request failed' })
    adapter.dispose()

    // Inertia 2's names map to the same outcome.
    const fake2 = fakeRouter()
    const adapter2 = inertiaFormComponentAdapter({ element, formRef, router: fake2 })
    const pending2 = adapter2.submit()
    fake2.fire('start', { visit: {} })
    fake2.fire('networkError', { error: new Error('offline') })
    fake2.fire('finish', { visit: { cancelled: false, interrupted: false } })
    await expect(pending2).resolves.toEqual({ status: 'error', message: 'Network error' })
    adapter2.dispose()

    const fake3 = fakeRouter()
    const adapter3 = inertiaFormComponentAdapter({ element, formRef, router: fake3 })
    const pending3 = adapter3.submit()
    fake3.fire('start', { visit: {} })
    fake3.fire('invalid', { response: {} })
    fake3.fire('finish', { visit: { cancelled: false, interrupted: false } })
    await expect(pending3).resolves.toEqual({ status: 'error', message: 'Request failed' })
    adapter3.dispose()

    const fake4 = fakeRouter()
    const adapter4 = inertiaFormComponentAdapter({ element, formRef, router: fake4 })
    const pending4 = adapter4.submit()
    fake4.fire('start', { visit: {} })
    fake4.fire('exception', { error: new Error('boom') })
    fake4.fire('finish', { visit: { cancelled: false, interrupted: false } })
    await expect(pending4).resolves.toEqual({ status: 'error', message: 'Network error' })
    adapter4.dispose()
  })

  it('form_component_interrupted_visit_cancelled', async () => {
    vi.spyOn(router, 'visit').mockImplementation(() => undefined)
    const { element, formRef } = mountForm()
    const fake = fakeRouter()
    const adapter = inertiaFormComponentAdapter({ element, formRef, router: fake })

    const pending = adapter.submit()
    fake.fire('start', { visit: {} })
    fake.fire('finish', { visit: { cancelled: false, interrupted: true } })

    await expect(pending).resolves.toEqual({ status: 'cancelled', by: 'signal' })
    adapter.dispose()

    const fake2 = fakeRouter()
    const adapter2 = inertiaFormComponentAdapter({ element, formRef, router: fake2 })
    const pending2 = adapter2.submit()
    fake2.fire('start', { visit: {} })
    fake2.fire('finish', { visit: { cancelled: true, interrupted: false } })
    await expect(pending2).resolves.toEqual({ status: 'cancelled', by: 'signal' })
    adapter2.dispose()
  })

  it('form_component_unmounted_error', async () => {
    const { element, formRef } = mountForm()
    cleanup()
    expect(formRef.current).toBeNull()

    const fake = fakeRouter()
    const adapter = inertiaFormComponentAdapter({ element, formRef, router: fake })
    await expect(adapter.submit()).resolves.toEqual({
      status: 'error',
      message: 'Form is not mounted',
    })
    adapter.dispose()
  })

  it('dispose_removes_listeners', () => {
    const { element, formRef } = mountForm()
    const fake = fakeRouter()
    const adapter = inertiaFormComponentAdapter({ element, formRef, router: fake })
    adapter.dispose()
    // No listener throws/leaks after dispose: fields/values still work via the DOM path.
    expect(adapter.getValues()).toEqual({ title: '' })
  })
})
