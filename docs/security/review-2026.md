# Toolmark 1.0 security review (2026)

Release security review for Toolmark 1.0 (spec §14, §21; M5 Task 4). Findings are resolved in M5
Task 5, which fills the `resolution`, `commit` and `regression test` columns. The threat model this
review works from is [threat-model.md](threat-model.md).

- **Reviewed revision:** `b12cd4896070d95dc69becb2e1bc6e315bd428ca` (`feat/m5-release` = `main`
  with M1–M4 merged, before the wave-0 merge of M5 Lane A). Wave 0 had not merged when the review
  ran, so the review worked from this SHA. Items 13 and 14 name the Lane A scripts they could not
  run yet and give the manual checks that stand in for them.
- **Reviewer:** M5 Lane C (the security lane, on the most capable model).
- **Date:** 2026-09-25.
- **Gate:** `node --test scripts/check-security-review.test.mjs && node scripts/check-security-review.mjs docs/security/review-2026.md`.
  `node scripts/check-security-review.mjs --resolved` fails while any finding is still `open`.
  Task 5 and the release checklist run it in that mode.

## Scope

- **Packages (source and built `dist`):**
  - `@toolmark/core`: registry, call pipeline, policy, confirmation, forms, wizard, files,
    json-schema, bridge and transports (`echo`, `websocket`, `post-message`, `in-page`), protocol,
    `dom`, `webmcp`, `otel`.
  - `@toolmark/react` (including `rhf`) and `@toolmark/inertia`.
  - `@toolmark/testing` (including `page` and `vitest`) and `@toolmark/tour`.
  - `@toolmark/mcp`: stdio server, pairing server, CLI and the `client` entry.
  - `@toolmark/lint` and `@toolmark/judge-typesafe`.
- **Laravel reference:** `examples/inertia-laravel` (`app/Toolmark/**`, routes, policies, form
  requests and channels) and its copy in `docs/guides/laravel-reference.md`.
- **Test-hook gating:** the `react-vite` and `nextjs` examples, but only to check that the test hook
  stays out of production builds.
- **CI and supply chain:** `.github/workflows/*.yml`, package `scripts`, the dependency audits and
  the published file lists.
