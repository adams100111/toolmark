# @toolmark/react

React bindings for Toolmark: `ToolmarkProvider`, `useTool` (register a tool for a component's
lifetime), `ToolScope`, `useFormTool` with the react-hook-form adapter (`@toolmark/react/rhf`),
the headless confirmation hooks `useConfirmQueue` / `usePendingConfirmations`, and
`useAgentActivity`. Tools appear and disappear with the components that declare them.

```sh
pnpm add @toolmark/core @toolmark/react
```

ESM only; Node ≥ 22.12; React ≥ 18.3. `react-hook-form` 7 is an optional peer (only for
`@toolmark/react/rhf`).

```tsx
import { createToolmark } from '@toolmark/core'
import { ToolmarkProvider, useFormTool } from '@toolmark/react'
import { rhfAdapter } from '@toolmark/react/rhf'
import { useForm } from 'react-hook-form'
import { z } from 'zod'

const tm = createToolmark()
const Signup = z.object({ name: z.string().min(1), email: z.string().email() })
type SignupValues = z.infer<typeof Signup>

function SignupForm({ save }: { save: (v: SignupValues) => Promise<unknown> }) {
  const form = useForm<SignupValues>({ defaultValues: { name: '', email: '' } })
  // Registers signup.fill and signup.submit while this component is mounted.
  useFormTool(rhfAdapter(form, { onSubmit: save }), {
    name: 'signup',
    description: 'The sign-up form: fill it, then submit it.',
    input: Signup,
  })
  return <form onSubmit={form.handleSubmit(save)}>{/* fields */}</form>
}

export const App = () => (
  <ToolmarkProvider toolmark={tm}>
    <SignupForm save={async (v) => v} />
  </ToolmarkProvider>
)
```

Protocol and server contract: [docs/protocol-v1.md](https://github.com/adams100111/toolmark/blob/main/docs/protocol-v1.md).

## License

MIT
