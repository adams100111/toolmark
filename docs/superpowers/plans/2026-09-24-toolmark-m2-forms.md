# Toolmark M2 — Forms Complete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `sdd-lanes` to implement this plan lane by lane.
> Plan-lite format. Requires M1 merged.

**Goal:** Every form shape an app has becomes a tool: arrays, async options, files, multi-step
wizards, uncontrolled/DOM forms (incl. Inertia `<Form>` and plain HTML), buttons and tables, Inertia
page scopes, props-declared server tools and navigation.

**Architecture:** Core gains array semantics, options, files, a zero-dependency JSON-Schema-subset
validator (so JSON-Schema-only tools — DOM-synthesized and server-declared — are validated too), the
wizard engine and the DOM layer. React and Inertia add thin bindings.

**Tech Stack:** as M1 (overview versions).

**Spec:** §8 (all), §9 (`useWizardTool`), §10 (all), §12.4, §14 (files), §18. Overview:
`2026-09-24-toolmark-00-overview.md`; M1 plan for existing names.

## Global constraints (M2 additions)

- Files: default `maxBytes` `10485760` (10 MiB); URL fetching disabled unless
  `files.allowOrigins` is non-empty; fetch uses `credentials: 'omit'` and `redirect: 'error'`.
- Table query tools: `limit` default `50`, maximum `500`.
- Options tools: at most `50` options returned per call.
- JSON-Schema-subset keywords supported by `fromJsonSchema` (exact list): `type`, `enum`, `const`,
  `properties`, `required`, `additionalProperties` (boolean), `items`, `minItems`, `maxItems`,
  `uniqueItems`, `minLength`, `maxLength`, `pattern`, `minimum`, `maximum`, `multipleOf`, `format`
  (`date`, `time`, `date-time`, `email`, `uri`), `anyOf`, `oneOf`, `default`, `title`,
  `description`. Other keywords are ignored and listed in the docs.
- New reserved `refused` codes: `file_rejected`, `navigation_failed`.

## Rulings made while planning

- **Arrays are units in `changes`:** a change to `sponsors` reports the whole array before/after;
  the array counts as user-edited if any dirty path lies under it.
- **Wizard data flow:** the wizard writes non-current steps into parent data and the **current**
  step through its mounted `FormAdapter` (optional `currentAdapter`), which updates the visible form
  and preserves per-field dirty tracking.
- **Transparent scopes:** `tm.scope(name, { transparent: true })` groups tools for disposal without
  prefixing names, so server-declared tools keep the names the server gave them.
- **Tool origin flag:** tools from native `toolname` forms carry `origin: 'native-form'` so the M3
  WebMCP consumer can avoid double-registering them where the browser already exposes declarative
  forms.
- **Inertia `<Form>` adapter** is built in Wave 2 because it composes the DOM adapter (Lane B) with
  Inertia router events (Lane D).

## Review focus

1. **Wizard fill while the user has typed on the current step** → the mounted step form shows the
   agent's values for untouched fields and keeps the user's (Task 4 `wizard_current_step_respects_dirty`).
2. **File URL that redirects** → rejected with `file_rejected`, no request with credentials
   (Task 3 `url_redirect_rejected`).
3. **React-controlled input filled through the DOM adapter** → React state updates (Task 5
   `dom_fill_updates_react_controlled_input`).
4. **Huge table** → `limit` capped at 500; default 50 (Task 6 `table_limit_capped`).
5. **Navigating away** → the navigation call returns `ok` and the old page's server tools become
   `unknown_tool` (Task 8 `navigation_ok_then_old_props_tools_gone`).

## File structure

