# Forms: arrays, options and JSON-Schema-only forms

This guide covers what M2 adds to form tools (spec §8.1, §8.3): array fill operations, async
`options` lookups, the zero-dependency JSON Schema validator `fromJsonSchema`, and the registry
additions other guides build on. Related guides: [wizards](wizards.md), [files](files.md),
[DOM forms](dom.md), [Inertia](inertia.md). Every error and refusal code is listed in
[`docs/reference/codes.md`](../reference/codes.md) (written in M4); the codes M2 adds are
[listed below](#codes-added-in-m2).

## A form with an array and an options field

```tsx
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import type { OptionsProvider } from '@toolmark/core'
import { useFormTool } from '@toolmark/react'
import { rhfAdapter } from '@toolmark/react/rhf'

const challengeSchema = z.object({
  title: z.string().min(1),
  ownerId: z.string(),
  sponsors: z.array(z.object({ memberId: z.string(), note: z.string().optional() })),
})
type Challenge = z.infer<typeof challengeSchema>

const members: OptionsProvider = async ({ query, signal }) => {
  const res = await fetch(`/api/members?q=${encodeURIComponent(query)}`, { signal })
  const rows = (await res.json()) as Array<{ id: string; name: string }>
  return rows.map((m) => ({ value: m.id, title: m.name }))
}

export function ChallengeForm({ save }: { save: (v: Challenge) => Promise<void> }) {
  const form = useForm<Challenge>({ resolver: zodResolver(challengeSchema) })
  useFormTool(rhfAdapter(form, { onSubmit: save }), {
    name: 'challenge',
    description: 'The new-challenge form.',
    input: challengeSchema,
    options: { ownerId: members, 'sponsors[].memberId': members },
  })
  return <form onSubmit={form.handleSubmit(save)}>{/* fields */}</form>
}
```

This registers `challenge.fill`, `challenge.submit` (consequential) and `challenge.options`
(read-only, `untrustedContent`). `createFormTools(tm, adapter, opts)` from `@toolmark/core` does the
same outside React and returns `{ dispose() }`.

## Fill rules (M1 rules plus M2 rulings)

`<name>.fill` takes `{ values, overwrite? }`. Every rule below fails closed: when one fires, the
result is `invalid` and **nothing** in that fill is written.

- **Undeclared paths are refused.** A nested value that cannot be matched to a declared schema
  node (`$ref`, `allOf`/`anyOf`/`oneOf` and `additionalProperties` are followed) is `invalid` with
  the message `"Undeclared field"`. Open nodes (`{}` / `true`) keep their value after the
  forbidden-key scan.
- **Forbidden keys.** A path segment `__proto__`, `prototype` or `constructor` is refused
  anywhere, including inside array items.
- **Duplicate paths.** The same path reached twice in one fill (`{ "a.b": 1, "a": { "b": 2 } }`,
  two operations on one array, or an operation plus a plain value) → `invalid` at that path with
  `"Duplicate field path"`.
- **Node budget.** One fill visits at most 10000 input nodes (values, array items, `$append`
  operands and file references share the budget). Past it the fill is `invalid` with one issue
  `{ path: "", message: "Input too complex" }`. The public `flatten(obj, opts?)` helper is bounded
  the same way.
- `null` clears a field; `undefined` (an absent key) leaves it unchanged. Fields the user edited
  are skipped (reported in `skipped`) unless `overwrite: true`. Validation is merge-based: the full
  schema runs on the current values merged with the input, and only issues on touched paths count.

## Arrays (D26)

An array field takes one of three values:

| Value                    | Effect                                                             |
| ------------------------ | ------------------------------------------------------------------ |
| `[ ... ]`                | Replaces the whole array.                                          |
| `{ "$append": [ ... ] }` | Appends items; each item is validated against the item schema.     |
| `{ "$remove": [0, 2] }`  | Removes items by index of the current array (applied high to low). |

The `ArrayOp` type (`{ $append: unknown[] } | { $remove: number[] }`) describes the two operations.

```json
{ "values": { "sponsors": { "$append": [{ "memberId": "m_42" }] } } }
```

- An operation with both keys, another key, no key, a non-array operand, or a duplicate,
  negative, non-integer or out-of-range index → `invalid` at the array path.
- **`$`-key operations only on declared arrays.** A `$`-keyed object is read as an operation only
  where the schema declares an array (or declares no object). On a record/object field such as
  `z.record(z.string(), z.any())`, `{ "$schema": "x" }` is plain data. On a scalar field it is
  still an operation and therefore `invalid` ("Array operations apply to array fields only").
- An operation on an array nested inside another array's items is refused (fail closed). An array
  reached through a `$ref`'d object (`$defs`) is accepted at run time but is not advertised with
  the operation branches in the fill schema.
- Arrays are **units** in `changes`: the whole array before and after. The array counts as
  user-edited when a dirty path lies on or under it and its value differs from what the agent last
  set. Replace and `$remove` are then skipped unless `overwrite: true`; `$append` is always
  applied. `tm.undo(callId)` restores the whole array.
- The fill schema advertises each array property as an `anyOf` of the array, the `$append` shape
  (item `required` kept) and the `$remove` shape, inserted after `required` is stripped.

## Async options (D26)

`FormToolOptions.options` maps field paths to an `OptionsProvider`:

```ts
type OptionsProvider = (args: {
  query: string
  signal: AbortSignal
}) => Promise<Array<{ value: string | number | boolean; title: string }>>
```

- Keys are dot paths; `[]` stands for any array index (`sponsors[].memberId`,
  `people.reviewers[].id`). The same notation is used for [file fields](files.md).
- When at least one key is present, `<name>.options({ field, query? })` is registered next to
  `fill`/`submit` and disposed with them. `field` is an enum of the keys; `query` defaults to `''`.
  `options: {}` registers nothing.
- The fill schema keeps the field's own type and adds `" (use <name>.options to find valid values)"`
  to its description.
- The provider's `signal` aborts when the call is cancelled or after **10 seconds**. The call is
  raced against that signal, so a provider that ignores it cannot hang the call.
- Results: at most **50** items; items that are not `{ value: string | finite number | boolean, title: string }` are dropped, and extra keys are removed (only `{ value, title }` reaches the
  agent). The tool is `untrustedContent`.
- Outcomes: caller abort → `cancelled` `signal`; timeout → `error` `"Options lookup timed out"`; a
  throw, rejection or non-array → `error` `"Options lookup failed"` plus an `error` event
  `tool_threw` (the provider's error goes to the event only).
- Keys are not checked against the schema: an undeclared key still gets a working lookup but no
  hint in the fill schema.

## JSON-Schema-only forms: `fromJsonSchema`

`fromJsonSchema<T>(schema)` turns a draft 2020-12 JSON Schema into a synchronous Standard Schema
that also implements Standard JSON Schema. DOM-synthesized forms and server-declared tools use it,
and you can pass it as `input` anywhere a schema is expected:

```ts
import { createToolmark, fromJsonSchema, ok } from '@toolmark/core'

declare function addNote(text: string): Promise<void> // your app code

const tm = createToolmark()
tm.register({
  name: 'notes.add',
  description: 'Add a note to the current record.',
  input: fromJsonSchema<{ text: string }>({
    type: 'object',
    properties: { text: { type: 'string', minLength: 1, maxLength: 2000 } },
    required: ['text'],
    additionalProperties: false,
  }),
  async run({ text }) {
    await addNote(text)
    return ok({})
  },
})
```

**Supported keywords (exact list):** `type` (a string or an array of types), `enum`, `const`,
`properties`, `required`, `additionalProperties` (boolean **or a schema**, which undeclared keys are
validated against), `items`, `minItems`, `maxItems`, `uniqueItems`, `minLength`, `maxLength`
(counted in code points), `pattern` (unanchored, compiled with the `u` flag), `minimum`,
`maximum`, `multipleOf`, `format` (`date`, `time`, `date-time`, `email`, `uri`), `anyOf`, `oneOf`,
`allOf`, `$defs`, `$ref` (local `#/$defs/<name>` only, resolved against the root `$defs`), and the
annotations `default`, `title`, `description`.

**Ignored keywords** (accepted, never checked): every other keyword, for example
`exclusiveMinimum`, `exclusiveMaximum`, `minProperties`, `maxProperties`, `patternProperties`,
`propertyNames`, `dependentRequired`, `dependentSchemas`, `if`/`then`/`else`, `not`, `contains`,
`prefixItems`, `unevaluatedProperties`, `contentMediaType` and unknown `format` values. Keep the
real check on the server when you rely on them.

Other behaviour:

- `default` is an annotation only; the validated value is the input unchanged.
- `integer` means `Number.isInteger`; `number` must be finite; `multipleOf` allows a relative
  1e-9 tolerance. `time` is checked by pattern only (no range check).
- A failed `anyOf`/`oneOf` reports the issues of the closest branch; `oneOf` with more than one
  match → `"Matches more than one allowed schema"`. Evaluation depth is capped at 256.
- The schema is deep-copied at construction; later changes to the argument have no effect.

**Rejected at construction** (`ToolmarkError` `schema_conversion_failed`): a `$ref` other than a
resolvable `#/$defs/<name>`; a pattern that does not compile with `u`; a non-schema value in a
schema position (for example a draft-07 tuple `items: [...]`); a non-object root; and **unsafe
patterns** (ReDoS hardening):

- backreferences (`\1`, `\k<name>`);
- nested quantifiers: a quantified group whose body contains `*`, `+`, `?`, `{n,}` or `{n,m}`
  (`(a+)+`, `(.*a){11}`, `(\d+)*x`); fixed counts inside are fine (`(\d{4}){2}`);
- repeated alternation whose branches overlap: inside a quantified group every alternation must
  have fixed-length literal branches with distinct first characters (`(ab|cd)*` passes; `(a|ab)*`,
  `(\d|x)*` are rejected). Unrepeated alternation is unrestricted.

The check is conservative, so **some safe patterns are rejected too**. The common hostname pattern
`^(?:[a-z0-9-]+\.)+[a-z]{2,}$` is one: rewrite it without the nested quantifier, use `format`, or
validate on the server. A string longer than **10000** UTF-16 code units is never run against a
pattern; it gets the issue `"Value too long for pattern"`. Patterns with adjacent unbounded
quantifiers (such as `\S+@\S+`) are allowed; their cost is bounded by that length cap.

## Registry additions

- **Tool origin.** `ToolDefinition.origin?: ToolOrigin` (`'code' | 'native-form' | 'dom' | 'server'`, default `'code'`) and, for native declarative forms, `ToolDefinition.nativeName`. Both
  are read through `tm.info(name)` → `ToolInfo` (`{ origin, nativeName? }`) and never appear in a
  manifest. `tm.info` also reports a tool hidden by `when` and is not filtered by policy; it
  returns `undefined` for unknown tools and under SSR.
- **`mode: 'stepwise'`** on `ToolDefinition` marks a stepwise wizard's tools; manifest entries
  carry it ([wizards](wizards.md#stepwise-fallback)).
- **Transparent scopes.** `tm.scope(name, { transparent: true })` (`ScopeOptions`) groups tools for
  `when` and disposal without adding a name segment, so tools keep the names they were given.
  `inertiaPages` uses one for server-declared tools.
- **`flatten(obj, { arraysAsLeaves })`** (`FlattenOptions`): arrays are leaves by default;
  `arraysAsLeaves: false` expands them into index paths (`tags.0.name`).

## Development and production

Misconfiguration throws a `ToolmarkError` in development and is reported as an `error` event in
production (spec §14). "Development" means the registry was created with `createToolmark({ dev: true })`: the React hooks follow the registry's flag, not the bundler's environment. An app built
for production that still passes `dev: true` sees the development behaviour (for example the
`wizard_misconfigured` throw and `useTool`'s churn warning). Listen to events with
`tm.events.on('error', (e) => …)` or `createToolmark({ onError })`.

## Codes added in M2

`error` event codes (full list with M1–M4 codes: [`docs/reference/codes.md`](../reference/codes.md)):

| Code                           | When                                                                                                                  | Development / production                                         |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `wizard_misconfigured`         | Wizard with no steps, an invalid or duplicate step name, missing callbacks                                            | Throws / event, nothing registered                               |
| `files_misconfigured`          | Invalid `files` options or `FileFieldSpec`                                                                            | Throws / event; URL fetching off, or the form registers no tools |
| `files_not_configured`         | A `{ ref }` arrived and no `files.resolve` exists (changed from M1's throw)                                           | Event (development only), next to `refused` `file_rejected`      |
| `invalid_props_tool`           | A server-declared props entry is malformed or violates a limit                                                        | Event in both, never thrown; the entry is skipped                |
| `options_url_rejected`         | A `data-tool-options-url` is invalid, too long, not same-origin http(s), or has credentials; the field gets no lookup | Event in both, never thrown                                      |
| `wizard_current_step_unsynced` | A wizard wrote the current step into parent data with no way to show it                                               | Event in both (once per wizard), never thrown                    |

Reused M1 codes with new sources: `duplicate_name` (props tool collisions, a second
`inertiaPages`; events, never thrown), `invalid_name` (DOM tool, group, column and field names;
buttons without a description), `schema_conversion_failed` (`fromJsonSchema`; a dropped DOM
`pattern` in development), `tool_threw` (an options provider failed; registering a DOM tool
threw a non-Toolmark error, which is reported as an event and that tool is skipped, never thrown).

`refused` codes used by M2: `file_rejected` (files), `navigation_failed` (navigation tool),
`not_allowed` (disabled or hidden DOM button; stepwise fill with no mounted step form) and
`stale` (a submit approved after the form or wizard data changed).
