import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@toolmark/testing'
import type { Page } from '@playwright/test'
import {
  connectRelayAgent,
  newRoom,
  relayPagePath,
  type RelayAgent,
} from './support/relay-server.js'

// Spec §11.5 / §18 (M4 exit 1): the authored three-step tour in show, guide and do mode, a tour
// planned by the (test) agent over the relay, and axe on the overlay in every mode.

const FILL = 'challenges.create.fill'
const SUBMIT = 'challenges.create.submit'

const overlay = (page: Page) => page.locator('.toolmark-tour')
const dialog = (page: Page) => page.locator('.toolmark-tour__dialog')
const title = (page: Page) => page.locator('.toolmark-tour__title')
const nextButton = (page: Page) => page.locator('.toolmark-tour__next')
const tourPanel = (page: Page) => page.getByRole('region', { name: 'Guided tour' })
const tourEvents = (page: Page) => page.getByTestId('tour-events')
const inlineConfirm = (page: Page) => page.getByRole('dialog', { name: 'Confirm inline action' })

async function openMainPage(page: Page, path = '/'): Promise<void> {
  await page.goto(path)
  await expect(tourPanel(page)).toBeVisible()
  await page.waitForFunction(() => globalThis.__toolmark_test__ !== undefined)
}

async function expectFormEmpty(page: Page): Promise<void> {
  await expect(page.getByLabel('Title (English)')).toHaveValue('')
  await expect(page.getByLabel('Title (Arabic)')).toHaveValue('')
  await expect(page.getByLabel('Starts at')).toHaveValue('')
  await expect(page.getByTestId('submitted').locator('li')).toHaveCount(0)
}

