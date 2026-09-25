# @toolmark/core

Framework-agnostic core of Toolmark: declare tools once in a registry (with Standard Schema input
validation, behaviour hints, per-caller policy and human confirmation for consequential actions),
generate form tools (`<form>.fill` / `<form>.submit`) from any form library through a
`FormAdapter`, and expose everything to an agent through the in-app bridge (protocol v1) and its
transports: Laravel Echo, WebSocket, `postMessage` and an in-page channel.

```sh
pnpm add @toolmark/core
```

ESM only; Node ≥ 22.12. Zero runtime dependencies.

```ts
import { createToolmark, ok } from '@toolmark/core'
import { bridge } from '@toolmark/core/bridge'
import { createInPageChannel } from '@toolmark/core/bridge/in-page'
import { z } from 'zod'

const tm = createToolmark()

tm.register({
  name: 'cart.add',
  description: 'Add a product to the cart by SKU.',
  input: z.object({ sku: z.string(), quantity: z.number().int().min(1) }),
  hints: { consequential: true }, // an in-app agent gets needs_confirmation; the user approves
  run: ({ sku, quantity }) => ok(addToCart(sku, quantity)),
})

// Attach the bridge: the agent side receives the manifest and sends calls (protocol v1).
const { transport, agent } = createInPageChannel()
tm.use(bridge({ transport }))
agent.onMessage((message) => console.log(message.type))
```

Entry points: `@toolmark/core`, `@toolmark/core/protocol` (message types, JSON Schemas,
`validateMessage`), `@toolmark/core/protocol/v1/*.json`, `@toolmark/core/bridge` and the
per-transport subpaths `/bridge/echo`, `/bridge/websocket`, `/bridge/post-message`,
`/bridge/in-page`.

Protocol and server contract: [docs/protocol-v1.md](https://github.com/adams100111/toolmark/blob/main/docs/protocol-v1.md).

## License

MIT
