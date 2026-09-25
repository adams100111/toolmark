import { useMemo, useRef, useState, type JSX } from 'react'
import {
  useFieldArray,
  useForm,
  type FieldErrors,
  type FieldValues,
  type Resolver,
} from 'react-hook-form'
import { z } from 'zod'
import { ok, type FormAdapter, type WizardStep } from '@toolmark/core'
import { ToolScope, useWizardTool } from '@toolmark/react'
import { rhfAdapter } from '@toolmark/react/rhf'

const categories = ['research', 'partnership', 'community'] as const

const basicsSchema = z.object({
  title: z.string().min(1).describe('Event title'),
  category: z.enum(categories).describe('Event category'),
})
const scheduleSchema = z.object({
  startsAt: z.iso.date().describe('Start date, YYYY-MM-DD'),
  endsAt: z.iso.date().describe('End date, YYYY-MM-DD'),
})
const peopleSchema = z.object({
  ownerId: z
    .string()
    .min(1)
    .describe('Owner user id (call events.create.options to search by name)'),
  reviewers: z.array(z.object({ name: z.string().min(1) })).describe('Reviewers'),
})

type Basics = z.infer<typeof basicsSchema>
type Schedule = z.infer<typeof scheduleSchema>
type People = z.infer<typeof peopleSchema>

/** One values object per wizard step, keyed by step name — the wizard's parent `data` shape. */
interface EventData {
  basics: Basics
  schedule: Schedule
  people: People
}

type StepName = 'basics' | 'schedule' | 'people'
const STEP_ORDER: StepName[] = ['basics', 'schedule', 'people']

/** A minimal zod resolver for react-hook-form (the example declares no resolver package). */
function makeResolver<T extends FieldValues>(schema: z.ZodType<T>): Resolver<T> {
  return (values) => {
    const parsed = schema.safeParse(values)
    if (parsed.success) return { values: parsed.data, errors: {} }
    const errors: Record<string, unknown> = {}
    for (const issue of parsed.error.issues) {
      let node = errors
      const path = issue.path.map(String)
      path.forEach((key, i) => {
        if (i === path.length - 1) node[key] ??= { type: issue.code, message: issue.message }
        else node = (node[key] ??= {}) as Record<string, unknown>
      })
    }
    return { values: {}, errors: errors as FieldErrors<T> }
  }
}

function elementFor(path: string): Element | null {
  return document.querySelector(`[name="${CSS.escape(path)}"]`)
}

/** A fixed in-memory directory the `people.ownerId` options provider searches. */
const PEOPLE: Array<{ id: string; name: string }> = [
  { id: 'ada-lovelace', name: 'Ada Lovelace' },
  { id: 'alan-turing', name: 'Alan Turing' },
  { id: 'grace-hopper', name: 'Grace Hopper' },
  { id: 'katherine-johnson', name: 'Katherine Johnson' },
  { id: 'margaret-hamilton', name: 'Margaret Hamilton' },
  { id: 'tim-berners-lee', name: 'Tim Berners-Lee' },
  { id: 'linus-torvalds', name: 'Linus Torvalds' },
  { id: 'barbara-liskov', name: 'Barbara Liskov' },
  { id: 'donald-knuth', name: 'Donald Knuth' },
  { id: 'edsger-dijkstra', name: 'Edsger Dijkstra' },
  { id: 'radia-perlman', name: 'Radia Perlman' },
  { id: 'vint-cerf', name: 'Vint Cerf' },
  { id: 'shafi-goldwasser', name: 'Shafi Goldwasser' },
  { id: 'john-mccarthy', name: 'John McCarthy' },
  { id: 'frances-allen', name: 'Frances Allen' },
  { id: 'ken-thompson', name: 'Ken Thompson' },
  { id: 'dennis-ritchie', name: 'Dennis Ritchie' },
  { id: 'anita-borg', name: 'Anita Borg' },
  { id: 'guido-van-rossum', name: 'Guido van Rossum' },
  { id: 'hedy-lamarr', name: 'Hedy Lamarr' },
]

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason as Error)
      return
    }
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(signal.reason as Error)
      },
      { once: true },
    )
  })
}

