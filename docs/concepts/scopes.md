# Scopes

A **scope** groups tools. Its path prefixes the names of the tools registered into it, it can hide
all of them at once, and disposing it removes all of them (spec §5).

```ts
const challenges = tm.scope('challenges')
const create = challenges.scope('create', { when: false }) // hidden until shown

tm.register({ name: 'fill', description: '…', input, run }, { scope: create }) // full name: challenges.create.fill

create.setWhen(true) // the tools appear in manifest() and become callable
challenges.dispose() // removes challenges.* including challenges.create.*
```

- **Nesting** is only through `scope.scope(name)`; `tm.scope` creates root-level scopes.
- **`when: false`** hides a scope's tools (and its descendants') from `manifest()` and `call()`;
  a call gets `refused` `unknown_tool`. Use it for tabs, dialogs and steps that are not on screen.
- **Transparent scopes** (`{ transparent: true }`) group tools for `when` and disposal without
  adding a name segment, so tools keep the names they were given (server-declared tools use this).
- **Disposal** unregisters the scope's tools and drops their pending confirmations. Registering into a disposed scope is `scope_disposed`.
- **Queues.** Calls run serially per scope in arrival order; separate scopes run in parallel
  (D22). A tool that ignores its aborted signal is abandoned after `abortGraceMs` (default 5000)
  and its queue slot released.
- **Deadline without a caller signal.** A run with no caller `signal` (a `tm.call` without one,
  the run a `confirmPending` approval starts, an `undo` restorer) is aborted after
  `callTimeoutMs` (default 120000) and then abandoned after the grace period with `cancelled`
  `signal`, so a hung tool cannot hold its scope queue forever. A caller that passes a `signal`
  owns the deadline instead.

In React, `<ToolScope name="create" when={open}>` creates a scope for its subtree; hooks inside it
register into it (see [React](../guides/react.md#toolscope)).

API: [`Scope`](../api/@toolmark/core/interfaces/Scope.md),
[`ScopeOptions`](../api/@toolmark/core/interfaces/ScopeOptions.md).
