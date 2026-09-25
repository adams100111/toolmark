import { useRef, useState, type JSX } from 'react'
import { useForm, type FieldErrors, type Resolver } from 'react-hook-form'
import { z } from 'zod'
import { ToolScope, useFormTool } from '@toolmark/react'
import { rhfAdapter } from '@toolmark/react/rhf'

const challengeTypes = ['workshop', 'hackathon', 'competition'] as const

/** The challenge form's schema (zod 4; Toolmark reads its Standard JSON Schema). */
export const challengeSchema = z.object({
  title: z.object({
    ar: z.string().min(1).describe('Title in Arabic'),
    en: z.string().min(1).describe('Title in English'),
  }),
  type: z.enum(challengeTypes).describe('Kind of challenge'),
  startsAt: z.iso.date().describe('Start date, YYYY-MM-DD'),
})

type ChallengeValues = z.infer<typeof challengeSchema>

/** A minimal zod resolver for react-hook-form (the example declares no resolver package). */
const resolver: Resolver<ChallengeValues> = (values) => {
  const parsed = challengeSchema.safeParse(values)
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
  return { values: {}, errors: errors as FieldErrors<ChallengeValues> }
}

function elementFor(path: string): Element | null {
  return document.querySelector(`[name="${CSS.escape(path)}"]`)
}

function CreateChallengeForm(props: {
  onCreated: (values: ChallengeValues) => number
}): JSX.Element {
  const form = useForm<ChallengeValues>({
    defaultValues: { title: { ar: '', en: '' }, type: 'workshop', startsAt: '' },
    resolver,
  })

  // `root` adds the user's `focus`/`submit` interaction events (guide-mode tours wait for them).
  const formRef = useRef<HTMLFormElement>(null)
  useFormTool(
    rhfAdapter(form, {
      onSubmit: (values) => ({ id: props.onCreated(values) }),
      elementFor,
      root: () => formRef.current,
    }),
    {
      name: 'create',
      title: 'Create challenge',
      description: 'Create a new challenge (bilingual title, type and start date).',
      input: challengeSchema,
      submitSummary: (values) => `Create challenge "${values.title.en || values.title.ar}"`,
    },
  )

  const { errors } = form.formState
  const submit = form.handleSubmit((values) => {
    props.onCreated(values)
  })

  return (
    <form ref={formRef} onSubmit={(e) => void submit(e)} aria-label="Create challenge">
      <label>
        Title (English)
        <input {...form.register('title.en')} />
      </label>
      {errors.title?.en && <p role="alert">{errors.title.en.message}</p>}
      <label>
        Title (Arabic)
        <input dir="rtl" lang="ar" {...form.register('title.ar')} />
      </label>
      {errors.title?.ar && <p role="alert">{errors.title.ar.message}</p>}
      <label>
        Type
        <select {...form.register('type')}>
          {challengeTypes.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>
      <label>
        Starts at
        <input type="date" {...form.register('startsAt')} />
      </label>
      {errors.startsAt && <p role="alert">{errors.startsAt.message}</p>}
      <button type="submit">Create</button>
    </form>
  )
}

/**
 * The challenges page: registers `challenges.create.fill` / `challenges.create.submit` under
 * `<ToolScope name="challenges">` and lists the challenges created so far.
 */
export function ChallengesPage(): JSX.Element {
  const [created, setCreated] = useState<ChallengeValues[]>([])
  const nextId = useRef(1)
  const onCreated = (values: ChallengeValues): number => {
    setCreated((list) => [...list, values])
    return nextId.current++
  }
  return (
    <ToolScope name="challenges">
      <h1>Challenges</h1>
      <CreateChallengeForm onCreated={onCreated} />
      <h2>Created</h2>
      <ul data-testid="submitted">
        {created.map((c, i) => (
          <li key={i}>
            {c.title.en} / {c.title.ar} — {c.type}, {c.startsAt}
          </li>
        ))}
      </ul>
    </ToolScope>
  )
}