/** `people.ownerId`'s async options provider: a 50ms lookup over an in-memory directory. */
async function ownerOptions({
  query,
  signal,
}: {
  query: string
  signal: AbortSignal
}): Promise<Array<{ value: string; title: string }>> {
  await delay(50, signal)
  const q = query.trim().toLowerCase()
  const matches = q === '' ? PEOPLE : PEOPLE.filter((p) => p.name.toLowerCase().includes(q))
  return matches.map((p) => ({ value: p.id, title: p.name }))
}

const initialData: EventData = {
  basics: { title: '', category: categories[0] },
  schedule: { startsAt: '', endsAt: '' },
  people: { ownerId: '', reviewers: [] },
}

/** The wizard's steps: `basics`, `schedule`, `people` (async `ownerId` options). Module-level so
 * their identity is stable across renders (no unnecessary wizard re-registration). */
const WIZARD_STEPS: WizardStep[] = [
  { name: 'basics', title: 'Basics', input: basicsSchema },
  { name: 'schedule', title: 'Schedule', input: scheduleSchema },
  { name: 'people', title: 'People', input: peopleSchema, options: { ownerId: ownerOptions } },
]

/** The wizard page: registers `events.create.*` under `<ToolScope name="events">`. */
export function WizardPage(): JSX.Element {
  return (
    <ToolScope name="events">
      <EventWizard />
    </ToolScope>
  )
}

