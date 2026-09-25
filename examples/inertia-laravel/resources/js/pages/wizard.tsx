import { router } from '@inertiajs/react'
import { useState, type JSX } from 'react'
import { z } from 'zod'
import { ok, type ToolResult, type WizardStep } from '@toolmark/core'
import { useWizardTool } from '@toolmark/react'
import { Layout } from '@/layout'
import { store } from '@/routes/wizard'

type Data = Record<string, Record<string, unknown>>

const steps: WizardStep[] = [
  {
    name: 'team',
    title: 'Team',
    input: z.object({
      name: z.string().min(1).describe('Team name'),
      size: z.number().int().min(1).max(20).describe('Number of team members, 1 to 20'),
    }),
  },
  {
    name: 'schedule',
    title: 'Schedule',
    input: z.object({
      startsAt: z.iso.date().describe('First day, YYYY-MM-DD'),
      days: z.number().int().min(1).max(14).describe('Number of days, 1 to 14'),
    }),
  },
  {
    name: 'contact',
    title: 'Contact',
    input: z.object({ email: z.email().describe('Contact e-mail address of the team') }),
  },
]

const empty: Data = {
  team: { name: '', size: 1 },
  schedule: { startsAt: '', days: 1 },
  contact: { email: '' },
}

function submitWizard(data: Data): Promise<ToolResult<unknown>> {
  return new Promise((resolve) => {
    router.post(store.url(), data as never, {
      onSuccess: () => resolve(ok({})),
      onError: (errors) =>
        resolve({
          status: 'invalid',
          issues: Object.entries(errors).map(([path, message]) => ({
            path,
            message: String(message),
          })),
        }),
    })
  })
}

function Field(props: {
  label: string
  step: string
  name: string
  type?: 'text' | 'number' | 'date' | 'email'
  data: Data
  onChange: (step: string, name: string, value: unknown) => void
}): JSX.Element {
  const value = props.data[props.step]?.[props.name]
  const type = props.type ?? 'text'
  return (
    <p>
      <label>
        {props.label}{' '}
        <input
          name={`${props.step}.${props.name}`}
          type={type}
          value={value === undefined || value === null ? '' : String(value)}
          onChange={(e) =>
            props.onChange(
              props.step,
              props.name,
              type === 'number' ? Number(e.target.value) : e.target.value,
            )
          }
        />
      </label>
    </p>
  )
}

/**
 * A three-step wizard in parent-state mode: `onboarding.fill` fills every step in one call,
 * `onboarding.goTo` moves between steps, `onboarding.submit` registers the team (consequential).
 */
export default function Wizard(): JSX.Element {
  const [data, setData] = useState<Data>(empty)
  const [current, setCurrent] = useState('team')

  useWizardTool({
    name: 'onboarding',
    title: 'Register a team',
    description: 'Register a team for the next challenge: team, schedule and contact steps.',
    steps,
    data,
    setData,
    current,
    goTo: setCurrent,
    submit: submitWizard,
    submitSummary: (d) => `Register team "${String(d.team?.name ?? '')}"`,
  })

  const index = steps.findIndex((s) => s.name === current)
  const onChange = (step: string, name: string, value: unknown): void =>
    setData((d) => ({ ...d, [step]: { ...d[step], [name]: value } }))

  return (
    <Layout title="Team wizard">
      <p data-testid="wizard-step">
        Step {index + 1} of {steps.length}: {steps[index]?.title}
      </p>
      <form
        aria-label="Team wizard"
        onSubmit={(e) => {
          e.preventDefault()
          void submitWizard(data)
        }}
      >
        {current === 'team' && (
          <>
            <Field label="Team name" step="team" name="name" data={data} onChange={onChange} />
            <Field
              label="Team size"
              step="team"
              name="size"
              type="number"
              data={data}
              onChange={onChange}
            />
          </>
        )}
        {current === 'schedule' && (
          <>
            <Field
              label="First day"
              step="schedule"
              name="startsAt"
              type="date"
              data={data}
              onChange={onChange}
            />
            <Field
              label="Days"
              step="schedule"
              name="days"
              type="number"
              data={data}
              onChange={onChange}
            />
          </>
        )}
        {current === 'contact' && (
          <Field
            label="Contact e-mail"
            step="contact"
            name="email"
            type="email"
            data={data}
            onChange={onChange}
          />
        )}
        <p>
          <button
            type="button"
            disabled={index === 0}
            onClick={() => setCurrent(steps[index - 1]!.name)}
          >
            Back
          </button>{' '}
          {index < steps.length - 1 ? (
            <button type="button" onClick={() => setCurrent(steps[index + 1]!.name)}>
              Next
            </button>
          ) : (
            <button type="submit">Register team</button>
          )}
        </p>
      </form>
    </Layout>
  )
}
