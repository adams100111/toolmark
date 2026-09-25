---
'@toolmark/core': patch
'@toolmark/judge-typesafe': patch
---

Security hardening from the 1.0 security review (docs/security/review-2026.md): a tool that
declares only `jsonSchema` is validated against it; `fill` never writes a key an open schema does
not declare (`"Undeclared field"`); confirmation expiry is checked against the clock at approval;
the `callTimeoutMs` option (default 120000) bounds runs without a caller signal — signal-less calls,
`confirmPending` runs and undo restorers; confirmation payloads redact sensitive input; form and
wizard fills are marked `untrustedContent` in the manifest; the TypeSafe judge does not send DOM
option lists.