```
packages/core/src/forms/paths.ts          (modify: array ops)
packages/core/src/forms/form-tools.ts     (modify: arrays, options, files)
packages/core/src/forms/options.ts        options tool
packages/core/src/files.ts                FileRef, resolveFileRef, fileFieldSchema
packages/core/src/json-schema/validate.ts JSON-Schema-subset validator
packages/core/src/json-schema/from-json-schema.ts  fromJsonSchema → StandardSchemaV1
packages/core/src/wizard/wizard-tools.ts  createWizardTools, createStepwiseWizardTools
packages/core/src/scope.ts · registry.ts · tool.ts · manifest.ts   (modify: transparent scopes, mode, origin)
packages/core/src/dom/form-adapter.ts     domFormAdapter
packages/core/src/dom/synthesize.ts       synthesizeFormSchema
packages/core/src/dom/elements.ts         field discovery incl. shadow DOM + form-associated CEs
packages/core/src/dom/scan.ts             scanDom
packages/core/src/dom/button-tools.ts · table-tools.ts
packages/core/src/dom/index.ts
packages/react/src/use-wizard-tool.ts
packages/inertia/src/pages.ts · props-tools.ts · navigation.ts · form-component.ts
examples/react-vite/src/{wizard.tsx,plain-form.html,dom-page.tsx}  e2e/{wizard,dom}.spec.ts
docs/guides/{forms,wizards,files,dom,inertia}.md
.changeset/m2-forms.md
```

## Lanes

| Wave | Lane | Tasks | Owns files | Consumes |
| --- | --- | --- | --- | --- |
| 0 | A (high) | 1–4 | `packages/core/src/{forms,json-schema,wizard}/**`, `files.ts`, `scope.ts`, `registry.ts`, `tool.ts`, `manifest.ts`, `index.ts`, `package.json` (new `./dom` export), `tsdown.config.ts`, matching tests | M1 |
| 1 | B (high) | 5–6 | `packages/core/src/dom/**`, `packages/core/test/dom-*.test.ts` | A |
| 1 | C (normal) | 7 | `packages/react/src/use-wizard-tool.ts`, `packages/react/src/index.ts`, react tests | A |
| 1 | D (normal) | 8 | `packages/inertia/src/{pages,props-tools,navigation}.ts`, `packages/inertia/src/index.ts`, inertia tests for them | A |
| 2 | E (normal) | 9–10 | `packages/inertia/src/form-component.ts` (+ its export line in `index.ts`), `examples/**`, `docs/guides/**`, `.changeset/m2-forms.md` | A–D |

Core tests for DOM run in Vitest **browser mode**: Task 1 of this plan switches core's
`vitest.config.ts` to two projects (`node` for `test/*.test.ts`, `browser` for `test/dom-*.test.ts`).

---

### Task 1: Arrays, transparent scopes, tool `mode`/`origin`   (Lane A, risk: high)

**Files:** Modify `src/forms/paths.ts`, `src/forms/form-tools.ts`, `src/scope.ts`,
`src/registry.ts`, `src/tool.ts`, `src/manifest.ts`, `packages/core/vitest.config.ts`; Test
`test/form-arrays.test.ts`, `test/scope-transparent.test.ts`.

**Interfaces — Produces:**
```ts
// scope
tm.scope(name: string, opts?: { when?: boolean; transparent?: boolean }): Scope
// tool definition additions
interface ToolDefinition { mode?: 'stepwise'; origin?: 'code' | 'native-form' | 'dom' | 'server' }   // origin default 'code'
interface ToolManifestSummary { mode?: 'stepwise' }                                                // origin is NOT in the manifest
function flatten(obj: unknown, opts?: { arraysAsLeaves?: boolean }): Record<string, unknown>      // default true
type ArrayOp = { $append: unknown[] } | { $remove: number[] }
```

**Behaviour:**
- Fill values for an array path may be an array (replace), `{ $append: [...] }` or `{ $remove: [indexes] }` (indexes refer to the current array; out-of-range → `invalid` issue at that path).
- `changes` report the whole array; user-edited if any `dirtyPaths()` entry starts with `path + '.'` or equals it.
- A transparent scope does not add a name segment; disposing it still disposes its tools; `when` still applies.
- `vitest.config.ts` defines projects `core-node` (`test/**/*.test.ts` excluding `dom-*`) and `core-browser` (`test/dom-*.test.ts`, Playwright chromium).

