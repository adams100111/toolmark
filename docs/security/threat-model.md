# Toolmark threat model

This is the threat model behind the [2026 release security review](review-2026.md) (spec §14,
M5 Task 4). It lists what Toolmark protects, where the trust boundaries are, and which review
checklist item covers each one. Item numbers refer to the `## Checklist` section of the review.

## Assets

| Asset                                                                                        | Why it matters                                                                                    | Covered by |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------- |
| **The user's session in the app** (cookies and CSRF token)                                   | Tools run inside it. An agent must never gain more than the user already has.                     | 2, 5, 11   |
| **App data behind server authorization**                                                     | The server, not the page, decides every mutation.                                                 | 2          |
| **Intent over consequential and destructive actions**                                        | A tool that changes state must run only after the user confirms, exactly once, before it expires. | 8, 11      |
| **Sensitive field values** (passwords, `cc-*`, one-time codes, app-declared sensitive paths) | They must never reach the agent, a confirmation payload, telemetry or third-party egress.         | 10, 12     |
| **Page integrity** (the JavaScript realm, prototypes)                                        | Agent input must not change code paths or pollute prototypes.                                     | 1, 4       |
| **The model's instruction channel**                                                          | Page and user content must reach the model marked as data, never as instructions.                 | 3          |
| **The MCP pairing secrets** (the one-time code and the session token)                        | Whoever holds them drives the page as caller `mcp`.                                               | 6          |
| **Availability of a page's tools**                                                           | A tool that hangs or never answers must not block its scope forever.                              | 8          |
| **The published packages and the release pipeline**                                          | A compromised tarball or workflow compromises every consumer.                                     | 13, 14     |

## Actors

- **The user** is trusted. They are the only `human` caller. Confirmations exist for them.
- **The agent (LLM)** is untrusted, whatever channel it uses (bridge, WebMCP, MCP, tour planner).
  Anything the page or the user wrote can steer it through prompt injection. Its inputs are treated
  as hostile, and consequential actions need a confirmation it cannot give itself.
- **The app developer** is trusted to write tool code, server props, markup inside the scanned DOM
  root, policy and server authorization. Toolmark guards against mistakes this developer is likely
  to make, such as open schemas, a missing confirm handler or a test hook left in production. It
  does not guard against malice.
- **Third-party content on the page** (user-generated HTML, other users' records, embedded frames)
  is untrusted. It must stay out of tool descriptions (`data-tool-ignore`, `contenteditable`,
  `iframe` and `template` are not scanned), and results that carry it are marked
  `untrustedContent`.
- **Other web origins** are untrusted: a malicious site in another tab, a cross-site iframe, a
  DNS-rebinding page.
- **Local processes on the user's machine** are out of scope (spec §14). A process that binds the
  pairing port first can receive the code or the token. Consequential tools still confirm inline in
  the page.
- **Pull-request authors and dependency publishers** are untrusted inputs to CI and to the build.

## Trust boundaries

### Page ↔ agent

The bridge (`@toolmark/core/bridge`, protocol v1), WebMCP and the tour planner cross this boundary.

- **Messages into the page** are bounded, parsed into detached copies, validated strictly, and
  ignored unless addressed to this `clientId`. Each id is answered exactly once, and the caller is
  never `human`. (Item 5)
- **Tools and input:** only registered tools run, and only with validated input. There is no
  `eval`. (Items 1 and 4; findings SEC-1 and SEC-2)
- **Confirmation:** policy and the confirmation rules apply to every call. The agent cannot
  approve its own consequential call: approval is `human` (`confirmPending` or the inline handler).
  (Item 11; finding SEC-3)
- **Results** carry page or user content marked `untrustedContent`, and sensitive values are
  redacted. (Items 3 and 10; findings SEC-5 and SEC-6)
- **Calls** have deadlines, cancellation and abandonment. (Item 8; finding SEC-4)
- **Transports:**
  - `postMessage` checks the exact origin **and** the source window.
  - The Echo transport uses a private per-user, per-conversation channel.
  - The WebSocket transport caps frame size. (Item 5)

### Page ↔ MCP server

`@toolmark/mcp`: a `toolmark-mcp` process on `127.0.0.1`, paired with a page.

- **Binding and upgrades:** the server binds to loopback only. An upgrade needs a loopback peer, an
  exact `Host` (a DNS-rebinding guard) and an allow-listed `Origin`; a missing `Origin` gets 403.
  (Item 6)
- **Code:** a 40-bit single-use code that expires after 300000 ms, rotates after five misses, and
  is throttled to one handshake at a time with a 250 ms cooldown after each `4401`. (Item 6)
- **Session token:** 256-bit, one valid at a time, kept in the page's `sessionStorage`. A newer
  pairing supersedes the old page with terminal close code `4409`, so the old page does not keep
  reconnecting. (Item 6)
- **Frames:** bound to the adopted `clientId`. A `call` has a deadline, and on deadline or MCP
  cancellation the page receives a protocol `cancel`. (Items 6 and 8)
- **MCP client side:** stdout carries only MCP frames. Untrusted results carry the description
  suffix, the text prefix and `_meta['toolmark/untrustedContent']`. (Items 3 and 6)

### App ↔ server

This is the app's own backend. The Laravel reference in `examples/inertia-laravel` is the one this
review audits.

- **Authorization:** the server re-authorizes and re-validates every mutation. Client tools and
  policy are UX only. Server-declared tools are filtered by the server's authorization before
  rendering, and each visit is authorized again. (Item 2)
- **§12.2 MUSTs:** ids are bound to user, conversation and `clientId` with deadlines, results are
  single-use, results that are unknown, mismatched, duplicated or late are rejected, and bodies are
  bounded in size and depth. (Item 5)
- **Prompt construction:** the page-supplied manifest is bounded before it reaches the prompt, and
  the follow-up after `confirmed` gets no tools. (Item 3; findings SEC-7 and SEC-8)
- **Files:** URL references are fetched only when enabled, only from allow-listed origins, and
  with no credentials, no redirects, no referrer and a timeout. Size and MIME limits apply to every
  resolved file. (Item 7)

### CI ↔ npm

This boundary covers the GitHub Actions workflows, the release pipeline and the npm registry.

- **Workflows:** actions are pinned by SHA, there is no `pull_request_target`, permissions are
  minimal, and PR code never runs with secrets or a write token. (Item 13; finding SEC-9)
- **Publishing:** only `release.yml` publishes, from the owner-approved `npm-release` environment,
  behind `TOOLMARK_PUBLISH_ENABLED`, with OIDC provenance. It is reviewed after Task 7a. (Item 13)
- **Packages:** no lifecycle scripts, pinned dependency ranges for `@toolmark/mcp`, a clean
  `pnpm audit --prod` and `composer audit`, and published files free of fixtures and secrets.
  (Items 12 and 13)
- **Scope rules (D3):** no app-specific code, and no runtime package imports an AI SDK. (Item 14)
- **Development tooling:** `toolmark lint --judge` executes only the module it is given
  (documented), `--url` uses a fresh browser context, and the TypeSafe judge's egress is limited
  and documented. (Item 12; finding SEC-10)

## Development vs production

Misconfiguration throws in development and emits an `error` event in production. The in-page test
hook and the tool budget exist only outside production. (Item 9)
