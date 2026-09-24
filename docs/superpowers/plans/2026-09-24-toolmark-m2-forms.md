# Toolmark M2 — Forms Complete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `sdd-lanes` to implement this plan lane by lane.
> Plan-lite format. Requires M1 merged.

**Goal:** Every form shape an app has becomes a tool: arrays, async options, files, multi-step
wizards, uncontrolled/DOM forms (incl. Inertia `<Form>` and plain HTML), buttons and tables, Inertia
page scopes, props-declared server tools and navigation. M2 is done when the wizard round budget
(success criterion 1) is met in `examples/react-vite` and the M2 tarballs pass the smoke test.

**Architecture:** Core gains array semantics, options, files, a zero-dependency JSON-Schema-subset
validator (so JSON-Schema-only tools — DOM-synthesized and server-declared — are validated too), the
wizard engine and the DOM layer (`@toolmark/core/dom`). React and Inertia add thin bindings.

**Tech Stack:** as M1 (overview versions), plus `playwright` (dev, same version as
`@playwright/test`) for core's browser-mode project.

**Spec:** §4 (`/dom`), §5 (`tm.info`), §6 (codes), §8 (all), §9 (`useWizardTool`), §10 (all), §12.4,
§12.5 (props builder), §14 (files, prompt injection, privacy), §18, §20 (M2 row), §23. Overview:
`2026-09-24-toolmark-00-overview.md`; M1 plan for existing names.

## Global constraints (M2 additions)

- **Stack currency:** before Wave 0, re-run `npm view <pkg> version` for every overview version this
  plan uses (plus `playwright`) and record bumps in the M2 ledger.
- **Files:** default `maxBytes` `10485760` (10 MiB); default URL fetch timeout `30000` ms
  (`files.timeoutMs`). URL fetching is disabled unless `files.allowOrigins` is non-empty; every
  entry must equal `new URL(entry).origin` (`'*'`, a trailing slash or a path is a
  misconfiguration). Only `https:` URLs, or `http:` whose hostname is `localhost` or `127.0.0.1`,
  with no username/password, are fetched, with exactly `credentials: 'omit'`, `redirect: 'error'`,
  `referrerPolicy: 'no-referrer'`, `cache: 'no-store'`, `mode: 'cors'`.
- **Options:** at most `50` options returned per call; provider timeout `10000` ms. Option and file
  keys are dot paths; `[]` denotes any array index (`people.reviewers[].id`).
- **Tables:** query `limit` default `50`; values above `500` are clamped to `500`.
- **JSON-Schema subset** supported by `fromJsonSchema` (exact list): `type` (string or array of
  types), `enum`, `const`, `properties`, `required`, `additionalProperties` (boolean), `items`,
  `minItems`, `maxItems`, `uniqueItems`, `minLength`, `maxLength`, `pattern` (compiled with the `u`
  flag), `minimum`, `maximum`, `multipleOf`, `format` (`date`, `time`, `date-time`, `email`, `uri`),
  `anyOf`, `oneOf`, `allOf`, `$defs`, `$ref` (local `#/$defs/<name>` only), `default`, `title`,
  `description`. Any other `$ref` or an invalid `pattern` rejects the schema
  (`ToolmarkError` `schema_conversion_failed`). Other keywords are ignored and listed in the docs.
- **Reserved `refused` codes used here:** `file_rejected`, `navigation_failed` (spec §6).
- **New `error` event codes:** `wizard_misconfigured`, `files_misconfigured` (dev → throw
  `ToolmarkError(code)`; prod → event, tools not registered / URL fetching disabled);
  `invalid_props_tool`, `options_url_rejected`, `wizard_current_step_unsynced` (event only, dev and
  prod, never thrown). Reused from M1: `files_not_configured` (dev event), `duplicate_name` (for
  props tools: event only, never thrown). `docs/guides/forms.md` lists them under "Codes added in
  M2"; M4 T7 collects every code into `docs/reference/codes.md`.
- **Security-tagged tasks** (`risk: high, security`, most capable model for implementation and
  review): T3 (file fetching), T5 and T6 (DOM scanning of page content), T8 (server-declared tools,
  navigation), T11 (Laravel props builder docs).
- **TSDoc with every export:** each task writes the TSDoc comment of every public name it adds.
- `@toolmark/core/dom` has no top-level DOM access, so it imports under Node (SSR) and in the tarball
  smoke test.
- Node-project tests build registries with `createTestRegistry` (`packages/core/test/helpers/`,
  M1 Task 4); browser-mode tests may call `createToolmark` directly.
- Nothing is published to npm; the milestone ends with packed `-next` tarballs that pass
  `node scripts/tarball-smoke.mjs dist-tarballs` (Task 12). Consumption by any app is outside this
  plan and is not verified here.

## Rulings made while planning

- **Arrays are units in `changes`:** a change to `sponsors` reports the whole array before/after;
  the array counts as user-edited if any dirty path lies under it.
- **Wizard data flow:** the wizard writes non-current steps into parent data and the **current**
  step through its mounted `FormAdapter` (optional `currentAdapter`), which updates the visible form
  and preserves per-field dirty tracking.
- **Transparent scopes:** `tm.scope(name, { transparent: true })` groups tools for disposal without
  prefixing names, so server-declared tools keep the names the server gave them.
- **Tool origin + native name:** tools carry `origin` (`'code' | 'native-form' | 'dom' |
  'server'`) and, for native `toolname` forms, `nativeName = toolname`; both are read through
  `tm.info(name)` (never in the manifest) so the M3 WebMCP consumer skips tools the browser already
  exposes (spec §5, §11.2, §23).
- **Inertia `<Form>` adapter** is built in Wave 2 because it composes the DOM adapter (Lane B) with
  Inertia router events (Lane D).

## Rulings made while fixing (plan audit, pass 2)

- **Array-op and file schemas are inserted after `stripRequired`:** the fill manifest schema is
  `stripRequired(input)` with each array property wrapped in the array-op `anyOf` and each file
  path replaced by `fileFieldSchema(...)` afterwards, so their `required`/`oneOf` survive. M1's
  `stripRequired` is unchanged (no `x-toolmark` marker).
- **`fromJsonSchema` implements Standard JSON Schema** (`~standard.jsonSchema`), so M1's
  `resolveJsonSchema` picks it up unchanged.
- **Props tools whose `visit.method` is not `get` are at least `consequential`** (a server
  `destructive` hint is kept; `readOnly` is dropped) — unconfirmed server mutations would bypass D7.
- **Props-tool name collisions** are reported as a `duplicate_name` event and the entry is skipped,
  never thrown (a throw inside a router event handler breaks navigation).