**Tests (write first):**
- `array_replace_append_remove` · `array_remove_out_of_range_invalid` · `array_changes_whole_unit` · `array_user_edited_when_child_dirty`.
- `transparent_scope_keeps_names_and_disposes`.
- `stepwise_mode_in_manifest`; `origin_not_in_manifest`.

**Task gate:** `pnpm -F @toolmark/core exec vitest run --project core-node test/form-arrays.test.ts test/scope-transparent.test.ts`

---

### Task 2: JSON-Schema-subset validator and async options   (Lane A, risk: normal)

**Files:** Create `src/json-schema/validate.ts`, `src/json-schema/from-json-schema.ts`,
`src/forms/options.ts`; Modify `src/forms/types.ts`, `src/forms/form-tools.ts`, `src/index.ts`;
Test `test/json-schema.test.ts`, `test/form-options.test.ts`.

**Interfaces — Produces:**
```ts
function fromJsonSchema<T = unknown>(schema: JsonSchema): StandardSchemaV1<unknown, T> & { readonly jsonSchema: JsonSchema }
type OptionsProvider = (args: { query: string; signal: AbortSignal }) => Promise<Array<{ value: unknown; title: string }>>
interface FormToolOptions<V> { options?: Record<string, OptionsProvider> }   // key = field path
```

**Behaviour:**
- `fromJsonSchema` validates exactly the keyword list in the constraints; issue paths use dot notation; formats checked with fixed regexes (date `^\d{4}-\d{2}-\d{2}$` + calendar check, time `^\d{2}:\d{2}(:\d{2})?$`, date-time via `Date.parse` on an ISO-8601 pattern, email `^[^\s@]+@[^\s@]+\.[^\s@]+$`, uri via `new URL`).
- `resolveJsonSchema` (M1) treats a `fromJsonSchema` schema's `jsonSchema` property as the tool's JSON Schema.
- When `options` is present, `createFormTools` registers `<name>.options` (`readOnly`, `untrustedContent`) with input `{ field: enum(option paths), query?: string }` → `ok({ options })` truncated to 50; provider throw → `error` result.
- The fill schema describes option fields with their value type and `description` suffix `" (use <name>.options to find valid values)"`.

**Tests (write first):**
- `json_schema_types_enum_required_nested` · `json_schema_string_number_limits` · `json_schema_formats` · `json_schema_anyof_oneof` · `json_schema_unknown_keywords_ignored`.
- `options_tool_registered_and_truncated` · `options_provider_error_result` · `options_description_hint_in_fill_schema`.

**Task gate:** `pnpm -F @toolmark/core exec vitest run --project core-node test/json-schema.test.ts test/form-options.test.ts`

---

### Task 3: Files   (Lane A, risk: high, security)

**Files:** Create `src/files.ts`; Modify `src/registry.ts` (options `files`, `ctx.files.resolve`),
`src/forms/types.ts`, `src/forms/form-tools.ts`, `src/index.ts`; Test `test/files.test.ts`,
`test/form-files.test.ts`.

**Interfaces — Produces:**
```ts
type FileRef = { ref: string } | { url: string }
interface FilesOptions { resolve?: (ref: string, ctx: { signal: AbortSignal }) => Promise<File>; allowOrigins?: string[]; maxBytes?: number }
interface ToolmarkOptions { files?: FilesOptions }
interface FileFieldSpec { accept?: string[]; maxBytes?: number; multiple?: boolean }
interface FormToolOptions<V> { files?: Record<string, FileFieldSpec> }
function fileFieldSchema(spec: FileFieldSpec): JsonSchema
```

**Behaviour:**
- `ctx.files.resolve({ ref })` → `options.files.resolve(ref)`; missing resolver → throws `ToolmarkError('file_rejected')`.
- `{ url }` → allowed only if `new URL(url).origin` is in `allowOrigins`; fetch with `credentials: 'omit'`, `redirect: 'error'`; reject non-2xx, `Content-Length` > max, streamed bytes > max, MIME not matching `accept` (`image/*` wildcard supported). Result `File` name = last path segment or `"download"`.
- Fill resolves every file field (array when `multiple`) before setting values; any failure → `refused` `file_rejected` with the reason and **no** values set.
- `fileFieldSchema` → `{ type:'object', properties:{ ref:{type:'string'}, url:{type:'string', format:'uri'} }, oneOf:[{required:['ref']},{required:['url']}], description: "File reference. Accepts: <accept>; max <n> bytes" }` (array wrapper when `multiple`).

