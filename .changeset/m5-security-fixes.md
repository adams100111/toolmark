---
'@toolmark/core': patch
'@toolmark/judge-typesafe': patch
---

Security review fixes (docs/security/review-2026.md): a tool that declares only `jsonSchema` is
validated against it (SEC-1); `fill` never writes a key an open schema does not declare
(`"Undeclared field"`, SEC-2); confirmation expiry is checked against the clock at approval
(SEC-3); the new `callTimeoutMs` option (default 120000) bounds runs without a caller signal —
signal-less calls, `confirmPending` runs and undo restorers (SEC-4); confirmation payloads redact
sensitive input (SEC-5); form and wizard fills are marked `untrustedContent` in the manifest
(SEC-6); the TypeSafe judge no longer sends DOM option lists (SEC-10).
