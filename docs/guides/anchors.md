# Anchors, state and interaction events (tour hooks)

Tours (and any UI that points at a tool) need three things from a tool: where it is on the page,
what it currently holds, and when the user touches it. Core provides them for every tool (spec §13).

## `tm.anchor(tool, param?)`

Returns the tool's element, or the element of one input path, or `null`:

```ts
tm.anchor('challenges.create.fill') // the <form>
tm.anchor('challenges.create.fill', 'title.en') // the title input
```

Precedence: a `tm.setAnchor` override → the tool's `anchors.params[param]` → `anchors.resolve(param)`
→ `null` (without a param: override → `anchors.element()` → `null`). SVG and custom elements count.

Form tools (`<name>.fill`, `<name>.submit`) anchor automatically when the adapter knows its
elements: `.fill` + path → the field element, `.fill` / `.submit` alone → the field's form. Wizard
tools anchor `<step>.<path>` only while that step is current (`<step>` alone → its form). Button
tools anchor to the button, table tools to the `<table>`.

For hand-written tools, pass `anchors` when registering:

```ts
tm.register({
  name: 'chart.zoom',
  anchors: { element: () => chartEl, params: { level: () => sliderEl } },
  // resolve: (param) => … for dynamic paths such as `items.2.qty`
  run,
})
```

## `tm.setAnchor` and `useToolAnchor`

`tm.setAnchor(tool, param, el)` overrides an anchor (`null` clears it). The registry drops a tool's
overrides when the tool is disposed. In React, `useToolAnchor` handles this for you:

```tsx
import { useToolAnchor } from '@toolmark/react'

;<canvas ref={useToolAnchor('reports.chart.zoom', 'level')} />
```

- It takes the **full** tool name (scope path included), as `tm.anchor` does.
- It clears the override on detach or unmount and re-applies it after every registry revision
  (StrictMode remounts and `useTool` re-registrations drop overrides).
- One override exists per `(tool, param)`: anchor each pair from one component only.

## `tm.state(tool)`

Returns `{ values, issues, step? }` from the tool's `state()` hook, without side effects (no writes,
no revision bump), or `undefined` for tools without one. Form tools return the form's values and
current validation issues; wizard tools return values per step, issues as `<step>.<path>` and the
current `step`.

**Redaction is owned by each tool's `state()`.** Form and wizard tools replace every sensitive path
with `'[redacted]'` and never include excluded DOM controls. A hand-written `state()` must redact its
own values; `tm.state` passes them through.

## Sensitive paths

`tm.info(tool).sensitivePaths` lists the paths a tool treats as sensitive (`[]` by default). The same
list drives `state()`, `fill` `changes`, confirmation payloads and OTel payload redaction. The paths
are paths of the tool's values (`password`, a wizard's `<step>.password`); OTel maps them onto the
call input (`values.password`, `steps.<step>.password`) when it redacts `toolmark.input`. For form
and wizard tools it is the union of:

- the declared list (`FormToolOptions.sensitive`, `WizardStep.sensitive`);
- fields the adapter reports as `FieldInfo.sensitive`;
- password inputs, `autocomplete="cc-*"` and secret `autocomplete` values (`current-password`,
  `new-password`, `one-time-code`), when the adapter has elements.

Rules:

- **`[]` is an array wildcard:** `cards[].cvc` covers `cards.0.cvc`, `cards.1.cvc`, … `sensitivePaths`
  publishes the pattern and its current concrete paths.
- **Sensitivity is sticky:** a path once seen sensitive through its element stays sensitive (a
  "show password" toggle that flips `type` does not leak it; a wizard step keeps its sensitivity after
  it unmounts).
- **Adapters without elements** (`rhfAdapter` without `root`/`elementFor`, Inertia `useForm`) cannot
  apply the element rule: declare `sensitive` explicitly. Wizard steps whose data exists before they
  are first mounted must declare `sensitive` too.
- Validation issue **messages** are not redacted: schemas must not echo sensitive values.

## Interaction events

```ts
tm.events.on('interaction', (e) => {
  // { tool, param?, kind: 'input' | 'focus' | 'submit', caller: 'human' }
})
```

Only user-originated events are reported, never values: agent fills, agent submits and agent
button clicks emit nothing. DOM `focus` / `submit` events (and DOM `input` events of the DOM
adapters) must be trusted (`isTrusted`); `rhfAdapter` reports `input` from React's `onChange`, which
may be synthetic. A field edit or focus is
`{ tool: '<name>.fill', param: path }`; a form submit is `{ tool: '<name>.submit' }` (a wizard step
submit is `{ tool: '<name>.fill', param: '<step>' }`).

Which adapters emit them:

| Adapter                                     | `input` | `focus` / `submit` |
| ------------------------------------------- | ------- | ------------------ |
| `domFormAdapter` (DOM forms, scanned forms) | yes     | yes                |
| `rhfAdapter` with `root`                    | yes     | yes                |
| `rhfAdapter` without `root`                 | yes     | no                 |
| `inertiaFormComponentAdapter` (`<Form>`)    | yes     | yes                |
| `inertiaAdapter` (Inertia `useForm`)        | no      | no                 |

The Inertia `useForm` adapter has no per-field events, so tours in guide mode need another adapter
(M4). `rhfAdapter` reports `input` from react-hook-form's change signal, so a synthetic `onChange`
counts as user input.

**Wizard step changes:** core gets no step-change signal. A wizard follows its current step's form on
every anchor or state read and every `fill`, so the events of a newly shown step start after the next
such read (tours read anchors per step, which covers it).

---

Every error, refusal and event code, with the milestone that added it, is listed in
[`reference/codes.md`](../reference/codes.md).
