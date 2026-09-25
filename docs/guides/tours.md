# Tours

`@toolmark/tour` runs guided tours over the registry's own tools: steps name **tools and params**,
never CSS selectors, so a tour keeps working when markup changes and an agent can plan one from the
same manifest it already reads (spec §11.5, D30). The engine is framework-free; the styled overlay
is vanilla DOM (`@toolmark/tour/overlay`), so Blade or plain-HTML pages get tours too; React apps
can also render headlessly with `useTour`. Tour event codes: [`reference/codes.md`](../reference/codes.md#tour-events-m4).

```sh
pnpm add @toolmark/tour
```

## Quick start

```ts
import '@toolmark/tour/styles.css'
import { startTour, type TourStep } from '@toolmark/tour'
import { mountTourOverlay } from '@toolmark/tour/overlay'

const steps: TourStep[] = [
  {
    tool: 'challenges.create.fill',
    param: 'title.en',
    title: 'Title',
    text: 'Give the challenge an English title.',
  },
  { tool: 'challenges.create.fill', param: 'type', text: 'Pick the kind of challenge.' },
  { tool: 'challenges.create.submit', text: 'Create it when you are ready.', waitFor: 'submit' },
]

const tour = await startTour(tm, { mode: 'show', steps })
const unmount = mountTourOverlay(tour)
tour.on((e) => console.debug('tour', e))
```

`startTour` resolves with a tour already on its first step (or `stopped` when no step is valid).
`tour.next()`, `tour.back()`, `tour.stop()`, `tour.subscribe(fn)` and `tour.on(fn)` drive and
observe it; the overlay unmounts itself when the tour is `done` or `stopped`.

## Modes and modality

| Mode    | What happens on a step                                                                                                                                                                                                                                                                  | Overlay                            |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `show`  | Highlights the anchor and explains; the user presses Next.                                                                                                                                                                                                                              | Not modal: the page stays operable |
| `guide` | Waits for the user's own input on the step's field and validates it through `tm.state()` (400 ms after the last input, or when focus leaves the field); `waitFor: 'submit'` waits for a submit. While the input has issues the status is `waiting` and `message` shows the first issue. | Not modal; the anchor gets focus   |
| `do`    | Calls the step's tool **as caller `tour`** with the step's `input` (policy and inline confirmation apply), then highlights each changed field for 600 ms and advances.                                                                                                                  | Modal (focus trap, `aria-modal`)   |

- In `do` mode the status is `busy` while the call is in flight (Next/Back are `aria-disabled`)
  and `confirming` for the whole call of a consequential or destructive tool: the overlay then
  releases its focus trap and backdrop and lets pointer input through, so the app's inline
  confirmation stays usable. Caller `tour` is always inline, so the app needs a `confirm` handler
  for tours that submit (see [Confirmation modes](../concepts/confirmation.md)).
- `show`/`guide`: `F6` or `Alt+T` moves focus between the dialog and the anchor.
- Keyboard: arrow keys move between steps, `Esc` stops the tour (focus in the dialog); on close,
  focus returns to where it was before the overlay mounted.
- A step whose anchor is not rendered is skipped (`anchor_missing`); a step whose tool disappears
  mid-tour is skipped (`step_skipped`). `back()` only moves the index: nothing is undone.
- The tour never reads DOM values: only anchors, `tm.state()` (already redacted by each tool) and
  interaction events.

### Guide mode needs interaction events

`guide` listens to the registry's `interaction` events (`input`, `focus`, `submit`, caller
`human`), which form adapters emit through the optional `FormAdapter.onUserInteraction`.
`rhfAdapter` emits them (`focus`/`submit` only when given `root`), and so does the DOM adapter.
**`inertiaAdapter` (Inertia `useForm`) emits none, so Inertia `useForm` pages support `show` and
`do` only**; the Inertia `<Form>` component path emits interactions. A custom adapter implements
`onUserInteraction(cb)` to support `guide`.

## Authored steps

```ts
interface TourStep {
  tool: string // full tool name, e.g. 'challenges.create.fill'
  param?: string // input path: 'type', 'items.0.qty', or '<step>.<path>' for wizards
  title?: string // app-localized
  text: string // app-localized explanation
  input?: unknown // `do` mode: the tool input (form fills may pass values directly)
  waitFor?: 'input' | 'submit' // `guide` mode, default 'input'
}
```

In `do` mode, a form fill step may pass the field values directly (`input: { title: { en: 'Robotics' } }`):
they are wrapped as `{ values }` when the tool's schema has a `values` property. Wizard fills pass
`{ steps: … }` unchanged.

## Planned tours

Pass `goal` and an app-supplied `planner` instead of `steps`. The planner gets the summary manifest
**as seen by caller `tour`**, a `describe(name)` for full entries, the mode and an abort signal,
and returns steps. Planned steps are untrusted: the engine keeps only steps whose tool is visible to
caller `tour` and whose `param` exists in the tool's input schema; the others are dropped with
`step_invalid` (`unknown_tool`, `unknown_param`, `malformed_step`). A planner rejection rejects
`startTour`.

