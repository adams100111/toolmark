import { expect, test } from '@toolmark/testing'

const FILL = 'events.create.fill'
const GOTO = 'events.create.goTo'
const SUBMIT = 'events.create.submit'
const OPTIONS = 'events.create.options'

test.beforeEach(async ({ page, tools }) => {
  await page.goto('/#/wizard')
  await expect(tools).toHaveTools([FILL, GOTO, SUBMIT, OPTIONS])
})

test('wizard_fill_all_steps_one_call', async ({ page, tools }) => {
  const result = await tools.call(FILL, {
    steps: {
      basics: { title: 'Innovation Summit', category: 'community' },
      schedule: { startsAt: '2026-11-01', endsAt: '2026-11-02' },
      people: { ownerId: 'ada-lovelace', reviewers: [{ name: 'Alan Turing' }] },
    },
  })
  expect(result.status).toBe('ok')
  expect(result).toHaveChanged('basics.title', 'Innovation Summit')
  expect(result).toHaveChanged('schedule.startsAt', '2026-11-01')
  expect(result).toHaveChanged('people.ownerId', 'ada-lovelace')
  await expect(page.getByLabel('Title')).toHaveValue('Innovation Summit')

  // Navigate to the other steps (through the tool, like an agent would) and check their values
  // landed even though their forms were not the mounted one when filled.
  await tools.call(GOTO, { step: 'schedule' })
  await expect(page.getByLabel('Starts at')).toHaveValue('2026-11-01')
  await expect(page.getByLabel('Ends at')).toHaveValue('2026-11-02')

  await tools.call(GOTO, { step: 'people' })
  await expect(page.getByLabel('Owner id')).toHaveValue('ada-lovelace')
  await expect(page.getByLabel('Reviewer 1')).toHaveValue('Alan Turing')
})

test('wizard_submit_confirmation', async ({ page, tools }) => {
  const filled = await tools.call(FILL, {
    steps: {
      basics: { title: 'Innovation Summit', category: 'community' },
      schedule: { startsAt: '2026-11-01', endsAt: '2026-11-02' },
      people: { ownerId: 'ada-lovelace', reviewers: [{ name: 'Alan Turing' }] },
    },
  })
  expect(filled.status).toBe('ok')

  const submitted = await tools.call(SUBMIT, {})
  expect(submitted.status).toBe('needs_confirmation')
  const card = page.getByRole('dialog', { name: 'Confirm action' })
  await expect(card).toBeVisible()
  await expect(card).toContainText('Innovation Summit')
  await card.getByRole('button', { name: 'Approve' }).click()
  await expect(card).toBeHidden()
  await expect(page.getByTestId('events-created')).toContainText('Innovation Summit')
})

test('wizard_user_typed_field_skipped', async ({ page, tools }) => {
  await page.getByLabel('Title').fill('Typed by the user')
  const result = await tools.call(FILL, {
    steps: { basics: { title: 'Agent title', category: 'research' } },
  })
  expect(result.status).toBe('ok')
  if (result.status !== 'ok') return
  const data = result.data as { skipped: string[] }
  expect(data.skipped).toContain('basics.title')
  expect(result).not.toHaveChanged('basics.title', 'Agent title')
  await expect(page.getByLabel('Title')).toHaveValue('Typed by the user')
})