- **Missing file resolver:** a `{ ref }` without `files.resolve` → `refused` `file_rejected`
  (`"File references are not configured"`) plus the dev event `files_not_configured` (replaces
  M1's placeholder rejection).
- **Select/radio titles** are carried as `enum` plus the titles in `description`
  (`"Options: <value> = <label>; …"`), with no custom keyword.
- **Wizard fill results** are `ok({ changes, skipped })` / `invalid` with paths `<step>.<path>`;
  there is no separate `issuesByStep` (spec §8.2's per-step issues are the step-prefixed paths).
- **Wizard without `currentAdapter`** calls an optional `resetCurrent(values)`; with neither, the
  dev event `wizard_current_step_unsynced` fires once.
- **Stepwise wizards** expose `refresh()`; `useWizardTool` calls it when `current` changes so
  `<name>.step.fill` always carries the current step's schema.
- **Inertia visits settle through per-visit callbacks** (`visit-outcome.ts`); `finish` alone is an
  `error`, never `ok`. M1's `inertiaAdapter.submit` adopts the same mapping (Lane D owns that change).
- **Disabled or hidden DOM buttons** → `refused` `not_allowed` (`"Button is disabled or hidden"`).
- **Table `limit`** has no schema maximum; values above 500 are clamped (never `invalid`).
- **Wizard per-step lenses** are declined for 1.0 (pass-1 ruling); wizard data stays keyed by step.
- **Round-budget wizard script** uses 4 rounds (describe, options, fill, submit); the test asserts
  `≤ 5`.

## Review focus

1. **Wizard fill while the user has typed on the current step** → the mounted step form shows the
   agent's values for untouched fields and keeps the user's (Task 4 `wizard_current_step_respects_dirty`).
2. **File URL that redirects, is `http:` off-localhost or carries userinfo** → `file_rejected`, no
   request with credentials or referrer (Task 3 `url_redirect_rejected`, `url_non_https_rejected`,
   `url_userinfo_rejected`).
3. **React-controlled inputs, checkboxes, radios and selects filled through the DOM adapter** →
   React state updates (Task 5 `dom_fill_updates_react_controlled_input`,
   `dom_fill_react_checkbox_radio_select`).
4. **User HTML inside the scanned root** (`data-tool-ignore`, `contenteditable`, `iframe`,
   `template`) → never becomes a tool (Task 6 `ignored_subtree_not_scanned`); a submit button is
   never an unconfirmed tool (Task 6 `submit_button_tool_is_consequential`); a CSRF hidden field
   never reaches a schema (Task 5 `synthesize_excludes_hidden_and_disabled`).
5. **Navigating away** → the navigation call returns `ok` and the old page's server tools become
   `unknown_tool` (Task 8 `navigation_ok_then_old_props_tools_gone`); a non-GET route is refused
   (`navigation_rejects_non_get_route`); a failed props visit is never `ok`
   (`props_tool_http_exception_is_error`).
6. **Wizard round budget** → `wizard_within_5_rounds` green with zero `invalid`/`refused` (Task 10).

## Milestone exit check

M2 is done when, on `main` with every lane merged:

1. `pnpm lint && pnpm typecheck && pnpm test && pnpm build` pass and CI is green (Inertia 2.3.28 and
   3.7.1 legs).
2. `examples/react-vite/e2e/round-budget.spec.ts` › `wizard_within_5_rounds` is green (wizard with
   3 steps and one async `options` field; ≤ 5 rounds; zero `invalid`/`refused`), and
   `simple_form_within_3_rounds` (M1) stays green.
3. `node scripts/tarball-smoke.mjs dist-tarballs` exits 0 on the M2 tarballs (incl. `@toolmark/core/dom`).
4. `docs/release/next-tarballs.md` has the M2 entry and `docs/release/round-budget.md` shows the
   `simple-form` and `wizard` rows from the M2 run.

## File structure

```
packages/core/src/forms/paths.ts          (modify: array ops, flatten opts)
packages/core/src/forms/form-tools.ts     (modify: arrays, options, files)
packages/core/src/forms/options.ts        options tool
packages/core/src/files.ts                FileRef, FilesOptions, fileFieldSchema, resolveFileRef (internal)
packages/core/src/json-schema/validate.ts JSON-Schema-subset validator
packages/core/src/json-schema/from-json-schema.ts  fromJsonSchema → StandardSchemaV1 & StandardJSONSchemaV1
packages/core/src/wizard/wizard-tools.ts  createWizardTools, createStepwiseWizardTools
packages/core/src/wizard/index.ts
packages/core/src/scope.ts · registry.ts · tool.ts · manifest.ts   (modify: transparent scopes, mode, origin, nativeName, info)
packages/core/src/schema.ts · call.ts     (modify, M1 files: libraryOptions pass-through; file_rejected mapping)
packages/core/src/dom/elements.ts         field discovery + name→path parsing (internal)
packages/core/src/dom/form-adapter.ts     domFormAdapter
packages/core/src/dom/synthesize.ts       synthesizeFormSchema
packages/core/src/dom/scan.ts             scanDom
packages/core/src/dom/button-tools.ts · table-tools.ts · options-url.ts
packages/core/src/dom/index.ts            (stub created by Lane A in T1, then Lane B's)
packages/core/package.json · tsdown.config.ts   (modify: ./dom export + entry, devDeps)
packages/core/vitest.browser.config.ts    core-browser Vitest project
vitest.config.ts                          (modify: append the core-browser project)
pnpm-workspace.yaml                       (modify: catalog entry `playwright`)
packages/react/src/use-wizard-tool.ts
packages/react/src/use-form-tool.ts · rhf/index.ts · index.ts   (modify, M1 files)
packages/inertia/src/router-like.ts · visit-outcome.ts · pages.ts · props-tools.ts · navigation.ts · form-component.ts
packages/inertia/src/inertia-adapter.ts · index.ts               (modify, M1 files)
examples/react-vite/src/{wizard.tsx,dom-page.ts}  examples/react-vite/plain-form.html
examples/react-vite/src/{app.tsx,in-page-agent.ts} · vite.config.ts   (modify, M1 files)
examples/react-vite/e2e/{wizard,dom}.spec.ts  e2e/round-budget.spec.ts (modify, M1 file)
docs/guides/{forms,wizards,files,dom,inertia}.md  docs/guides/laravel-reference.md (modify, M1 file)
docs/release/{next-tarballs,round-budget}.md (modify, M1 files)
.changeset/m2-forms.md
```

## Lanes

| Wave | Lane | Tasks | Owns files | Consumes |
| --- | --- | --- | --- | --- |
| 0 | A (high, security) | 1–4 | `packages/core/src/{forms,json-schema,wizard}/**`, `src/files.ts`, `src/scope.ts`, `src/registry.ts`, `src/tool.ts`, `src/manifest.ts`, `src/index.ts`, and for M2 changes only the M1 files `src/schema.ts`, `src/call.ts`, `src/undo.ts`; `src/dom/index.ts` (T1 stub only); `packages/core/package.json`, `packages/core/tsdown.config.ts`, `pnpm-workspace.yaml` (catalog line), `pnpm-lock.yaml`, `packages/core/vitest.browser.config.ts`, root `vitest.config.ts`, core tests `test/{form-arrays,scope-transparent,registry-info,browser-smoke,json-schema,form-options,files,form-files,call-files,wizard}.test.ts` | M1 |
| 1 | B (high, security) | 5–6 | `packages/core/src/dom/**` (incl. `index.ts` after T1), `packages/core/test/dom-*.test.ts`, `packages/core/test/ssr-dom-entry.test.ts`, `packages/core/test/fixtures/dom/**` | A |
| 1 | C (normal) | 7 | `packages/react/src/use-wizard-tool.ts`; M1 files `packages/react/src/use-form-tool.ts`, `src/rhf/index.ts`, `src/index.ts`; `packages/react/test/{use-wizard-tool,use-form-tool-options,rhf-arrays}.test.tsx` | A |
| 1 | D (high, security) | 8 | `packages/inertia/src/{router-like,visit-outcome,pages,props-tools,navigation}.ts`; M1 files `packages/inertia/src/inertia-adapter.ts`, `src/index.ts` (except Lane E's one line); `packages/inertia/test/{pages,props-tools,navigation}.test.ts`, `test/inertia-adapter-outcome.test.tsx` | A |
| 2 | E (normal; T11 high, security) | 9–12 | `packages/inertia/src/form-component.ts` (+ its export line in `index.ts`), `packages/inertia/test/form-component.test.tsx`, `examples/**` except `package.json` (incl. M1's `src/app.tsx`, `src/main.tsx`, `src/in-page-agent.ts`, `vite.config.ts`, `e2e/round-budget.spec.ts`, `e2e/support/round-recorder.ts`), `docs/guides/**` (incl. M1's `laravel-reference.md`), M1's `docs/release/{next-tarballs,round-budget}.md`, `.changeset/m2-forms.md`, M1's `scripts/tarball-smoke.mjs` (only if Task 12 finds the `./dom` entry unhandled) | A–D |

Dependencies are declared in Wave 0 only (Task 1): Wave-1/2 lanes must not add dependencies
(report to the controller instead). No example dependency is added in M2 (the example already has
`react-hook-form`, `zod`, and the workspace packages).

Core tests for DOM run in Vitest **browser mode**: Task 1 adds `packages/core/vitest.browser.config.ts`
(project `core-browser`, include `test/{dom,browser}-*.test.ts`) and appends it to the root
`vitest.config.ts` project list; `core-node` (M1) already excludes those files. React fixtures in core
tests use `React.createElement` with `react-dom/client` `createRoot` (no JSX, no testing-library), so
core's tsconfig needs no `jsx` setting. Core gates run from the root:
`pnpm exec vitest run --project core-node|core-browser <files>`.

---

### Task 1: Arrays, transparent scopes, tool `mode`/`origin`/`nativeName`, `tm.info`, `./dom` subpath   (Lane A, risk: high)

**Files:** Modify `src/forms/paths.ts`, `src/forms/form-tools.ts`, `src/scope.ts`,
`src/registry.ts`, `src/tool.ts`, `src/manifest.ts`, `src/index.ts`, `packages/core/package.json`,
`packages/core/tsdown.config.ts`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, root `vitest.config.ts`
(append `'packages/core/vitest.browser.config.ts'`); Create `packages/core/vitest.browser.config.ts`,
`src/dom/index.ts` (stub `export {}`, handed to Lane B); Test `test/form-arrays.test.ts`,
`test/scope-transparent.test.ts`, `test/registry-info.test.ts`, `test/browser-smoke.test.ts`.

**Interfaces — Produces:**
```ts
tm.scope(name: string, opts?: { when?: boolean; transparent?: boolean }): Scope
scope.scope(name: string, opts?: { when?: boolean; transparent?: boolean }): Scope
type ToolOrigin = 'code' | 'native-form' | 'dom' | 'server'
interface ToolDefinition { mode?: 'stepwise'; origin?: ToolOrigin; nativeName?: string }   // origin default 'code'
interface ToolManifestSummary { mode?: 'stepwise' }                                        // origin/nativeName NOT in any manifest
interface Toolmark { info(name: string): { origin: ToolOrigin; nativeName?: string } | undefined }
function flatten(obj: unknown, opts?: { arraysAsLeaves?: boolean }): Record<string, unknown>  // default true
type ArrayOp = { $append: unknown[] } | { $remove: number[] }
```

**Exact values:**
- `packages/core/package.json` `exports` adds
  `"./dom": { "@toolmark/source": "./src/dom/index.ts", "types": "./dist/dom.d.ts", "import": "./dist/dom.js" }`;
  `tsdown.config.ts` entry map adds `dom: 'src/dom/index.ts'` (`platform: 'neutral'`).
- `packages/core/package.json` devDependencies (catalog versions): `@vitest/browser`,
  `@vitest/browser-playwright`, `playwright` (same version as `@playwright/test`, 1.63.0), `react`,
  `react-dom`, `@types/react`, `@types/react-dom`. `pnpm-workspace.yaml` catalog adds `playwright`.
  Core keeps zero runtime dependencies.
- `packages/core/vitest.browser.config.ts`: project name `core-browser`, include
  `test/{dom,browser}-*.test.ts`, `browser: { enabled: true, provider: playwright() /* from
  @vitest/browser-playwright */, instances: [{ browser: 'chromium' }], headless: true }`,
  `resolve.conditions` and `ssr.resolve.conditions` include `'@toolmark/source'`,
  `optimizeDeps.include: ['react', 'react-dom/client']`.

**Behaviour:**
- Fill values for an array path may be an array (replace), `{ $append: [...] }` or
  `{ $remove: [indexes] }`. `$remove` indexes refer to the current array and are applied in
  descending order. An op object with both keys or any other key, and a duplicate, negative,
  non-integer or out-of-range index → `invalid` issue at that path, nothing set.
- The fill manifest schema is M1's `stripRequired(input)`; afterwards every array property `P` is
  replaced by `{ anyOf: [P, { type:'object', properties:{ $append:{ type:'array', items: <P.items from the unstripped schema> } }, required:['$append'], additionalProperties:false }, { type:'object', properties:{ $remove:{ type:'array', items:{ type:'integer', minimum:0 }, uniqueItems:true } }, required:['$remove'], additionalProperties:false }] }`.
- `$append` items are validated by the merged full-schema run (M1 merge-based validation).
- `changes` report the whole array (before/after). Equality for `changes`, skipping and agent-set
  tracking of arrays is deep JSON-structural equality.
- An array is user-edited if any `dirtyPaths()` entry equals `path` or starts with `path + '.'`
  (and the array differs from the agent-set value). Replace and `$remove` on a user-edited array are
  skipped unless `overwrite: true`; `$append` is applied (existing items untouched).
- Undo restores the whole array.
- A transparent scope adds no name segment; disposing it still disposes its tools; `when` still
  applies; nested `scope.scope(name, { transparent: true })` behaves the same.
- `tm.info(fullName)` returns `{ origin, nativeName? }` for a registered tool, `undefined` otherwise;
  `origin`/`nativeName` never appear in `manifest()`, `describe()` or protocol messages.
- `mode: 'stepwise'` appears in the summary and full manifest entries.

**Tests (write first):**
- `array_replace_append_remove` · `array_remove_out_of_range_invalid` · `array_op_both_keys_invalid` · `array_ops_in_fill_schema` (published schema keeps both branches' `required`) · `array_changes_whole_unit` · `array_user_edited_when_child_dirty` · `array_append_allowed_when_user_edited` · `array_undo_restores_whole_array`.
- `transparent_scope_keeps_names_and_disposes` (incl. a nested transparent `scope.scope`).
- `stepwise_mode_in_manifest` (the bridge `manifest` message containing a stepwise tool passes `validateMessage(_, 'toAgent')`); `origin_not_in_manifest`; `info_returns_origin_and_native_name`.
- `browser_smoke_document_defined` (core-browser project).

**Task gate:** `pnpm exec vitest run --project core-node test/form-arrays.test.ts test/scope-transparent.test.ts test/registry-info.test.ts && pnpm exec vitest run --project core-browser test/browser-smoke.test.ts && pnpm -F @toolmark/core build && test -f packages/core/dist/dom.js`

---

### Task 2: JSON-Schema-subset validator and async options   (Lane A, risk: normal)

**Files:** Create `src/json-schema/validate.ts`, `src/json-schema/from-json-schema.ts`,
`src/forms/options.ts`; Modify `src/forms/types.ts`, `src/forms/form-tools.ts`, `src/index.ts`;
Test `test/json-schema.test.ts`, `test/form-options.test.ts`.

**Interfaces — Produces:**
```ts
function fromJsonSchema<T = unknown>(schema: JsonSchema): StandardSchemaV1<unknown, T> & StandardJSONSchemaV1<unknown, T>
type OptionsProvider = (args: { query: string; signal: AbortSignal }) => Promise<Array<{ value: string | number | boolean; title: string }>>
interface FormToolOptions<V> { options?: Record<string, OptionsProvider> }   // key = field path; `[]` = any array index
```

**Behaviour:**
- `fromJsonSchema` validates exactly the keyword list in the constraints; `$ref` resolves only
  `#/$defs/<name>`; any other `$ref` or an invalid `pattern` throws `ToolmarkError`
  `schema_conversion_failed` at construction. Issue paths use dot notation (array indexes as
  numbers, `a.0.b`). Formats: date `^\d{4}-\d{2}-\d{2}$` + calendar check; time
  `^\d{2}:\d{2}(:\d{2})?$`; date-time `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$`
  + `Date.parse`; email `^[^\s@]+@[^\s@]+\.[^\s@]+$`; uri via `new URL`.
- `~standard.vendor` = `'toolmark'`; `~standard.jsonSchema.input({ target })` and `.output({ target })`
  return a deep copy of `schema` for `target: 'draft-2020-12'` and throw for any other target, so M1's
  `resolveJsonSchema` uses it unchanged.
- When `options` is present, `createFormTools` registers `<name>.options` (`readOnly`,
  `untrustedContent`) with input `{ field: enum(option keys), query?: string }` (`query` default
  `''`) → `ok({ options })` truncated to 50. The provider gets
  `signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(10000)])`; timeout → `error`
  `"Options lookup timed out"`; throw → `error` `"Options lookup failed"`; items not matching
  `{ value: string | number | boolean, title: string }` are dropped.
- A key with `[]` addresses a field inside array items (`sponsors[].memberId`); the fill schema
  describes each option field with its value type and the `description` suffix
  `" (use <name>.options to find valid values)"`.

**Tests (write first):**
- `json_schema_types_enum_required_nested` · `json_schema_string_number_limits` · `json_schema_formats` · `json_schema_anyof_oneof` · `json_schema_allof_type_array_ref` · `json_schema_external_ref_rejected` · `json_schema_invalid_pattern_rejected` · `json_schema_unknown_keywords_ignored` · `from_json_schema_resolves_via_standard_json_schema`.
- `options_tool_registered_and_truncated` · `options_provider_error_result` · `options_provider_timeout` · `options_invalid_items_dropped` · `options_array_row_path` · `options_description_hint_in_fill_schema`.

**Task gate:** `pnpm exec vitest run --project core-node test/json-schema.test.ts test/form-options.test.ts`

---

### Task 3: Files   (Lane A, risk: high, security)

**Files:** Create `src/files.ts`; Modify `src/tool.ts` (`FileRef` moves to `files.ts`; `tool.ts`
imports it), `src/registry.ts` (options `files`, `ctx.files.resolve`), `src/call.ts` (M1 file:
`file_rejected` mapping), `src/schema.ts` (M1 file: optional `libraryOptions` pass-through),
`src/forms/types.ts`, `src/forms/form-tools.ts`, `src/index.ts` (exports `FileRef` once); Test
`test/files.test.ts`, `test/form-files.test.ts`, `test/call-files.test.ts`.

**Interfaces — Produces:**
```ts
type FileRef = { ref: string } | { url: string }
interface FilesOptions { resolve?: (ref: string, ctx: { signal: AbortSignal }) => Promise<File>; allowOrigins?: string[]; maxBytes?: number; timeoutMs?: number }
interface ToolmarkOptions { files?: FilesOptions }
interface FileFieldSpec { accept?: string[]; maxBytes?: number; multiple?: boolean }
interface FormToolOptions<V> { files?: Record<string, FileFieldSpec> }   // key = field path; `[]` = any array index
function fileFieldSchema(spec: FileFieldSpec): JsonSchema
// M1 schema.ts: resolveJsonSchema(schema, opts?: { libraryOptions?: Record<string, unknown> }) — optional arg added
// internal (not exported): resolveFileRef(ref: FileRef, spec: FileFieldSpec, files: FilesOptions, signal: AbortSignal): Promise<File>
```

**Behaviour:**
- At `createToolmark`: an `allowOrigins` entry that does not equal `new URL(entry).origin`, or a
  non-positive `maxBytes`/`timeoutMs` → `files_misconfigured` (dev throw; prod `error` event and URL
  fetching stays disabled).
- `ctx.files.resolve(ref)` passes `ctx.signal`. `{ ref }` → `files.resolve(ref, { signal })`; no
  resolver → rejects with `ToolmarkError('file_rejected', "File references are not configured")` plus
  the dev event `files_not_configured`.
- `{ url }` is fetched only when every constraint in the Global constraints files bullet holds
  (non-empty `allowOrigins`, protocol, no userinfo, origin listed); fetch init is exactly the listed
  options with `signal = AbortSignal.any([signal, AbortSignal.timeout(files.timeoutMs ?? 30000)])`.
  Rejected: non-2xx, `Content-Length` > limit, streamed bytes > limit (reading is aborted), MIME not
  matching `accept`, timeout. File name = decoded last path segment with `/`, `\` and control
  characters removed, at most 255 chars, else `"download"`.
- Every resolved `File` (`ref` or `url`) is checked against the effective limits:
  `maxBytes = min(field.maxBytes ?? Infinity, files.maxBytes ?? 10485760)`; `accept` matches
  `File.type` exactly or by `type/*`; absent/empty `accept` = any. Violations → `file_rejected`
  naming the path and the limit.
- The call pipeline maps a `ToolmarkError` with code `file_rejected` thrown from `run` to `refused`
  `file_rejected` with its message (no `tool_threw` event).
- Fill order for paths in `files`: (1) validate the input value against `fileFieldSchema(spec)` →
  `invalid` at that path; (2) resolve all refs (array when `multiple`) → any failure → `refused`
  `file_rejected` with the reason and **no** values set; (3) merge the resolved `File`/`File[]` into
  current values and run the form's `input` schema (merge-based).
- Fill manifest schema: when `files` is present the form's JSON Schema is resolved with
  `libraryOptions: { unrepresentable: 'any' }` (verify zod 4.6 honours it through
  `~standard.jsonSchema`), then after `stripRequired` each `files` path is replaced by
  `fileFieldSchema(effective spec)`. If conversion still fails, M1's `schema_conversion_failed` path
  applies and the guide tells apps to pass `jsonSchema`.
- `fileFieldSchema` → `{ type:'object', properties:{ ref:{type:'string'}, url:{type:'string', format:'uri'} }, oneOf:[{required:['ref']},{required:['url']}], additionalProperties:false, description: "File reference. Accepts: <accept joined by ', ' or 'any type'>; max <n> bytes" }`;
  `multiple` → `{ type:'array', items: <that> }`.
- In `changes`, `skipped`, confirmation payloads and any result data a file value is
  `{ file: { name, size, type } }` (arrays for `multiple`); real `File` objects go only to
  `adapter.setValues` and the undo restorer. Undo restores the previous file values.

**Tests (write first):**
- `ref_resolves_via_app_resolver` · `ref_without_resolver_rejected` (asserts dev event `files_not_configured`) · `ref_file_size_limit` · `ref_file_mime_accept` · `field_max_bytes_cannot_exceed_global`.
- `url_disabled_by_default` · `url_origin_not_allowed` · `url_non_https_rejected` · `url_userinfo_rejected` · `allow_origins_star_misconfigured` · `url_redirect_rejected` (review focus 2; asserts the exact fetch init) · `url_fetch_no_referrer_no_store` · `url_fetch_timeout` · `url_size_limit_header_and_stream` · `url_mime_accept` · `url_filename_sanitized`.
- `custom_tool_file_rejection_is_refused` (`test/call-files.test.ts`).
- `form_fill_with_file_sets_file_value` · `form_fill_file_failure_sets_nothing` · `file_ref_shape_invalid_issue_at_path` · `file_field_with_zod_file_schema_fills` (zod 4 `z.file()`) · `file_field_with_instanceof_file_registers` (no `schema_conversion_failed`) · `file_changes_are_json_safe` (`JSON.parse(JSON.stringify(result))` deep-equals result) · `file_undo_restores_previous_files`.

**Task gate:** `pnpm exec vitest run --project core-node test/files.test.ts test/form-files.test.ts test/call-files.test.ts`

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
  resetCurrent?: (values: Record<string, unknown>) => void
  submit(): Promise<ToolResult<unknown>>
  submitSummary?: (data: Record<string, Record<string, unknown>>) => string
}
function createWizardTools(tm: Toolmark, opts: WizardToolOptions & { scope?: Scope }): { dispose(): void }
interface StepwiseWizardOptions { name: string; description: string; title?: string; currentAdapter: () => FormAdapter | undefined; currentStep: () => { name: string; input: StandardSchemaV1; jsonSchema?: JsonSchema }; next(): Promise<ToolResult<unknown>>; previous(): void; submit(): Promise<ToolResult<unknown>>; submitSummary?: () => string }
function createStepwiseWizardTools(tm: Toolmark, opts: StepwiseWizardOptions & { scope?: Scope }): { dispose(): void; refresh(): void }
```

**Behaviour:**
- Empty `steps` or duplicate step names → `wizard_misconfigured` (dev throw; prod event, nothing
  registered).
- `createWizardTools` registers `<name>.fill`, `<name>.goTo` (`{ step: enum }` → `goTo(step)` →
  `ok({ step })`), `<name>.submit` (consequential; summary = `submitSummary(data)` ??
  `"Submit <title ?? name>"`), and `<name>.options` if any step has options (field enum
  `<step>.<path>`).
- Fill manifest schema: `{ type:'object', properties:{ steps:{ type:'object', properties:{ <step>: <step fill schema: stripRequired(step JSON Schema) + array-op/file insertions as T1/T3> }, additionalProperties:false }, overwrite:{ type:'boolean' } }, required:['steps'] }`.
- Fill: per step, the form-fill core semantics (merge-based validation per step schema, arrays,
  files, `null`/`undefined`, redaction). The **current** step: when `currentAdapter()` returns an
  adapter, its live `getValues()` is the merge base and the step is written via `setValues`
  (dirty-aware); otherwise it is merged into parent data and `resetCurrent(values)` is called with
  the step's merged values; with neither, the dev `error` event `wizard_current_step_unsynced` fires
  once per wizard. Non-current steps are merged into `getData()` and written with **one** `setData`
  call. Any step invalid → `invalid` with paths `<step>.<path>` and nothing is written (no `setData`,
  no `setValues`). Otherwise `ok({ changes, skipped })` with paths `<step>.<path>`.
- `<name>.submit` first validates every step's full schema against its data (current step from
  `currentAdapter()` when present) → any issue → `invalid` with paths `<step>.<path>` and **no**
  confirmation is created; otherwise the normal confirmation, then `opts.submit()`.
- Undo restores every step touched: through `currentAdapter()` for the step that is current at undo
  time, otherwise through `setData`.
- `createStepwiseWizardTools` registers `<name>.step.fill` (current step's schema; description
  suffix `" (current step: <step>)"`), `<name>.next` (returns the app's result), `<name>.previous`
  (→ `ok({ step: currentStep().name })` after `previous()`), `<name>.submit` (consequential), all
  with `mode: 'stepwise'`. `refresh()` re-registers `<name>.step.fill` with the current step's schema
  (one `rev` bump) and is a no-op when the step is unchanged.

**Tests (write first):**
- `wizard_fill_multiple_steps_one_call` · `wizard_fill_schema_shape` · `wizard_invalid_step_writes_nothing` · `wizard_current_step_respects_dirty` (review focus 1) · `wizard_current_step_without_adapter_calls_reset` · `wizard_unsynced_event_once` · `wizard_goto_and_submit_confirmation` · `wizard_submit_validates_all_steps_before_confirmation` · `wizard_undo_all_steps` · `wizard_undo_after_step_change` · `wizard_options_step_field_enum` · `wizard_duplicate_step_misconfigured` · `stepwise_tools_and_mode` · `stepwise_fill_schema_follows_current_step`.

**Task gate:** `pnpm exec vitest run --project core-node test/wizard.test.ts`

---

### Task 5: DOM form adapter and schema synthesis   (Lane B, risk: high, security)

**Files:** Create `src/dom/elements.ts`, `src/dom/form-adapter.ts`, `src/dom/synthesize.ts`;
Modify `src/dom/index.ts`; Test `test/dom-form-adapter.test.ts`, `test/dom-synthesize.test.ts`,
`test/dom-react-controlled.test.ts`, `test/ssr-dom-entry.test.ts` (core-node), fixtures under
`test/fixtures/dom/`.

**Interfaces — Produces:**
```ts
function domFormAdapter(form: HTMLFormElement, opts?: { submit?: (form: HTMLFormElement) => Promise<ToolResult<unknown>> }): FormAdapter & { dispose(): void }
function synthesizeFormSchema(form: HTMLFormElement): JsonSchema
// internal (not exported): discoverFields(form) → Array<{ path; element; kind: 'input' | 'select' | 'textarea' | 'custom' }>
```

**Behaviour:**
- Fields = named entries of `form.elements` (includes `form=`-associated controls and
  form-associated custom elements; verify in Chromium/Firefox/WebKit). Controls inside shadow roots
  are not added to an outer form (they are not submitted with it).
- **Excluded** from synthesis, `getValues`, `changes`, `skipped` and `fields()`, and never written by
  `setValues`: `type="hidden"` (e.g. CSRF `_token`), `type="password"`, `autocomplete` starting with
  `cc-`, disabled controls (incl. inside a disabled `fieldset`), and controls with
  `data-tool-ignore` on themselves or an ancestor.
- Names → dot paths: `a.b` → `a.b`; `a[b]` → `a.b`; `a[0][b]` → `a.0.b`; `a[]`, or several
  non-radio controls sharing a name → array at `a`; `fieldset[name]` prefixes its descendants.
  Synthesized objects/arrays nest accordingly and `setValues` maps paths back to the owning controls.
- Synthesis (exact; `synthesize_types_table` asserts it with `toEqual`): text/search/textarea →
  `{type:'string'}` + `minLength`/`maxLength` from attributes, `pattern` = `^(?:<pattern>)$`;
  email → `format:'email'`; url → `format:'uri'`; tel → string; number/range → `type:'integer'` if
  `step` is an integer (default 1) and `min` is absent or an integer, else `number`
  (`step="any"` → `number`, no `multipleOf`); `minimum`/`maximum` from `min`/`max`;
  `multipleOf: step` only when `min` is absent or a multiple of `step`; date → `format:'date'`;
  time → `format:'time'`; datetime-local →
  `{type:'string', pattern:'^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}(:\\d{2}(\\.\\d{1,3})?)?$'}`;
  date/time `min`/`max` → appended to `description` as `"(min <v>, max <v>)"` (enforced by constraint
  validation at submit); single checkbox → `boolean`; checkboxes sharing a name →
  `{type:'array', items:{enum:[values]}, uniqueItems:true}`; radio/select → `{enum:[values]}` with
  `description` suffix `"Options: <value> = <label>; …"`; `<option value="">` is excluded from
  `enum`; `select[multiple]` → array + `uniqueItems`; file → `fileFieldSchema({ accept, multiple })`;
  `required` → `required`; load-time `value`/`checked`/`selected` → `default`; objects
  `additionalProperties: false`.
- Descriptions: `toolparamdescription` on the control → the form's `data-tool-param-<name>` →
  associated `<label>` text → `aria-description`.
- `setValues`: text-like controls via the prototype's native `value` setter; a checkbox/radio whose
  `checked` must change via `element.click()` (React derives `onChange` from `click`; verify with
  React 19); single `select` via `HTMLSelectElement.prototype` `value` setter; `select[multiple]` via
  each option's `selected` setter; files via `DataTransfer`; then dispatch bubbling `input` and
  `change`.
- `dirtyPaths` = paths whose value differs from the load snapshot and is not the value the agent last
  set, plus paths touched by trusted (`isTrusted`) `input`/`change` events; a form `reset` event
  re-snapshots and clears the trusted set.
- Default `submit`: `!form.checkValidity()` → `invalid` with each invalid control's
  `validationMessage` at its path; else `form.requestSubmit()` → `ok({ submitted: true })`. Custom
  `opts.submit` overrides.
- `dispose()` removes every listener the adapter added.
- `src/dom/index.ts` exports `domFormAdapter`, `synthesizeFormSchema`, `scanDom` (T6) and has no
  top-level DOM access.

**Tests (write first):** (browser mode unless noted)
- `synthesize_types_table` (one fixture form with every control above) · `synthesize_descriptions_precedence` · `synthesize_excludes_password_and_cc` · `synthesize_excludes_hidden_and_disabled` (review focus 4).
- `dom_paths_dotted_and_bracket_names` · `dom_array_names_map_to_arrays` · `form_associated_ce_is_field`.
- `dom_fill_sets_native_controls` · `dom_fill_updates_react_controlled_input` (review focus 3) · `dom_fill_react_checkbox_radio_select` · `dom_fill_files_via_datatransfer` · `excluded_controls_never_written`.
- `dirty_only_from_trusted_events_or_snapshot_diff` · `dom_dirty_after_script_change_and_reset` · `dom_undo_restores_values`.
- `dom_submit_constraint_failure_invalid` · `dom_subpath_resolves` (`import('@toolmark/core/dom')` exposes `domFormAdapter`, `synthesizeFormSchema`, `scanDom`).
- `ssr_dom_entry_imports_under_node` (core-node, `test/ssr-dom-entry.test.ts`).

**Task gate:** `pnpm exec vitest run --project core-browser test/dom-form-adapter.test.ts test/dom-synthesize.test.ts test/dom-react-controlled.test.ts && pnpm exec vitest run --project core-node test/ssr-dom-entry.test.ts`

---

### Task 6: `scanDom` — forms, buttons, tables, observation   (Lane B, risk: high, security)

**Files:** Create `src/dom/scan.ts`, `src/dom/button-tools.ts`, `src/dom/table-tools.ts`,
`src/dom/options-url.ts`; Modify `src/dom/index.ts`, `test/ssr-dom-entry.test.ts`; Test
`test/dom-scan.test.ts`, `test/dom-table.test.ts`.

**Interfaces — Produces:**
```ts
function scanDom(opts?: { root?: Document | Element | ShadowRoot; observe?: boolean }): (tm: Toolmark) => () => void   // root default document; observe default true
```

**Exact values:** attributes `toolname`, `tooldescription`, `toolautosubmit`, `toolparamdescription`,
`data-tool`, `data-tool-description`, `data-tool-group`, `data-tool-readonly`,
`data-tool-consequential`, `data-tool-destructive`, `data-tool-confirm`, `data-tool-column`,
`data-tool-type`, `data-tool-param-<name>`, `data-tool-options-url`, `data-tool-ignore` (verify the
native attribute names against the current WebMCP draft at execution; ledger changes).

**Behaviour:**
- **Trusted root:** nothing under `[data-tool-ignore]`, `[contenteditable]` (any value except
  `"false"`), `<iframe>` or `<template>` is scanned. The scanned root must hold only app-authored
  markup (spec §10.2, §14); descriptions come from that markup only.
- Forms with native `toolname` + `tooldescription` → form tools via
  `createFormTools(domFormAdapter(form))` + `fromJsonSchema(synthesizeFormSchema(form))` named by
  `toolname`, `origin: 'native-form'`, `nativeName = toolname` on both `.fill` and `.submit`;
  `toolautosubmit` absent → submit stays consequential; present → submit has no confirmation hint.
  Forms with `data-tool` + `data-tool-description` → same with `origin: 'dom'`.
- `data-tool-group` on an ancestor → a scope named by the group; an invalid group or tool name is
  skipped with an `invalid_name` event (never thrown from the observer).
- Buttons with `data-tool` → action tool (`origin: 'dom'`), run = `button.click()` →
  `ok({ clicked: true })`; hints from attributes; `data-tool-confirm` → summary text. A button whose
  click would submit a form (`type` submit, explicit or default, with a form owner) is
  `consequential` unless `data-tool-readonly` or `data-tool-destructive` says otherwise. A disabled
  button or one failing `checkVisibility()` → `refused` `not_allowed` `"Button is disabled or hidden"`.
- Tables with `data-tool` + `th[data-tool-column]` → `<name>` read-only query tool,
  `untrustedContent`, input `{ where?: { [column]: string }, limit?: { type:'integer', minimum:1 } }`
  (default 50, above 500 clamped to 500) → `ok({ rows, total })`; `rows` = objects keyed by column
  name with trimmed `textContent` (`data-tool-type="number"` columns parse numbers, unparsable →
  `null`); `total` = matching rows before the limit; `where` is a case-insensitive substring match.
- `data-tool-options-url` on a field → options provider: URL = `new URL(attr, document.baseURI)` then
  `searchParams.set('q', query)`; only same-origin URLs are honoured (others ignored + `error` event
  `options_url_rejected`); `credentials: 'same-origin'`; the response must be a JSON array; T2's
  item validation, 50-item truncation and 10 s timeout apply.
- `observe: true` → a `MutationObserver` on the root and every open shadow root found; forms,
  buttons and tables inside open shadow roots are scanned. Mutations are batched per animation
  frame; a tool is re-registered only when its synthesized schema or tool attributes changed (deep
  compare); unchanged tools keep their registrations; removed elements' tools and adapters are
  disposed.
- The disposer disconnects every observer and disposes every adapter and tool. Without `document`
  `scanDom` is a no-op.

**Tests (write first):**
- `native_form_registered_with_origin` · `native_form_info_exposes_native_name` · `data_tool_form_and_group_scope` · `autosubmit_controls_confirmation`.
- `ignored_subtree_not_scanned` (`data-tool-ignore`, `contenteditable`, `iframe`, `template`; review focus 4).
- `button_tool_clicks_and_hints` · `submit_button_tool_is_consequential` · `disabled_button_refused`.
- `table_query_where_and_limit` · `table_limit_capped` · `table_rows_shape_and_total`.
- `options_url_provider` · `options_url_same_origin_only`.
- `observer_adds_and_removes_tools` · `observer_batches_and_skips_unchanged` · `form_in_shadow_root_scanned` · `dispose_disconnects_observers_and_listeners`.
- `scan_dom_ssr_noop` (added to `test/ssr-dom-entry.test.ts`, core-node).

**Task gate:** `pnpm exec vitest run --project core-browser test/dom-scan.test.ts test/dom-table.test.ts && pnpm exec vitest run --project core-node test/ssr-dom-entry.test.ts`

---

### Task 7: `useWizardTool`, options/files pass-through, RHF field arrays (React)   (Lane C, risk: normal)

**Files:** Create `packages/react/src/use-wizard-tool.ts`; Modify (M1 files) `src/index.ts`,
`src/use-form-tool.ts` (pass-through of `options`/`files`), `src/rhf/index.ts` (field arrays); Test
`test/use-wizard-tool.test.tsx`, `test/use-form-tool-options.test.tsx`, `test/rhf-arrays.test.tsx`.

**Interfaces — Produces:**
```ts
function useWizardTool(opts: {
  name: string; description: string; title?: string; steps: WizardStep[]
  data?: Record<string, Record<string, unknown>>; setData?: (next: Record<string, Record<string, unknown>>) => void
  current: string; goTo(step: string): void
  currentAdapter?: FormAdapter
  resetCurrent?: (values: Record<string, unknown>) => void
  next?(): Promise<ToolResult<unknown>>; previous?(): void
  submit(): Promise<ToolResult<unknown>>
  submitSummary?: (data: Record<string, Record<string, unknown>>) => string
}): void
```

**Behaviour:**
- With `data` + `setData` → `createWizardTools`; without → `createStepwiseWizardTools` (requires
  `next`, `previous`, `currentAdapter`; missing → `ToolmarkError` code `wizard_misconfigured` in dev,
  `error` event in prod, nothing registered).
- Option providers, `submit`, `goTo`, `next`, `previous`, `setData`, `resetCurrent` and the adapter
  are read through refs; tools re-register only when `name`, `description`, `title`, step names or
  schema identities change. In stepwise mode a change of `current` calls `refresh()`.
- `useFormTool` passes `options` and `files` to `createFormTools`; providers are read through refs
  (no re-registration when a provider closure changes).
- `rhfAdapter.dirtyPaths` flattens `formState.dirtyFields` with `{ arraysAsLeaves: false }` and
  emits `a.0.b`-style paths for `true` leaves; `setValues` for an array path calls
  `form.setValue(path, array, { shouldDirty: true, shouldValidate: true })` (verify with RHF 7.88
  that this updates a mounted `useFieldArray`'s `fields`; ledger the finding).

**Tests (write first):**
- `wizard_hook_parent_state_mode` (steps rendered one at a time, fill non-current step then navigate → data present) · `wizard_hook_stepwise_mode` · `wizard_hook_stepwise_refresh_on_current_change` · `wizard_hook_missing_stepwise_callbacks_misconfigured` · `wizard_hook_stable_across_renders`.
- `form_tool_options_provider_latest_no_reregister`.
- `rhf_field_array_replace_updates_rows` · `rhf_field_array_user_edit_skips_array`.

**Task gate:** `pnpm -F @toolmark/react exec vitest run test/use-wizard-tool.test.tsx test/use-form-tool-options.test.tsx test/rhf-arrays.test.tsx`

---

### Task 8: Inertia pages, props-declared tools, navigation   (Lane D, risk: high, security)

**Files:** Create `packages/inertia/src/router-like.ts`, `src/visit-outcome.ts`, `src/pages.ts`,
`src/props-tools.ts`, `src/navigation.ts`; Modify (M1 files) `src/index.ts`,
`src/inertia-adapter.ts` (`submit` settles through `visit-outcome`); Test `test/pages.test.ts`,
`test/props-tools.test.ts`, `test/navigation.test.ts`, `test/inertia-adapter-outcome.test.tsx`.

**Interfaces — Produces:**
```ts
type InertiaEventName = 'start' | 'navigate' | 'success' | 'error' | 'finish' | 'httpException' | 'networkError' | 'invalid' | 'exception'
interface VisitCallbacks {
  onSuccess?(): void; onError?(errors: Record<string, string>): void
  onHttpException?(): void; onInvalid?(): void; onNetworkError?(): void; onException?(): void
  onCancel?(): void; onFinish?(): void; onCancelToken?(token: { cancel(): void }): void
}
interface RouterLike { on(event: InertiaEventName, cb: (e: CustomEvent) => void): () => void; visit(url: string, opts?: { method?: string; data?: unknown; preserveState?: boolean } & VisitCallbacks): void }
function inertiaPages(o: { router: RouterLike; initialPage: { props: Record<string, unknown> }; propsKey?: string }): (tm: Toolmark) => () => void
interface PropsToolEntry { name: string; title?: string; description: string; inputSchema: JsonSchema; hints?: ToolHints; visit: { url: string; method: 'get' | 'post' | 'put' | 'patch' | 'delete' } }
function propsTools(tm: Toolmark, entries: unknown[], scope: Scope): void    // entries are untrusted and validated
type RouteFn = (params?: Record<string, unknown>) => { url: string; method: string }
function navigationTool(o: { routes: Record<string, RouteFn>; visit: (url: string, opts: { method: 'get' }) => void; name?: string; description?: string }): ToolDefinition<{ route: string; params?: Record<string, unknown> }, { url: string }>
```

**Exact values:** default `propsKey`: `'toolmark'`; default navigation tool name `navigate`,
description `"Navigate to a page in this app. Use route names from the enum."`; non-GET navigation
message `"Only GET routes can be navigated; declare a server tool for mutations"`.

**Behaviour:**
- `inertiaPages` holds one **transparent** page scope. On attach it registers
  `initialPage.props[propsKey]`; on each `navigate` event it reads `e.detail.page.props[propsKey]`,
  disposes the page scope and registers the new entries. Re-registering identical entries (e.g. a
  `navigate` fired on initial load — verify per major) leaves one registration and bumps `rev` at most
  once. Its disposer disposes the scope and resolves every in-flight props call as `cancelled`
  `signal`. SSR: no-op.
- Each entry is checked: `name` matches the tool-name regex, `description` is a non-empty string,
  `inputSchema` is an object accepted by `fromJsonSchema`, `visit.method` is in the enum,
  `visit.url` is a string. Invalid entries are skipped with `error` event `invalid_props_tool` (dev
  and prod, never thrown). A name collision → `duplicate_name` event, entry skipped, never thrown.
- Props tools carry `origin: 'server'`; input is validated with `fromJsonSchema(inputSchema)`.
  An entry whose `visit.method` is not `get` is at least `consequential` (`destructive` kept,
  `readOnly` dropped); `get` entries keep the server's hints.
- A props tool's run calls `router.visit(url, { method, data: input, preserveState: true, …callbacks })`
  and settles once, via `visit-outcome.ts`: `onSuccess` → `ok({})`; `onError(errors)` → `invalid`
  (keys → paths); `onHttpException`/`onInvalid` → `error` `"Request failed"`;
  `onNetworkError`/`onException` → `error` `"Network error"`; `onCancel` → `cancelled` `signal`;
  `onFinish` with none of these → `error` `"Visit did not complete"`. `ctx.signal` abort cancels the
  visit through the `onCancelToken` token. v2 and v3 callback names are both passed (structural).
- M1's `inertiaAdapter.submit` uses the same mapping (replacing "`onFinish` alone → `ok`").
- `navigationTool`: input `route` is an enum of the route keys; run → `route(params)`; a throwing
  `RouteFn` → `refused` `navigation_failed`; a method other than `get` (case-insensitive) → `refused`
  `navigation_failed` with the exact message; otherwise `visit(url, { method: 'get' })` and `ok({ url })`
  immediately (before the page swap disposes scopes). No hints. The app registers it at the root
  scope (never inside the page scope); the guide says so.
- `form-component.test.tsx` (T9) and this task's tests run in both CI Inertia legs (2.3.28, 3.7.1).

**Tests (write first):**
- `props_tools_registered_with_server_names` · `props_tool_success_and_error_mapping` · `props_tool_http_exception_is_error` · `props_tool_network_error_is_error` · `props_tool_finish_only_is_error` · `props_tool_abort_cancels_visit` · `props_non_get_forced_consequential`.
- `invalid_props_entry_skipped_with_event` · `props_collision_does_not_throw` · `dispose_resolves_inflight_props_call` · `initial_navigate_does_not_duplicate`.
- `navigation_ok_then_old_props_tools_gone` (review focus 5) · `navigation_route_enum_and_failure` · `navigation_rejects_non_get_route`.
- `inertia_adapter_http_exception_is_error` (M1 adapter via `visit-outcome`).

**Task gate:** `pnpm -F @toolmark/inertia exec vitest run test/pages.test.ts test/props-tools.test.ts test/navigation.test.ts test/inertia-adapter-outcome.test.tsx`

---

### Task 9: Inertia `<Form>` component adapter   (Lane E, risk: normal)

**Files:** Create `packages/inertia/src/form-component.ts`; Modify `packages/inertia/src/index.ts`
(one export line); Test `packages/inertia/test/form-component.test.tsx`.

**Interfaces — Produces:**
```ts
function inertiaFormComponentAdapter(o: { element: HTMLFormElement; formRef: { current: { submit(): void } | null }; router: RouterLike }): FormAdapter & { dispose(): void }
```

**Behaviour:** values/dirty/setValues/fields/dispose from `domFormAdapter(element)` (imported from
`@toolmark/core/dom`). `submit` calls `formRef.current.submit()`, captures the visit from the next
router `start` event and settles on that visit's `finish`: an `error` seen → `invalid`;
`httpException`/`invalid` or `networkError`/`exception` seen → `error`; `visit.cancelled ||
visit.interrupted` → `cancelled` `signal`; otherwise `ok({})`. v2 and v3 event names are both
listened to; all listeners are removed on settle. A missing ref → `error` `"Form is not mounted"`.

**Tests (write first):** `form_component_fill_and_submit_success` · `form_component_submit_errors_invalid` · `form_component_http_exception_is_error` · `form_component_interrupted_visit_cancelled` · `form_component_unmounted_error` (render a real Inertia `<Form>` from `@inertiajs/react` with a stubbed router; runs in both CI legs — `<Form>` exists from 2.1, verify on 2.3.28; `formRef.current.submit()` is the documented ref method).

**Task gate:** `pnpm -F @toolmark/inertia exec vitest run test/form-component.test.tsx`

---

### Task 10: Example pages and e2e, incl. the wizard round budget   (Lane E, risk: normal)

**Files:** Create `examples/react-vite/src/wizard.tsx`, `src/dom-page.ts`,
`examples/react-vite/plain-form.html`, `e2e/wizard.spec.ts`, `e2e/dom.spec.ts`; Modify (M1 files)
`src/app.tsx` (a `location.hash` switch, `#/wizard`; no router dependency), `src/main.tsx` (only if
the switch needs it), `src/in-page-agent.ts` (wizard script), `vite.config.ts` (second
`build.rollupOptions.input` entry `plain-form.html`), `e2e/round-budget.spec.ts` (add the wizard
test), `e2e/support/round-recorder.ts` (only if the wizard script needs a helper).

**Behaviour:**
- Wizard page (the common pattern: one `useForm` per step, parent `useState` data, one step mounted
  at a time) inside `<ToolScope name="events">`: `useWizardTool({ name: 'create', … })` with steps
  `basics` (`title` string, `category` enum), `schedule` (`startsAt`, `endsAt` dates), `people`
  (`ownerId` with an async `options` provider over an in-memory list of 20 people with a 50 ms delay,
  `reviewers` array of `{ name }`); `currentAdapter` = the mounted step's `rhfAdapter`; confirm card
  from `usePendingConfirmations`.
- DOM page: `plain-form.html` (project root) holds a plain HTML form with native `toolname`
  attributes, a hidden `_token` field, a `data-tool` table and a `data-tool` button, and loads
  `<script type="module" src="/src/dom-page.ts">`, which creates the toolmark, applies `scanDom()`,
  `bridge({ transport })` from `createInPageChannel()`, and `installTestHook(tm)` (non-production
  builds only, M1 rule).
- `round-budget.spec.ts` › `wizard_within_5_rounds`: the scripted in-page agent (no LLM) starts from
  the attach summary manifest. Round 1: `describe` `events.create.fill`. Round 2: `call`
  `events.create.options` `{ field: 'people.ownerId', query: <name> }`. Round 3: `call`
  `events.create.fill` with all three steps (`ownerId` from round 2). Round 4: `call`
  `events.create.submit` → `needs_confirmation`; the test approves via the confirm card (not a round)
  and the agent receives `confirmed` with `ok`. Asserts `rounds ≤ 5`, zero `invalid`/`refused`
  results, and every step's values present in the page. With `ROUND_BUDGET_REPORT` set it writes
  `{ task: 'wizard', rounds, messages, manifestBytes, describeBytes, wallMs }`.

**Tests (write first):** `e2e/round-budget.spec.ts`: `wizard_within_5_rounds`; `e2e/wizard.spec.ts`:
`wizard_fill_all_steps_one_call`, `wizard_submit_confirmation`, `wizard_user_typed_field_skipped`;
`e2e/dom.spec.ts`: `plain_form_filled_and_skips_user_field`, `table_query_returns_rows`,
`hidden_token_not_in_schema`.

**Task gate:** `pnpm -F @toolmark-examples/react-vite exec playwright test`

---

### Task 11: Guides and the Laravel props builder   (Lane E, risk: high, security)

**Files:** Create `docs/guides/forms.md`, `wizards.md`, `files.md`, `dom.md`, `inertia.md`; Modify
(M1 file) `docs/guides/laravel-reference.md`.

**Behaviour:**
- Guides document every public name added in M2 (registry rows M2) with a runnable snippet, the
  JSON-Schema-subset keyword list, option/file path notation (`[]`), and link to
  `docs/reference/codes.md` (M4).
- `forms.md`: arrays and array ops, options, "Codes added in M2" (the constraints list).
- `files.md`: every §8.4 rule — URL fetching off by default, exact-origin `allowOrigins`, protocol
  and userinfo rules, fetch options, timeout, limits on `ref` and `url` files (field narrows global),
  JSON-safe file values, `files_misconfigured`/`files_not_configured`, and passing `jsonSchema` when
  a file schema cannot be converted.
- `dom.md`: the `data-tool-*` and native attribute reference, the trusted-root rule
  (`data-tool-ignore` for user HTML; `contenteditable`/`iframe`/`template` never scanned), excluded
  controls, submitting buttons are consequential, and that a native (non-SPA) submit navigates, so
  the server sees `timeout` and a fresh `manifest` (D23).
- `inertia.md`: the `toolmark` props shape as public API (§17) with its JSON Schema inline, non-GET
  props tools forced `consequential`, the visit-outcome mapping, GET-only `navigationTool`
  registered at the root scope, a Wayfinder and a Ziggy `RouteFn` wrapper, `<Form>` support
  (`@inertiajs/react` ≥ 2.1, verify).
- `laravel-reference.md` gains the **props builder** (spec §12.5): PHP that builds the `toolmark`
  props entries, includes only tools the current user is authorized to run (policy/`Gate` check
  before rendering, §12.4), and a note that the server re-authorizes every visit it receives. The
  reviewer checks it against §12.4 and §14 line by line.

**Tests:** none beyond the gate; the reviewer checks every snippet against the exported names.

**Task gate:** `for n in createWizardTools createStepwiseWizardTools useWizardTool fromJsonSchema fileFieldSchema scanDom domFormAdapter synthesizeFormSchema navigationTool propsTools inertiaPages inertiaFormComponentAdapter; do grep -rq "$n" docs/guides || { echo "missing $n"; exit 1; }; done && grep -q "props builder" docs/guides/laravel-reference.md`

---

### Task 12: Milestone close — changeset, tarballs, smoke test, round-budget evidence   (Lane E, risk: normal)

**Files:** Create `.changeset/m2-forms.md`; Modify (M1 files) `docs/release/next-tarballs.md`,
`docs/release/round-budget.md`; `scripts/tarball-smoke.mjs` only if it does not already cover the
new `./dom` entry (it must import it under Node, per the Global constraints).

**Behaviour:**
- Changeset: `@toolmark/core`, `@toolmark/react`, `@toolmark/inertia` `minor` (the `fixed` group
  versions all packages together; pre mode `next`, versions only).
- Run the lane gate, then `pnpm changeset version`, commit, then
  `pnpm -r --filter "./packages/*" pack --pack-destination "$PWD/dist-tarballs"` and
  `node scripts/tarball-smoke.mjs dist-tarballs`.
- Run `ROUND_BUDGET_REPORT=<file> pnpm -F @toolmark-examples/react-vite exec playwright test e2e/round-budget.spec.ts`
  and render `docs/release/round-budget.md` from the report as in M1 (one row per task:
  `simple-form`, `wizard`).
- Append the M2 entry (version, each tarball's filename and SHA-256, smoke result) to
  `docs/release/next-tarballs.md`. Consumption by any app is outside this plan and is not verified
  here.

**Task gate:** `pnpm lint && pnpm typecheck && pnpm test && pnpm build` then
`pnpm -F @toolmark-examples/react-vite exec playwright test` then
`node scripts/tarball-smoke.mjs dist-tarballs` exits 0, and both release docs carry the M2 entries
(the Milestone exit check).

---

## Verify at execution (ledger each result)

- zod 4.6 honours `libraryOptions: { unrepresentable: 'any' }` through `~standard.jsonSchema` (T3).
- React 19 checkbox/radio `onChange` from `click` (T5); form-associated custom elements in
  `form.elements` on Chromium/Firefox/WebKit (T5).
- RHF 7.88 `setValue` on an array path updates a mounted `useFieldArray` (T7).
- Inertia per-visit callback names in 2.3.28 and 3.7.1; whether `navigate` fires on initial load;
  `<Form>` availability in 2.3.28 (T8, T9).
- Current WebMCP declarative attribute names (T6).

## Self-review

- **Spec coverage:** §4 `/dom` → T1 (export/entry), T5; §5 `tm.info` → T1, T6; §6 codes → T3, T8;
  §8.1 arrays/options/files → T1–T3, T7 (RHF arrays); §8.2 (incl. submit validates every step) →
  T4/T7; §8.3 → T1/T2; §8.4 (all hardening) → T3; §10.1 (GET-only navigation, malformed props
  skipped) → T8/T9; §10.2 (trusted root, exclusions, dirty rule, submitting buttons, shadow DOM,
  form-associated CEs) → T5/T6; §12.4 → T8, T11; §12.5 props builder → T11; §14 (files, prompt
  injection, privacy, untrusted paths via fill core) → T3, T5, T6; §18 → T1–T10; §20 M2 exit check →
  T10, T12, Milestone exit check.
- **Placeholders:** none. New codes are in the Global constraints and `docs/guides/forms.md`
  (T11); M4 T7 collects them into `docs/reference/codes.md`.
- **Names:** `createWizardTools`, `createStepwiseWizardTools`, `useWizardTool`, `fromJsonSchema`,
  `FileRef`, `domFormAdapter`, `scanDom`, `synthesizeFormSchema`, `inertiaPages`, `propsTools`,
  `navigationTool`, `inertiaFormComponentAdapter`, `ArrayOp`, `OptionsProvider`, `FilesOptions`,
  `FileFieldSpec`, `fileFieldSchema`, `WizardStep`, `WizardToolOptions`, `StepwiseWizardOptions`,
  `RouterLike`, `PropsToolEntry`, `RouteFn`, `ToolOrigin`, `ToolDefinition.nativeName`, `tm.info`
  match the overview registry M2 rows; `discoverFields` stays internal; `resolveFileRef` is internal.
- **Ownership:** lanes are disjoint. M1-owned files modified in M2 have one M2 owner each: core
  `schema.ts`, `call.ts`, `undo.ts`, `tool.ts`, `registry.ts`, `scope.ts`, `manifest.ts`, `index.ts`,
  `forms/**`, `package.json`, `tsdown.config.ts`, root `vitest.config.ts`, `pnpm-workspace.yaml`,
  `pnpm-lock.yaml` → A; react `use-form-tool.ts`, `rhf/index.ts`, `index.ts` → C; inertia
  `inertia-adapter.ts`, `index.ts` → D (Lane E adds one export line); example `app.tsx`, `main.tsx`,
  `in-page-agent.ts`, `vite.config.ts`, `e2e/round-budget.spec.ts`, `e2e/support/round-recorder.ts`,
  `docs/guides/laravel-reference.md`, `docs/release/{next-tarballs,round-budget}.md`,
  `scripts/tarball-smoke.mjs` → E. `src/dom/index.ts` is created by A (T1 stub) and owned by B after.
  Every dependency is declared in Wave 0 (T1).
- **Release independence:** no task, test or gate reads another repository.
