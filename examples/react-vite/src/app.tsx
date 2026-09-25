import type { JSX } from 'react'
import { usePendingConfirmations } from '@toolmark/react'
import { ChallengesPage } from './challenge-form.js'
import { PairMcpPanel } from './pair-mcp.js'

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
 * The example app: the challenges page, the confirm cards of pending agent actions and the
 * "Pair with desktop MCP" panel.
 */
export function App(): JSX.Element {
  return (
    <main>
      <ChallengesPage />
      <ConfirmCards />
      <PairMcpPanel />
    </main>
  )
}