```ts
import type { Planner } from '@toolmark/tour'

const tour = await startTour(tm, {
  mode: 'do',
  goal: 'Create a robotics workshop',
  planner,
  signal,
})
```

The planner contract has no transport of its own and protocol v1 has no plan message: the app
chooses how to reach its agent.

**Recipe — HTTP endpoint** (the Laravel example's `POST /tour/plan`):

```ts
const planner: Planner = {
  async plan({ goal, mode, tools, signal }) {
    const res = await fetch('/tour/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-XSRF-TOKEN': xsrfToken() },
      credentials: 'same-origin',
      body: JSON.stringify({
        goal,
        mode,
        tools: tools.map((t) => ({ name: t.name, description: t.description })),
      }),
      signal,
    })
    if (!res.ok) throw new Error(`Planner failed: ${res.status}`)
    return (await res.json()) as TourStep[]
  },
}
```

**Recipe — bridge/relay side channel** (the react-vite example's `relayPlanner`): send an
app-level message such as `{ kind: 'app/plan', id, goal, tools }` on the socket that already links
the page to your agent server, and resolve on the matching `{ kind: 'app/plan-result', id, steps }`.
Keep it separate from protocol v1 frames, and time it out with the `signal`.

The server side asks its LLM for `TourStep[]` over the same tool names the agent already uses;
authorize the request like any other endpoint.

## Styling

Import the stylesheet once (it is the package's only file with side effects):

```ts
import '@toolmark/tour/styles.css'
```

In **Next.js** import it in `app/layout.tsx`; in Vite/Laravel import it from the entry script.
Every selector starts with `.toolmark-tour`, so it never styles the rest of the page. Theme it with
custom properties on any ancestor (for example `:root`) or on `.toolmark-tour`:

| Custom property            | Default                      | Used for                               |
| -------------------------- | ---------------------------- | -------------------------------------- |
| `--toolmark-tour-accent`   | `#1d4ed8`                    | Buttons, highlight outline, focus ring |
| `--toolmark-tour-bg`       | `#ffffff`                    | Dialog background                      |
| `--toolmark-tour-fg`       | `#111827`                    | Dialog text                            |
| `--toolmark-tour-radius`   | `8px`                        | Dialog and highlight corners           |
| `--toolmark-tour-shadow`   | `0 8px 24px rgb(0 0 0 / .2)` | Dialog shadow                          |
| `--toolmark-tour-z`        | `2147483000`                 | Stacking order                         |
| `--toolmark-tour-backdrop` | `rgb(0 0 0 / .45)`           | Backdrop in `do` mode                  |

The defaults meet WCAG 2.2 AA (text ≥ 4.5:1 on the background, focus ring ≥ 3:1). If you change
them, keep those ratios. The overlay is axe-clean in every mode.

```css
:root {
  --toolmark-tour-accent: #0f766e;
  --toolmark-tour-radius: 12px;
}
```

## Strings

All strings are app-supplied (spec §15); English defaults:

```ts
mountTourOverlay(tour, {
  strings: {
    next: 'التالي',
    back: 'السابق',
    close: 'إغلاق الجولة',
    done: 'تم',
    confirming: 'بانتظار تأكيدك',
    busy: 'جارٍ التنفيذ…',
    stepOf: (i, n) => `الخطوة ${i} من ${n}`,
  },
})
```

| Key          | Default                             |
| ------------ | ----------------------------------- |
| `next`       | `Next`                              |
| `back`       | `Back`                              |
| `close`      | `Close tour`                        |
| `done`       | `Done`                              |
| `confirming` | `Waiting for your confirmation`     |
| `busy`       | `Working…`                          |
| `stepOf`     | `` (i, n) => `Step ${i} of ${n}` `` |

Step `title` and `text` are rendered as text, never as markup. `container` (default
`document.body`) chooses where the overlay is appended.

## RTL and reduced motion

- **RTL.** The overlay follows the computed `direction` of the anchor (or container): placement is
  mirrored and the arrow keys are swapped (in RTL, `ArrowLeft` moves forward).
- **Reduced motion.** Under `prefers-reduced-motion: reduce` the overlay has no transitions,
  scrolls without animation, and `do` mode skips the 600 ms field highlight. `startTour(tm, {
reducedMotion })` overrides the media query for the engine.

## Headless tours

Skip the overlay and render `TourState` yourself: `tour.subscribe(fn)` in any framework, or
`useTour(tour)` from `@toolmark/tour/react` (SSR-safe; see [React](react.md#usetour)). The state
has `status`, `mode`, `index`, `steps`, `anchor`, `highlight`, `busy` and `message`. A headless UI
must keep the same modality rules: leave the app's confirmation UI usable while `confirming`.

API: [`@toolmark/tour`](../api/@toolmark/tour/index.md),
[`@toolmark/tour/overlay`](../api/@toolmark/tour/overlay/index.md),
[`@toolmark/tour/react`](../api/@toolmark/tour/react/index.md).
