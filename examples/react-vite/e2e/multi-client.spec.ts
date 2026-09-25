import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import {
  connectRelayAgent,
  newRoom,
  relayPagePath,
  type RelayAgent,
} from './support/relay-server.js'

// Spec §18: two tabs share one relay (one agent); a `call` addressed to tab B's `clientId` runs
// only in tab B and is answered exactly once.

const FILL = 'challenges.create.fill'

let agent: RelayAgent | undefined
test.afterEach(async () => {
  await agent?.close()
  agent = undefined
})

async function clientIdOf(page: Page): Promise<string> {
  await page.waitForFunction(() => globalThis.__example !== undefined)
  return page.evaluate(() => globalThis.__example!.clientId)
}

test('two_tabs_only_addressed_client_executes', async ({ context }) => {
  const room = newRoom()
  agent = await connectRelayAgent(room)
  const tabA = await context.newPage()
  const tabB = await context.newPage()
  await tabA.goto(relayPagePath(room))
  await tabB.goto(relayPagePath(room))
  const idA = await clientIdOf(tabA)
  const idB = await clientIdOf(tabB)
  expect(idA).not.toBe(idB)

  // Both tabs announced themselves with a manifest carrying the fill tool.
  const hasFill = (m: Record<string, unknown>): boolean =>
    m.type === 'manifest' &&
    Array.isArray(m.tools) &&
    (m.tools as { name: string }[]).some((t) => t.name === FILL)
  await agent.waitFor((m) => hasFill(m) && m.clientId === idA)
  await agent.waitFor((m) => hasFill(m) && m.clientId === idB)

  agent.send({
    protocol: 1,
    type: 'call',
    clientId: idB,
    id: 'mc-1',
    tool: FILL,
    input: { values: { title: { en: 'Only tab B' } } },
  })
  const result = await agent.waitFor<{ clientId: string; result: { status: string } }>(
    (m) => m.type === 'result' && m.id === 'mc-1',
  )
  expect(result.clientId).toBe(idB)
  expect(result.result.status).toBe('ok')

  await expect(tabB.getByLabel('Title (English)')).toHaveValue('Only tab B')
  await expect(tabA.getByLabel('Title (English)')).toHaveValue('')

  // Give a (wrong) second answer time to arrive, then check there is exactly one.
  await tabA.waitForTimeout(500)
  const answers = agent.messages.filter(
    (m) =>
      typeof m === 'object' &&
      m !== null &&
      (m as { type?: unknown }).type === 'result' &&
      (m as { id?: unknown }).id === 'mc-1',
  )
  expect(answers).toHaveLength(1)
  const tabAResults = await tabA.evaluate(() => globalThis.__example!.results.length)
  expect(tabAResults).toBe(0)
})
