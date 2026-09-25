import type { InPageAgent } from '@toolmark/core/bridge'
import type { AgentToPageMessage, PageToAgentMessage } from '@toolmark/core/protocol'

type ManifestMessage = Extract<PageToAgentMessage, { type: 'manifest' }>
type ConfirmedMessage = Extract<PageToAgentMessage, { type: 'confirmed' }>
type ResultMessage = Extract<PageToAgentMessage, { type: 'result' }>

/** How long a turn waits for its replies (and `waitForConfirmed` for its message), in ms. */
const REPLY_TIMEOUT_MS = 10_000

/**
 * A scripted agent (no LLM) on the agent side of an in-page channel. Tests drive it; a real app
 * would put a client-side LLM loop here.
 */
export interface ScriptedAgent {
  /** The latest `manifest` received (the attach manifest, then one per registry revision). */
  readonly manifest: ManifestMessage | undefined
  /** Every `confirmed` message received, in arrival order. */
  readonly confirmed: ConfirmedMessage[]
  /**
   * One agent turn: sends every message, then awaits one `result` per `call`/`describe` id.
   * @returns The replies, in the order of the messages that asked for them.
   */
  turn(messages: AgentToPageMessage[]): Promise<PageToAgentMessage[]>
  /** Resolves with the `confirmed` message of `confirmId` (already received or still to come). */
  waitForConfirmed(confirmId: string, timeoutMs?: number): Promise<ConfirmedMessage>
}

declare global {
  /** Test-only: the example's scripted agent (installed outside production builds). */
  var __toolmark_agent__: ScriptedAgent | undefined
}

/**
 * Creates the scripted agent over `channel`. Subscribe it before `tm.use(bridge(...))` so it
 * receives the attach `manifest`.
 * @param channel - The `agent` handle of `createInPageChannel()`.
 */
export function createScriptedAgent(channel: InPageAgent): ScriptedAgent {
  let manifest: ManifestMessage | undefined
  const confirmed: ConfirmedMessage[] = []
  const waitingResults = new Map<string, (message: ResultMessage) => void>()
  const waitingConfirms = new Map<string, (message: ConfirmedMessage) => void>()

  channel.onMessage((message) => {
    switch (message.type) {
      case 'manifest':
        manifest = message
        return
      case 'result':
        waitingResults.get(message.id)?.(message)
        waitingResults.delete(message.id)
        return
      case 'confirmed':
        confirmed.push(message)
        waitingConfirms.get(message.confirmId)?.(message)
        waitingConfirms.delete(message.confirmId)
        return
      default:
        return
    }
  })

  const withTimeout = <T>(
    register: (resolve: (value: T) => void) => void,
    what: string,
    timeoutMs: number,
  ): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${what}`)), timeoutMs)
      register((value) => {
        clearTimeout(timer)
        resolve(value)
      })
    })

  return {
    get manifest() {
      return manifest
    },
    confirmed,
    async turn(messages) {
      const replies = messages
        .filter((m) => m.type === 'call' || m.type === 'describe')
        .map((m) =>
          withTimeout<ResultMessage>(
            (resolve) => waitingResults.set(m.id, resolve),
            `the result of "${m.id}"`,
            REPLY_TIMEOUT_MS,
          ),
        )
      for (const message of messages) channel.send(message)
      return Promise.all(replies)
    },
    waitForConfirmed(confirmId, timeoutMs = REPLY_TIMEOUT_MS) {
      const seen = confirmed.find((m) => m.confirmId === confirmId)
      if (seen) return Promise.resolve(seen)
      return withTimeout<ConfirmedMessage>(
        (resolve) => waitingConfirms.set(confirmId, resolve),
        `the confirmation of "${confirmId}"`,
        timeoutMs,
      )
    },
  }
}
