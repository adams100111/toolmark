---
'@toolmark/core': minor
'@toolmark/react': minor
'@toolmark/inertia': minor
---

Every form shape becomes a tool. Core adds array semantics, async options, files, a
zero-dependency JSON-Schema-subset validator (`fromJsonSchema`), the wizard engine
(`createWizardTools`, `createStepwiseWizardTools`) and the DOM layer (`@toolmark/core/dom`:
`scanDom`, `synthesizeFormSchema`, `domFormAdapter`) for uncontrolled/plain HTML forms. React adds
`useWizardTool` and `useFieldArray` support in the react-hook-form adapter. Inertia adds page scopes
(`inertiaPages`), props-declared server tools (`propsTools`), a navigation tool and the `<Form>`
component adapter.