**Tests (write first):**
- `ref_resolves_via_app_resolver` · `ref_without_resolver_rejected`.
- `url_disabled_by_default` · `url_origin_not_allowed` · `url_redirect_rejected` (review focus 2; assert fetch called with `redirect:'error'` and `credentials:'omit'`) · `url_size_limit_header_and_stream` · `url_mime_accept`.
- `form_fill_with_file_sets_file_value` · `form_fill_file_failure_sets_nothing`.

**Task gate:** `pnpm -F @toolmark/core exec vitest run --project core-node test/files.test.ts test/form-files.test.ts`

---

### Task 4: Wizard engine   (Lane A, risk: high)

**Files:** Create `src/wizard/wizard-tools.ts`, `src/wizard/index.ts`; Modify `src/index.ts`; Test
`test/wizard.test.ts`.

**Interfaces — Produces:**
```ts
interface WizardStep { name: string; title?: string; input: StandardSchemaV1; jsonSchema?: JsonSchema; files?: Record<string, FileFieldSpec>; options?: Record<string, OptionsProvider> }
interface WizardToolOptions {
  name: string; description: string; title?: string; steps: WizardStep[]
  getData(): Record<string, Record<string, unknown>>
  setData(next: Record<string, Record<string, unknown>>): void
  getCurrent(): string; goTo(step: string): void
  currentAdapter?: () => FormAdapter | undefined
  submit(): Promise<ToolResult<unknown>>
  submitSummary?: (data: Record<string, Record<string, unknown>>) => string
}
function createWizardTools(tm: Toolmark, opts: WizardToolOptions & { scope?: Scope }): { dispose(): void }
interface StepwiseWizardOptions { name: string; description: string; title?: string; currentAdapter: () => FormAdapter | undefined; currentStep: () => { name: string; input: StandardSchemaV1 }; next(): Promise<ToolResult<unknown>>; previous(): void; submit(): Promise<ToolResult<unknown>> }
function createStepwiseWizardTools(tm: Toolmark, opts: StepwiseWizardOptions & { scope?: Scope }): { dispose(): void }
```

**Behaviour:**
- `createWizardTools` registers `<name>.fill` (input `{ steps: { [step]: Partial<values> }, overwrite?: boolean }`), `<name>.goTo` (`{ step: enum }`), `<name>.submit` (consequential), and `<name>.options` if any step has options (field enum uses `step.field`).
- Fill: per step, same semantics as form fill (merge-based validation per step schema, arrays, files, null/undefined). The **current** step is applied through `currentAdapter()` when provided (dirty-aware); other steps are merged into `getData()` and written with one `setData` call. Returns `ok({ changes: FieldChange[] /* paths prefixed "step." */, skipped, issuesByStep? })`; any step invalid → `invalid` (paths prefixed with the step name) and nothing is written.
- Undo restores every step touched.
- `createStepwiseWizardTools` registers `<name>.step.fill` (current step schema), `<name>.next`, `<name>.previous`, `<name>.submit`, all with `mode: 'stepwise'`.

**Tests (write first):**
- `wizard_fill_multiple_steps_one_call` · `wizard_invalid_step_writes_nothing` · `wizard_current_step_respects_dirty` (review focus 1) · `wizard_goto_and_submit_confirmation` · `wizard_undo_all_steps` · `wizard_options_step_field_enum` · `stepwise_tools_and_mode`.

**Task gate:** `pnpm -F @toolmark/core exec vitest run --project core-node test/wizard.test.ts`

---

### Task 5: DOM form adapter and schema synthesis   (Lane B, risk: high)

