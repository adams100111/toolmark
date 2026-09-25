import { createToolmark } from '@toolmark/core'
import { bridge } from '@toolmark/core/bridge'
import { echoTransport } from '@toolmark/core/bridge/echo'

// Laravel reference §1 (page wiring).

export const xsrfToken = (): string =>
  decodeURIComponent(document.cookie.match(/(?:^|; )XSRF-TOKEN=([^;]*)/)?.[1] ?? '')

export const toolmark = createToolmark({ dev: import.meta.env.DEV })

export function attachBridge(userId: number, conversationId: string): () => void {
  return toolmark.use(
    bridge({
      transport: echoTransport({
        echo: window.Echo,
        channel: `toolmark.${userId}.${conversationId}`, // echo.private(...) → private-toolmark.…
        postUrl: `/toolmark/bridge/${encodeURIComponent(conversationId)}`, // same origin
        headers: () => ({ 'X-XSRF-TOKEN': xsrfToken() }), // Laravel CSRF
      }),
    }),
  )
}

/** The shared `agent` prop: which conversation's private channel this page joins. */
export interface AgentProp {
  userId: number
  conversationId: string | null
}

type BridgeStatus = 'idle' | 'connecting' | 'connected'
let status: BridgeStatus = 'idle'
const listeners = new Set<() => void>()

/** Bridge status for the UI (`useSyncExternalStore`). */
export const bridgeStatus = {
  get: (): BridgeStatus => status,
  subscribe(fn: () => void): () => void {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },
}

function setStatus(next: BridgeStatus): void {
  status = next
  for (const fn of [...listeners]) fn()
}

/**
 * Attaches the bridge once the private channel is subscribed, so the first `manifest` (which tells
 * the server a page is connected) never races the channel authorization.
 */
export function connectAgent(agent: AgentProp | null | undefined): void {
  if (status !== 'idle' || !agent || agent.conversationId === null) return
  const { userId, conversationId } = agent
  setStatus('connecting')
  window.Echo.private(`toolmark.${userId}.${conversationId}`).subscribed(() => {
    if (status === 'connected') return // a reconnect re-fires `subscribed`
    attachBridge(userId, conversationId)
    setStatus('connected')
  })
}
