# Inertia: pages, server-declared tools and navigation

`@toolmark/inertia` (`@inertiajs/react` 2 and 3) adds three things in M2 (spec §10.1, §12.4):

- `inertiaPages` — a page scope per visit that registers **server-declared tools** from the
  `toolmark` page prop and disposes them on navigation (D23);
- `navigationTool` — a GET-only tool that visits named routes (Wayfinder or Ziggy);
- `inertiaFormComponentAdapter` — form tools for the uncontrolled Inertia `<Form>` component.

`inertiaAdapter` (M1) still covers `useForm` forms. For the server side, see the
[Laravel props builder](laravel-reference.md#8-props-builder-server-declared-tools).

## Setup

```tsx
// resources/js/app.tsx
import { createInertiaApp, router } from '@inertiajs/react'
import { createRoot } from 'react-dom/client'
import { ToolmarkProvider } from '@toolmark/react'
import { inertiaPages, navigationTool } from '@toolmark/inertia'
import { toolmark } from './toolmark' // createToolmark(...) (see the Laravel reference, section 1)
import { routes } from './navigation-routes' // Record<string, RouteFn>, see "navigationTool" below

createInertiaApp({
  resolve: (name) => import(`./Pages/${name}.tsx`),
  setup({ el, App, props }) {
    toolmark.use(inertiaPages({ router, initialPage: props.initialPage }))
    // Root scope: the navigation tool must survive page swaps.
    toolmark.register(navigationTool({ routes, visit: (url, opts) => router.visit(url, opts) }))
    createRoot(el!).render(
      <ToolmarkProvider toolmark={toolmark}>
        <App {...props} />
      </ToolmarkProvider>,
    )
  },
})
```

Pass Inertia's `router` directly: it satisfies `RouterLike` in both majors. `RouterLike.on` is typed
for the events both majors dispatch (`InertiaCommonEventName`: `start`, `navigate`, `success`,
`error`, `finish`); `InertiaEventName` also names the major-specific ones (`httpException`,
`networkError` in 3; `invalid`, `exception` in 2). `RouterVisitOptions` and `VisitDataValue` mirror
Inertia's visit options without importing `@inertiajs/*` types.

## `inertiaPages`

`inertiaPages({ router, initialPage, propsKey? })` (`InertiaPagesOptions`, `propsKey` default
`'toolmark'`) returns a consumer for `tm.use`:

- It holds one **transparent** page scope, so tools keep exactly the names the server gave them.
- On attach it registers `initialPage.props[propsKey]`; on every `navigate` event it disposes the
  page scope and registers the new page's entries. An unchanged entry list (Inertia fires
  `navigate` on first load and after `preserveState` visits) keeps the registrations: no revision
  bump. A changed list bumps the revision once.
- A navigation does not cancel an in-flight props call (a props tool's own visit swaps the page
  before its success callback). Only the consumer's disposer does: it removes the page tools,
  unsubscribes from the router and settles every in-flight props call `cancelled` `signal`.
- At most one `inertiaPages` per registry: a second one does nothing and emits `duplicate_name`.
- A props value that is `null`/missing registers nothing; any other non-array → one
  `invalid_props_tool` event. Nothing in `navigate` handling ever throws into Inertia.
- Under SSR it does nothing.

## The `toolmark` props shape (public API)

