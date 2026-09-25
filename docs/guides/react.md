# React

`@toolmark/react` binds a registry to React ≥ 18.3 (spec §9). Every hook registers in an effect,
is StrictMode-safe and SSR-inert. Codes: [`reference/codes.md`](../reference/codes.md).

```sh
pnpm add @toolmark/core @toolmark/react
```

## `ToolmarkProvider`

Create the registry once, outside render (or in `useState`), and provide it:

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createConfirmQueue, createToolmark } from '@toolmark/core'
import { ToolmarkProvider } from '@toolmark/react'
import { App } from './app'

export const confirmQueue = createConfirmQueue()
const tm = createToolmark({ dev: import.meta.env.DEV, confirm: confirmQueue.handler })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToolmarkProvider toolmark={tm}>
      <App />
    </ToolmarkProvider>
  </StrictMode>,
)
```

`useToolmark()` returns the registry (it throws outside a provider). Attach consumers with
`tm.use(…)`: the bridge, WebMCP, OpenTelemetry, MCP pairing.

## `ToolScope`

Tools registered by the subtree get the scope's path as a name prefix; `when={false}` hides them.

```tsx
import { ToolScope } from '@toolmark/react'

export function ChallengeDialog({ open }: { open: boolean }) {
  return (
    <ToolScope name="challenges" when={open}>
      <ToolScope name="create">
        <CreateChallengeForm /> {/* registers challenges.create.fill / .submit */}
      </ToolScope>
    </ToolScope>
  )
}
```

`useCurrentScope()` returns the enclosing `Scope` (or `undefined` at the root). See
[Scopes](../concepts/scopes.md).

## `useTool`

Registers one tool while the component is mounted.

```tsx
import { ok } from '@toolmark/core'
import { useTool } from '@toolmark/react'
import { z } from 'zod'

const input = z.object({ tab: z.enum(['details', 'members']).describe('Tab to open') })

export function ChallengeTabs() {
  const [tab, setTab] = useState<'details' | 'members'>('details')
  useTool({
    name: 'openTab',
    description: 'Switch the challenge page to another tab.',
    input, // keep schemas at module level: a new identity re-registers the tool
    run: ({ tab }) => {
      setTab(tab)
      return ok({ tab })
    },
  })
  return <Tabs value={tab} onChange={setTab} />
}
```

`run`, `summary` and `state` always see the latest render's closure, so a fresh definition object
every render is fine. The tool re-registers only when `name`, `description`, `title`, `hints`
(shallow) or the `input`/`output`/`jsonSchema` identities change; in development a tool that
re-registers on every render triggers a churn warning.

## `useFormTool` + `rhfAdapter`

Registers `<name>.fill` and `<name>.submit` (consequential) for a form library adapter. The
react-hook-form adapter lives in `@toolmark/react/rhf`.

```tsx
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { useFormTool } from '@toolmark/react'
import { rhfAdapter } from '@toolmark/react/rhf'

const challengeSchema = z.object({
  title: z.string().min(1).describe('Challenge title'),
  startsAt: z.iso.date().describe('Start date, YYYY-MM-DD'),
})
type Challenge = z.infer<typeof challengeSchema>

export function CreateChallengeForm({ save }: { save: (v: Challenge) => Promise<{ id: number }> }) {
  const form = useForm<Challenge>({ defaultValues: { title: '', startsAt: '' } })
  const root = useRef<HTMLFormElement>(null)
  useFormTool(rhfAdapter(form, { onSubmit: save, root: () => root.current }), {
    name: 'create',
    title: 'Create challenge',
    description: 'The new-challenge form. Fill it, then submit to create the challenge.',
    input: challengeSchema,
    submitSummary: (v) => `Create challenge "${v.title}"`,
  })
  return (
    <form ref={root} onSubmit={form.handleSubmit(save)}>
      <input {...form.register('title')} />
      <input type="date" {...form.register('startsAt')} />
    </form>
  )
}
```

`root` (or `elementFor(path)`) gives the adapter the field elements, which enables tour anchors and
element-based redaction (`password`, `cc-*`); without elements, declare sensitive fields in
`sensitive`. Fill rules, arrays and `options`: [Forms](forms.md). Files: [Files](files.md).

## `useWizardTool`

Multi-step forms: in parent-state mode (`data` + `setData`) it registers `<name>.fill`,
`<name>.goTo` and `<name>.submit` over all steps.

```tsx
import { ok } from '@toolmark/core'
import { useWizardTool } from '@toolmark/react'
import { rhfAdapter } from '@toolmark/react/rhf'

