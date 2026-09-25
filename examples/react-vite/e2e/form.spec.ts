import { expect, test } from '@toolmark/testing'
import type { AgentToPageMessage } from '@toolmark/core/protocol'

const FILL = 'challenges.create.fill'
const SUBMIT = 'challenges.create.submit'

const values = {
  title: { ar: 'تحدي الابتكار', en: 'Innovation challenge' },
  type: 'hackathon',
  startsAt: '2026-10-01',
}

test.beforeEach(async ({ page, tools }) => {
  await page.goto('/')
  await expect(tools).toHaveTools([FILL, SUBMIT])
})

test('agent_fill_updates_visible_fields', async ({ page, tools }) => {
  const result = await tools.call(FILL, { values })
  expect(result.status).toBe('ok')
  expect(result).toHaveChanged('title.en', 'Innovation challenge')
  expect(result).toHaveChanged('title.ar', 'تحدي الابتكار')
  expect(result).toHaveChanged('type', 'hackathon')
  expect(result).toHaveChanged('startsAt', '2026-10-01')
  await expect(page.getByLabel('Title (English)')).toHaveValue('Innovation challenge')
  await expect(page.getByLabel('Title (Arabic)')).toHaveValue('تحدي الابتكار')
  await expect(page.getByLabel('Type')).toHaveValue('hackathon')
  await expect(page.getByLabel('Starts at')).toHaveValue('2026-10-01')
})

test('user_typed_field_is_skipped', async ({ page, tools }) => {
  await page.getByLabel('Title (English)').fill('Typed by the user')
  const result = await tools.call(FILL, { values })
  expect(result.status).toBe('ok')
  if (result.status !== 'ok') return
  const data = result.data as { skipped: string[] }
  expect(data.skipped).toContain('title.en')
  expect(result).not.toHaveChanged('title.en', 'Innovation challenge')
  expect(result).toHaveChanged('title.ar', 'تحدي الابتكار')
  await expect(page.getByLabel('Title (English)')).toHaveValue('Typed by the user')
})

test('submit_needs_confirmation_then_confirm_card_approves', async ({ page, tools }) => {
  expect((await tools.call(FILL, { values })).status).toBe('ok')
  const submit = await tools.call(SUBMIT, {})
  expect(submit.status).toBe('needs_confirmation')
  const card = page.getByRole('dialog', { name: 'Confirm action' })
  await expect(card).toBeVisible()
  await expect(card).toContainText('Innovation challenge')
  await card.getByRole('button', { name: 'Approve' }).click()
  await expect(card).toBeHidden()
  await expect(page.getByTestId('submitted')).toContainText('Innovation challenge')
})

test('bridge_round_trip_via_in_page_agent', async ({ page }) => {
  await page.waitForFunction(() => globalThis.__toolmark_agent__?.manifest !== undefined)
  const replies = await page.evaluate(
    async ([fill, v]) => {
      const agent = globalThis.__toolmark_agent__!
      const clientId = agent.manifest!.clientId
      const messages: AgentToPageMessage[] = [
        { protocol: 1, type: 'describe', clientId, id: 'rt-1', tool: fill },
        { protocol: 1, type: 'call', clientId, id: 'rt-2', tool: fill, input: { values: v } },
      ]
      return agent.turn(messages)
    },
    [FILL, values] as const,
  )
  expect(replies).toHaveLength(2)
  const [describe, call] = replies
  expect(describe).toMatchObject({ type: 'result', id: 'rt-1', result: { status: 'ok' } })
  expect(call).toMatchObject({ type: 'result', id: 'rt-2', result: { status: 'ok' } })
  await expect(page.getByLabel('Title (English)')).toHaveValue('Innovation challenge')
  const tools = await page.evaluate(() =>
    globalThis.__toolmark_agent__!.manifest!.tools.map((t) => t.name),
  )
  expect(tools).toEqual(expect.arrayContaining([FILL, SUBMIT]))
})
