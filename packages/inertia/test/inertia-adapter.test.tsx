/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call,
   @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return,
   @typescript-eslint/no-unnecessary-type-assertion --
   typescript-eslint's type-aware checker cannot resolve any export of `@inertiajs/react` in this
   workspace (confirmed with a minimal repro: even a bare `import { Head } from '@inertiajs/react'`
   comes back as an unresolved/error type), while `tsc -p tsconfig.test.json` typechecks this file
   with zero errors. Real types are enforced by `pnpm typecheck`; these lines are not unsafe. */
import { router, useForm } from '@inertiajs/react'
import type { FormAdapter, ToolResult } from '@toolmark/core'
import { act, cleanup, render } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { inertiaAdapter, type InertiaFormLike } from '../src/inertia-adapter.js'

interface Values extends Record<string, unknown> {
  title: string
  address: { city: string }
}

const initialValues: Values = { title: '', address: { city: '' } }

/** The subset of a real Inertia visit's options this suite reads or fires. */
interface CapturedVisitOptions {
  data?: unknown
  onSuccess?: (page?: unknown) => unknown
  onError?: (errors: Record<string, string>) => unknown
  onCancel?: () => unknown
  onFinish?: (visit?: { cancelled?: boolean; interrupted?: boolean }) => unknown
  onHttpException?: (response?: unknown) => unknown
}

/** Replaces `router.visit` with a stub that records the options Inertia built for the visit. */
function mockVisit(): { getOptions: () => CapturedVisitOptions } {
  let captured: CapturedVisitOptions | undefined
  vi.spyOn(router, 'visit').mockImplementation(
    ((_href: unknown, options: unknown) => {
      captured = options as CapturedVisitOptions
    }) as unknown as typeof router.visit,
  )
  return {
    getOptions: (): CapturedVisitOptions => {
      if (!captured) throw new Error('router.visit was not called')
      return captured
    },
  }
}

/**
 * Wraps `useForm()` in an object whose identity (and whose `setData`) never changes across
 * renders, so tests can hold a single reference to spy on regardless of Inertia's own memoization.
 */
function useStableForm(initial: Values): InertiaFormLike<Values> {
  const form = useForm<Values>(initial)
  const latest = useRef(form)
  latest.current = form
  const stableRef = useRef<InertiaFormLike<Values> | undefined>(undefined)
  stableRef.current ??= {
    get data() {
      return latest.current.data
    },
    setData: (d: Values) => {
      latest.current.setData(d)
    },
    get errors() {
      return latest.current.errors as Partial<Record<string, string>>
    },
    transform: (cb) => {
      latest.current.transform(cb)
    },
    submit: (method, url, opts) => {
      latest.current.submit(method as 'post', url, opts)
    },
  }
  return stableRef.current
}

function Harness({
  expose,
}: {
  expose: (adapter: FormAdapter<Values>, form: InertiaFormLike<Values>) => void
}) {
  const form = useStableForm(initialValues)
  const adapter = inertiaAdapter(form, { submit: { method: 'post', url: '/things' } })
  expose(adapter, form)
  return null
}

