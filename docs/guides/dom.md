# DOM forms, buttons and tables

`@toolmark/core/dom` turns app-authored HTML into tools: plain and native WebMCP declarative forms,
buttons and tables (spec §10.2). The entry has no top-level DOM access, so it imports under Node
(SSR), where `scanDom` does nothing.

```ts
import { createToolmark } from '@toolmark/core'
import { scanDom } from '@toolmark/core/dom'

const tm = createToolmark({ dev: import.meta.env.DEV })
const stop = tm.use(scanDom({ root: document.querySelector('main')!, observe: true }))
// later: stop() disconnects observers and disposes every tool, adapter and group scope
```

`ScanDomOptions`: `root` (default `document`; a `Document`, `Element` or `ShadowRoot`) and `observe`
(default `true`). Tools appear synchronously when the consumer is attached; later DOM changes are
picked up after the next animation frame.

## The trusted-root rule

Tool names, descriptions, field labels and confirmation texts are read from the markup and reach
the model. The scanned root must therefore hold **only app-authored markup** (spec §14):

- Put user-authored HTML (comments, rich-text previews, anything rendered from user input) under
  `data-tool-ignore`. Nothing inside it is scanned, and labels inside it never describe a field.
- Subtrees under `[contenteditable]` (any value except `"false"`, including `""` and
  `plaintext-only`), `<iframe>` and `<template>` are **never** scanned, with or without
  `data-tool-ignore`. Closed shadow roots are not scanned; open ones are.
- If `root` itself is inside such a region, nothing is scanned.
- Labels and controls inside ignored or editable regions are dropped, including controls placed
  there and associated to a form with the `form=` attribute.
- Mutations inside ignored regions never trigger a rescan (toggling `data-tool-ignore` or
  `contenteditable` itself does).

Results of every DOM tool are marked `untrustedContent`.

## Attribute reference

Native WebMCP declarative attributes (verified against the WebMCP explainer on 2026-09-25):

| Attribute              | On      | Meaning                                                                                                     |
| ---------------------- | ------- | ----------------------------------------------------------------------------------------------------------- |
| `toolname`             | form    | Registers `<toolname>.fill` / `.submit` (+ `.options`), `origin: 'native-form'`, `nativeName` = `toolname`. |
| `tooldescription`      | form    | Tool description (required with `toolname`).                                                                |
| `toolautosubmit`       | form    | The submit tool has **no confirmation hint** (the page opted in to agent submits).                          |
| `toolparamdescription` | control | Field description (highest precedence).                                                                     |

Toolmark attributes:

| Attribute                   | On                       | Meaning                                                                                      |
| --------------------------- | ------------------------ | -------------------------------------------------------------------------------------------- |
| `data-tool="<name>"`        | form                     | Registers `<name>.fill` / `.submit` (+ `.options`), `origin: 'dom'` (native attributes win). |
| `data-tool="<name>"`        | button, button `<input>` | An action tool that clicks the button.                                                       |
| `data-tool="<name>"`        | table                    | A read-only query tool.                                                                      |
| `data-tool-description`     | form, button, table      | Tool description. **Required for buttons** (never taken from the button text).               |
| `data-tool-group="<name>"`  | any ancestor             | Puts the tools in a scope of that name (tool names become `<group>.<name>`).                 |
| `data-tool-readonly`        | button                   | `readOnly` hint (ignored on a button that submits or resets a form).                         |
| `data-tool-consequential`   | button                   | `consequential` hint.                                                                        |
| `data-tool-destructive`     | form, button             | `destructive` hint (on a form: its submit).                                                  |
| `data-tool-confirm`         | form, button             | Confirmation summary (≤ 500 characters).                                                     |
| `data-tool-param-<name>`    | form                     | Description of the field whose control `name` is `<name>`.                                   |
| `data-tool-options-url`     | control                  | Same-origin JSON endpoint for the field's options lookup.                                    |
| `data-tool-column="<name>"` | `th`                     | A queryable column (`^[A-Za-z0-9_-]{1,64}$`).                                                |
| `data-tool-type="number"`   | `th`                     | Parse the column's cells as numbers.                                                         |
| `data-tool-ignore`          | any element              | Excludes the subtree (user HTML) and, on a control, the control.                             |

Tool descriptions are capped at 2048 characters; field descriptions and labels at 500; option
titles at 200 (longer text is cut with `…`). An invalid tool, group or column name is skipped with
an `invalid_name` event (never thrown, also in development).