- **Out of scope:** consumer apps, owner-only settings (npm org, environments, branch protection)
  and `release.yml`. `release.yml` does not exist at the reviewed SHA; it is reviewed after Task 7a
  (see [Follow-ups](#follow-ups)).

## Method

1. **Line-by-line reading** of every file in scope, against spec §12.2, §14 and every §23 ruling
   row. The review verified each claim in the rulings against the code instead of taking the table
   on trust.
2. **Focused probes** against the built packages (scratch scripts, not committed):
   - `probe-paths.mjs`: prototype keys at every depth, dotted `constructor.prototype`, `$append`
     items and open-object keys in `fill`. `Object.prototype` stayed clean.
   - `probe-open.mjs`: undeclared keys against open JSON Schemas, closed JSON Schemas, zod
     `object` and zod `looseObject`, in form fills and in wizard fills (SEC-2).
   - `probe-jsonschema-only.mjs`: a tool that declares only `jsonSchema` (SEC-1).
3. **Suites:**
   - `pnpm test`: 101 files and 814 tests passed.
   - `pnpm build`, then a grep of every `packages/*/dist` for `eval(`, `new Function(` and string
     timers: 0 hits.
   - A production `vite build` of `examples/react-vite`: no `__toolmark_test__`,
     `__toolmark_agent__` or `installTestHook` in the output.
4. **Supply chain:**
   - `pnpm audit --prod` (also with `--audit-level high`): "No known vulnerabilities found".
   - `composer audit --locked` in `examples/inertia-laravel` (through `scripts/php.sh`, which ran
     the Docker image because the host has no PHP): "No security vulnerability advisories found."
   - `npm pack --dry-run --json` for every package: the file lists hold only `dist/**`, `src/**`,
     `README.md`, `CHANGELOG.md` and `package.json`, with no fixtures, tests, `.env` files or keys.
   - A secret-pattern grep (`sk-…`, `ghp_…`, `npm_…`, `AKIA…`, PEM headers) over `src`, `dist`,
     READMEs and manifests: 0 hits.
5. **Severity.**
   - **Critical:** an agent or a remote party can bypass confirmation or authorization, or execute
     code.
   - **Important:** a spec §14 guarantee is broken in a way an agent can reach through normal use.
   - **Minor:** defence in depth, a narrow window, documentation accuracy, or a guarantee that
     depends on an app misconfiguration.

## Checklist

### 1. No code execution

**Verdict:** finding (SEC-1)

- `eslint.config.js:26-28` sets `no-eval`, `no-new-func` and `no-implied-eval` to `error` for
  every package. Linting is type-checked (`parserOptions.project`).
- A grep of `packages/*/src` and of the built `packages/*/dist` found no `eval(`,
  `new Function(`, `Function(` or string-argument timers. It found no `innerHTML`,
  `insertAdjacentHTML`, `document.write` or `srcdoc` either: the tour overlay writes text through
  `textContent` (`packages/tour/src/overlay/render.ts:74`).
- Two kinds of dynamic `import()` exist:
  - `toolmark lint --judge` imports the module the user names (item 12).
  - The `toolmark-mcp` CLI imports its own relative modules (`packages/mcp/src/cli.ts:67,85,110`).
- Only registered tools run:
  - `packages/core/src/call.ts:458-466` refuses unknown or hidden names with `unknown_tool` or
    `stale`.
  - Input is validated before the confirmation step and before `run` (`call.ts:478`).
  - Input that an approval edits is validated again (`call.ts:515`, `call.ts:538`).
  - Tests: `throwing_validator_on_confirm_pending_edited_input`,
    `deferred_confirm_edited_input_revalidated`.
- **Gap:** a tool that declares only `jsonSchema` (no Standard Schema `input`) runs with
  unvalidated input (SEC-1).

### 2. Server is the authority

**Verdict:** pass

- The server-declared mutation route checks authorization twice:
  - `examples/inertia-laravel/routes/web.php:21-23` checks `->can('archiveAny', Challenge::class)`
    on the route.
  - `ArchiveChallengeRequest::authorize()` checks the specific challenge
    (`ChallengePolicy::archive`) on every visit.
  - `StoreChallengeRequest::rules()` plus `validated()` re-validate the form input.
- The props builder renders only tools the user passes a gate for (`ToolmarkProps.php:46`, with
  no default ability).
  - Tests: `test_props_builder_filters_by_authorization`,
    `test_bridge_endpoint_requires_the_conversation_owner`.
- The docs say client policy is only agent UX:
  - `docs/concepts/callers.md:23`: "Client policy is not an authorization boundary. The server
    must authorize every mutation".
  - `docs/guides/laravel-reference.md:1286-1288`: "the page's schema and confirmation are agent
    UX".

### 3. Prompt injection

**Verdict:** finding (SEC-6, SEC-7, SEC-8)

- **MCP:** `untrustedContent` produces all three markers:
  - the description suffix (`packages/mcp/src/server/tool-mapping.ts:169`);
  - the `[untrusted page content]\n` text prefix (`tool-mapping.ts:194`);
  - `_meta['toolmark/untrustedContent']` on the tool and on the result (`tool-mapping.ts:178`,
    `tool-mapping.ts:198`).
  - Tests: `untrusted_content_marked_in_mcp`,
    `caps_description_then_appends_untrusted_suffix`.
- **WebMCP:** `untrustedContentHint` (`packages/core/src/webmcp/sync.ts:115`).
- **Bridge:** the hint travels in every manifest entry (`packages/core/src/manifest.ts:42`), and
  `docs/protocol-v1.md:129-130` tells servers to treat such results as data.
- **Built-in tools that return page or user content are marked:**
  - DOM form fill and submit (`packages/core/src/dom/scan.ts:383-399`);
  - buttons (`dom/button-tools.ts:43-49`);
  - tables (`dom/table-tools.ts:160`);
  - options lookups (`forms/options.ts:111`).
- **Where descriptions come from:**
  - Code: `ToolDefinition.description`.
  - Server props: validated and capped in `packages/inertia/src/props-tools.ts`. The Laravel
    builder also refuses user content (`ServerTool::$description` is documented as constant text).
  - App-authored markup in the scanned DOM root.
  - The Laravel bridge bounds and whitelists page manifests before they reach the prompt
    (`BrowserBridge.php:196-253`; test `test_manifest_bounds`).
- **Subtrees that are not scanned:** `isIgnoredElement` (`dom/scan.ts:56-62`) skips `iframe`,
  `template`, `[data-tool-ignore]` and `[contenteditable]` with any value other than `"false"`
  (including `""` and `plaintext-only`).
  - `collect` (`scan.ts:153-155`) and the mutation filter (`scan.ts:119-137`) apply it.
  - Labels from ignored or editable regions are dropped (`dom/elements.ts:147`).
  - Tests: `element_root_inside_ignored_region_scans_nothing`,
    `labels_from_ignored_or_editable_regions_dropped`,
    `form_associated_control_in_editable_region_excluded`,
    `ignored_region_text_update_schedules_no_rescan`.
- **Gaps:**
  - SEC-6: code-registered form and wizard fills return user-entered values without
    `untrustedContent`.
  - SEC-7: the Laravel reference returns untrusted results unmarked.
  - SEC-8: the Laravel reference puts page-supplied results into a `system` message.

### 4. Untrusted input paths

**Verdict:** finding (SEC-2)

- **Prototype keys:**
  - `packages/core/src/forms/paths.ts:3` defines the forbidden set (`__proto__`, `prototype`,
    `constructor`), which is enforced by `isSafePath` (`paths.ts:43-46`) on every segment.
  - `flattenWithRejected` (`paths.ts:122-175`) and `unsafeInside` (`paths.ts:75-103`) cover keys
    nested inside leaves. `applyArrayOp` checks `$append` items (`paths.ts:362`).
  - Writes go through `defineProperty` (`paths.ts:255`).
- **Probe (`probe-paths.mjs`):** every prototype probe returned `invalid` and left
  `Object.prototype` clean. It tried:
  - `{"__proto__":…}` at the top level and nested;
  - the dotted keys `constructor.prototype.x` and `address.__proto__.x`;
  - `$append` with `__proto__` items;
  - an open object (`meta`) holding `__proto__` or `constructor`.
- **Navigation, props and the wizard:**
  - Navigation rejects prototype keys in `params` (`packages/inertia/src/navigation.ts:91`) and
    looks routes up with `Object.hasOwn` (`navigation.ts:95`).
  - Props tools refuse `_method` and `_token` anywhere in the input (`props-tools.ts:193-203`, checked in `run`)
    and need a closed root schema for non-GET tools.
  - The wizard reuses the form-fill core.
- **Tests:** `fill_rejects_proto_path_no_pollution`, `paths_reject_prototype_keys`,
  `navigation_rejects_prototype_keys_in_params`, `type_mismatch_is_undeclared`,
  `fallback_unresolvable_schema_node_is_undeclared_field`.
- **Gap:** undeclared keys are written when the fill schema is open (an object with `properties`
  and no `additionalProperties: false`, or a loose Standard Schema) (SEC-2).

### 5. Bridge (§12.2 MUSTs)

**Verdict:** pass

- **Page side** (`packages/core/src/bridge/bridge.ts`):
  - Addressing: messages for another `clientId` are ignored (`:271`). An unsupported protocol is
    answered only when the message is addressed to this page (`:277-289`).
  - Each `call` and `describe` id is answered once. Duplicates of an in-flight id or of the last
    1000 answered ids are ignored (`:296`, `:300`, `:190-196`).
  - `cancel` aborts the call (`:310-312`).
  - Inbound size and depth are bounded before parsing (`boundsProblem` plus `utf8Exceeds`,
    `:255-268`; default 1048576 bytes, `:32`), then validated strictly (`protocol/validate.ts`).
  - The caller is validated at runtime and is never `human` (`:137-141`).
  - Results go out as detached JSON copies (`:102-110`).
- **Transports:**
  - `postMessageTransport` requires exact origins and a non-wildcard `targetOrigin`
    (`bridge/post-message.ts:34-45`). It accepts an event only when its origin is allowed **and**
    its `source` is the target window (`:53`).
  - The WebSocket transport drops frames over 4 MiB unparsed (`bridge/websocket.ts:211`).
- **Laravel reference** (`examples/inertia-laravel/app/Toolmark`):
  - `BrowserBridge.php:84-96` mints UUID v4 ids and binds each to user, conversation, `clientId`
    and deadline before sending.
  - Results are rejected when unknown (404), mismatched (403) or late (410) (`:275-286`).
  - Each `confirmId` is bound once with an atomic `add` (409 on re-binding, `:294-303`). Every id
    is single-use through an atomic claim (`:307-313`), and a duplicate `confirmed` gets 409
    (`:336-338`).
  - `BridgeController.php` checks the owner (`:18`), caps the body at 1 MiB (`:21`) and caps JSON
    depth at 64 (`:25`).
  - Channels are private per user and conversation (`routes/channels.php:8-12`).
- **Tests:**
  - Page side: `ignores_call_for_other_client`, `duplicate_call_id_ignored`,
    `oversized_message_dropped`, `post_message_filters_origin_and_source`,
    `unsupported_protocol_replies_error`, `unsupported_protocol_reports_id`.
  - Laravel: `test_rejects_result_from_other_user`, `test_rejects_unknown_or_duplicate_id`,
    `test_rejects_after_deadline`, `test_accepts_valid_result_once`, `test_channel_auth_only_owner`,
    `test_body_size_limit`, `test_json_depth_limit`, `test_rejects_malformed_ids`.

### 6. MCP pairing

**Verdict:** pass

- **Code** (`packages/mcp/src/pairing/code.ts`):
  - 8 characters from `crypto.randomInt` over a 32-symbol alphabet, which is 40 bits (`:4-6`,
    `:16-20`).
  - It expires after 300000 ms (`:8`, `:81`).
  - A match consumes it and issues a new one (`:108-110`). Five misses rotate it (`:10`, `:86-88`).
  - The comparison is constant-time (`:40-49`).
  - `ws-server.ts:150` refuses new handshakes for 250 ms after every `4401`, and `:166` allows
    one handshake at a time. Together these rule out online guessing.
- **Unpaired list:** `tools/list` returns only `toolmark_pairing` while no page is paired
  (`packages/mcp/src/server/server.ts:183`).
- **Session token:**
  - 256-bit (`pairing/token.ts:6-8`). A fresh `pair` replaces it, which revokes the previous
    token (`ws-server.ts:205`). Only one token is valid at a time.
  - The page keeps it in `sessionStorage`, falling back to memory
    (`packages/mcp/src/client/index.ts:45-66`), and deletes it after a `4401` on resume
    (`:164-166`).
  - A newer pairing closes the old page with `4409` (`ws-server.ts:159`). The codes `4400`,
    `4401`, `4408` and `4409` are terminal, so the old page stops reconnecting
    (`client/index.ts:191`, `bridge/websocket.ts:243-245`).
- **Connection checks:**
  - The server binds to `127.0.0.1` only (`ws-server.ts:241`). Non-upgrade requests get 404
    (`:136-138`).
  - `isAllowedUpgrade` requires a loopback peer, an exact `Host` of `127.0.0.1:<port>` or
    `localhost:<port>` (a DNS-rebinding guard), and an `Origin` that is present and exactly on the
    allow-list (`pairing/upgrade.ts:18-26`). Anything else gets 403 (`ws-server.ts:225-228`).
  - The CLI refuses `*`, `null` and non-origin values for `--allow-origin` (`args.ts:30-38`).
- **Handshake:** the first frame must arrive within 3000 ms and be at most 1024 bytes
  (`ws-server.ts:172-179`, `:193`).
- **Frame binding:** frames are bound to the adopted `clientId` (`pairing/page-link.ts:373`). A
  `result` resolves only a pending id that was sent to that `clientId` (`:386-387`).
- **Deadline:** `--call-timeout` (default 600000 ms) or an MCP cancellation sends a protocol
  `cancel`. If the page is detached, the `cancel` is deferred until the same `clientId` resumes
  (`page-link.ts:147-151`, `:320-324`).
- **stdout:** it carries only MCP frames once serving. Diagnostics go to stderr (`cli.ts:3`,
  `ws-server.ts:121-127`), and stdout is written only for `--help` and `--version`
  (`cli.ts:71`, `:75`).
- **Tests:** `code_normalized_single_use_and_reissued`, `code_expires_after_300000_ms`,
  `rejects_wrong_code_and_rotates`, `unpaired_lists_only_pairing_tool`,
  `paired_lists_page_tools_and_removes_pairing_tool`,
  `newer_pairing_supersedes_4409_and_revokes_token`,
  `websocket_terminal_close_code_stops_reconnect`, `rejected_token_is_removed`,
  `reload_resumes_with_token`, `rejects_bad_origin`, `rejects_missing_origin`,
  `rejects_bad_host`, `rejects_non_loopback`, `pair_timeout_default_is_3000_ms`,
  `oversize_first_frame_closes_4400`, `stdout_only_frames`,
  `timeout_sends_cancel_and_page_does_not_run`,
  `call_ended_while_detached_cancelled_on_same_client_resume`.
- **Out of scope** (spec §14): a malicious local process that binds the port first.

### 7. Files

**Verdict:** pass

- **URL fetching** (`packages/core/src/files.ts`):
  - It is off unless `allowOrigins` is non-empty (`:458`).
  - `filesConfig` rejects `*`, entries that are not origins, and `http:` on non-loopback hosts. On
    any problem it disables fetching (`:143-186`).
  - Only `https:` (or `http:` on loopback) is fetched (`:465-466`), with no userinfo (`:467-469`)
    and only from allow-listed origins (`:470-472`).
  - Every fetch uses a timeout (`AbortSignal.timeout(files.timeoutMs)`, default 30000),
    `credentials: 'omit'`, `redirect: 'error'`, `referrerPolicy: 'no-referrer'` and
    `cache: 'no-store'` (`:473-491`). A redirected or opaque-redirect response is refused as well
    (`:501-504`).
  - A `Content-Length` over the limit is refused (`:510-514`), the body is streamed with a hard
    cap (`readLimited`), and the MIME type is checked (`:515-519`).
- **`ref` files:** a resolved `{ ref }` goes through the same `checkFile` size and MIME limits
  (`:565`), with a field limit able only to narrow the global one (`effectiveSpec`).
- **JSON-safe values:** results carry `{ file: { name, size, type } }` (`describeFile`, `:236`).
- **Tests:** `url_disabled_by_default`, `url_redirect_rejected`, `url_userinfo_rejected`,
  `url_fetch_no_referrer_no_store`, `url_fetch_timeout`, `url_mime_accept`,
  `ref_file_mime_accept`, `allow_origins_star_misconfigured`,
  `allow_origins_wildcard_and_remote_http_misconfigured`,
  `ref_and_url_length_limits_invalid_before_resolution`.

### 8. Timeouts and cancellation

**Verdict:** finding (SEC-3, SEC-4)

- **Signals:** each run gets a controller linked to the caller's signal
  (`packages/core/src/call.ts:290-293`). A call aborted while queued leaves the queue without
  running (`:398-402`, `:411-414`).
- **Abandoned tools:** after abort, a tool that ignores its signal is abandoned once
  `abortGraceMs` passes (default 5000, `:329-341`).
  - The queue job then returns, which releases the scope slot (`queue.ts:42-53`).
  - A later settle emits `late_result` (`:345-351`).
- **Inline confirmation:** `askInline` is bounded by the signal and the expiry (`:207-213`).
- **Deferred confirmations:** they expire at 600000 ms (`:25`, `confirm.ts:67-74`) and are
  dropped with their tool (`:595-598`, `registry.ts:498`).
- **Bridge `cancel`:** `bridge.ts:310-312`.
- **Other bounds:**
  - options lookups: 10 s (`forms/options.ts`);
  - files: `timeoutMs`;
  - MCP calls: `--call-timeout`;
  - MCP `describe`: 10 s (`page-link.ts:31`).
- **Tests:** `abort_releases_queue_after_grace`,
  `abort_during_run_returns_tool_result_within_grace`, `ctx_confirm_signal_and_expiry`,
  `deferred_expiry_then_confirm_refused`, `cancel_yields_cancelled_signal_once`,
  `options_provider_timeout`, `url_fetch_timeout`, `timeout_sends_cancel_and_page_does_not_run`.
- **Gaps:**
  - SEC-4: `confirmPending`, `undo` and signal-less `tm.call` have no deadline, so a hung tool
    holds its scope queue forever.
  - SEC-3: confirmation expiry depends only on timers.

### 9. Development vs production

**Verdict:** pass

- Every misconfiguration class in `docs/reference/codes.md` goes through the registry's `fail()`
  (`packages/core/src/registry.ts:405-414`), which throws a `ToolmarkError` in development and
  emits an `error` event in production:
  - `duplicate_name`, `invalid_name`, `invalid_scope`, `scope_disposed`: `register`,
    `registry.ts:529-562`.
  - `invalid_confirm_mode`: `:431-436`.
  - `invalid_policy`: `:439`.
  - `files_misconfigured`: `:440-442`; forms, `form-tools.ts:904`.
  - `missing_confirm_handler`: `:573-580`.
  - `schema_conversion_failed`: `:589-596`.
  - `wizard_misconfigured`: `wizard/wizard-tools.ts:510`. The React stepwise path checks
    `isDevRegistry` and otherwise emits an `error` event (`packages/react/src/use-wizard-tool.ts:325-331`).
- `invalid_props_tool` and `options_url_rejected` are events in both modes by design (untrusted
  server or markup input, codes.md).
- **Tests:** `duplicate_name_dev_throws_prod_event`, `invalid_name_rejected`,
  `foreign_or_fake_scope_is_invalid_scope`, `invalid_confirm_mode_rejected`,
  `policy_human_rejected`, `max_files_misconfigured`, `budget_exceeded_dev_event_only`.
- **Test hook:** `installTestHook` is opt-in, and the examples call it only behind
  `MODE !== 'production'` or `NODE_ENV !== 'production'`.
  - A production build of `examples/react-vite` contains no `__toolmark_test__` or
    `installTestHook`.
  - The Laravel e2e bundle is served only in `local` and `testing`
    (`AppServiceProvider.php:32`; test `test_uses_the_e2e_build_only_when_asked_in_local_or_testing`).
  - The hook rejects caller `human` (`packages/testing/src/page/install-test-hook.ts:46-48`; test `hook_rejects_human_caller`).
- **Tool budget:** it is checked only inside `if (dev)` (`registry.ts:470-479`).

### 10. Privacy

**Verdict:** finding (SEC-5)

- **DOM:** password controls (sticky after a "show password" toggle), `autocomplete` `cc-*`,
  `current-password`, `new-password` and `one-time-code`, hidden, disabled and ignored controls
  are excluded from schemas, values and `changes`, and are never written
  (`packages/core/src/dom/elements.ts:122-185`, `isExcluded`).
- **Form tools:** `state()` redacts every sensitive path (`forms/form-tools.ts:1192`). `fill`
  `changes` are redacted at element-derived and declared sensitive paths (`:1174-1181`).
  `skipped` holds paths only. The wizard does the same (`wizard/wizard-tools.ts:781`).
- **Manifests:** they carry schemas and descriptions, never values. Password and `cc-*` controls
  are not in DOM schemas at all.
- **OTel:**
  - `recordPayloads` is off by default (`otel/index.ts:181`).
  - Error spans carry only `Tool failed`.
  - When payload recording is opted in, the input is redacted at the tool's real shape
    (`:200-210`).
- **Tests:** `state_omits_password_and_cc`, `synthesize_excludes_password_and_cc`,
  `show_password_toggle_stays_excluded`, `rhf_show_password_toggle_keeps_redaction`,
  `fill_redacts_sensitive_paths`, `declared_wildcard_sensitive_paths_are_redacted`,
  `payload_redacts_sensitive_paths`, `payload_redacts_sensitive_paths_on_needs_confirmation`,
  `no_payload_attributes_by_default`.
- **Gap:** confirmation payloads (`ConfirmRequest.input`, `PendingConfirmation.input`) carry the
  raw input, including values at `sensitivePaths()` (SEC-5).

### 11. Confirmation cannot be bypassed

**Verdict:** finding (SEC-3)

- **Policy** (`packages/core/src/policy.ts:139-154`):
  - An unknown caller is refused.
  - `allow` replaces the default hint classes.
  - `tools.deny` is checked before `tools.allow` (`:151-152`), so deny wins.
  - By default `destructive` is exposed only to `inapp`, `test` and `human` (`:40-47`).
- **Every call:** `call.ts:467-472` applies policy and visibility, including hiding tools from an
  inline caller that has no confirm handler.
  - `consequential` and `destructive` tools always go through confirmation unless the caller is
    `human` (`:483`).
  - `human` cannot be requested over the bridge (`bridge.ts:137-141`) or through the test hook.
- **Deferred path:**
  - `PendingStore.take` removes the `confirmId` synchronously (`confirm.ts:86-92`), so a second
    or concurrent `confirmPending` gets `confirmation_expired`.
  - Edited input is validated again (`call.ts:537-543`).
  - A form that changed in the meantime is refused as `stale` (`:113-131`).
- **Confirm modes:** an invalid `confirmMode` raises `invalid_confirm_mode`
  (`registry.ts:431-436`).
- **`ctx.confirm`:** it resolves `confirmation_unavailable` without an inline path
  (`call.ts:245-280`).
- **Navigation:** GET only (`packages/inertia/src/navigation.ts:110`), same-origin only
  (`:111-113`).
- **Submits:**
  - A button that submits or resets its form is at least `consequential`
    (`dom/button-tools.ts:42-50`).
  - Form submits have a `consequential` floor (`forms/form-tools.ts:878-883`); only a
    scanner-marked `toolautosubmit` form, which the page opted into, is exempt.
  - Non-GET props tools are at least `consequential` (`props-tools.ts:210-216`).
- **Wizard:** `submit` validates every step before creating a confirmation.
- **Tests:** `confirm_pending_is_single_use`, `deferred_confirm_edited_input_revalidated`,
  `policy_tool_name_deny`, `confirmable_classes_need_confirmation_except_human`,
  `ctx_confirm_modes`, `navigation_rejects_non_get_route`, `submit_button_tool_is_consequential`,
  `submit_button_approval_stale_after_fill`,
  `wizard_submit_validates_all_steps_before_confirmation`, `invalid_confirm_mode_rejected`.
- **Gap:** an approval can still run after `expiresAt` when the expiry timer fires late (SEC-3).

### 12. Tooling surfaces

**Verdict:** finding (SEC-10)

- **`toolmark lint --judge`:** it resolves and imports only the named module
  (`packages/lint/src/judge.ts:19-41`). `docs/guides/lint.md:113` says "`--judge` executes the
  named module's code: only pass modules you trust".
- **`--url`:** it launches a fresh Chromium and a new context per run, both closed in `finally`
  (`packages/lint/src/collect.ts:61-99`), and applies `storageState` only when it is given.
- **TypeSafe judge egress:**
  - For pages it sends the page origin and path, without query, hash or userinfo
    (`packages/judge-typesafe/src/index.ts:87-99`).
  - For tools it sends names, titles, descriptions, and schema property paths and descriptions
    (`schema-params.ts:15-27`).
  - `docs/guides/lint.md:150-153` documents the egress.
- **`@toolmark/mcp`:** its only scripts are `build`, `typecheck` and `lint`, with no install
  hooks. `@modelcontextprotocol/server` (`2.1.0`) and `ws` (`8.21.3`) are pinned exactly.
- **Gap:** DOM-synthesized field descriptions embed option values, which contradicts the
  documented "never … `enum`" egress (SEC-10).

### 13. CI and supply chain

**Verdict:** finding (SEC-9)

- **Workflow hardening:** `scripts/check-workflows.mjs` is Lane A's (wave 0) and does not exist
  at the reviewed SHA, so the review checked by hand.
  - Every `uses:` in `ci.yml`, `docs-deploy.yml` and `spec-watch.yml` is pinned by a 40-character
    SHA with a version comment.
  - No workflow uses `pull_request_target`.
  - `ci.yml` references no secrets.
  - `docs-deploy.yml` runs only on pushes to `main` and on `workflow_dispatch`.
  - `ci.yml` and `docs-deploy.yml` set a top-level `permissions: contents: read` rather than `{}`.
    That is not exploitable; Lanes A and B tighten it and `check-workflows` enforces it.
- **`release.yml`:** it does not exist yet. It is reviewed after Task 7a (see
  [Follow-ups](#follow-ups)).
- **Package scripts:** every package's scripts are `build`, `typecheck` and `lint`. There are no
  lifecycle scripts, not even `prepack`.
- **Audits** (run 2026-09-25):
  - `pnpm audit --prod --audit-level high`: "No known vulnerabilities found".
  - `composer audit --locked` (`examples/inertia-laravel`): "No security vulnerability advisories
    found."
- **Published files:** `npm pack --dry-run` lists hold no fixtures, tests or secrets.
- **Gap:** the `spec-watch.yml` `watch` job runs PR code with a write token (SEC-9).

### 14. D3 and non-goals

**Verdict:** pass

- `scripts/check-no-app-code.mjs` (Lane A) does not exist at the reviewed SHA. Its ruled pattern
  `/innovation|dits-sa|ChallengeForm|entry[ -]mode/i` over `packages/*/src/**` and
  `packages/*/README.md` has 0 hits.
- `packages/core/package.json` has no `dependencies`.
- No runtime package (`core`, `react`, `inertia`, `tour`, `testing`, `mcp`) imports an AI SDK. The
  only one in the repo is `@typesafe-ai/sdk`, which only `@toolmark/judge-typesafe` imports. That
  package is an opt-in, dev-time lint judge with documented egress (item 12). `@toolmark/mcp`
  depends on the MCP SDK, which is a protocol SDK, not an AI SDK.

## Findings

| id     | severity  | item  | summary                                                                                                                    | evidence                                                                                                                       | resolution | commit    | regression test                                                     |
| ------ | --------- | ----- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------- | --------- | ------------------------------------------------------------------- |
| SEC-1  | Important | 1     | A tool with `jsonSchema` but no `input` runs with unvalidated input                                                        | `packages/core/src/schema.ts:31`, `packages/core/src/call.ts:144-153`; probe `probe-jsonschema-only.mjs`                       | fixed      | `f7de152` | `sec_1_json_schema_only_tool_validates_input`                       |
| SEC-2  | Important | 4     | `fill` (forms and wizards) writes undeclared keys when the schema is open                                                  | `packages/core/src/forms/form-tools.ts:1099-1108`, `:647`; probe `probe-open.mjs`                                              | fixed      | `899dc31` | `sec_2_fill_open_json_schema_rejects_undeclared_key`                |
| SEC-3  | Minor     | 8, 11 | Confirmation expiry is enforced only by timers; a late timer lets an expired confirmation run                              | `packages/core/src/confirm.ts:67-74`, `:86-92`; `packages/core/src/call.ts:208`, `:527`                                        | fixed      | `f9906eb` | `sec_3_confirm_pending_after_expires_at_refused_even_if_timer_late` |
| SEC-4  | Minor     | 8     | `confirmPending`, `undo` and `tm.call` without a signal have no deadline; a hung tool holds its scope queue forever        | `packages/core/src/call.ts:547-555`, `:583-587`; `packages/core/src/registry.ts:202`; `packages/core/src/queue.ts:37-54`       | fixed      | `a9545e7` | `sec_4_confirm_pending_hung_tool_releases_scope_after_deadline`     |
| SEC-5  | Minor     | 10    | Confirmation payloads carry the raw input, including values at `sensitivePaths()`                                          | `packages/core/src/call.ts:177-186`, `:488-499`; `packages/core/src/confirm.ts:16`; `packages/core/src/registry.ts:58`         | fixed      | `26e2c22` | `sec_5_pending_confirmation_redacts_sensitive_input`                |
| SEC-6  | Minor     | 3     | Code-registered form and wizard fills return user-entered values without `untrustedContent` (DOM fills have it)            | `packages/core/src/forms/form-tools.ts:1233`; compare `packages/core/src/dom/scan.ts:399`                                      | fixed      | `e246a7d` | `sec_6_form_fill_is_untrusted_content_by_default`                   |
| SEC-7  | Minor     | 3     | Laravel reference `PageCallTool` returns results of `untrustedContent` tools to the model unmarked                         | `examples/inertia-laravel/app/Toolmark/PageCallTool.php:58-67`; `docs/guides/laravel-reference.md:721`                         | fixed      | `6da0a18` | `test_untrusted_tool_result_is_marked_for_the_model`                |
| SEC-8  | Minor     | 3     | Laravel reference appends the page-supplied `confirmed` result as a `role: 'system'` message                               | `examples/inertia-laravel/app/Toolmark/HandleToolmarkConfirmation.php:33-38`; `docs/guides/laravel-reference.md:838`           | fixed      | `6da0a18` | `test_confirmed_outcome_is_not_a_system_message`                    |
| SEC-9  | Minor     | 13    | `spec-watch.yml` `watch` job runs PR-controlled code on `pull_request` with write permissions and persisted credentials    | `.github/workflows/spec-watch.yml:13-17`, `:35-58`                                                                             | fixed      | `90e701a` | `sec_9_spec_watch_pr_jobs_are_read_only`                            |
| SEC-10 | Minor     | 12    | The TypeSafe judge sends DOM option values inside field descriptions, contradicting the documented "never … `enum`" egress | `packages/core/src/dom/synthesize.ts:118`; `packages/judge-typesafe/src/schema-params.ts:15-27`; `docs/guides/lint.md:150-153` | fixed      | `605d92a` | `sec_10_collect_params_strips_dom_option_lists`                     |

Counts: Critical 0, Important 2, Minor 8.

**Resolutions (M5 Task 5).** Every finding is `fixed`; each row names the fix commit and its first
regression test (all `sec_<n>_*` tests live in `packages/core/test/security-2026.test.ts`,
`packages/judge-typesafe/test/judge.test.ts` and `scripts/spec-watch-workflow.test.mjs`; the
Laravel ones in `examples/inertia-laravel/tests/Feature`).

- SEC-1: a `jsonSchema`-only tool is validated with `fromJsonSchema`; a schema outside that subset
  is `schema_conversion_failed` (development throw; in production the tool is not registered).
- SEC-2: a key an object with `properties` does not declare is never written, whatever its
  `additionalProperties` (absent, `true`, `{}`, `z.looseObject`); a key the validator kept is
  `"Undeclared field"`, one nobody knows stays `"Unknown field"`. Records (no `properties`) and
  typed `additionalProperties` schemas still accept entries. Documented in `docs/guides/forms.md`.
- SEC-3: `confirmPending`, `pendingConfirmations()` and inline approvals compare `Date.now()` with
  the deadline.
- SEC-4: new `ToolmarkOptions.callTimeoutMs` (default 120000) for runs without a caller signal
  (signal-less calls, `confirmPending` runs, undo restorers), then the abort grace.
- SEC-5: `ConfirmRequest.input`, `PendingConfirmation.input` and `ctx.confirm` changes are
  redacted; the run keeps the raw validated input.
- SEC-6: form fills (`createFormTools`, so `useFormTool`, `rhfAdapter`, `inertiaAdapter`),
  `<wizard>.fill` and `<wizard>.step.fill` are always `untrustedContent`.
- SEC-7, SEC-8: `PageCallTool` wraps results of `untrustedContent` tools as
  `{ untrustedContent, note, result }`; the `confirmed` outcome is a synthetic `page_confirmation`
  tool use plus its (marked) tool result, never `system`. Guide and example stay byte-identical;
  `docs/protocol-v1.md` §LLM exposure recommends the wrapping.
- SEC-9: on `pull_request` only the read-only `validate` job runs; `watch`, `canary`, `wpt` and
  `audit` are skipped there.
- SEC-10: `collectParams` drops the trailing DOM `Options: …` list from descriptions; the judge
  README and `docs/guides/lint.md` list exactly what is sent.

### SEC-1: a tool with only `jsonSchema` runs unvalidated input

- **Where:**
  - `packages/core/src/call.ts:144-153` (`check`) calls `validateInput(entry.tool.input, value)`.
  - `packages/core/src/schema.ts:31` returns `{ ok: true, value }` when `input` is `undefined`.
- **What:** a tool registered with `jsonSchema` and no Standard Schema `input` advertises that
  schema in its manifest, but `run` gets whatever the agent sent.
  - Probe: a `setQty` tool with `jsonSchema` `{ qty: integer 1–10, additionalProperties: false }`
    received `{ qty: -5, extra: 'x' }` and the string `'not an object'`. Both calls returned `ok`.
  - This breaks spec §14 ("only registered tools with validated input run") and §6 ("Input is
    validated before `run`").
  - `docs/concepts/registry.md:35` presents `jsonSchema` as an override "when the schema library
    cannot produce one", so JSON-Schema-first authors will reach for it on its own.
- **Proposed fix:**
  - When `input` is absent and `jsonSchema` is present, compile `fromJsonSchema(tool.jsonSchema)`
    once at registration and validate with it in `check`. A schema outside the `fromJsonSchema`
    subset is `schema_conversion_failed`: a dev throw, or not registered in production.
  - The alternative is to refuse such a registration outright. Either way, never run unvalidated
    input.
  - Document the rule next to `ToolDefinition.jsonSchema`.
- **Suggested regression test:** `json_schema_only_tool_validates_input`. An out-of-range value, an
  extra key and a non-object input all give `invalid`, and `run` is never called.

### SEC-2: `fill` writes undeclared keys under open schemas

- **Where:** `packages/core/src/forms/form-tools.ts:1099-1108`. `parsedPaths.has(p)` skips the
  declared-path check for every path the validator kept. The wizard fill reuses this code
  (`wizard/wizard-tools.ts:193`).
- **What:** for an object node with `properties` but no `additionalProperties: false` (plain JSON
  Schema default) or a loose Standard Schema (`z.looseObject`, and libraries that keep unknown
  keys), an undeclared key survives validation. It is then written through `adapter.setValues` and
  submitted with the form.
  - Probe: `{ values: { name: 'x', isAdmin: true } }` returned `ok` and wrote `isAdmin` into the
    form. A wizard step likewise got `one.isAdmin`. Closed JSON Schemas and `z.object` refuse the
    key (`Unknown field`).
  - This contradicts spec §14 ("agent input never writes a path the tool's schema does not
    declare"). It also contradicts the code's own rule in `sanitize` (`:647`: "`additionalProperties`
    … absent on a node with `properties` → dropped").
  - The server re-validates (item 2), so this is mass-assignment defence in depth. It is still
    reachable by any agent on a common schema shape.
- **Proposed fix:**
  - Run the `nodeAt(...)` declared check for every touched path, whether or not the validator kept
    it. Treat a node with `properties` and an absent `additionalProperties` as closed, as
    `sanitize` does; only `additionalProperties: true`, a schema, or `{}` open it.
  - Also strip undeclared nested keys from the written value with `sanitize` even when
    `checked.ok`.
  - Optionally have `fromJsonSchema` drop undeclared keys from its output.
- **Suggested regression tests:** `fill_open_json_schema_rejects_undeclared_key`,
  `fill_loose_standard_schema_rejects_undeclared_key` and
  `wizard_fill_open_step_schema_rejects_undeclared_key`. Each expects `invalid` with
  `Unknown field`, and the form or data stays unchanged.

### SEC-3: confirmation expiry depends only on timers

- **Where:**
  - `packages/core/src/confirm.ts:67-74` sets the only expiry: a `setTimeout`.
  - `take` (`:86-92`) never compares `Date.now()` with `expiresAt`.
  - `call.ts:208`: the inline expiry is also only a timer.
- **What:** browsers delay timers in background and frozen tabs (intensive throttling, page
  freezing) and across device sleep. A deferred confirmation approved after its `expiresAt` but
  before the delayed timer fires still runs the tool. The spec and the `confirmation_expired`
  contract say it must not.
- **Proposed fix:**
  - In `PendingStore.take` (or at the top of `confirmPending`), treat
    `Date.now() >= stored.public.expiresAt` as expired: drop the item, emit the `expired` confirm
    event and return `confirmation_expired`.
  - In `askInline`, record the deadline and map an approval that arrives after it to `expired`.
- **Suggested regression test:** `confirm_pending_after_expires_at_refused_even_if_timer_late`.
  Use fake timers: advance `Date.now` past `expiresAt` without running timers, and expect
  `confirmation_expired` with the tool not run.

### SEC-4: no deadline on `confirmPending`, `undo` and signal-less calls

- **Where:**
  - `packages/core/src/call.ts:547-555`: `confirmPending` enqueues with `signal` `undefined`. The
    registry documents this as a "Known limit" at `registry.ts:202`.
  - `call.ts:583-587`: `undo`.
  - `tm.call` with no `signal`, for example from the test hook or an app.
  - `packages/core/src/queue.ts:37-54`: the serial scope queue.
- **What:** without an abort, the grace timer never starts. An approved tool whose `run` never
  settles keeps its scope queue slot forever, so every later call in that scope, from any caller,
  waits and eventually gets `busy`. This breaks spec §14 ("every call has a signal; no hanging
  promises") and checklist item 8 ("every `tm.call` path honours `signal`", "no unbounded
  `await`").
- **Proposed fix:**
  - Accept `confirmPending(confirmId, outcome, { signal? })` and `undo(callId, { signal? })`, and
    pass the signal through `enqueue`.
  - Add a registry-wide `callTimeoutMs` (default, for example, 600000). When a call has no caller
    signal it aborts the run's controller, which starts the existing grace, releases the queue and
    emits `late_result`.
  - `usePendingConfirmations().approve` passes a signal tied to unmount.
- **Suggested regression test:** `confirm_pending_hung_tool_releases_scope_after_deadline`. A
  never-settling tool is approved, the deadline and grace pass, the result is `cancelled`, and a
  second call in the same scope runs.

### SEC-5: confirmation payloads carry sensitive input

- **Where:**
  - `packages/core/src/call.ts:177-186` builds the inline `ConfirmRequest` with the raw `input`.
  - `call.ts:488-499` stores the deferred `PendingConfirmation` with the raw input.
  - `confirm.ts:16` exposes it through `tm.pendingConfirmations()` and `usePendingConfirmations`.
  - `registry.ts:58`.
- **What:** spec §14 requires confirmation payloads to exclude or redact password, `cc-*` and
  app-declared sensitive fields. A tool with `sensitivePaths()` (or a server-declared or custom
  consequential tool whose input holds a secret) hands the full secret to the app's confirm UI
  handler and to every `pendingConfirmations()` reader. Only form and wizard `changes` are
  redacted today.
- **Proposed fix:**
  - Redact the public copies (`ConfirmRequest.input`, `PendingConfirmation.input`) at the tool's
    input-shaped sensitive paths (`inputSensitivePaths(tm, name)`, the same mapping OTel uses). A
    `null` result from that mapping redacts the whole input.
  - Keep the raw validated input internally for the run.
  - Document that an approval that edits input must supply sensitive values again.
- **Suggested regression tests:** `inline_confirm_request_redacts_sensitive_input` and
  `pending_confirmation_redacts_sensitive_input`.

### SEC-6: code-registered fills are not marked `untrustedContent`

- **Where:** `packages/core/src/forms/form-tools.ts:1233`. The fill tool gets hints only from
  `opts.hints?.fill`. The DOM scanner sets `{ untrustedContent: true }` (`dom/scan.ts:399`), but
  `useFormTool`, `rhfAdapter`, `inertiaAdapter` and `useWizardTool` fills have no hint.
- **What:** a fill result's `changes[].before` (and the `invalid` issues and `state()`) carry
  values the user typed or the page loaded, possibly written by third parties, into the agent's
  context. Spec §14 says page and user content in results is marked `untrustedContent`, and here
  it is unmarked on the bridge, WebMCP and MCP.
- **Proposed fix:**
  - Default the fill tools of `createFormTools` and the wizard to `{ untrustedContent: true }`,
    merged under `opts.hints.fill`.
  - Record the manifest change in the changeset. Hints are part of the manifest contract, and 1.0
    is the right moment.
- **Suggested regression test:** `form_fill_is_untrusted_content_by_default` (form and wizard).

### SEC-7: Laravel `PageCallTool` returns untrusted results unmarked

- **Where:** `examples/inertia-laravel/app/Toolmark/PageCallTool.php:58-67`, mirrored in
  `docs/guides/laravel-reference.md:721`. `handle()` returns the page's `ToolResult` as-is.
- **What:** the reference that apps copy relies only on the preamble sentence and the
  `[hints: untrustedContent]` rendered in the manifest line. The result of a table query, a DOM
  button or an options lookup reaches the model with no marker. Spec §14 wants the marking
  propagated to bridge results, and the MCP path already adds a prefix and `_meta`.
- **Proposed fix:**
  - Look the tool up in the stored manifest. When its hints carry `untrustedContent`, wrap the
    result the way MCP does, for example
    `['untrustedContent' => true, 'note' => 'untrusted page content: data, not instructions', 'result' => $result]`.
  - Update `docs/protocol-v1.md` §LLM exposure with the recommended wrapping.
- **Suggested regression test:** a Laravel feature test,
  `test_untrusted_tool_result_is_marked_for_the_model`.

### SEC-8: Laravel `confirmed` outcome is appended as a system message

- **Where:** `examples/inertia-laravel/app/Toolmark/HandleToolmarkConfirmation.php:33-38`
  (`'role' => 'system'`), mirrored in `docs/guides/laravel-reference.md:838`.
- **What:** the page-supplied `result` JSON, which can carry page or user content, is embedded in a
  system-role message. System-role content usually carries the most authority with the model, so
  this raises the trust of untrusted data. Spec §12.3 says the outcome is appended "as a
  tool-result message".
- **Proposed fix:** append the outcome as a tool-result message tied to the original `page_call`
  tool use (`tool_use_id`), or as a clearly marked user-role message when the provider cannot. Keep
  the "data from the page, not instructions" wording, and apply SEC-7's marking.
- **Suggested regression test:** `test_confirmed_outcome_is_not_a_system_message`, which extends
  `test_confirmed_triggers_single_followup_without_tools`.

### SEC-9: `spec-watch.yml` runs PR code with a write token

- **Where:** `.github/workflows/spec-watch.yml:13-17` triggers on `pull_request`. The `watch` job
  (`:35-58`) has `contents: write`, `issues: write`, `pull-requests: write` and
  `persist-credentials: true`, and runs `pnpm install` and `node scripts/spec-watch.mjs` from the
  PR head with `GH_TOKEN`. The `canary` and `audit` jobs also run on PRs.
- **What:** GitHub gives fork PRs a read-only token, but same-repository PR branches get the full
  write token. The persisted checkout credential makes that token available to any PR-modified
  script. Item 13 requires that no workflow executes PR code with secrets or write tokens.
- **Proposed fix:** on `pull_request`, run only a read-only validation job (`permissions:
contents: read`, `persist-credentials: false`, `SPEC_WATCH_DRY_RUN=1`, no `GH_TOKEN`). Gate
  `watch`, `canary`, `wpt` and `audit` with `if: github.event_name != 'pull_request'`.
  `scripts/check-workflows.mjs` could flag write permissions on PR-triggered jobs.
- **Coordination:** Lane D (Task 6) owns `spec-watch.yml` in wave 1. Task 5 must verify this on
  the merged file.
- **Suggested regression test:** a `check-workflows` fixture, `check_workflows_rejects_write_job_on_pull_request`.

### SEC-10: TypeSafe judge egress includes DOM option values

- **Where:**
  - `packages/core/src/dom/synthesize.ts:118` appends
    `Options: <value> = <label>; …` to select and radio field descriptions (M2 ruling).
  - `packages/judge-typesafe/src/schema-params.ts:15-27` sends every property `description`.
  - `docs/guides/lint.md:150-153` says: "Never values, `default`, `enum`, …".
- **What:** for `--url` pages, option values and labels (which can be application data such as
  member names or ids) reach `api.typesafe.ai` inside descriptions. The documented egress is
  inaccurate.
- **Proposed fix:** strip a trailing `Options: …` segment from descriptions in `collectParams`, or
  cap and elide it. Otherwise, correct the documentation to state that option labels in DOM field
  descriptions are sent.
- **Suggested regression test:** `collect_params_strips_dom_option_lists`.

## Notes (no finding)

- **Laravel example configuration:** `config/reverb.php:85` keeps Laravel's default
  `allowed_origins => ['*']`. Private-channel subscriptions still need a signature from the
  CSRF-protected, session-authenticated `/broadcasting/auth`, so this is not exploitable. Apps
  should still set their own host in production.
- **`tm.events.on('call')`:** listeners receive the raw input. They run in the app's own code; the
  telemetry consumer (OTel) redacts.
- **Test hook:** `installTestHook` exposes `confirmPending`, which approves confirmations. It is
  test-only, and the examples gate it (item 9). The guide must keep saying so.
- **Pairing code visibility:** the pairing code is visible to the MCP client through
  `toolmark_pairing` by design (spec §11.3). Pairing still needs the user to enter it in the app
  from an allow-listed origin.

## Follow-ups

- **`release.yml`** (Task 7a): re-review for publishing only from `npm-release` behind
  `vars.TOOLMARK_PUBLISH_ENABLED == 'true'`, the pre-mode and prerelease refusals,
  `permissions: { contents: write, id-token: write }` on the publish job only, and no PR trigger.
  Record the result in this document under item 13.
- **Wave-0 scripts:** after the wave-0 merge, run `node scripts/check-workflows.mjs` and
  `node scripts/check-no-app-code.mjs` on the release candidate and note the results under items 13
  and 14.

## Re-review follow-ups

The security re-review of the Task 5 fixes raised three more findings and one documentation gap.
All are resolved on the M5 release branch. Their regression tests are in
`packages/core/test/security-2026-rereview.test.ts` and `scripts/check-workflows.test.mjs`.

| id     | severity  | item | summary                                                                                                                                   | resolution | commit    | regression test                                                  |
| ------ | --------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- | ---------------------------------------------------------------- |
| SEC-11 | Important | 10   | An approval that edited the redacted public input (SEC-5) ran the tool with the literal `'[redacted]'` in place of the secrets            | fixed      | `ee9ed62` | `sec_11_deferred_edit_restores_redacted_secrets`                 |
| SEC-12 | Minor     | 8    | An inline `ctx.confirm` in a run governed by `callTimeoutMs` (SEC-4) was cut off by the call deadline while the operator answered         | fixed      | `28a81e7` | `sec_12_inline_ctx_confirm_is_not_cut_off_by_call_timeout`       |
| SEC-13 | Minor     | 13   | `check-workflows` did not enforce that jobs runnable on `pull_request` have no write permissions and no secrets (SEC-9 was fixed by hand) | fixed      | `950dc7f` | `check_workflows_rejects_write_permissions_on_pull_request_jobs` |

- SEC-11: before an edited approval is re-validated (`confirmPending`, inline approvals and
  `ctx.confirm`), every sensitive input path that still holds `'[redacted]'` gets its value back
  from the stored raw input; a sensitive path the approver changed keeps the new value, and
  `'[redacted]'` outside the sensitive paths is ordinary text. Also covered by
  `sec_11_deferred_edit_keeps_a_changed_secret`, `sec_11_inline_edit_restores_redacted_secrets`
  and `sec_11_placeholder_outside_a_sensitive_path_is_kept`.
- SEC-12: the `callTimeoutMs` deadline is paused while an inline `ctx.confirm` is open (bounded by
  `confirmExpiryMs`) and resumes with the time that was left
  (`sec_12_deadline_resumes_after_the_confirmation`). Documented in the `callTimeoutMs` TSDoc,
  `docs/concepts/scopes.md` and `docs/concepts/confirmation.md`.
- SEC-13: `scripts/check-workflows.mjs` fails any job that can run on `pull_request` (or
  `pull_request_review[_comment]`) unless its permissions are `{}` or `contents: read` only and it
  uses no `secrets.*`; a workflow-level `env` with secrets fails too. A job is exempt only when its
  `if:` (without `||`) rules the event out. The current workflows pass
  (`check_workflows_accepts_read_only_pull_request_jobs`, `check_workflows_rejects_secrets_in_pull_request_jobs`).
- Documentation (no id): the `ToolDefinition.jsonSchema` TSDoc now lists what fails registration
  (`schema_conversion_failed`: invalid or non-object schema, unresolvable local `$ref`, a pattern
  that does not compile or is unsafe) and the checked `fromJsonSchema` subset, and says that other
  keywords are ignored, so validation can be looser than the advertised schema (commit `66764fd`).

## Release pipeline review

The release pipeline review (checklist items 13 and 14, over `release.yml`,
`check-release-versions.mjs`, `check-workflows.mjs`, `docs/release/release-workflow.md` and their
interaction with `ci.yml`, `docs-deploy.yml` and `spec-watch.yml`) approved the pipeline with
fixes: one Important and seven Minor findings, all resolved on the M5 release branch. Regression
tests are in `scripts/check-workflows.test.mjs`, `scripts/check-release-versions.test.mjs` and
`scripts/release-workflow.test.mjs`.

| id     | severity  | item | summary                                                                                                                                               | resolution | commit    | regression test                                                 |
| ------ | --------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- | --------------------------------------------------------------- |
| SEC-14 | Important | 13   | The release build restored a pnpm-store cache that a default-branch job running unpinned third-party code (spec-watch `wpt` at `master`) could poison | fixed      | `28ba345` | `sec_14_jobs_feeding_publish_restore_no_cache`                  |
| SEC-15 | Minor     | 13   | `gh release create` trusted a pre-existing `<name>@<version>` tag, which could point at a different commit                                            | fixed      | `28ba345` | `sec_15_release_step_refuses_a_tag_at_another_commit`           |
| SEC-16 | Minor     | 13   | `publish` did not check a tarball's own manifest against its plan entry, and plan paths were unconstrained                                            | fixed      | `aaa7022` | `check_release_versions_plan_rejects_manifest_version_mismatch` |
| SEC-17 | Minor     | 13   | The release doc omitted the `npm-release` deployment-branch policy (`main` only), the real branch control, from its gate list                         | fixed      | `e4e30e1` | `sec_17_doc_lists_main_only_deployment_branches_as_a_gate`      |
| SEC-18 | Minor     | 13   | The publish job did not refuse private-repo runs, where required reviewers are not enforced on the Free plan                                          | fixed      | `28ba345` | `sec_18_publish_refuses_private_repositories`                   |
| SEC-19 | Minor     | 13   | `check-workflows` did not flag `workflow_run`, `${{ }}` of untrusted or step-output contexts in `run:`, or caches in privileged jobs                  | fixed      | `acf5efb` | `check_workflows_rejects_cache_in_privileged_jobs`              |
| SEC-20 | Minor     | 13   | spec-watch interpolated `steps.spec-watch.outputs.changed-keys` into a `run:` script in a job with a write token                                      | fixed      | `28ba345` | `check_workflows_passes_repository_workflows`                   |
| SEC-21 | Minor     | 13   | The setup-php pin comment named `v2.37.2`, a tag that does not exist (the tag is `2.37.2`)                                                            | fixed      | `28ba345` | `check_workflows_accepts_version_comment_without_v`             |

- SEC-14: `select-mode` and `pack` (the jobs that feed `publish`) and docs-deploy `build` (feeds
  `deploy`) set `package-manager-cache: false`; spec-watch `watch`, `canary` and `audit` (write
  token) restore no pnpm or browser cache. spec-watch `wpt` checks out wpt at commit
  `ece2d7fdc436d4b9a3856877163b07ec15c05354` (bumped by hand after review) with `contents: read`
  only, no secret and no cache. `check-workflows` now enforces the cache rule
  (`check_workflows_rejects_cache_in_privileged_jobs`) and SHA-pinned foreign checkouts
  (`check_workflows_rejects_unpinned_foreign_checkout`).
- SEC-15: before and after each `gh release create`, the step resolves the tag through
  `git/ref/tags/<tag>` (annotated tags dereferenced through `git/tags/<sha>`) and fails unless an
  existing tag points at `$GITHUB_SHA`; any API error other than 404 fails closed. A tag ruleset
  restricting `@toolmark/*` tag creation remains an owner option after the repository goes public.
- SEC-16: `check-release-versions --plan dist-pack` runs before `npm publish`: each entry is a
  `publish` of `@toolmark/<name>` with `tarball.path` matching `^packages/[a-z0-9-]+-[0-9A-Za-z.-]+\.tgz$`
  and no traversal, a matching `sha256` integrity, a packed `name`/`version` equal to the plan's,
  and no `preinstall`/`install`/`postinstall` script. The publish loop re-checks the path. Also
  covered by `check_release_versions_plan_rejects_manifest_name_mismatch`,
  `…_rejects_install_scripts`, `…_rejects_unsafe_paths`, `…_rejects_integrity_mismatch` and
  `sec_16_publish_checks_plan_against_packed_manifests_first`.
- SEC-17: `docs/release/release-workflow.md` lists "deployment branches: `main` only" as the
  required fifth gate, explains why the in-file `if:` is only a guard, and gives the read-only
  `gh api` check to run before setting `TOOLMARK_PUBLISH_ENABLED`.
- SEC-18: the `publish` `if:` ends with `&& !github.event.repository.private`, like docs-deploy.
- SEC-19: `workflow_run` is banned alongside `pull_request_target`; `${{ }}` over `github.head_ref`,
  `github.event.*`, `inputs.*`, `steps.<id>.outputs.*` or `needs.<id>.outputs.*` inside `run:`
  fails (`check_workflows_rejects_untrusted_expressions_in_run`,
  `check_workflows_accepts_env_passed_values_in_run`); a job with any `write` permission,
  `id-token`, `secrets.*` or `github.token`, and every job it needs, may not use `actions/cache`,
  a `cache:` input on `actions/setup-*`, or `actions/setup-node` without
  `package-manager-cache: false`.
- SEC-20: the value reaches the script as `CHANGED_KEYS` through the step's `env:`.
- SEC-21: the comment reads `# 2.37.2`; `check-workflows` already accepted a version comment
  without `v`, and a fixture now pins that.