**Files:** Create `src/dom/elements.ts`, `src/dom/form-adapter.ts`, `src/dom/synthesize.ts`,
`src/dom/index.ts`; Test `test/dom-form-adapter.test.ts`, `test/dom-synthesize.test.ts`.

**Interfaces — Produces:**
```ts
function domFormAdapter(form: HTMLFormElement, opts?: { submit?: (form: HTMLFormElement) => Promise<ToolResult<unknown>> }): FormAdapter
function synthesizeFormSchema(form: HTMLFormElement): JsonSchema
function discoverFields(form: HTMLFormElement): Array<{ path: string; element: Element; kind: 'input' | 'select' | 'textarea' | 'custom' }>
```

**Behaviour:**
- Fields: form-owned controls with a `name` (incl. `form=` attribute association), open shadow roots of descendants, and form-associated custom elements (`constructor.formAssociated === true` with `name` + `value`). `fieldset[name]` nests paths (`contact.email`).
- Synthesis follows spec §10.2's table exactly; descriptions from `toolparamdescription` → the form's `data-tool-param-<name>` attribute → associated `<label>` text → `aria-description`; file inputs → `fileFieldSchema({ accept, multiple })`; password and `autocomplete^="cc-"` fields are **excluded**.
- `setValues` uses the prototype's native `value`/`checked` setter (so React-controlled inputs update), selects options by value, sets files via `DataTransfer`, then dispatches bubbling `input` and `change` events.
- `dirtyPaths` = fields changed by trusted (`isTrusted`) user `input`/`change` events since load.
- `submit` default: `form.requestSubmit()` → `ok({ submitted: true })`; custom `opts.submit` overrides.

**Tests (write first):** (browser mode)
- `synthesize_types_table` (one fixture form with every control in §10.2) · `synthesize_descriptions_precedence` · `synthesize_excludes_password_and_cc`.
- `dom_fill_sets_native_controls` · `dom_fill_updates_react_controlled_input` (review focus 3) · `dom_fill_files_via_datatransfer` · `dirty_only_from_trusted_events` · `shadow_and_form_associated_fields_found`.

**Task gate:** `pnpm -F @toolmark/core exec vitest run --project core-browser test/dom-form-adapter.test.ts test/dom-synthesize.test.ts`

---

### Task 6: `scanDom` — forms, buttons, tables, observation   (Lane B, risk: normal)

**Files:** Create `src/dom/scan.ts`, `src/dom/button-tools.ts`, `src/dom/table-tools.ts`; Modify
`src/dom/index.ts`; Test `test/dom-scan.test.ts`, `test/dom-table.test.ts`.

**Interfaces — Produces:**
```ts
function scanDom(opts?: { root?: Document | Element | ShadowRoot; observe?: boolean }): (tm: Toolmark) => () => void
```

**Exact values:** attributes `toolname`, `tooldescription`, `toolautosubmit`, `toolparamdescription`,
`data-tool`, `data-tool-description`, `data-tool-group`, `data-tool-readonly`,
`data-tool-consequential`, `data-tool-destructive`, `data-tool-confirm`, `data-tool-column`,
`data-tool-type`, `data-tool-param-<name>`, `data-tool-options-url`.

**Behaviour:**
- Forms with native `toolname`+`tooldescription` → form tools via `createFormTools(domFormAdapter)` + `fromJsonSchema(synthesizeFormSchema(form))`, `origin: 'native-form'`; `toolautosubmit` absent → submit stays consequential; present → submit has no confirmation hint. Forms with `data-tool` + `data-tool-description` → same with `origin: 'dom'`.
- `data-tool-group` on an ancestor → a scope named by the group.
- Buttons with `data-tool` → action tool, run = `button.click()` → `ok({ clicked: true })`; hints from attributes; `data-tool-confirm` → summary text.
- Tables with `data-tool` + `th[data-tool-column]` → `<name>` read-only query tool, `untrustedContent`, input `{ where?: { [column]: string }, limit?: integer (1–500, default 50) }` → `ok({ rows, total })`; `where` is case-insensitive substring match; `data-tool-type="number"` columns parse numbers.
- `data-tool-options-url` on a field → options provider fetching `<url>?q=<query>` (`credentials: 'same-origin'`) expecting `[{ value, title }]`.
- `observe: true` → `MutationObserver` on the root and every discovered open shadow root; added/removed/attribute changes re-sync tools (disposing removed ones).