function renderHarness(): { adapter: FormAdapter<Values>; form: InertiaFormLike<Values> } {
  let adapter!: FormAdapter<Values>
  let form!: InertiaFormLike<Values>
  render(
    <Harness
      expose={(a, f) => {
        adapter = a
        form = f
      }}
    />,
  )
  return { adapter, form }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('inertiaAdapter', () => {
  it('set_values_single_set_data', () => {
    const { adapter, form } = renderHarness()
    const setDataSpy = vi.spyOn(form, 'setData')
    act(() => {
      adapter.setValues({ title: 'Ada', 'address.city': 'Paris' }, { source: 'agent' })
    })
    expect(setDataSpy).toHaveBeenCalledTimes(1)
    expect(adapter.getValues()).toEqual({ title: 'Ada', address: { city: 'Paris' } })
  })

  it('dirty_paths_against_initial_snapshot', () => {
    const { adapter } = renderHarness()
    expect(adapter.dirtyPaths()).toEqual([])
    act(() => {
      adapter.setValues({ title: 'Ada' }, { source: 'agent' })
    })
    expect(adapter.dirtyPaths()).toEqual(['title'])
  })

  it('adapter_state_survives_rerender', () => {
    let adapter1!: FormAdapter<Values>
    const { rerender } = render(
      <Harness
        expose={(a) => {
          adapter1 = a
        }}
      />,
    )
    act(() => {
      adapter1.setValues({ title: 'Ada' }, { source: 'agent' })
    })
    let adapter2!: FormAdapter<Values>
    rerender(
      <Harness
        expose={(a) => {
          adapter2 = a
        }}
      />,
    )
    expect(adapter2).not.toBe(adapter1)
    expect(adapter2.getValues()).toEqual({ title: 'Ada', address: { city: '' } })
    expect(adapter2.dirtyPaths()).toEqual(['title'])
  })

  it('fill_then_immediate_submit_sends_new_values', () => {
    const { getOptions } = mockVisit()
    const { adapter } = renderHarness()
    act(() => {
      adapter.setValues({ title: 'Ada' }, { source: 'agent' })
      void adapter.submit()
    })
    expect(getOptions().data).toEqual({ title: 'Ada', address: { city: '' } })
  })

  it('submit_success_ok', async () => {
    const { getOptions } = mockVisit()
    const { adapter } = renderHarness()
    let resultPromise!: Promise<ToolResult<unknown>>
    act(() => {
      resultPromise = adapter.submit()
    })
    await act(async () => {
      await getOptions().onSuccess?.({ component: 'X', props: {}, url: '/things', version: '1' })
    })
    await expect(resultPromise).resolves.toEqual({ status: 'ok', data: {} })
  })

  it('submit_errors_invalid', async () => {
    const { getOptions } = mockVisit()
    const { adapter } = renderHarness()
    let resultPromise!: Promise<ToolResult<unknown>>
    act(() => {
      resultPromise = adapter.submit()
    })
    act(() => {
      getOptions().onError?.({ title: 'Required' })
    })
    await expect(resultPromise).resolves.toEqual({
      status: 'invalid',
      issues: [{ path: 'title', message: 'Required' }],
    })
  })

  it('submit_finish_without_outcome_is_error', async () => {
    const { getOptions } = mockVisit()
    const { adapter } = renderHarness()
    let resultPromise!: Promise<ToolResult<unknown>>
    act(() => {
      resultPromise = adapter.submit()
    })
    act(() => {
      getOptions().onFinish?.({ cancelled: false, interrupted: false })
    })
    await expect(resultPromise).resolves.toEqual({
      status: 'error',
      message: 'Visit did not complete',
    })
  })

  it('submit_cancelled_visit_is_cancelled', async () => {
    const { getOptions } = mockVisit()
    const { adapter } = renderHarness()
    let resultPromise!: Promise<ToolResult<unknown>>
    act(() => {
      resultPromise = adapter.submit()
    })
    act(() => {
      getOptions().onCancel?.()
    })
    await expect(resultPromise).resolves.toEqual({ status: 'cancelled', by: 'signal' })
  })

  it('submit_http_exception_is_error', async (ctx) => {
    const major = await installedInertiaMajor()
    if (major < 3) ctx.skip()
    const { getOptions } = mockVisit()
    const { adapter } = renderHarness()
    let resultPromise!: Promise<ToolResult<unknown>>
    act(() => {
      resultPromise = adapter.submit()
    })
    act(() => {
      getOptions().onHttpException?.({ status: 500 })
    })
    await expect(resultPromise).resolves.toEqual({ status: 'error', message: 'Request failed' })
  })
})

/**
 * Reads the installed `@inertiajs/react` major version straight off its `package.json` (a
 * computed, non-literal specifier so `tsc` never attempts to resolve it; Vite resolves it at
 * runtime the same way it resolves any other relative import). Defaults to `3` — the version this
 * suite is written against — if the read fails for any reason.
 */
async function installedInertiaMajor(): Promise<number> {
  try {
    const segments = ['..', 'node_modules', '@inertiajs', 'react', 'package.json']
    const mod = (await import(/* @vite-ignore */ segments.join('/'))) as {
      version?: string
      default?: { version?: string }
    }
    const version = mod.version ?? mod.default?.version ?? ''
    const major = Number.parseInt(version.split('.')[0] ?? '', 10)
    return Number.isNaN(major) ? 3 : major
  } catch {
    return 3
  }
}
