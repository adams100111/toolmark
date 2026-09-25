import type { JSX } from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { userEvent } from 'vitest/browser'
import { afterEach, describe, expect, it } from 'vitest'
import { useForm, type FieldErrors, type Resolver, type UseFormReturn } from 'react-hook-form'
import { z } from 'zod'
import { createToolmark, type FormAdapter } from '@toolmark/core'
import { ToolmarkProvider, useFormTool } from '../src/index.js'
import { rhfAdapter } from '../src/rhf/index.js'

afterEach(cleanup)

interface Values extends Record<string, unknown> {
  title: string
}

const schema = z.object({ title: z.string().min(1, 'Title is required') })

/** Small inline zod-4 resolver (no `@hookform/resolvers` dependency in this package). */
function inlineZodResolver(s: typeof schema): Resolver<Values> {
  return async (values) => {
    const result = await s['~standard'].validate(values)
    if (result.issues) {
      const errors: Record<string, { type: string; message: string }> = {}
      for (const issue of result.issues) {
        const path =
          issue.path
            ?.map((seg) => (typeof seg === 'object' ? String(seg.key) : String(seg)))
            .join('.') || 'root'
        errors[path] = { type: 'validation', message: issue.message }
      }
      return { values: {}, errors: errors as unknown as FieldErrors<Values> }
    }
    return { values: result.value, errors: {} }
  }
}

interface Captured {
  form: UseFormReturn<Values>
  adapter: FormAdapter<Values>
}

