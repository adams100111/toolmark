# @toolmark/inertia

Inertia.js adapter for Toolmark form tools: `inertiaAdapter(form, { submit })` turns an
`@inertiajs/react` `useForm()` into a `FormAdapter`, so `useFormTool` exposes the form as
`<name>.fill` / `<name>.submit`. Submits settle on the visit's own callbacks (success → `ok`,
validation errors → `invalid`, failures → `error`, cancelled → `cancelled`).

```sh
pnpm add @toolmark/core @toolmark/react @toolmark/inertia
```

ESM only; Node ≥ 22.12; React ≥ 18.3; `@inertiajs/react` 2 or 3 (Inertia 3 requires React 19).

```tsx
import { useForm } from '@inertiajs/react'
import { useFormTool } from '@toolmark/react'
import { inertiaAdapter } from '@toolmark/inertia'
import { z } from 'zod'

const Project = z.object({ title: z.string().min(1), budget: z.number().min(0) })

export function CreateProject() {
  const form = useForm({ title: '', budget: 0 })
  useFormTool(inertiaAdapter(form, { submit: { method: 'post', url: '/projects' } }), {
    name: 'project',
    description: 'Create a project: fill its title and budget, then submit.',
    input: Project,
  })
  return <form>{/* fields bound to form.data / form.setData */}</form>
}
```

Protocol and server contract: [docs/protocol-v1.md](https://github.com/adams100111/toolmark/blob/main/docs/protocol-v1.md).

Docs: [Inertia guide](https://adams100111.github.io/toolmark/guides/inertia) ·
[API reference](https://adams100111.github.io/toolmark/api/@toolmark/inertia/).

## License

MIT
