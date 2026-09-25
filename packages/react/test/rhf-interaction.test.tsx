import { useRef, useState, type JSX } from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { userEvent } from 'vitest/browser'
import { afterEach, describe, expect, it } from 'vitest'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { createToolmark, type Toolmark } from '@toolmark/core'
import { ToolmarkProvider, useFormTool } from '../src/index.js'
import { rhfAdapter } from '../src/rhf/index.js'

afterEach(cleanup)

interface Values extends Record<string, unknown> {
  title: string
  password: string
  address: { city: string }
}

const schema = z.object({
  title: z.string(),
  password: z.string(),
  address: z.object({ city: z.string() }),
})

const flush = () => act(() => new Promise<void>((r) => setTimeout(r, 0)))

function Profile(props: { withRoot: boolean }): JSX.Element {
  const form = useForm<Values>({
    defaultValues: { title: '', password: '', address: { city: '' } },
  })
  const formRef = useRef<HTMLFormElement>(null)
  const adapter = rhfAdapter(form, {
    onSubmit: () => ({}),
    ...(props.withRoot ? { root: () => formRef.current } : {}),
  })
  useFormTool(adapter, { name: 'profile', description: 'Profile.', input: schema })
  return (
    <form ref={formRef} onSubmit={(e) => e.preventDefault()}>
      <input data-testid="title" {...form.register('title')} />
      <input data-testid="password" type="password" {...form.register('password')} />
      <input data-testid="city" {...form.register('address.city')} />
      <button type="submit">Save</button>
    </form>
  )
}

function mount(withRoot: boolean): { tm: Toolmark; events: unknown[] } {
  const tm = createToolmark({ dev: true, confirm: () => Promise.resolve({ approved: true }) })
  const events: unknown[] = []
  tm.events.on('interaction', (e) => events.push(e))
  render(
    <ToolmarkProvider toolmark={tm}>
      <Profile withRoot={withRoot} />
    </ToolmarkProvider>,
  )
  return { tm, events }
}

describe('rhfAdapter interaction events', () => {
  it('interaction_only_for_user_changes_rhf', async () => {
    const { tm, events } = mount(false)
    await flush()
    const r = await act(() =>
      tm.call('profile.fill', { values: { title: 'Agent' } }, { caller: 'inapp' }),
    )
    expect(r.status).toBe('ok')
    await act(() => tm.call('profile.submit', {}, { caller: 'human' }))
    await flush()
    expect(events).toEqual([])

    await userEvent.type(screen.getByTestId('title'), 'x')
    await userEvent.type(screen.getByTestId('password'), 'hunter2')
    await flush()
    expect(events).toContainEqual({
      tool: 'profile.fill',
      param: 'title',
      kind: 'input',
      caller: 'human',
    })
    expect(events).toContainEqual({
      tool: 'profile.fill',
      param: 'password',
      kind: 'input',
      caller: 'human',
    })
    // Without `root`, only `input` is emitted; the value is never carried.
    expect(events.every((e) => (e as { kind: string }).kind === 'input')).toBe(true)
    expect(JSON.stringify(events)).not.toContain('hunter2')
  })

  it('rhf_anchor_via_root_name_lookup', async () => {
    const { tm } = mount(true)
    await flush()
    expect(tm.anchor('profile.fill', 'address.city')).toBe(screen.getByTestId('city'))
    expect(tm.anchor('profile.fill')).toBe(screen.getByTestId('title').closest('form'))
    expect(tm.anchor('profile.submit')).toBe(screen.getByTestId('title').closest('form'))
    // The password element makes its path sensitive: state redacts it.
    await userEvent.type(screen.getByTestId('password'), 'hunter2')
    expect(tm.info('profile.fill')?.sensitivePaths).toEqual(['password'])
    expect(tm.state('profile.fill')?.values).toMatchObject({ password: '[redacted]' })
    expect(JSON.stringify(tm.state('profile.fill'))).not.toContain('hunter2')
  })

  it('rhf_focus_and_submit_with_root', async () => {
    const { tm, events } = mount(true)
    await flush()
    // The adapter's own submit emits nothing.
    await act(() => tm.call('profile.submit', {}, { caller: 'human' }))
    await flush()
    expect(events).toEqual([])
    await userEvent.click(screen.getByTestId('city'))
    await userEvent.click(screen.getByText('Save'))
    await flush()
    expect(events).toContainEqual({
      tool: 'profile.fill',
      param: 'address.city',
      kind: 'focus',
      caller: 'human',
    })
    expect(events).toContainEqual({ tool: 'profile.submit', kind: 'submit', caller: 'human' })
  })

  it('rhf_show_password_toggle_keeps_redaction', async () => {
    function Login(): JSX.Element {
      const form = useForm<{ pw: string }>({ defaultValues: { pw: '' } })
      const formRef = useRef<HTMLFormElement>(null)
      const [shown, setShown] = useState(false)
      const adapter = rhfAdapter(form, { onSubmit: () => ({}), root: () => formRef.current })
      useFormTool(adapter, {
        name: 'login',
        description: 'Login.',
        input: z.object({ pw: z.string() }),
      })
      return (
        <form ref={formRef}>
          <input data-testid="pw" type={shown ? 'text' : 'password'} {...form.register('pw')} />
          <button type="button" onClick={() => setShown((v) => !v)}>
            Show
          </button>
        </form>
      )
    }
    const tm = createToolmark({ dev: true, confirm: () => Promise.resolve({ approved: true }) })
    render(
      <ToolmarkProvider toolmark={tm}>
        <Login />
      </ToolmarkProvider>,
    )
    await flush()
    await userEvent.type(screen.getByTestId('pw'), 'hunter2')
    expect(tm.state('login.fill')?.values).toEqual({ pw: '[redacted]' })
    await userEvent.click(screen.getByText('Show'))
    await flush()
    expect(screen.getByTestId('pw').getAttribute('type')).toBe('text')
    expect(tm.state('login.fill')?.values).toEqual({ pw: '[redacted]' })
    expect(tm.info('login.fill')?.sensitivePaths).toEqual(['pw'])
    expect(JSON.stringify(tm.state('login.fill'))).not.toContain('hunter2')
  })
})
