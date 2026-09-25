# Wizards

A multi-step form usually keeps one form per step and the collected data in the parent. Toolmark
turns the whole wizard into a few tools, so an agent can fill every step in one call (spec §8.2,
D25). Two modes exist:

- **Parent-state mode** (preferred): the parent owns the data (`useState` slices). Tools:
  `<name>.fill`, `<name>.goTo`, `<name>.submit` (consequential) and `<name>.options` when a step
  declares options. Core: `createWizardTools`; React: `useWizardTool` with `data` + `setData`.
- **Stepwise fallback**: the app cannot expose parent state. Tools: `<name>.step.fill`,
  `<name>.next`, `<name>.previous`, `<name>.submit`, each with `mode: 'stepwise'` in the manifest.
  Core: `createStepwiseWizardTools`; React: `useWizardTool` without `data`/`setData`.

Fill semantics are the form-fill semantics of [forms](forms.md) applied per step: fail-closed
undeclared paths, forbidden keys, duplicate paths, the node budget (10000 nodes per step), array
operations, [files](files.md), `null` clears, redaction and skipping of user-edited fields.

## React: parent-state mode

```tsx
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ok, type OptionsProvider, type WizardStep } from '@toolmark/core'
import { useWizardTool } from '@toolmark/react'
import { rhfAdapter } from '@toolmark/react/rhf'

const basics = z.object({ title: z.string().min(1), category: z.enum(['idea', 'problem']) })
const schedule = z.object({ startsAt: z.iso.date(), endsAt: z.iso.date() })
const people = z.object({ ownerId: z.string(), reviewers: z.array(z.object({ name: z.string() })) })

declare const findPeople: OptionsProvider // your lookup
declare function createEvent(data: Record<string, Record<string, unknown>>): Promise<void>

const steps: WizardStep[] = [
  { name: 'basics', title: 'Basics', input: basics },
  { name: 'schedule', title: 'Schedule', input: schedule },
  { name: 'people', title: 'People', input: people, options: { ownerId: findPeople } },
]

export function CreateEventWizard() {
  const [data, setData] = useState<Record<string, Record<string, unknown>>>({})
  const [current, setCurrent] = useState('basics')
  const stepSchema = { basics, schedule, people }[current as 'basics' | 'schedule' | 'people']
  const form = useForm({ resolver: zodResolver(stepSchema), values: data[current] ?? {} })

  useWizardTool({
    name: 'create',
    description: 'The new-event wizard.',
    steps,
    data,
    setData,
    current,
    goTo: setCurrent,
    currentAdapter: rhfAdapter(form, { onSubmit: () => undefined }),
    // Use the argument: `data` captured by this closure may miss the current step's latest edits.
    submit: async (merged) => {
      await createEvent(merged)
      return ok({})
    },
  })
  return null // render the current step's form here
}
```

`useWizardTool` takes `UseWizardToolOptions` (the fields shown above plus `title`,
`resetCurrent`, `next`, `previous` and `submitSummary`). The hook re-registers only when `name`, `description`, `title`, the step names or count, a step's
`input`/`jsonSchema` identity, or the mode changes. `goTo`, `submit`, `setData`, `currentAdapter`,
`resetCurrent` and every step's `options` providers are read through refs, so fresh closures each
render are fine.

## The tools

### `<name>.fill`

Input: `{ steps: { <step>: partial values }, overwrite? }`. Any subset of steps may be filled at
once. Returns `ok({ changes, skipped })` with every path prefixed `<step>.`, or `invalid` with the
issues of **every** invalid step (`<step>.<path>`). An unknown step → `invalid` at `<step>`
(`"Unknown step"`); a non-object step value → `invalid` at `<step>`. A `refused`/`cancelled`/`error`
from a step (for example `file_rejected`) is returned as is.

- **All-or-nothing commit.** Every step is validated and staged first; nothing is written unless
  all steps are `ok`. The commit then does one `setData` call for the data-backed steps and writes
  the current step through its mounted form. If writing the mounted form (or `resetCurrent`)
  throws, the previous parent data is restored with `setData(prev)` and the call ends `error`
  (`"Tool failed"`) with nothing registered for undo.
- **The current step** is read from and written through `currentAdapter()` when it returns a form,
  so the visible form updates and keeps the user's edits (fields the user typed are skipped unless
  `overwrite`). Other steps go into parent data.
- **No mounted form for the current step**: the step is written into parent data and
  `resetCurrent(values)` is called with the step's merged values so the app can reset the visible
  form. With neither `currentAdapter` nor `resetCurrent`, the `error` event
  `wizard_current_step_unsynced` fires once per wizard (in development and production; never
  thrown).
- **Undo.** `tm.undo(callId)` restores every touched step, through the form of the step that is
  current at undo time, otherwise through `setData`.

