import { router } from '@inertiajs/react'
import { useEffect, type JSX } from 'react'
import { useForm, type FieldErrors, type Resolver } from 'react-hook-form'
import { z } from 'zod'
import { ToolScope, useFormTool, useToolmark } from '@toolmark/react'
import { rhfAdapter } from '@toolmark/react/rhf'
import { startTour } from '@toolmark/tour'
import { mountTourOverlay } from '@toolmark/tour/overlay'
import { Layout } from '@/layout'
import { store } from '@/routes/challenges'
import { authoredCreateTour, serverPlanner } from '@/tour'

const challengeTypes = ['workshop', 'hackathon', 'competition'] as const

const challengeSchema = z.object({
  title: z.object({
    en: z.string().min(1).describe('Title in English'),
    ar: z.string().min(1).describe('Title in Arabic'),
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

/** Posts the new challenge as an Inertia visit and settles when the server answered. */
function createChallenge(values: ChallengeValues): Promise<{ created: true }> {
  return new Promise((resolve, reject) => {
    router.post(store.url(), values, {
      onSuccess: () => resolve({ created: true }),
      onError: () => reject(new Error('The server rejected the challenge')),
    })
  })
}

/** `?tour=authored` or `?tour=planned`: runs a `show` tour over this form's fill tool. */
function useCreateTour(): void {
  const tm = useToolmark()
  useEffect(() => {
    const which = new URLSearchParams(window.location.search).get('tour')
    if (which !== 'authored' && which !== 'planned') return
    const abort = new AbortController()
    let unmount: (() => void) | undefined
    void startTour(
      tm,
      which === 'authored'
        ? { mode: 'show', steps: authoredCreateTour, signal: abort.signal }
        : {
            mode: 'show',
            goal: 'Create a challenge',
            planner: serverPlanner,
            signal: abort.signal,
          },
    ).then(
      (tour) => {
        if (abort.signal.aborted) return tour.stop()
        unmount = mountTourOverlay(tour)
      },
      (e: unknown) => console.error('Tour could not start', e),
    )
    return () => {
      abort.abort()
      unmount?.()
    }
  }, [tm])
}

function CreateChallengeForm(): JSX.Element {
  const form = useForm<ChallengeValues>({
    defaultValues: { title: { en: '', ar: '' }, type: 'workshop', startsAt: '' },
    resolver,
  })

  useFormTool(rhfAdapter(form, { onSubmit: createChallenge, elementFor }), {
    name: 'create',
    title: 'Create challenge',
    description: 'Create a new challenge (bilingual title, type and start date).',
    input: challengeSchema,
    submitSummary: (values) => `Create challenge "${values.title.en || values.title.ar}"`,
  })
  useCreateTour()

  const { errors } = form.formState
  const onSubmit = form.handleSubmit((values) => createChallenge(values).catch(() => {}))

  return (
    <form onSubmit={(e) => void onSubmit(e)} aria-label="Create challenge">
      <p>
        <label>
          Title (English) <input {...form.register('title.en')} />
        </label>
        {errors.title?.en && <span role="alert">{errors.title.en.message}</span>}
      </p>
      <p>
        <label>
          Title (Arabic) <input dir="rtl" lang="ar" {...form.register('title.ar')} />
        </label>
        {errors.title?.ar && <span role="alert">{errors.title.ar.message}</span>}
      </p>
      <p>
        <label>
          Type{' '}
          <select {...form.register('type')}>
            {challengeTypes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
      </p>
      <p>
        <label>
          Starts at <input type="date" {...form.register('startsAt')} />
        </label>
        {errors.startsAt && <span role="alert">{errors.startsAt.message}</span>}
      </p>
      <button type="submit">Create</button>
    </form>
  )
}

/** Registers `challenges.create.fill` / `challenges.create.submit` (react-hook-form + useFormTool). */
export default function ChallengesCreate(): JSX.Element {
  return (
    <Layout title="New challenge">
      <ToolScope name="challenges">
        <CreateChallengeForm />
      </ToolScope>
    </Layout>
  )
}
