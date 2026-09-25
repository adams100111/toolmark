# Confirmation modes

Consequential and destructive tools need the user's approval before they run, unless the caller
is `human`. Toolmark ships **no confirmation UI** (D13): it hands the app a request and waits for
the app's answer, in one of two modes (spec §7, D16).

## Deferred (default for `inapp`)

The call returns immediately with `needs_confirmation`:

```json
{
  "status": "needs_confirmation",
  "confirmId": "f3…",
  "summary": "Create challenge \"Robotics\"",
  "changes": []
}
```

The agent tells the user a confirmation is pending; the app renders it (for example as a card in
the chat). On approval the app calls `tm.confirmPending(confirmId, { approved: true })` (optionally
with edited `input`, which is re-validated). The tool then runs **as caller `human`**, and the
bridge delivers the outcome to the agent as a `confirmed` message. In React,
[`usePendingConfirmations()`](../guides/react.md#confirmations) lists and answers them.

## Inline (always for `webmcp`, `mcp`, `tour`)

Those callers wait on their own, so the call stays open while the app's `confirm` handler asks the
user:

```ts
import { createConfirmQueue, createToolmark } from '@toolmark/core'

const queue = createConfirmQueue()
const tm = createToolmark({ confirm: queue.handler })
// Render queue.getPending() (or useConfirmQueue(queue) in React) and call approve()/reject().
```

## Rules

- Only `inapp` and `test` modes are configurable (`confirmMode: { inapp: 'inline' }`); `webmcp`,
  `mcp` and `tour` are always inline, so they never see `needs_confirmation`. Anything else is
  `invalid_confirm_mode`.
- A pending confirmation expires (default 10 minutes, `confirmExpiryMs`) and is dropped when its
  scope is disposed. A `confirmId` is **single use**: the first `confirmPending` consumes it, any
  later one gets `refused` `confirmation_expired`. At most 100 are pending; the oldest expire first.
  Expiry is checked against the clock at approval time, not only by a timer: browsers delay timers
  in background tabs and across device sleep, so an approval that arrives after `expiresAt` (inline
  or deferred) is expired and the tool does not run.
- **Sensitive values stay out of confirmation payloads.** `ConfirmRequest.input`,
  `PendingConfirmation.input` (`tm.pendingConfirmations()`, `usePendingConfirmations`) and
  `ctx.confirm` changes carry `'[redacted]'` at the tool's sensitive paths (`sensitivePaths()`,
  mapped onto the input shape for form and wizard fills; the whole input when that list cannot be
  read). The approved run still gets the real input. An approval that edits `input` (inline,
  deferred or through `ctx.confirm`) may send the public input back with its changes: every
  sensitive path that still holds the literal `'[redacted]'` gets its real value back before the
  edit is validated, so a secret is never replaced by the placeholder; a sensitive path the
  approver changed keeps the new value. `'[redacted]'` outside the sensitive paths is ordinary text.
- A deferred form or wizard submit approved after the form's values changed is refused `stale`
  ("Form changed since confirmation was requested").
- **Registration check.** Registering a consequential or destructive tool fails
  (`missing_confirm_handler`) only when no allowed non-human caller has a confirmation path. An
  inline-mode caller without a `confirm` handler simply does not see such tools (and a call from it
  is `refused` `not_allowed`); a development-only `missing_confirm_handler` warning event says so.
- **`ctx.confirm({ summary, changes? })`** inside `run` asks mid-run: `human` → approved; an inline
  caller → awaits the handler (bounded by the call signal and the expiry, and not by
  `callTimeoutMs`: the call deadline is paused while the confirmation is open and resumes with the
  time that was left); a deferred caller or no
  handler → `{ approved: false, reason: 'confirmation_unavailable' }` plus the development event
  `ctx_confirm_unavailable`. It never throws. Tools that always need confirmation should declare
  `consequential` instead.
- `createTestToolmark()` keeps these production modes and installs a default-approve inline
  handler.

API: [`ConfirmRequest`](../api/@toolmark/core/interfaces/ConfirmRequest.md),
[`ConfirmOutcome`](../api/@toolmark/core/type-aliases/ConfirmOutcome.md),
[`createConfirmQueue`](../api/@toolmark/core/functions/createConfirmQueue.md).
