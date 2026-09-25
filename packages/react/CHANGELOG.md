# @toolmark/react

## 1.0.0

### Major Changes

- [`3aa8d2f`](https://github.com/adams100111/toolmark/commit/3aa8d2ff9231402345c244aadf2c2b31ff057a5c) Thanks [@adams100111](https://github.com/adams100111)! - First stable release.

### Minor Changes

- [#2](https://github.com/adams100111/toolmark/pull/2) [`826127a`](https://github.com/adams100111/toolmark/commit/826127aeec43c70b8dead15d426e8aab6b6de896) Thanks [@adams100111](https://github.com/adams100111)! - The tool registry with policy, deferred and inline confirmation, undo and form tools; bridge
  protocol v1 with the Echo, WebSocket, postMessage and in-page transports; React bindings with the
  react-hook-form adapter; the Inertia `useForm` adapter; and the Playwright fixture plus
  `createTestToolmark` for tests.

- [#3](https://github.com/adams100111/toolmark/pull/3) [`1f75289`](https://github.com/adams100111/toolmark/commit/1f75289f1f6bea53658b9a5bc33ad2231a533287) Thanks [@adams100111](https://github.com/adams100111)! - Every form shape becomes a tool. Core adds array semantics, async options, files, a
  zero-dependency JSON-Schema-subset validator (`fromJsonSchema`), the wizard engine
  (`createWizardTools`, `createStepwiseWizardTools`) and the DOM layer (`@toolmark/core/dom`:
  `scanDom`, `synthesizeFormSchema`, `domFormAdapter`) for uncontrolled/plain HTML forms. React adds
  `useWizardTool` and `useFieldArray` support in the react-hook-form adapter. Inertia adds page scopes
  (`inertiaPages`), props-declared server tools (`propsTools`), a navigation tool and the `<Form>`
  component adapter.

- [#4](https://github.com/adams100111/toolmark/pull/4) [`ad3fb62`](https://github.com/adams100111/toolmark/commit/ad3fb62cd76ebcf96956c8b410e64ecc55549f85) Thanks [@adams100111](https://github.com/adams100111)! - The same tool declarations reach browser agents through the experimental WebMCP consumer
  (`@toolmark/core/webmcp`, app-supplied polyfill loader), desktop MCP clients through the
  `@toolmark/mcp` package (the dual-era `toolmark-mcp` stdio server with localhost pairing, and
  `mcpPairing` in `@toolmark/mcp/client`), and OpenTelemetry (`@toolmark/core/otel`, no payloads by
  default). Tour hooks in core: `tm.anchor`, `tm.setAnchor`, `tm.state`, `tm.info(...).sensitivePaths`
  and user interaction events from the DOM, react-hook-form (`rhfAdapter` `root`) and Inertia `<Form>`
  adapters, plus `useToolAnchor` in `@toolmark/react`.

### Patch Changes

- Updated dependencies [[`826127a`](https://github.com/adams100111/toolmark/commit/826127aeec43c70b8dead15d426e8aab6b6de896), [`1f75289`](https://github.com/adams100111/toolmark/commit/1f75289f1f6bea53658b9a5bc33ad2231a533287), [`ad3fb62`](https://github.com/adams100111/toolmark/commit/ad3fb62cd76ebcf96956c8b410e64ecc55549f85), [`238d1ef`](https://github.com/adams100111/toolmark/commit/238d1ef3edd0068554fa228d86ddee0c0a55a509), [`3aa8d2f`](https://github.com/adams100111/toolmark/commit/3aa8d2ff9231402345c244aadf2c2b31ff057a5c)]:
  - @toolmark/core@1.0.0

## 1.0.0-next.4

### Major Changes

- First stable release.

### Patch Changes

- Updated dependencies [[`238d1ef`](https://github.com/adams100111/toolmark/commit/238d1ef3edd0068554fa228d86ddee0c0a55a509)]:
  - @toolmark/core@1.0.0-next.4

## 0.1.0-next.3

### Patch Changes

- @toolmark/core@0.1.0-next.3

## 0.1.0-next.2

### Minor Changes

- Third preview (M3, reach): the same tool declarations now reach browser agents through the
  experimental WebMCP consumer (`@toolmark/core/webmcp`, app-supplied polyfill loader), desktop MCP
  clients through the new `@toolmark/mcp` package (the dual-era `toolmark-mcp` stdio server with
  localhost pairing, and `mcpPairing` in `@toolmark/mcp/client`), and OpenTelemetry
  (`@toolmark/core/otel`, no payloads by default). Tour hooks land in core: `tm.anchor`,
  `tm.setAnchor`, `tm.state`, `tm.info(...).sensitivePaths` and user interaction events from the DOM,
  react-hook-form (`rhfAdapter` `root`) and Inertia `<Form>` adapters, plus `useToolAnchor` in
  `@toolmark/react`. Distributed as `-next` tarballs only; nothing is published to npm before 1.0.

### Patch Changes

- Updated dependencies
  - @toolmark/core@0.1.0-next.2

## 0.1.0-next.1

### Minor Changes

- Second milestone (M2) preview: every form shape becomes a tool. Core adds array semantics, async
  options, files, a zero-dependency JSON-Schema-subset validator (`fromJsonSchema`), the wizard engine
  (`createWizardTools`, `createStepwiseWizardTools`) and the DOM layer (`@toolmark/core/dom`:
  `scanDom`, `synthesizeFormSchema`, `domFormAdapter`) for uncontrolled/plain HTML forms. React adds
  `useWizardTool` and `useFieldArray` support in the react-hook-form adapter. Inertia adds page scopes
  (`inertiaPages`), props-declared server tools (`propsTools`), a navigation tool and the `<Form>`
  component adapter. Distributed as `-next` tarballs only; nothing is published to npm before 1.0.

### Patch Changes

- Updated dependencies
  - @toolmark/core@0.1.0-next.1

## 0.1.0-next.0

### Minor Changes

- 826127a: First milestone (M1) preview: the tool registry with policy, deferred and inline confirmation,
  undo and form tools; bridge protocol v1 with the Echo, WebSocket, postMessage and in-page
  transports; React bindings with the react-hook-form adapter; the Inertia `useForm` adapter; and the
  Playwright fixture plus `createTestToolmark` for tests. Distributed as `-next` tarballs only;
  nothing is published to npm before 1.0.

### Patch Changes

- Updated dependencies [826127a]
  - @toolmark/core@0.1.0-next.0