**Tests (write first):**
- `native_form_registered_with_origin` · `data_tool_form_and_group_scope` · `autosubmit_controls_confirmation` · `button_tool_clicks_and_hints` · `table_query_where_and_limit` · `table_limit_capped` (review focus 4) · `options_url_provider` · `observer_adds_and_removes_tools` · `shadow_root_observed`.

**Task gate:** `pnpm -F @toolmark/core exec vitest run --project core-browser test/dom-scan.test.ts test/dom-table.test.ts`

---

### Task 7: `useWizardTool` (React)   (Lane C, risk: normal)

**Files:** Create `packages/react/src/use-wizard-tool.ts`; Modify `src/index.ts`,
`src/use-form-tool.ts` (pass-through of `options`/`files`); Test `test/use-wizard-tool.test.tsx`.

**Interfaces — Produces:**
```ts
function useWizardTool(opts: {
  name: string; description: string; title?: string; steps: WizardStep[]
  data?: Record<string, Record<string, unknown>>; setData?: (next: Record<string, Record<string, unknown>>) => void
  current: string; goTo(step: string): void
  currentAdapter?: FormAdapter
  next?(): Promise<ToolResult<unknown>>; previous?(): void
  submit(): Promise<ToolResult<unknown>>
}): void
```

**Behaviour:**
- With `data` + `setData` → `createWizardTools`; without → `createStepwiseWizardTools` (requires `next`, `previous`, `currentAdapter`; missing → dev throw `ToolmarkError('invalid_name')`-style code `wizard_misconfigured`, added to the error code list).
- Latest values read through refs; no re-registration on each render.

**Tests (write first):**
- `wizard_hook_parent_state_mode` (steps rendered one at a time, fill non-current step then navigate → data present) · `wizard_hook_stepwise_mode` · `wizard_hook_stable_across_renders`.

**Task gate:** `pnpm -F @toolmark/react exec vitest run test/use-wizard-tool.test.tsx`

---

### Task 8: Inertia pages, props-declared tools, navigation   (Lane D, risk: normal)

**Files:** Create `packages/inertia/src/pages.ts`, `src/props-tools.ts`, `src/navigation.ts`;
Modify `src/index.ts`; Test `test/pages.test.ts`, `test/navigation.test.ts`.

**Interfaces — Produces:**
```ts
interface RouterLike { on(event: 'navigate' | 'success' | 'error' | 'finish', cb: (e: CustomEvent) => void): () => void; visit(url: string, opts?: { method?: string; data?: unknown; preserveState?: boolean }): void }
function inertiaPages(o: { router: RouterLike; initialPage: { props: Record<string, unknown> }; propsKey?: string }): (tm: Toolmark) => () => void
interface PropsToolEntry { name: string; title?: string; description: string; inputSchema: JsonSchema; hints?: ToolHints; visit: { url: string; method: 'get' | 'post' | 'put' | 'patch' | 'delete' } }
function propsTools(tm: Toolmark, entries: PropsToolEntry[], scope: Scope): void
type RouteFn = (params?: Record<string, unknown>) => { url: string; method: string }
function navigationTool(o: { routes: Record<string, RouteFn>; visit: (url: string) => void; name?: string; description?: string }): ToolDefinition<{ route: string; params?: Record<string, unknown> }, { url: string }>
```

**Exact values:** default `propsKey`: `'toolmark'`; default navigation tool name `navigate`, description
`"Navigate to a page in this app. Use route names from the enum."`.

**Behaviour:**
- `inertiaPages` holds one **transparent** page scope; on each `navigate` event disposes it and registers the new page's `props[propsKey]` entries via `propsTools` (input validated with `fromJsonSchema`, `origin: 'server'`).
- A props tool's run calls `router.visit(url, { method, data: input, preserveState: true })` and resolves on the next `success` → `ok({})`, `error` → `invalid` (keys → paths), `finish` without either → `ok({})`.
- `navigationTool` input `route` is an enum of the route keys; run → `visit(route(params).url)` → returns `ok({ url })` immediately (before the page swap disposes scopes); a throwing `RouteFn` → `refused` `navigation_failed`.

