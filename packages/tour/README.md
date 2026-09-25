# @toolmark/tour

Guided tours over a Toolmark registry's own tools. Steps name **tools and params**, never CSS
selectors, so a tour survives markup changes and an agent can plan one from the manifest it
already reads. `@toolmark/tour` is the framework-free engine (`startTour`: `show`, `guide` and
`do` modes, authored steps or a `goal` + app-supplied `planner`); `@toolmark/tour/overlay` is a
vanilla-DOM overlay (`mountTourOverlay`, spotlight + accessible dialog, works on Blade or plain
HTML pages) styled by `@toolmark/tour/styles.css`; `@toolmark/tour/react` provides `useTour` for
rendering a tour headlessly in React.

```sh
pnpm add @toolmark/core @toolmark/tour
```

ESM only. React ≥ 18.3 is an optional peer (only for `@toolmark/tour/react`).

```ts
import '@toolmark/tour/styles.css'
import { startTour } from '@toolmark/tour'
import { mountTourOverlay } from '@toolmark/tour/overlay'

const tour = await startTour(tm, {
  mode: 'show',
  steps: [
    { tool: 'signup.fill', param: 'email', text: 'Start with your email address.' },
    { tool: 'signup.submit', text: 'Create the account when you are ready.' },
  ],
})
mountTourOverlay(tour) // unmounts itself when the tour is done or stopped
```

`do` mode calls each step's tool as caller `tour` (policy and inline confirmation apply). The
tour never reads DOM values: only anchors, `tm.state()` (redacted by each tool) and interaction
events.

Guide (modes, modality, planners, overlay options): [docs/guides/tours.md](https://github.com/adams100111/toolmark/blob/main/docs/guides/tours.md).

## License

MIT
