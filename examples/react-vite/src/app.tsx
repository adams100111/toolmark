import { useEffect, useState, type JSX } from 'react'
import type { ConfirmQueue } from '@toolmark/core'
import { useConfirmQueue, usePendingConfirmations } from '@toolmark/react'
import type { Planner } from '@toolmark/tour'
import { ChallengesPage } from './challenge-form.js'
import { PairMcpPanel } from './pair-mcp.js'
import { Routes, ROUTE_HASHES } from './routes.js'
import { TourPanel } from './tour-panel.js'
import { WizardPage } from './wizard.js'

/** Renders every pending deferred confirmation as a card with Approve / Reject. */
function ConfirmCards(): JSX.Element | null {
  const { items, approve, reject } = usePendingConfirmations()
  if (items.length === 0) return null
  return (
    <>
      {items.map((item) => (
        <section
          key={item.confirmId}
          role="dialog"
          aria-label="Confirm action"
          style={{ border: '1px solid', padding: '0.5rem', marginBlock: '0.5rem' }}
        >
          <p>{item.summary}</p>
          {item.changes && item.changes.length > 0 && (
            <ul>
              {item.changes.map((c) => (
                <li key={c.path}>
                  {c.path}: {JSON.stringify(c.after)}
                </li>
              ))}
            </ul>
          )}
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

/**
 * The inline confirm dialog (spec §7): the head of the inline {@link ConfirmQueue} that
 * `createToolmark({ confirm: queue.handler })` uses for inline callers (WebMCP, desktop MCP and
 * tours). The call waits until the user approves or rejects here.
 */
function InlineConfirm(props: { queue: ConfirmQueue }): JSX.Element | null {
  const { pending, approve, reject } = useConfirmQueue(props.queue)
  if (!pending) return null
  return (
    <section
      role="dialog"
      aria-label="Confirm inline action"
      style={{ border: '2px solid', padding: '0.5rem', marginBlock: '0.5rem' }}
    >
      <p>
        {pending.summary} <small>(asked by {pending.caller})</small>
      </p>
      {pending.changes && pending.changes.length > 0 && (
        <ul>
          {pending.changes.map((c) => (
            <li key={c.path}>
              {c.path}: {JSON.stringify(c.after)}
            </li>
          ))}
        </ul>
      )}
      <button type="button" onClick={() => approve()}>
        Approve
      </button>
      <button type="button" onClick={() => reject('rejected by the user')}>
        Reject
      </button>
    </section>
  )
}

/**
 * A `location.hash` switch between the example's pages (no router dependency): `#/wizard` shows
 * the multi-step wizard, `#/routes/a` and `#/routes/b` the navigation routes, anything else the
 * challenges form.
 */
function useHashRoute(): string {
  const [hash, setHash] = useState(() => window.location.hash)
  useEffect(() => {
    const onHashChange = (): void => setHash(window.location.hash)
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])
  return hash
}

/**
 * The example app: the current page (by hash), the guided-tour panel over the challenge form, the
 * inline confirm dialog, the confirm cards of pending (deferred) agent actions and the "Pair with
 * desktop MCP" panel.
 * @param props.confirmQueue - The inline confirmation queue passed to `createToolmark`.
 * @param props.planner - The agent tour planner (relay pages only).
 */
export function App(props: { confirmQueue: ConfirmQueue; planner?: Planner }): JSX.Element {
  const hash = useHashRoute()
  const isRoute = (ROUTE_HASHES as readonly string[]).includes(hash)
  return (
    <main>
      {hash === '#/wizard' ? (
        <WizardPage />
      ) : isRoute ? (
        <Routes hash={hash} />
      ) : (
        <>
          <ChallengesPage />
          <TourPanel {...(props.planner ? { planner: props.planner } : {})} />
        </>
      )}
      <InlineConfirm queue={props.confirmQueue} />
      <ConfirmCards />
      <PairMcpPanel />
    </main>
  )
}
