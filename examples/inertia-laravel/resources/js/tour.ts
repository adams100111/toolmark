import type { Planner, TourStep } from '@toolmark/tour'
import { xsrfToken } from './toolmark'

/** The authored three-step `show` tour of the create form (`?tour=authored`). */
export const authoredCreateTour: TourStep[] = [
  {
    tool: 'challenges.create.fill',
    param: 'title.en',
    title: 'Title',
    text: 'Give the challenge a short English title.',
  },
  {
    tool: 'challenges.create.fill',
    param: 'type',
    title: 'Type',
    text: 'Pick what kind of challenge this is.',
  },
  {
    tool: 'challenges.create.fill',
    param: 'startsAt',
    title: 'Start date',
    text: 'Choose the day the challenge starts.',
  },
]

/**
 * A planner backed by the server (`POST /tour/plan`, a scripted planner in this example). The page
 * sends the goal and the tools visible to caller `tour`; the engine re-validates the steps.
 */
export const serverPlanner: Planner = {
  async plan(ctx) {
    const response = await fetch('/tour/plan', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'X-XSRF-TOKEN': xsrfToken(),
      },
      credentials: 'same-origin',
      body: JSON.stringify({ goal: ctx.goal, tools: ctx.tools }),
      signal: ctx.signal,
    })
    if (!response.ok) throw new Error(`Tour planner failed with status ${response.status}`)
    return (await response.json()) as TourStep[]
  },
}
