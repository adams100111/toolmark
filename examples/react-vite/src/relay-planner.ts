import type { Planner, TourStep } from '@toolmark/tour'

/** How long the planner waits for the agent's plan, in ms. */
const PLAN_TIMEOUT_MS = 15_000

/** Options of {@link relayPlanner}. */
export interface RelayPlannerOptions {
  /** The relay room URL (`ws://127.0.0.1:<port>/<room>`). */
  url: string
  /** This page's registry `clientId`, so the agent knows which tab asks. */
  clientId: string
}

let nextPlanId = 1

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

/**
 * A tour {@link Planner} that asks the agent on the e2e relay (spec §11.5: the planner is
 * app-supplied). It opens its own relay socket per plan and sends
 * `{ kind: 'toolmark-example/plan', id, clientId, goal, mode, tools }`, then resolves the `steps` of
 * the matching `{ kind: 'toolmark-example/plan-result', id, steps }`. This is an app-level side
 * channel, not bridge protocol v1 (which has no plan message). The steps are untrusted: the tour
 * engine validates them against what caller `tour` can see.
 * @param o - The relay room URL and this page's `clientId`.
 */
export function relayPlanner(o: RelayPlannerOptions): Planner {
  return {
    plan(ctx) {
      return new Promise<TourStep[]>((resolve, reject) => {
        const id = `plan-${nextPlanId++}`
        const socket = new WebSocket(o.url)
        let settled = false
        const finish = (fn: () => void): void => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          ctx.signal.removeEventListener('abort', onAbort)
          socket.close()
          fn()
        }
        const timer = setTimeout(
          () => finish(() => reject(new Error('The agent did not answer the plan request'))),
          PLAN_TIMEOUT_MS,
        )
        const onAbort = (): void => finish(() => reject(new Error('Plan request aborted')))
        ctx.signal.addEventListener('abort', onAbort, { once: true })
        socket.addEventListener('open', () => {
          socket.send(
            JSON.stringify({
              kind: 'toolmark-example/plan',
              id,
              clientId: o.clientId,
              goal: ctx.goal,
              mode: ctx.mode,
              tools: ctx.tools,
            }),
          )
        })
        socket.addEventListener('message', (event: MessageEvent) => {
          if (typeof event.data !== 'string') return
          let message: unknown
          try {
            message = JSON.parse(event.data)
          } catch {
            return
          }
          if (!isObj(message) || message.kind !== 'toolmark-example/plan-result') return
          if (message.id !== id) return
          const steps = message.steps
          // Pass the planned array on as-is: the engine validates (and drops) every step.
          finish(() =>
            Array.isArray(steps)
              ? resolve(steps as TourStep[])
              : reject(new TypeError('The agent answered without a steps array')),
          )
        })
        socket.addEventListener('error', () =>
          finish(() => reject(new Error('The relay connection failed'))),
        )
      })
    },
  }
}