```html
<main>
  <form
    toolname="contact"
    tooldescription="Send a message to support."
    action="/contact"
    method="post"
  >
    <input type="hidden" name="_token" value="…" />
    <label>Subject <input name="subject" required maxlength="120" /></label>
    <label
      >Topic
      <select name="topic" data-tool-options-url="/api/topics"></select>
    </label>
    <textarea name="body" toolparamdescription="The message, plain text."></textarea>
    <button>Send</button>
  </form>

  <table data-tool="orders" data-tool-description="The user's recent orders.">
    <thead>
      <tr>
        <th data-tool-column="id">#</th>
        <th data-tool-column="total" data-tool-type="number">Total</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>A-1</td>
        <td>19.90</td>
      </tr>
    </tbody>
  </table>

  <button data-tool="refresh" data-tool-description="Reload the order list." data-tool-readonly>
    Refresh
  </button>

  <section data-tool-ignore><!-- user comments rendered here --></section>
</main>
```

## Forms

A form with `toolname` + `tooldescription`, or `data-tool` + `data-tool-description`, registers
`<name>.fill` and `<name>.submit` through `domFormAdapter` and a synthesized schema, plus
`<name>.options` when a field has an accepted `data-tool-options-url`. The submit is
`consequential` (a form's `data-tool-destructive` makes it `destructive`; `toolautosubmit` on a
native form removes the hint). `fill` and `submit` results are `untrustedContent`.

### Which controls are fields

Fields are the named controls of `form.elements` (including `form=`-associated controls and
form-associated custom elements). **Excluded** everywhere (schema, values, `changes`, `fields()`,
never written):

- `type="hidden"` (for example the CSRF `_token`), `type="password"`;
- `autocomplete` tokens `cc-*`, `current-password`, `new-password`, `one-time-code`;
- a control once seen as `type="password"` stays excluded after a "show password" toggle changes
  its type (**sticky exclusion**);
- disabled controls (including inside a disabled `fieldset`) and controls under
  `data-tool-ignore` or an editable region.

**Read-only** controls (`readonly` or `aria-readonly="true"`) are left out of the schema and are
**never written**, but their values stay readable as context. Validation messages of an excluded
or read-only control are reported at `""` without its name.

### Schema synthesis