The shape is public API (spec §17). Each entry is a `PropsToolEntry`: a manifest-shaped tool plus
the visit that runs it.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "toolmark page prop",
  "type": "array",
  "maxItems": 64,
  "items": {
    "type": "object",
    "required": ["name", "description", "inputSchema", "visit"],
    "properties": {
      "name": { "type": "string", "pattern": "^[A-Za-z0-9_.-]{1,128}$" },
      "title": { "type": "string", "maxLength": 128 },
      "description": { "type": "string", "minLength": 1, "maxLength": 2048 },
      "inputSchema": {
        "type": "object",
        "description": "Draft 2020-12 schema in the fromJsonSchema subset; JSON.stringify length ≤ 32768. For a non-get visit the root must be { \"type\": \"object\", \"additionalProperties\": false }. No \"properties\" may declare \"_method\" or \"_token\"."
      },
      "hints": {
        "type": "object",
        "properties": {
          "readOnly": { "type": "boolean" },
          "consequential": { "type": "boolean" },
          "destructive": { "type": "boolean" },
          "untrustedContent": { "type": "boolean" }
        }
      },
      "visit": {
        "type": "object",
        "required": ["url", "method"],
        "properties": {
          "url": {
            "type": "string",
            "description": "Same-origin http(s) URL without userinfo; absolute is recommended."
          },
          "method": { "enum": ["get", "post", "put", "patch", "delete"] }
        }
      }
    }
  }
}
```

Example entry:

```json
{
  "name": "post.update",
  "title": "Update post",
  "description": "Update this post's title and body.",
  "inputSchema": {
    "type": "object",
    "properties": { "title": { "type": "string", "minLength": 1, "maxLength": 200 } },
    "required": ["title"],
    "additionalProperties": false
  },
  "visit": { "url": "https://app.example.com/posts/7", "method": "put" }
}
```

### How entries are checked

The client treats every entry as **untrusted**. It reads own properties only and skips an entry
with an `invalid_props_tool` event (in development and production, never thrown) when:

- `name` is not a valid tool name, `description` is empty, or a field has the wrong type;
- `title` is longer than 128 (`MAX_PROPS_TOOL_TITLE_LENGTH`) or `description` longer than 2048
  (`MAX_PROPS_TOOL_DESCRIPTION_LENGTH`) UTF-16 code units;
- `inputSchema` is larger than 32768 characters serialized (`MAX_PROPS_TOOL_SCHEMA_LENGTH`), is
  outside the [`fromJsonSchema` subset](forms.md#json-schema-only-forms-fromjsonschema) (including
  an unsafe `pattern`), or declares `_method` or `_token` in any `properties`;
- **a non-GET entry's schema root is not closed** (`type: "object"` and
  `additionalProperties: false`), because extra keys would reach the server's request body;
- `visit.method` is not one of the five lowercase methods (`PropsToolMethod`: `get`, `post`, `put`,
  `patch`, `delete`);
- `visit.url` does not resolve to this page's origin over `http:`/`https:` without userinfo
  (`//evil.example`, backslash tricks, `javascript:` are all refused).

Only the first 64 entries (`MAX_PROPS_TOOLS_PER_PAGE`) are processed; one event reports the rest.
Hint values must be booleans; unknown hint keys are dropped. A name already taken by any tool (or
its LLM name) is skipped with a `duplicate_name` event, so a server entry can never replace an app
tool.

**Canonical absolute URLs.** The URL is resolved once, at registration, against the page it was
registered on, and the tool always visits that canonical absolute `href`. A relative URL can
therefore not be retargeted by a later in-app navigation. Send absolute same-origin URLs anyway.

### How props tools run

- Tools carry `origin: 'server'`; input is validated with `fromJsonSchema(inputSchema)` before
  `run`.
- **Non-GET tools are at least `consequential`**, so every non-human caller must get a
  confirmation: a server `destructive` (and `untrustedContent`) hint is kept, `readOnly` is dropped.
  GET tools keep the server's hints.
- **Reserved keys.** Input carrying `_method` or `_token` at any depth → `invalid` (`"Reserved field is not allowed"`), no visit: `_method` would spoof the HTTP method (turning a `post` tool
  into a `delete`) and `_token` is Laravel's CSRF field. Input that is not an object → `invalid`.
- The run calls `router.visit(url, { method, data: input, preserveState: true, ...callbacks })`.
  Inertia attaches its own XSRF header; Toolmark never reads cookies or tokens.
- **Visit outcome mapping** (per-visit callbacks, shared with `inertiaAdapter`):

| Callback                                 | Result                              |
| ---------------------------------------- | ----------------------------------- |
| `onSuccess`                              | `ok({})`                            |
| `onError` (validation errors)            | `invalid`, one issue per error key  |
| `onHttpException` (3) / `onInvalid` (2)  | `error` `"Request failed"`          |
| `onNetworkError` (3) / `onException` (2) | `error` `"Network error"`           |
| cancelled or interrupted                 | `cancelled` `signal`                |
| `onFinish` with none of the above        | `error` `"Visit did not complete"`  |
| call signal aborted                      | the visit is cancelled, `cancelled` |

The server remains the authority: it filters the entries with its own authorization before
rendering and **re-authorizes and re-validates every visit it receives**. The client checks are
agent-UX and defence in depth, not access control.

`propsTools(tm, entries, scope, { router, signal? })` (`PropsToolsOptions`) is the building block
`inertiaPages` uses; call it yourself only when you manage scopes by hand.

## `navigationTool`

`navigationTool({ routes, visit, name?, description? })` (`NavigationToolOptions`) returns a tool
definition for `tm.register`:

- Input `{ route, params? }` (`NavigationInput`): `route` is an enum of the `routes` keys.
- Returns `ok({ url })` — `url` is the canonical absolute href that was visited — right after
  starting the visit, **before** the page swap disposes the page
  scope; a `changed`/manifest follows (D23). Register it at the **root** scope with
  `tm.register(...)`, never inside the page scope, so it survives navigation.
- **GET only.** A route whose method is not `get` (case-insensitive) → `refused`
  `navigation_failed` (`"Only GET routes can be navigated; declare a server tool for mutations"`). A throwing route, a malformed route result, a URL outside this origin or a
  throwing `visit` → `refused` `navigation_failed`. The visit receives the canonical absolute URL.
