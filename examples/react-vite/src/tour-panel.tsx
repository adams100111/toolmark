import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import { useToolmark } from '@toolmark/react'
import {
  startTour,
  type Planner,
  type StartTourOptions,
  type Tour,
  type TourEvent,
  type TourMode,
  type TourStep,
} from '@toolmark/tour'
import { mountTourOverlay } from '@toolmark/tour/overlay'
import { useTour } from '@toolmark/tour/react'
import '@toolmark/tour/styles.css'

const FILL = 'challenges.create.fill'
const SUBMIT = 'challenges.create.submit'

/**
 * The authored three-step tour over the challenge form (spec §11.5). Steps name tools and params,
 * never selectors; `input` is used by `do` mode, `waitFor` by `guide` mode.
 */
export const AUTHORED_TOUR: TourStep[] = [
  {
    tool: FILL,
    param: 'title.en',
    title: 'Title',
    text: 'Give the challenge a title in English (and Arabic).',
    input: { title: { en: 'Innovation challenge', ar: 'تحدي الابتكار' } },
  },
  {
    tool: FILL,
    param: 'type',
    title: 'Type',
    text: 'Pick the kind of challenge and its start date.',
    input: { type: 'hackathon', startsAt: '2026-10-01' },
  },
  {
    tool: SUBMIT,
    title: 'Create',
    text: 'Create the challenge. You confirm it before it is saved.',
    waitFor: 'submit',
  },
]

/** The goal handed to the agent's planner. */
const PLANNED_GOAL = 'Create a new challenge'

function describeEvent(e: TourEvent): string {
  switch (e.type) {
    case 'step_entered':
      return `step_entered ${e.index} ${e.step.tool}${e.step.param ? ` ${e.step.param}` : ''}`
    case 'done':
      return 'done'
    default:
      return `${e.type} ${e.step.tool} ${e.reason}`
  }
}

/**
 * The "Guided tour" panel: starts the authored tour in `show`, `guide` and `do` mode, and a tour
 * planned by the agent (`planner`, present on relay pages) in `show` and `do`. Renders the tour
 * with the styled overlay (`mountTourOverlay`) and logs its events.
 * @param props.planner - The agent planner, when the page is on the relay.
 */
export function TourPanel(props: { planner?: Planner }): JSX.Element {
  const tm = useToolmark()
  const [tour, setTour] = useState<Tour | null>(null)
  const [events, setEvents] = useState<string[]>([])
  const [highlights, setHighlights] = useState<string[]>([])
  const [failure, setFailure] = useState<string | null>(null)
  const state = useTour(tour)
  const current = useRef<{ tour: Tour; unmount: () => void; off: () => void } | null>(null)

  const start = useCallback(
    async (o: StartTourOptions): Promise<void> => {
      if (current.current) {
        current.current.off()
        current.current.unmount()
        current.current.tour.stop()
        current.current = null
      }
      setEvents([])
      setHighlights([])
      setFailure(null)
      let next: Tour
      try {
        next = await startTour(tm, o)
      } catch (e) {
        setFailure(e instanceof Error ? e.message : String(e))
        return
      }
      const offEvents = next.on((e) => setEvents((list) => [...list, describeEvent(e)]))
      // Log each `do` highlight by its field name (the overlay's spotlight follows it).
      const offState = next.subscribe((s) => {
        const name = s.highlight?.getAttribute('name')
        if (name) setHighlights((list) => (list.at(-1) === name ? list : [...list, name]))
      })
      const unmount = mountTourOverlay(next)
      current.current = {
        tour: next,
        unmount,
        off: () => {
          offEvents()
          offState()
        },
      }
      setTour(next)
    },
    [tm],
  )

  useEffect(
    () => () => {
      current.current?.off()
      current.current?.unmount()
      current.current?.tour.stop()
      current.current = null
    },
    [],
  )

  // Test-only: lets the e2e specs start a tour through this panel (same overlay and event log).
  useEffect(() => {
    if (import.meta.env.MODE === 'production') return undefined
    const hook = globalThis.__example
    if (!hook) return undefined
    hook.startTour = (o) => start(o)
    return () => {
      delete hook.startTour
    }
  }, [start])

  const authored = (mode: TourMode) => () => void start({ mode, steps: AUTHORED_TOUR })
  const planned = (mode: TourMode) => () => {
    if (props.planner) void start({ mode, goal: PLANNED_GOAL, planner: props.planner })
  }

  return (
    <section aria-label="Guided tour" style={{ borderTop: '1px solid', marginTop: '1rem' }}>
      <h2>Guided tour</h2>
      <p>
        <button type="button" onClick={authored('show')}>
          Show tour
        </button>{' '}
        <button type="button" onClick={authored('guide')}>
          Guide tour
        </button>{' '}
        <button type="button" onClick={authored('do')}>
          Do tour
        </button>
      </p>
      <p>
        <button type="button" onClick={planned('show')} disabled={!props.planner}>
          Planned tour (show)
        </button>{' '}
        <button type="button" onClick={planned('do')} disabled={!props.planner}>
          Planned tour (do)
        </button>
        {!props.planner && <small> (planned tours need the agent relay)</small>}
      </p>
      <p>
        Status: <output data-testid="tour-status">{state?.status ?? 'idle'}</output>
        {state?.message !== undefined && <> — {state.message}</>}
        {failure !== null && <span role="alert"> Tour failed: {failure}</span>}
      </p>
      <ol data-testid="tour-events" aria-label="Tour events">
        {events.map((e, i) => (
          <li key={i}>{e}</li>
        ))}
      </ol>
      <p>
        Highlighted: <output data-testid="tour-highlights">{highlights.join(', ')}</output>
      </p>
    </section>
  )
}