**Tests (write first):**
- `props_tools_registered_with_server_names` · `props_tool_success_and_error_mapping` · `navigation_ok_then_old_props_tools_gone` (review focus 5) · `navigation_route_enum_and_failure`.

**Task gate:** `pnpm -F @toolmark/inertia exec vitest run test/pages.test.ts test/navigation.test.ts`

---

### Task 9: Inertia `<Form>` component adapter   (Lane E, risk: normal)

**Files:** Create `packages/inertia/src/form-component.ts`; Modify `packages/inertia/src/index.ts`
(one export line); Test `packages/inertia/test/form-component.test.tsx`.

**Interfaces — Produces:**
```ts
function inertiaFormComponentAdapter(o: { element: HTMLFormElement; formRef: { current: { submit(): void } | null }; router: RouterLike }): FormAdapter
```

**Behaviour:** values/dirty/setValues from `domFormAdapter(element)`; `submit` calls
`formRef.current.submit()` and resolves on the next router `success` → `ok({})`, `error` →
`invalid`, `finish` alone → `ok({})`; missing ref → `error` result `"Form is not mounted"`.

**Tests (write first):** `form_component_fill_and_submit_success` · `form_component_submit_errors_invalid` · `form_component_unmounted_error` (render a real Inertia `<Form>` from `@inertiajs/react` 3.7.1 with a stubbed router).

**Task gate:** `pnpm -F @toolmark/inertia exec vitest run test/form-component.test.tsx`

---

### Task 10: Example pages, guides, changeset   (Lane E, risk: normal)

**Files:** Create `examples/react-vite/src/wizard.tsx`, `src/dom-page.tsx`,
`public/plain-form.html`, `e2e/wizard.spec.ts`, `e2e/dom.spec.ts`; `docs/guides/forms.md`,
`wizards.md`, `files.md`, `dom.md`, `inertia.md`; `.changeset/m2-forms.md`.

**Behaviour:**
- Wizard page mirrors a real pattern: three steps, one `useForm` per step, parent `useState` data, one step mounted at a time; `useWizardTool` with `currentAdapter`.
- DOM page: plain HTML form with native attributes + a `data-tool` table + button, scanned by `scanDom`.
- Guides document every public name added in M2 with a runnable snippet, the JSON-Schema-subset keyword list, the files security model, and the `data-tool-*` attribute reference.

**Tests (write first):** `e2e/wizard.spec.ts`: `wizard_fill_all_steps_one_call`, `wizard_submit_confirmation`; `e2e/dom.spec.ts`: `plain_form_filled_and_skips_user_field`, `table_query_returns_rows`.

**Task gate:** `pnpm -F @toolmark-examples/react-vite exec playwright test` then lane gate `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.

---

## Self-review

- **Spec coverage:** §8.1 arrays/options/files → T1–T3; §8.2 → T4/T7; §8.3 → T1/T2; §8.4 → T3; §10.1
  → T8/T9; §10.2 → T5/T6 (shadow DOM + form-associated CEs in T5/T6); §12.4 → T8; §14 files → T3.
- **Placeholders:** none. New error code `wizard_misconfigured` recorded in T7 and must be appended
  to the M1 error-code list in `docs/guides/forms.md`.
- **Names:** `createWizardTools`, `createStepwiseWizardTools`, `useWizardTool`, `fromJsonSchema`,
  `FileRef`, `domFormAdapter`, `scanDom`, `inertiaPages`, `propsTools`, `navigationTool`,
  `inertiaFormComponentAdapter` match the overview registry (registry gains the last two).
- **Ownership:** `packages/inertia/src/index.ts` is Lane D's except the single export line for
  `form-component.ts` granted to Lane E; `packages/react/src/index.ts` is Lane C's in this plan.