function EventWizard(): JSX.Element {
  const [current, setCurrent] = useState<StepName>('basics')
  const [data, setData] = useState<EventData>(initialData)
  const [created, setCreated] = useState<EventData[]>([])
  // Mirrors `data` synchronously (React state updates are not visible until the next render), so
  // `submit`/`syncCurrentToData` always read the latest merged values, even right after a `setData`
  // call in the same tick (matches `useWizardTool`'s own internal `dataRef` pattern).
  const dataRef = useRef(data)

  const setDataBoth = (next: EventData): void => {
    dataRef.current = next
    setData(next)
  }

  const basicsForm = useForm<Basics>({
    defaultValues: initialData.basics,
    resolver: makeResolver(basicsSchema),
  })
  const scheduleForm = useForm<Schedule>({
    defaultValues: initialData.schedule,
    resolver: makeResolver(scheduleSchema),
  })
  const peopleForm = useForm<People>({
    defaultValues: initialData.people,
    resolver: makeResolver(peopleSchema),
  })
  const reviewers = useFieldArray({ control: peopleForm.control, name: 'reviewers' })

  const basicsAdapter = useMemo(
    () => rhfAdapter(basicsForm, { onSubmit: () => ({}), elementFor }),
    [basicsForm],
  )
  const scheduleAdapter = useMemo(
    () => rhfAdapter(scheduleForm, { onSubmit: () => ({}), elementFor }),
    [scheduleForm],
  )
  const peopleAdapter = useMemo(
    () => rhfAdapter(peopleForm, { onSubmit: () => ({}), elementFor }),
    [peopleForm],
  )

  const currentAdapter: FormAdapter =
    current === 'basics' ? basicsAdapter : current === 'schedule' ? scheduleAdapter : peopleAdapter

  /**
   * Writes the current step's live form values into `data` (mirrors what `useWizardTool` does
   * around the agent's `goTo`/`submit`), so the app's own Back/Next/Create controls keep `data`
   * (and therefore the next-mounted step, and `submit`) in sync too.
   */
  const syncCurrentToData = (): void => {
    const merged = { ...dataRef.current, [current]: currentAdapter.getValues() } as EventData
    setDataBoth(merged)
  }

  // A step becoming current re-reads its own form from the latest `data` (values another step's
  // fill, or an earlier visit, may have written while this step's form was not the mounted one).
  const applyStep = (step: StepName): void => {
    if (step === 'basics') basicsForm.reset(dataRef.current.basics)
    if (step === 'schedule') scheduleForm.reset(dataRef.current.schedule)
    if (step === 'people') peopleForm.reset(dataRef.current.people)
    setCurrent(step)
  }

  useWizardTool({
    name: 'create',
    description: 'Create an event: basics, a schedule and the people involved.',
    title: 'Create event',
    steps: WIZARD_STEPS,
    // `EventData`'s fixed step keys (`basics`/`schedule`/`people`) don't structurally match the
    // hook's arbitrary-step-name `Record<string, Record<string, unknown>>` shape.
    data: data as unknown as Record<string, Record<string, unknown>>,
    setData: (next) => setDataBoth(next as unknown as EventData),
    current,
    // `useWizardTool` already writes the mounted current step into `data` (via `setData`) right
    // before calling this, so `dataRef.current` is up to date by the time `applyStep` runs.
    goTo: (step) => applyStep(step as StepName),
    currentAdapter,
    submit: () => {
      setCreated((list) => [...list, dataRef.current])
      return Promise.resolve(ok({}))
    },
    // `d` (core's `getData()`) only reflects the mounted current step once it has been synced
    // into `data` (on `goTo`/`submit`, i.e. after this summary is shown) — read the live current
    // adapter directly instead, so the confirmation text is right even for the current step.
    submitSummary: () => {
      const merged = { ...dataRef.current, [current]: currentAdapter.getValues() } as EventData
      return `Create event "${merged.basics.title}"`
    },
  })

  // The app's own Back/Next controls bypass the wizard tool call, so they sync explicitly first.
  const goTo = (step: StepName): void => {
    syncCurrentToData()
    applyStep(step)
  }

  const idx = STEP_ORDER.indexOf(current)
  const goNext = (): void => {
    const next = STEP_ORDER[idx + 1]
    if (next) goTo(next)
  }
  const goPrevious = (): void => {
    const prev = STEP_ORDER[idx - 1]
    if (prev) goTo(prev)
  }
  const handleCreate = (): void => {
    syncCurrentToData()
    setCreated((list) => [...list, dataRef.current])
  }

  return (
    <section aria-label="Create event wizard">
      <h1>Create event</h1>
      <p data-testid="wizard-step">{current}</p>
      {current === 'basics' && (
        <form aria-label="Basics" onSubmit={(e) => e.preventDefault()}>
          <label>
            Title
            <input {...basicsForm.register('title')} />
          </label>
          <label>
            Category
            <select {...basicsForm.register('category')}>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        </form>
      )}
      {current === 'schedule' && (
        <form aria-label="Schedule" onSubmit={(e) => e.preventDefault()}>
          <label>
            Starts at
            <input type="date" {...scheduleForm.register('startsAt')} />
          </label>
          <label>
            Ends at
            <input type="date" {...scheduleForm.register('endsAt')} />
          </label>
        </form>
      )}
      {current === 'people' && (
        <form aria-label="People" onSubmit={(e) => e.preventDefault()}>
          <label>
            Owner id
            <input {...peopleForm.register('ownerId')} />
          </label>
          <fieldset>
            <legend>Reviewers</legend>
            {reviewers.fields.map((field, i) => (
              <label key={field.id}>
                Reviewer {i + 1}
                <input {...peopleForm.register(`reviewers.${i}.name` as const)} />
              </label>
            ))}
            <button type="button" onClick={() => reviewers.append({ name: '' })}>
              Add reviewer
            </button>
          </fieldset>
        </form>
      )}
      <nav>
        <button type="button" onClick={goPrevious} disabled={current === 'basics'}>
          Back
        </button>
        {current === 'people' ? (
          <button type="button" onClick={handleCreate}>
            Create event
          </button>
        ) : (
          <button type="button" onClick={goNext}>
            Next
          </button>
        )}
      </nav>
      <h2>Created</h2>
      <ul data-testid="events-created">
        {created.map((e, i) => (
          <li key={i}>
            {e.basics.title} ({e.basics.category}), {e.schedule.startsAt}–{e.schedule.endsAt}, owner{' '}
            {e.people.ownerId}, reviewers: {e.people.reviewers.map((r) => r.name).join(', ')}
          </li>
        ))}
      </ul>
    </section>
  )
}
