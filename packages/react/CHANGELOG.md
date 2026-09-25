# @toolmark/react

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