describe('rhfAdapter', () => {
  it('set_values_updates_form_and_marks_dirty', () => {
    const captured: { current?: Captured } = {}

    function Harness(): null {
      const form = useForm<Values>({ defaultValues: { title: '' } })
      const adapter = rhfAdapter(form, { onSubmit: () => ({}) })
      captured.current = { form, adapter }
      return null
    }

    render(<Harness />)
    const { adapter } = captured.current!

    act(() => {
      adapter.setValues({ title: 'Hello' }, { source: 'agent' })
    })

    expect(adapter.getValues().title).toBe('Hello')
    expect(adapter.dirtyPaths()).toContain('title')
  })

  it('null_clears_string_to_empty', () => {
    const captured: { current?: Captured } = {}

    function Harness(): null {
      const form = useForm<Values>({ defaultValues: { title: '' } })
      const adapter = rhfAdapter(form, { onSubmit: () => ({}) })
      captured.current = { form, adapter }
      return null
    }

    render(<Harness />)
    const { adapter } = captured.current!

    act(() => {
      adapter.setValues({ title: 'Hello' }, { source: 'agent' })
    })
    act(() => {
      adapter.setValues({ title: null }, { source: 'agent' })
    })

    expect(adapter.getValues().title).toBe('')
  })

  it('dirty_paths_reflect_user_typing', async () => {
    const captured: { current?: Captured } = {}

    function Harness(): JSX.Element {
      const form = useForm<Values>({ defaultValues: { title: '' } })
      const adapter = rhfAdapter(form, { onSubmit: () => ({}) })
      captured.current = { form, adapter }
      return <input data-testid="title" {...form.register('title')} />
    }

    render(<Harness />)
    await userEvent.type(screen.getByTestId('title'), 'Hi')

    expect(captured.current!.adapter.dirtyPaths()).toContain('title')
  })

  it('dirty_paths_without_app_reading_form_state', async () => {
    // Only the adapter (constructed here) ever touches `form.formState`; the component below
    // never reads it, proving the adapter's own construction-time read is what enables tracking.
    let adapter: FormAdapter<Values> | undefined

    function Harness(): JSX.Element {
      const form = useForm<Values>({ defaultValues: { title: '' } })
      adapter = rhfAdapter(form, { onSubmit: () => ({}) })
      return <input data-testid="title" {...form.register('title')} />
    }

    render(<Harness />)
    await userEvent.type(screen.getByTestId('title'), 'Hi')

    expect(adapter?.dirtyPaths()).toContain('title')
  })

  it('submit_valid_calls_on_submit_ok', async () => {
    const captured: { current?: Captured } = {}
    let received: Values | undefined

    function Harness(): null {
      const form = useForm<Values>({
        defaultValues: { title: 'ok' },
        resolver: inlineZodResolver(schema),
      })
      const adapter = rhfAdapter(form, {
        onSubmit: (values) => {
          received = values
          return { ok: true }
        },
      })
      captured.current = { form, adapter }
      return null
    }

    render(<Harness />)
    const result = await act(() => captured.current!.adapter.submit())

    expect(result).toEqual({ status: 'ok', data: { ok: true } })
    expect(received).toEqual({ title: 'ok' })
  })

  it('submit_invalid_returns_issues', async () => {
    const captured: { current?: Captured } = {}

    function Harness(): null {
      const form = useForm<Values>({
        defaultValues: { title: '' },
        resolver: inlineZodResolver(schema),
      })
      const adapter = rhfAdapter(form, { onSubmit: () => ({}) })
      captured.current = { form, adapter }
      return null
    }

    render(<Harness />)
    const result = await act(() => captured.current!.adapter.submit())

    expect(result.status).toBe('invalid')
    if (result.status === 'invalid') {
      expect(result.issues.some((i) => i.path === 'title')).toBe(true)
    }
  })

  it('submit_non_json_result_becomes_empty_ok', async () => {
    const captured: { current?: Captured } = {}

    function Harness(): null {
      const form = useForm<Values>({ defaultValues: { title: 'ok' } })
      const adapter = rhfAdapter(form, { onSubmit: () => ({ handler: () => {} }) })
      captured.current = { form, adapter }
      return null
    }

    render(<Harness />)
    const result = await act(() => captured.current!.adapter.submit())

    expect(result).toEqual({ status: 'ok', data: {} })
  })

  it('submit_on_submit_throws_rejects_and_leaves_is_submit_successful_false', async () => {
    const captured: { current?: Captured } = {}

    function Harness(): null {
      const form = useForm<Values>({
        defaultValues: { title: 'ok' },
        resolver: inlineZodResolver(schema),
      })
      const adapter = rhfAdapter(form, {
        onSubmit: () => {
          throw new Error('boom: secret-internal-detail')
        },
      })
      captured.current = { form, adapter }
      return null
    }

    render(<Harness />)
    // The adapter must not turn the app's exception into a result carrying its message (that
    // would leak it to the agent); it rejects, and core's runTool maps that to `Tool failed`.
    await expect(act(() => captured.current!.adapter.submit())).rejects.toThrow(
      'boom: secret-internal-detail',
    )
    // A thrown `onSubmit` must propagate out of `onValid` so react-hook-form itself sees the
    // submission fail (M6): otherwise `handleSubmit` would resolve `onValid` "successfully" and
    // mark the form as having submitted OK even though the caller's callback threw.
    expect(captured.current!.form.formState.isSubmitSuccessful).toBe(false)
  })

  it('submit_on_submit_throws_yields_tool_failed_without_leaking_message', async () => {
    const tm = createToolmark({ dev: true })
    const errors: { code: string }[] = []
    tm.events.on('error', (e) => errors.push(e))

    function Harness(): null {
      const form = useForm<Values>({ defaultValues: { title: 'ok' } })
      const adapter = rhfAdapter(form, {
        onSubmit: () => {
          throw new Error('boom: secret-internal-detail')
        },
      })
      useFormTool(adapter, { name: 'x', description: 'A form', input: schema })
      return null
    }

    render(
      <ToolmarkProvider toolmark={tm}>
        <Harness />
      </ToolmarkProvider>,
    )

    const submitResult = await act(() => tm.call('x.submit', {}, { caller: 'test' }))
    if (submitResult.status !== 'needs_confirmation') {
      throw new Error('expected needs_confirmation')
    }
    const result = await act(() => tm.confirmPending(submitResult.confirmId, { approved: true }))

    expect(result).toEqual({ status: 'error', message: 'Tool failed' })
    expect(JSON.stringify(result)).not.toContain('secret-internal-detail')
    expect(errors.map((e) => e.code)).toContain('tool_threw')
  })

  it('end_to_end_fill_skips_user_typed_field', async () => {
    const tm = createToolmark({ dev: true })

    function Harness(): JSX.Element {
      const form = useForm<Values>({ defaultValues: { title: '' } })
      const adapter = rhfAdapter(form, { onSubmit: () => ({}) })
      useFormTool(adapter, { name: 'x', description: 'A form', input: schema })
      return <input data-testid="title" {...form.register('title')} />
    }

    render(
      <ToolmarkProvider toolmark={tm}>
        <Harness />
      </ToolmarkProvider>,
    )
    await userEvent.type(screen.getByTestId('title'), 'User typed')

    const result = await tm.call('x.fill', { values: { title: 'Agent value' } }, { caller: 'test' })
    expect(result.status).toBe('ok')
    if (result.status === 'ok') {
      expect((result.data as { skipped: string[] }).skipped).toContain('title')
    }
  })

  it('deferred_submit_approve_with_no_edits_runs_ok', async () => {
    const tm = createToolmark({ dev: true })
    let received: Values | undefined

    function Harness(): null {
      const form = useForm<Values>({
        defaultValues: { title: '' },
        resolver: inlineZodResolver(schema),
      })
      const adapter = rhfAdapter(form, {
        onSubmit: (values) => {
          received = values
          return { done: true }
        },
      })
      useFormTool(adapter, { name: 'x', description: 'A form', input: schema })
      return null
    }

    render(
      <ToolmarkProvider toolmark={tm}>
        <Harness />
      </ToolmarkProvider>,
    )

    const fillResult = await act(() =>
      tm.call('x.fill', { values: { title: 'Hello' } }, { caller: 'test' }),
    )
    expect(fillResult.status).toBe('ok')

    const submitResult = await act(() => tm.call('x.submit', {}, { caller: 'test' }))
    expect(submitResult.status).toBe('needs_confirmation')
    if (submitResult.status !== 'needs_confirmation') {
      throw new Error('expected needs_confirmation')
    }

    const approveResult = await act(() =>
      tm.confirmPending(submitResult.confirmId, { approved: true }),
    )

    expect(approveResult).toEqual({ status: 'ok', data: { done: true } })
    expect(received).toEqual({ title: 'Hello' })
  })
})