`synthesizeFormSchema(form)` returns the JSON Schema (the [`fromJsonSchema`](forms.md#json-schema-only-forms-fromjsonschema)
subset) the scanner uses:

| Control                                 | Schema                                                                                                     |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| text, search, email, url, tel, textarea | `string`; `minLength`/`maxLength`; anchored `pattern`; `format` `email`/`uri`                              |
| number, range                           | `integer` (integer `step` and `min`) or `number`; `minimum`/`maximum`; `multipleOf` for an explicit `step` |
| date, time                              | `string` with `format`; `min`/`max` in the description                                                     |
| datetime-local                          | `string` with a pattern; `min`/`max` in the description                                                    |
| checkbox                                | `boolean`; several with one name → array of unique values                                                  |
| radio group, select                     | `enum`, titles in the description (`"Options: <value> = <label>; …"`)                                      |
| `select[multiple]`                      | array of unique `enum` values                                                                              |
| file                                    | [`fileFieldSchema`](files.md) (`accept` MIME entries, `multiple`)                                          |
| form-associated custom element          | `string`                                                                                                   |

Names map to paths: `a[b]` → `a.b`, `a[0][b]` → `a.0.b`, `a[]` or a repeated name → an array,
`fieldset[name]` prefixes its descendants. `required` becomes `required`, load-time values become
`default`, every object is closed (`additionalProperties: false`). A page `pattern` that is invalid
or [unsafe](forms.md#json-schema-only-forms-fromjsonschema) is dropped (the field is kept; in
development a `schema_conversion_failed` event says so). Invalid names and colliding paths are
skipped (development `invalid_name` event). Descriptions come from `toolparamdescription`, then the
form's `data-tool-param-<name>`, the `<label>`, then `aria-description`.

### Filling and dirty tracking

`setValues` uses the prototypes' native setters and dispatches bubbling `input` and `change`, so
React-controlled inputs update their state; checkboxes and radios are `click()`ed (a click the page
cancels leaves the field unchanged). A field is **dirty** (user-edited, skipped unless `overwrite`)
when its value differs from the load snapshot and is not what the agent last set, or when a
trusted (`isTrusted`) `input`/`change` event touched it; a form `reset` re-snapshots. This protects
the user's edits; it is not a security boundary.

### Options URL

`data-tool-options-url` is resolved against the document and must be `http:`/`https:`, carry no
username/password, have the **page's own origin** and be at most 2048 characters; otherwise it is
ignored with an `options_url_rejected` event. Each lookup is `GET <url>?q=<query>` with
`credentials: 'same-origin'`, `mode: 'same-origin'` (a cross-origin redirect fails) and
`Accept: application/json`. The endpoint returns a JSON array of `{ value, title }`; a non-2xx
status, a body over 1 MiB, invalid JSON or a non-array fails the lookup (`"Options lookup failed"`).
The [options rules](forms.md#async-options-d26) (10 s, 50 items) apply. Read-only fields get no
options.

### Native submits navigate (D23)

The default submit runs `form.checkValidity()` (failures → `invalid` with each field's
`validationMessage`) and then `form.requestSubmit()` → `ok({ submitted: true })`. A plain HTML
form then **navigates**: the page unloads, the bridge disconnects, and the result may never reach
the server. The server sees the call end as `timeout`, followed by a fresh `manifest` from the new
page (spec D23). Treat a `timeout` after a native submit as "outcome unknown" and read the new page
before retrying. Single-page forms avoid this: pass `domFormAdapter(form, { submit })` a submit
that goes through your router.

## Buttons

A `<button>` (or button `<input>`) with `data-tool` and `data-tool-description` becomes a tool with
no input that clicks the button and returns `ok({ clicked: true })`. Without
`data-tool-description` the button is skipped (development `invalid_name` event).

- A disabled, hidden, `inert` or detached button → `refused` `not_allowed`
  (`"Button is disabled or hidden"`), without clicking.
- **Submitting buttons are consequential.** A button that submits or resets its form (type
  `submit`, explicit or default, `image` or `reset`, with a form owner) is always at least
  `consequential`, even with `data-tool-readonly`; `data-tool-destructive` raises it. Its
  confirmation summary is the owner form's `data-tool-confirm`, else the button's own, else the tool
  name. The confirmation carries a **stale snapshot** of the form owner and its non-excluded values:
  an approval after the form changed (an agent fill or a user edit) is refused `stale` and nothing
  is clicked.

## Tables

A `table[data-tool]` with `th[data-tool-column]` headers becomes a read-only (`readOnly`,
`untrustedContent`) query tool:

- Input `{ where?: { <column>: string }, limit?: integer ≥ 1 }`. `where` matches rows whose cell
  text contains every given string (case-insensitive). `limit` defaults to 50; values above 500 are
  clamped to 500.
- Result `ok({ rows, total, truncated? })`: rows keyed by column (trimmed text, at most 1000
  characters per cell; number columns parse, empty or unparsable → `null`), `total` counts every
  match.
- Caps: at most **32 columns** (the rest skipped with an `invalid_name` event); rows are cut when
  their JSON passes **200000 characters**, and then `truncated: true` is set.
- Rows are the `<tbody>` rows at call time; a row holding a column header is skipped.

## Observation

With `observe` (default), one `MutationObserver` watches the root and every open shadow root
found. Only mutations touching forms, controls, labels, tool elements or tool attributes outside
ignored regions schedule a rescan, batched per animation frame. A tool re-registers only when its
tool attributes or synthesized schema (load-time defaults aside) changed; removed elements' tools
and adapters are disposed.

## Using the adapter directly

`domFormAdapter(form, opts?)` returns a `DomFormAdapter` (a `FormAdapter` plus `dispose()`);
`DomFormAdapterOptions.submit` replaces the default submit. Use it when you register a form's
tools yourself, for example to route the submit through your SPA router:

```ts
import { createFormTools, fromJsonSchema, ok, type Toolmark } from '@toolmark/core'
import { domFormAdapter, synthesizeFormSchema } from '@toolmark/core/dom'

export function formTools(tm: Toolmark, form: HTMLFormElement): () => void {
  const adapter = domFormAdapter(form, {
    submit: async (f) => {
      await fetch(f.action, { method: 'POST', body: new FormData(f) })
      return ok({})
    },
  })
  const schema = synthesizeFormSchema(form)
  const tools = createFormTools(tm, adapter, {
    name: 'profile',
    description: 'The profile form.',
    input: fromJsonSchema(schema),
    jsonSchema: schema,
  })
  return () => {
    tools.dispose()
    adapter.dispose()
  }
}
```

This works for forms without file inputs. With file inputs, the validation schema must accept a
resolved `File` (use `{}` for the file field) while `jsonSchema` advertises
`fileFieldSchema(spec)`, and the form needs `files: { <path>: spec }`; `scanDom` does this for you.

## Known limits

- Browser behaviour (form-associated custom elements, `form=` controls) is verified in Chromium;
  Firefox and WebKit runs come with the M5 browser matrix.
- Each animation frame with relevant mutations re-synthesizes every form under the root.
