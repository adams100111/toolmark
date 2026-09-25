import { useEffect, useState, type JSX } from 'react'
import { usePendingConfirmations } from '@toolmark/react'
import { ChallengesPage } from './challenge-form.js'
import { PairMcpPanel } from './pair-mcp.js'
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
 * A `location.hash` switch between the example's pages (no router dependency): `#/wizard` shows
 * the multi-step wizard, anything else shows the challenges form.
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
 * The example app: the current page (by hash), the confirm cards of pending agent actions and the
 * "Pair with desktop MCP" panel.
 */
export function App(): JSX.Element {
  const hash = useHashRoute()
  return (
    <main>
      {hash === '#/wizard' ? <WizardPage /> : <ChallengesPage />}
      <ConfirmCards />
      <PairMcpPanel />
    </main>
  )
}
