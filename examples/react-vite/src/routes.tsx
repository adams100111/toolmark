import { useState, type JSX } from 'react'
import { z } from 'zod'
import { invalid, ok } from '@toolmark/core'
import { ToolScope, useTool } from '@toolmark/react'

const NOTES = [
  { id: 'n1', title: 'Roadmap review' },
  { id: 'n2', title: 'Hackathon retro' },
  { id: 'n3', title: 'Workshop agenda' },
]

const REMINDERS = [
  { id: 'r1', text: 'Send the workshop invites', due: 'today' },
  { id: 'r2', text: 'Book the hackathon venue', due: 'week' },
]

// Module-level schemas keep their identity across renders (no re-registration churn).
const searchInput = z.object({
  query: z.string().describe('Words to look for in note titles'),
})
const openInput = z.object({
  id: z.string().describe('Id of the note to open, e.g. "n1"'),
})
const listInput = z.object({
  due: z.enum(['today', 'week', 'all']).describe('Which reminders to list, by due date'),
})
const snoozeInput = z.object({
  id: z.string().describe('Id of the reminder to snooze, e.g. "r1"'),
  minutes: z.number().int().min(5).max(1440).describe('How long to snooze it, in minutes'),
})
const READ_ONLY = { readOnly: true } as const

/** Route A: registers `notes.search` and `notes.open`. */
function NotesRoute(): JSX.Element {
  const [open, setOpen] = useState<string | null>(null)
  useTool({
    name: 'search',
    title: 'Search notes',
    description: 'Search the notes by words in their title.',
    input: searchInput,
    hints: READ_ONLY,
    run: ({ query }) =>
      ok({ notes: NOTES.filter((n) => n.title.toLowerCase().includes(query.toLowerCase())) }),
  })
  useTool({
    name: 'open',
    title: 'Open note',
    description: 'Open one note by its id and show it on the page.',
    input: openInput,
    hints: READ_ONLY,
    run: ({ id }) => {
      const note = NOTES.find((n) => n.id === id)
      if (!note) return invalid([{ path: 'id', message: `No note "${id}"` }])
      setOpen(note.id)
      return ok(note)
    },
  })
  return (
    <section aria-label="Notes">
      <h1>Notes</h1>
      <ul>
        {NOTES.map((n) => (
          <li key={n.id} aria-current={open === n.id ? 'true' : undefined}>
            {n.title}
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Route B: registers `reminders.list` and `reminders.snooze`. */
function RemindersRoute(): JSX.Element {
  const [snoozed, setSnoozed] = useState<Record<string, number>>({})
  useTool({
    name: 'list',
    title: 'List reminders',
    description: 'List the reminders that are due today, this week or at any time.',
    input: listInput,
    hints: READ_ONLY,
    run: ({ due }) => ok({ reminders: REMINDERS.filter((r) => due === 'all' || r.due === due) }),
  })
  useTool({
    name: 'snooze',
    title: 'Snooze reminder',
    description: 'Snooze one reminder for a number of minutes.',
    input: snoozeInput,
    run: ({ id, minutes }) => {
      if (!REMINDERS.some((r) => r.id === id)) {
        return invalid([{ path: 'id', message: `No reminder "${id}"` }])
      }
      setSnoozed((s) => ({ ...s, [id]: minutes }))
      return ok({ id, minutes })
    },
  })
  return (
    <section aria-label="Reminders">
      <h1>Reminders</h1>
      <ul>
        {REMINDERS.map((r) => (
          <li key={r.id}>
            {r.text}
            {snoozed[r.id] !== undefined && ` (snoozed ${snoozed[r.id]} min)`}
          </li>
        ))}
      </ul>
    </section>
  )
}

/** The hash routes this page handles (`#/routes/a`, `#/routes/b`). */
export const ROUTE_HASHES = ['#/routes/a', '#/routes/b'] as const

/**
 * The navigation example (spec §18): a `location.hash` switch (no router dependency) between two
 * routes, each rendering its own `<ToolScope>` with different tools, so navigating publishes a new
 * manifest.
 * @param props.hash - The current `location.hash`.
 */
export function Routes(props: { hash: string }): JSX.Element {
  return (
    <>
      <nav aria-label="Routes">
        <a href="#/routes/a">Route A</a> · <a href="#/routes/b">Route B</a> ·{' '}
        <a href="#/">Challenges</a>
      </nav>
      {props.hash === '#/routes/b' ? (
        <ToolScope name="reminders">
          <RemindersRoute />
        </ToolScope>
      ) : (
        <ToolScope name="notes">
          <NotesRoute />
        </ToolScope>
      )}
    </>
  )
}