### `<name>.goTo`

Input `{ step }` → calls `goTo(step)` → `ok({ step })`. With `useWizardTool` in parent-state mode,
the mounted current step's values are first written into `data` (via `setData`), so undo and submit
still see them after navigating away (**parent-data sync**).

### `<name>.submit`

Takes no input (only `{}` or nothing). Before any confirmation is created, every step's **full**
schema is validated (the current step from its mounted form, the others from parent data); any
issue → `invalid` with `<step>.<path>` paths and no confirmation. The tool is `consequential`; a
confirmation approved after the wizard's data or the mounted step values changed is refused
`stale`. The default confirmation summary is `"Submit <title ?? name>"`; pass `submitSummary(data)`
to change it. `data` is a copy of the parent data with the current step replaced by its **live**
values (the mounted step form's values when `currentAdapter` returns one), so the confirmation shows
what the user sees, including edits on the current step not yet synced into parent data.

With `useWizardTool`, the app's `submit` is called with the **merged parent data** as its argument
(`submit(data)`), after the current step's values were synced into it. `setData` usually schedules
a React update that is not visible in the same tick, so a `data` value closed over by `submit` is
the pre-merge snapshot: read the argument. A zero-argument `submit` still type-checks and runs.

### `<name>.options`

Registered when any step declares `options`; `field` is `<step>.<path>` (`people.ownerId`,
`people.reviewers[].id`). Behaviour as in [forms](forms.md#async-options-d26).

## Stepwise fallback

Use it when the wizard cannot expose its data (for example each step posts to the server). Omit
`data`/`setData`; `next`, `previous` and `currentAdapter` become required (missing ones →
`wizard_misconfigured`: a `ToolmarkError` in development, an `error` event in production, nothing
registered).

- `<name>.step.fill` is the form fill of the current step's mounted form with the current step's
  schema; its description ends with `" (current step: <step>)"`. No mounted form → `refused`
  `not_allowed` (`"No step form is mounted"`).
- `<name>.next` returns your `next()` result; `<name>.previous` → `ok({ step })`.
- `<name>.submit` is consequential and refused `stale` when the step form changed after the
  confirmation was requested. In this mode `submit` and `submitSummary` receive `{}`.
- **Stepwise refresh.** When the step changes, `refresh()` re-registers `<name>.step.fill` with the
  new schema (one revision bump). It is a no-op while the current step name is unchanged, and it
  retries on the next call if a registration failed. `useWizardTool` calls it whenever `current`
  changes.

## Core API

```ts
import { createStepwiseWizardTools, createWizardTools, type Toolmark } from '@toolmark/core'

declare const tm: Toolmark
declare const opts: Parameters<typeof createWizardTools>[1]

const wizard = createWizardTools(tm, opts) // WizardToolOptions & { scope?: Scope }
wizard.dispose()
```

`WizardToolOptions` fields: `name`, `description`, `title?`, `steps: WizardStep[]`, `getData()`,
`setData(next)` (called at most once per fill or undo), `getCurrent()`, `goTo(step)`,
`currentAdapter?: () => FormAdapter | undefined`, `resetCurrent?(values)`, `submit()`,
`submitSummary?(data)`. `getData`, `getCurrent` and `currentAdapter` are read at call time: pass
getters backed by the latest state. The step list is read at creation: re-create the wizard tools
(`createWizardTools`) when steps change.

`WizardStep`: `name` (`A–Z a–z 0–9 _ -`, 1–64 characters, unique, not `__proto__`/`prototype`/
`constructor`), `title?`, `input`, `jsonSchema?`, `files?`, `options?`, `sensitive?` (dot paths
always redacted).

`createStepwiseWizardTools(tm, opts)` takes `StepwiseWizardOptions` (`name`, `description`,
`title?`, `currentAdapter()`, `currentStep()` → `{ name, input, jsonSchema? }`, `next()`,
`previous()`, `submit()`, `submitSummary?()`) plus `scope?`, and returns `{ dispose(), refresh() }`.

## Manifest schema

The `fill` schema has one property per step: that step's fill schema (required stripped, array
operation branches, file schemas, option hints). Each step's `$defs`/`definitions` move to the root
`$defs` as `<step>.<name>` and every local `$ref` is rewritten, so steps cannot collide.

## Known limits

- `changes.after` for the current step is the staged value, not a read-back after the form wrote
  it: an adapter that coerces values (`null` → `''`) reports the uncoerced value.
- After a multi-step fill that ends `invalid`, the steps that passed have updated their private
  "agent last set" records although nothing was written. Effect: at most one extra "not user
  edited" decision later.
- The node budget is per step (10000 each).

---

Every error, refusal and event code, with the milestone that added it, is listed in
[`reference/codes.md`](../reference/codes.md).
