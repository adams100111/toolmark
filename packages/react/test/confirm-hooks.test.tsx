import type { JSX } from 'react'
import { renderToString } from 'react-dom/server'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { createConfirmQueue, createToolmark, ok, type ToolResult } from '@toolmark/core'
import { ToolmarkProvider, useConfirmQueue, usePendingConfirmations } from '../src/index.js'

afterEach(cleanup)

describe('confirm hooks', () => {
  it('confirm_queue_hook_shows_head_and_resolves', async () => {
    const queue = createConfirmQueue()
    const tm = createToolmark({
      dev: true,
      confirm: queue.handler,
      confirmMode: { inapp: 'inline' },
    })
    tm.register({
      name: 'danger',
      description: 'dangerous',
      hints: { consequential: true },
      summary: () => 'Do the dangerous thing',
      run: () => ok('done'),
    })

    function Probe(): JSX.Element {
      const { pending, approve } = useConfirmQueue(queue)
      return (
        <div>
          <span data-testid="summary">{pending?.summary ?? ''}</span>
          <button type="button" onClick={() => approve()}>
            approve
          </button>
        </div>
      )
    }

    render(
      <ToolmarkProvider toolmark={tm}>
        <Probe />
      </ToolmarkProvider>,
    )
    expect(screen.getByTestId('summary').textContent).toBe('')

    let callPromise!: Promise<ToolResult<unknown>>
    act(() => {
      callPromise = tm.call('danger', undefined, { caller: 'inapp' })
    })

    await waitFor(() => {
      expect(screen.getByTestId('summary').textContent).toBe('Do the dangerous thing')
    })

    act(() => {
      fireEvent.click(screen.getByText('approve'))
    })

    const result = await callPromise
    expect(result).toEqual({ status: 'ok', data: 'done' })
    expect(screen.getByTestId('summary').textContent).toBe('')
  })

  it('pending_confirmations_list_and_approve', async () => {
    const tm = createToolmark({ dev: true })
    tm.register({
      name: 'danger',
      description: 'dangerous',
      hints: { consequential: true },
      summary: () => 'Do it',
      run: () => ok('done'),
    })

    function Probe({
      onApprove,
    }: {
      onApprove: (p: Promise<ToolResult<unknown>>) => void
    }): JSX.Element {
      const { items, approve } = usePendingConfirmations()
      return (
        <div>
          <span data-testid="count">{items.length}</span>
          {items.map((p) => (
            <button key={p.confirmId} type="button" onClick={() => onApprove(approve(p.confirmId))}>
              approve
            </button>
          ))}
        </div>
      )
    }

    let approved: Promise<ToolResult<unknown>> | undefined
    render(
      <ToolmarkProvider toolmark={tm}>
        <Probe
          onApprove={(p) => {
            approved = p
          }}
        />
      </ToolmarkProvider>,
    )
    expect(screen.getByTestId('count').textContent).toBe('0')

    const callResult = await act(() => tm.call('danger', undefined, { caller: 'inapp' }))
    expect(callResult.status).toBe('needs_confirmation')
    expect(screen.getByTestId('count').textContent).toBe('1')

    await act(async () => {
      fireEvent.click(screen.getByRole('button'))
      await approved
    })

    expect(approved && (await approved)).toEqual({ status: 'ok', data: 'done' })
    expect(screen.getByTestId('count').textContent).toBe('0')
  })

  it('confirm_hooks_ssr_inert', () => {
    const tm = createToolmark({ dev: true, __environment: 'server' })
    const queue = createConfirmQueue()

    function App(): JSX.Element {
      const { pending } = useConfirmQueue(queue)
      const { items } = usePendingConfirmations()
      return (
        <div>
          {pending === null ? 'null' : 'pending'}:{items.length}
        </div>
      )
    }

    let html = ''
    expect(() => {
      html = renderToString(
        <ToolmarkProvider toolmark={tm}>
          <App />
        </ToolmarkProvider>,
      )
    }).not.toThrow()

    expect(html).toContain('null')
    expect(html).toContain('0')
  })
})
