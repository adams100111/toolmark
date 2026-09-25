import { Link, usePage } from '@inertiajs/react'
import { useSyncExternalStore, type JSX, type ReactNode } from 'react'
import { usePendingConfirmations } from '@toolmark/react'
import { bridgeStatus, toolmark } from './toolmark'

/** Every pending deferred confirmation (e.g. the agent's `challenges.archive`), with Approve/Reject. */
function ConfirmCards(): JSX.Element | null {
  const { items, approve, reject } = usePendingConfirmations()
  if (items.length === 0) return null
  return (
    <>
      {items.map((item) => (
        <section key={item.confirmId} role="dialog" aria-label="Confirm action" className="confirm">
          <p>{item.summary}</p>
          <button type="button" onClick={() => void approve(item.confirmId)}>
            Approve
          </button>
          <button type="button" onClick={() => void reject(item.confirmId)}>
            Reject
          </button>
        </section>
      ))}
    </>
  )
}

/** Shared chrome: navigation, the page's Toolmark `clientId`, flash messages and confirmations. */
export function Layout(props: { title: string; children: ReactNode }): JSX.Element {
  const { flash, agent } = usePage<{
    flash: { status: string | null }
    agent: { conversationId: string | null } | null
  }>().props
  const bridge = useSyncExternalStore(bridgeStatus.subscribe, bridgeStatus.get)
  return (
    <>
      <header>
        <nav aria-label="Main">
          <Link href="/challenges">Challenges</Link> ·{' '}
          <Link href="/challenges/create">New challenge</Link> ·{' '}
          <Link href="/wizard">Team wizard</Link> · <Link href="/feedback">Feedback</Link>
        </nav>
        <p>
          Page client{' '}
          <output
            data-testid="toolmark-client-id"
            data-bridge={bridge}
            data-conversation-id={agent?.conversationId ?? ''}
          >
            {toolmark.clientId}
          </output>
        </p>
      </header>
      <main>
        <h1>{props.title}</h1>
        {flash.status && <p role="status">{flash.status}</p>}
        <ConfirmCards />
        {props.children}
      </main>
    </>
  )
}