export function EventWizard() {
  const [data, setData] = useState({ basics: {}, venue: {} })
  const [current, setCurrent] = useState('basics')
  const form = useForm()
  useWizardTool({
    name: 'event',
    description: 'The new-event wizard.',
    steps, // [{ name: 'basics', input: basicsSchema }, { name: 'venue', input: venueSchema }]
    data,
    setData,
    current,
    goTo: setCurrent,
    currentAdapter: rhfAdapter(form, { onSubmit: () => undefined }),
    submit: async (merged) => {
      await createEvent(merged) // use the argument: it includes the visible step's latest edits
      return ok({})
    },
  })
  return <StepForm step={current} form={form} />
}
```

Stepwise mode, validation and undo: [Wizards](wizards.md).

## Confirmations

**Inline** (WebMCP, MCP, tours; optional for `inapp`): `useConfirmQueue(queue)` subscribes to the
queue passed as `confirm: queue.handler`.

```tsx
import { useConfirmQueue } from '@toolmark/react'
import { confirmQueue } from './main'

export function InlineConfirm() {
  const { pending, approve, reject } = useConfirmQueue(confirmQueue)
  if (!pending) return null
  return (
    <dialog open aria-label="Confirm action">
      <p>{pending.summary}</p>
      <button onClick={() => approve()}>Approve</button>
      <button onClick={() => reject('declined')}>Reject</button>
    </dialog>
  )
}
```

**Deferred** (`inapp` default): `usePendingConfirmations()` lists `needs_confirmation` calls and
answers them; the tool then runs as caller `human`.

```tsx
import { usePendingConfirmations } from '@toolmark/react'

export function PendingCards() {
  const { items, approve, reject } = usePendingConfirmations()
  return items.map((p) => (
    <article key={p.confirmId}>
      <p>{p.summary}</p>
      <button onClick={() => void approve(p.confirmId)}>Approve</button>
      <button onClick={() => void reject(p.confirmId, 'declined')}>Reject</button>
    </article>
  ))
}
```

See [Confirmation modes](../concepts/confirmation.md).

## `useAgentActivity`

A live list of in-flight calls, for a "the agent is working" indicator.

```tsx
import { useAgentActivity } from '@toolmark/react'

export function AgentBusy() {
  const { active } = useAgentActivity()
  const agentCalls = active.filter((c) => c.caller !== 'human')
  return agentCalls.length > 0 ? <p role="status">Agent is using {agentCalls[0]!.tool}…</p> : null
}
```

## `useToolAnchor`

Points a tool (or one of its params) at a custom widget for [tours](tours.md): the returned ref
callback sets `tm.setAnchor(tool, param, el)` and clears it on detach.

```tsx
import { useToolAnchor } from '@toolmark/react'

export function ZoomableChart() {
  return <canvas ref={useToolAnchor('chart.zoom', 'level')} />
}
```

Anchor each `(tool, param)` from one component only. Form adapters supply anchors for their fields
automatically. See [Anchors and state](anchors.md).

## `useTour`

`@toolmark/tour/react` renders a tour headlessly: `useTour(tour)` returns the current
`TourState` (or `null`).

```tsx
import { startTour, type Tour } from '@toolmark/tour'
import { useTour } from '@toolmark/tour/react'
import { useToolmark } from '@toolmark/react'

export function TourCallout() {
  const tm = useToolmark()
  const [tour, setTour] = useState<Tour | null>(null)
  const state = useTour(tour)
  const start = async () =>
    setTour(
      await startTour(tm, {
        mode: 'show',
        steps: [{ tool: 'challenges.create.fill', param: 'title', text: 'Name your challenge' }],
      }),
    )
  if (!state || state.status === 'done' || state.status === 'stopped') {
    return <button onClick={() => void start()}>Show me how</button>
  }
  return (
    <aside role="dialog" aria-label="Tour">
      <p>{state.steps[state.index]?.text}</p>
      <button onClick={() => void tour?.next()}>Next</button>
      <button onClick={() => tour?.stop()}>Close</button>
    </aside>
  )
}
```

The styled overlay, planners and modes: [Tours](tours.md).

## StrictMode and SSR

- **StrictMode.** Registration happens in effects; the dev-only double mount/unmount leaves
  exactly one live registration per tool. `ToolScope` re-creates its scope after a simulated
  unmount and re-renders its subtree, and `useToolAnchor` keeps its callback identity on React 18
  and 19.
- **Stable identities.** Hooks read callbacks through refs, so inline closures never force
  re-registration; schemas (`input`) should be module-level constants.
- **SSR.** On the server there is no `document`: the registry is inert, hooks register nothing and
  the confirmation/activity hooks return frozen empty snapshots. See [Next.js](nextjs.md).
- **Development flag.** Hooks follow the registry's `dev` flag, not the bundler's environment.

API: [`@toolmark/react`](../api/@toolmark/react/index.md),
[`@toolmark/react/rhf`](../api/@toolmark/react/rhf/index.md),
[`@toolmark/tour/react`](../api/@toolmark/tour/react/index.md).
