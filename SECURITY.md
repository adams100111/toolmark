# Security policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 1.x     | Yes       |
| < 1.0   | No        |

Pre-1.0 (`0.x`) versions were never published to npm and receive no security support.

## Reporting a vulnerability

**Please do not open a public GitHub issue for a security report.**

Report it privately through GitHub's Security Advisories for this repository:

<https://github.com/adams100111/toolmark/security/advisories/new>

That form reaches only the maintainer and lets us coordinate a fix and a disclosure timeline with
you before anything is public. We do not accept vulnerability reports by email.

We aim to acknowledge a new report within **5 working days**. From there we'll work with you to
understand impact and severity, develop and test a fix, and agree a disclosure date — typically
coordinated with the release that ships the fix.

## Scope

In scope are the security properties Toolmark itself is responsible for (spec §14):

- No arbitrary code execution: only registered tools with validated input ever run; no
  `eval`/`new Function` in any package.
- Untrusted input handling: agent input can only reach paths a tool's schema declares, and
  prototype-pollution paths (`__proto__`, `prototype`, `constructor`) are always rejected.
- Prompt-injection marking: page/user content surfaced in results is flagged
  `untrustedContent` across the bridge, WebMCP and MCP surfaces.
- Bridge and desktop-MCP pairing security: origin allow-listing, localhost binding, session
  tokens, bounded message sizes, and the other MUSTs in the design's bridge/MCP sections.
- File handling: URL fetching is off by default, origin allow-listed, and bounded in size/type
  when enabled.
- Sensitive-field redaction: `state()`, manifests, fill results, confirmation payloads and
  telemetry never leak password fields, `autocomplete="cc-*"` fields or app-declared sensitive
  paths.

Out of scope:

- Vulnerabilities in an application that _uses_ Toolmark but are not caused by Toolmark's own code
  (report those to that application's maintainers).
- The known, documented boundary that a malicious **local process** which binds the MCP pairing
  port before the app does is out of scope for the pairing protocol (see the design's threat
  model) — this is a design trade-off, not something we need a new report for.
- Findings against `@toolmark/source` / the shipped `src/` build-time export condition itself
  (it is internal and outside semver, not a runtime attack surface).

If you're unsure whether something is in scope, report it anyway through the advisory link above —
we'd rather triage a borderline report than miss a real one.