- `params` keys `__proto__`/`constructor`/`prototype` (any depth) → `invalid`. Parameters a route
  does not consume may become query-string values, as Wayfinder and Ziggy do.
- Default name `navigate`, description `"Navigate to a page in this app. Use route names from the enum."`. Empty `routes` throws a
  `TypeError` (`"navigationTool needs at least one route"`) when the tool is built.

A `RouteFn` is `(params?) => { url, method }`.

**Wayfinder** route functions already return `{ url, method }`:

```ts
// resources/js/navigation-routes.ts
import type { RouteFn } from '@toolmark/inertia'
import { index as postsIndex, show as showPost } from '@/routes/posts' // generated by Wayfinder

export const routes: Record<string, RouteFn> = {
  'posts.index': () => postsIndex(),
  'posts.show': (params) => showPost(params as { post: string | number }),
}
```

**Ziggy**'s `route()` returns a URL string, so the wrapper adds the method (list only GET routes):

```ts
import type { RouteFn } from '@toolmark/inertia'
import { route } from 'ziggy-js'

const get =
  (name: string): RouteFn =>
  (params) => ({ url: route(name, params as Record<string, string>), method: 'get' })

export const routes: Record<string, RouteFn> = {
  'posts.index': get('posts.index'),
  'posts.show': get('posts.show'),
}
```

Ziggy builds absolute URLs from its configured `url`; when that differs from the page's origin
(a proxy, a different host name), the call is refused `navigation_failed`.

## Inertia `<Form>`

`inertiaFormComponentAdapter({ element, formRef, router })` adapts the uncontrolled `<Form>`
component (`@inertiajs/react` ≥ 2.1; verified on 2.3.28 and 3.7.1). Values, filling, dirty tracking
and `fields()` come from [`domFormAdapter`](dom.md) over the `<form>` element (so the same
exclusions apply: hidden `_token`, passwords, read-only fields…); `submit()` calls
`formRef.current.submit()` and settles from the router's global events.

```tsx
import { Form, router } from '@inertiajs/react'
import { useEffect, useRef, type ComponentRef } from 'react'
import { createFormTools, fromJsonSchema } from '@toolmark/core'
import { synthesizeFormSchema } from '@toolmark/core/dom'
import { inertiaFormComponentAdapter } from '@toolmark/inertia'
import { useToolmark } from '@toolmark/react'

export function EditPost({ id }: { id: number }) {
  const tm = useToolmark()
  const formRef = useRef<ComponentRef<typeof Form>>(null)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = box.current?.querySelector('form')
    if (!element) return
    const adapter = inertiaFormComponentAdapter({ element, formRef, router })
    const schema = synthesizeFormSchema(element)
    const tools = createFormTools(tm, adapter, {
      name: 'post',
      description: 'Edit this post.',
      input: fromJsonSchema(schema),
      jsonSchema: schema,
    })
    return () => {
      tools.dispose()
      adapter.dispose()
    }
  }, [tm])

  return (
    <div ref={box}>
      <Form ref={formRef} action={`/posts/${id}`} method="put">
        <input name="title" required />
        <button type="submit">Save</button>
      </Form>
    </div>
  )
}
```

(For file inputs, see [DOM forms](dom.md#using-the-adapter-directly); `scanDom` also picks up a
`<Form>` rendered with `data-tool` attributes, but its submit is then the native `requestSubmit`.)

Outcome mapping of `submit()`:

- `error` event → `invalid` (one issue per error key; `path: ""` when none can be read);
- `httpException` (3) / `invalid` (2) → `error` `"Request failed"`; `networkError` (3) /
  `exception` (2) → `error` `"Network error"`;
- `finish` with `cancelled` or `interrupted` → `cancelled` `signal`;
- **a bare `finish` → `ok({})`.** This differs from the per-visit mapping above, where a bare
  `onFinish` is an `error`: here success is only observable through the global `finish`;
- no mounted ref → `error` `"Form is not mounted"`; `dispose()` settles in-flight submits
  `cancelled` `signal` and removes their listeners.

**Correlation.** The first `start` after `submit()` records `"<method> <visit.url.href>"`; a
`finish` (or failure event carrying a visit) is accepted only when it matches, so an unrelated
visit (a poll, another form) that starts or finishes meanwhile is ignored.

**Known limit (Inertia 3):** `error`, `httpException` and `networkError` events carry **no visit**,
so they cannot be correlated. An unrelated visit that fails while this form's submit is in flight
may be attributed to it.

## Development and production

Misconfiguration in this package is always an `error` event (`invalid_props_tool`,
`duplicate_name`), never a throw, because a throw inside Inertia's event dispatch would break
navigation. Registry errors thrown in development while registering a props tool are re-emitted as
events with their own code.