async function seriousAxeViolations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).include('.toolmark-tour').analyze()
  return results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.help}`)
}

test('tour_show_mode', async ({ page, tools }) => {
  await openMainPage(page)
  await expect(tools).toHaveTools([FILL, SUBMIT])
  await tourPanel(page).getByRole('button', { name: 'Show tour' }).click()

  await expect(overlay(page)).toHaveAttribute('data-mode', 'show')
  await expect(title(page)).toHaveText('Title')
  // Not modal: the anchor stays clickable and focusable through the spotlight.
  const titleEn = page.getByLabel('Title (English)')
  await titleEn.click()
  await expect(titleEn).toBeFocused()

  await nextButton(page).click()
  await expect(title(page)).toHaveText('Type')
  await nextButton(page).click()
  await expect(title(page)).toHaveText('Create')
  await expect(nextButton(page)).toHaveText('Done')
  await nextButton(page).click()

  await expect(overlay(page)).toHaveCount(0)
  await expect(tourEvents(page)).toContainText('done')
  await expect(page.getByTestId('tour-status')).toHaveText('done')
  // Show mode never fills or submits anything.
  await expectFormEmpty(page)
  await expect(page.getByRole('combobox', { name: 'Type' })).toHaveValue('workshop')
})

test('tour_guide_mode_waits_for_valid_input', async ({ page }) => {
  await openMainPage(page)
  await tourPanel(page).getByRole('button', { name: 'Guide tour' }).click()
  await expect(overlay(page)).toHaveAttribute('data-mode', 'guide')
  await expect(title(page)).toHaveText('Title')

  // An invalid typed value (empty after typing) keeps the step and shows the field's issue.
  const titleEn = page.getByLabel('Title (English)')
  await titleEn.fill('x')
  await titleEn.fill('')
  await expect(overlay(page)).toHaveAttribute('data-status', 'waiting')
  await expect(page.locator('.toolmark-tour__status')).toContainText(/too small|>=1|at least/i)
  await expect(title(page)).toHaveText('Title')

  // A valid value advances.
  await titleEn.fill('Innovation challenge')
  await expect(title(page)).toHaveText('Type')
  await page.getByRole('combobox', { name: 'Type' }).selectOption('hackathon')
  await expect(title(page)).toHaveText('Create')

  // The last step waits for the user's own (valid) submit.
  await page.getByLabel('Title (Arabic)').fill('تحدي الابتكار')
  await page.getByLabel('Starts at').fill('2026-10-01')
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(overlay(page)).toHaveCount(0)
  await expect(page.getByTestId('tour-status')).toHaveText('done')
  await expect(page.getByTestId('submitted')).toContainText('Innovation challenge')
})

test('tour_do_mode_fills_and_confirms', async ({ page }) => {
  await openMainPage(page)
  await tourPanel(page).getByRole('button', { name: 'Do tour' }).click()
  await expect(overlay(page)).toHaveAttribute('data-mode', 'do')

  // The consequential submit waits on the inline confirm while the overlay is `confirming`.
  await expect(overlay(page)).toHaveAttribute('data-status', 'confirming', { timeout: 15_000 })
  const confirm = inlineConfirm(page)
  await expect(confirm).toBeVisible()
  await expect(confirm).toContainText('Innovation challenge')

  // Both fills ran, and every changed field was highlighted.
  await expect(page.getByLabel('Title (English)')).toHaveValue('Innovation challenge')
  await expect(page.getByLabel('Title (Arabic)')).toHaveValue('تحدي الابتكار')
  await expect(page.getByRole('combobox', { name: 'Type' })).toHaveValue('hackathon')
  await expect(page.getByLabel('Starts at')).toHaveValue('2026-10-01')
  const highlights = page.getByTestId('tour-highlights')
  for (const field of ['title.en', 'title.ar', 'type', 'startsAt']) {
    await expect(highlights).toContainText(field)
  }
  await expect(page.getByTestId('submitted').locator('li')).toHaveCount(0)

  await confirm.getByRole('button', { name: 'Approve' }).click()
  await expect(confirm).toBeHidden()
  await expect(page.getByTestId('submitted')).toContainText('Innovation challenge')
  await expect(overlay(page)).toHaveCount(0)
  await expect(page.getByTestId('tour-status')).toHaveText('done')
})

test.describe('tour_planned_via_agent_planner', () => {
  let agent: RelayAgent | undefined
  test.afterEach(async () => {
    await agent?.close()
    agent = undefined
  })

  const PLANNED = [
    { tool: FILL, param: 'title.en', title: 'Title', text: 'The English title.', input: {} },
    { tool: 'challenges.archive', title: 'Archive', text: 'No such tool.' },
    { tool: FILL, param: 'type', title: 'Type', text: 'The challenge type.', input: {} },
    { tool: SUBMIT, title: 'Create', text: 'Create it.' },
  ]

  for (const mode of ['show', 'do'] as const) {
    test(`tour_planned_via_agent_planner (${mode})`, async ({ page }) => {
      const room = newRoom()
      agent = await connectRelayAgent(room)
      await openMainPage(page, relayPagePath(room))
      await tourPanel(page)
        .getByRole('button', { name: `Planned tour (${mode})` })
        .click()

      // The page's planner asks the agent over the relay (app-level side channel).
      const request = await agent.waitFor<{
        id: string
        goal: string
        tools: { name: string }[]
      }>((m) => m.kind === 'toolmark-example/plan')
      expect(request.goal).toBeTruthy()
      expect(request.tools.map((t) => t.name)).toEqual(expect.arrayContaining([FILL, SUBMIT]))
      const values = {
        title: { en: 'Planned challenge', ar: 'تحدي مخطط' },
        type: 'competition',
        startsAt: '2026-11-02',
      }
      const steps = PLANNED.map((s, i) =>
        i === 0
          ? { ...s, input: { title: values.title } }
          : i === 2
            ? { ...s, input: { type: values.type, startsAt: values.startsAt } }
            : s,
      )
      agent.send({ kind: 'toolmark-example/plan-result', id: request.id, steps })

      await expect(overlay(page)).toHaveAttribute('data-mode', mode)
      await expect(tourEvents(page)).toContainText('step_invalid challenges.archive unknown_tool')

      if (mode === 'show') {
        await expect(title(page)).toHaveText('Title')
        await nextButton(page).click()
        await expect(title(page)).toHaveText('Type')
        await nextButton(page).click()
        await expect(title(page)).toHaveText('Create')
        await nextButton(page).click()
        await expect(overlay(page)).toHaveCount(0)
        await expectFormEmpty(page)
      } else {
        await expect(overlay(page)).toHaveAttribute('data-status', 'confirming', {
          timeout: 15_000,
        })
        await inlineConfirm(page).getByRole('button', { name: 'Approve' }).click()
        await expect(page.getByTestId('submitted')).toContainText('Planned challenge')
        await expect(overlay(page)).toHaveCount(0)
      }
      await expect(page.getByTestId('tour-status')).toHaveText('done')
    })
  }
})

test('tour_overlay_axe_clean', async ({ page }) => {
  await openMainPage(page)

  // show
  await tourPanel(page).getByRole('button', { name: 'Show tour' }).click()
  await expect(dialog(page)).toBeVisible()
  expect(await seriousAxeViolations(page)).toEqual([])
  await page.locator('.toolmark-tour__close').click()
  await expect(overlay(page)).toHaveCount(0)

  // guide (running, then waiting with an issue shown)
  await tourPanel(page).getByRole('button', { name: 'Guide tour' }).click()
  await expect(dialog(page)).toBeVisible()
  expect(await seriousAxeViolations(page)).toEqual([])
  await page.getByLabel('Title (English)').fill('x')
  await page.getByLabel('Title (English)').fill('')
  await expect(overlay(page)).toHaveAttribute('data-status', 'waiting')
  expect(await seriousAxeViolations(page)).toEqual([])
  await page.locator('.toolmark-tour__close').click()
  await expect(overlay(page)).toHaveCount(0)

  // do (modal while running; released while confirming)
  await tourPanel(page).getByRole('button', { name: 'Do tour' }).click()
  await expect(overlay(page)).toHaveAttribute('data-mode', 'do')
  expect(await seriousAxeViolations(page)).toEqual([])
  await expect(overlay(page)).toHaveAttribute('data-status', 'confirming', { timeout: 15_000 })
  expect(await seriousAxeViolations(page)).toEqual([])
  await inlineConfirm(page).getByRole('button', { name: 'Reject' }).click()
  await expect(overlay(page)).toHaveCount(0)
})
