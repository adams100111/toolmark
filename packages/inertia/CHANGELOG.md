# @toolmark/inertia

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
