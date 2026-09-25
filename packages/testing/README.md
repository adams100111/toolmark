# @toolmark/testing

Testing helpers for Toolmark. `@toolmark/testing` extends `@playwright/test` with a `tools`
fixture (`list`, `get`, `call`, `confirm`, `autoConfirm`) and matchers (`toHaveTools`,
`toBeConsequential`, `toBeReadOnly`, `toHaveChanged`) that drive page tools through an in-page
test hook; `@toolmark/testing/vitest` provides `createTestToolmark()` (production confirmation
modes, scripted inline confirmations, a call recorder) without importing Playwright; and
`@toolmark/testing/page` installs the hook (`installTestHook(tm)`) in non-production builds.

```sh
pnpm add -D @toolmark/testing
```

ESM only; Node ≥ 22.12. `@playwright/test` ≥ 1.63 is an optional peer (only for the fixture).

```ts
// app entry: install the hook outside production builds only
if (import.meta.env.MODE !== 'production') {
  void import('@toolmark/testing/page').then(({ installTestHook }) => installTestHook(tm))
}
```

```ts
// e2e/signup.spec.ts
import { expect, test } from '@toolmark/testing'

test('agent can fill the sign-up form', async ({ page, tools }) => {
  await page.goto('/')
  await expect(tools).toHaveTools(['signup.fill', 'signup.submit'])
  const result = await tools.call('signup.fill', { name: 'Ada' })
  expect(result).toHaveChanged('name', 'Ada')
})
```

Protocol and server contract: [docs/protocol-v1.md](https://github.com/adams100111/toolmark/blob/main/docs/protocol-v1.md).

## License

MIT
