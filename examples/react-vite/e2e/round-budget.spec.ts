import { expect, test } from '@toolmark/testing'
import { RoundRecorder } from './support/round-recorder.js'

// Serial: report appends never race (overview "Success criterion 1").
test.describe.configure({ mode: 'serial' })

const FILL = 'challenges.create.fill'
const SUBMIT = 'challenges.create.submit'

test('simple_form_within_3_rounds', async ({ page }) => {
  await page.goto('/')
  const recorder = new RoundRecorder(page)

  // Start from the (summary) manifest that first lists the form's tools.
  const manifest = await recorder.attach([FILL, SUBMIT])
  expect(manifest.tools.map((t) => t.name)).toEqual(expect.arrayContaining([FILL, SUBMIT]))
  expect(manifest.tools.every((t) => !('inputSchema' in t))).toBe(true)

  // Round 1: describe the fill tool to learn its schema.
  const [described] = await recorder.turn([{ type: 'describe', id: 'r1-describe', tool: FILL }])
  expect(described).toMatchObject({ type: 'result', result: { status: 'ok' } })

  // Round 2: fill with complete, valid values.
  const [filled] = await recorder.turn([
    {
      type: 'call',
      id: 'r2-fill',
      tool: FILL,
      rev: manifest.rev,
      input: {
        values: {
          title: { ar: 'تحدي الابتكار', en: 'Innovation challenge' },
          type: 'hackathon',
          startsAt: '2026-10-01',
        },
      },
    },
  ])
  expect(filled).toMatchObject({ type: 'result', result: { status: 'ok' } })

  // Round 3: submit → needs_confirmation (the in-app caller's deferred mode).
  const [submitted] = await recorder.turn([
    { type: 'call', id: 'r3-submit', tool: SUBMIT, input: {} },
  ])
  if (submitted?.type !== 'result' || submitted.result.status !== 'needs_confirmation') {
    throw new Error(`expected needs_confirmation, got ${JSON.stringify(submitted)}`)
  }

  // The human approves on the confirm card (not a round) → `confirmed` with `ok`.
  const card = page.getByRole('dialog', { name: 'Confirm action' })
  await card.getByRole('button', { name: 'Approve' }).click()
  const confirmed = await recorder.confirmed(submitted.result.confirmId)
  expect(confirmed.result.status).toBe('ok')

  expect(recorder.rounds).toBeLessThanOrEqual(3)
  expect(recorder.failures).toEqual([])
  const entry = await recorder.report('simple_form')
  expect(entry.rounds).toBe(3)
})

const WIZARD_FILL = 'events.create.fill'
const WIZARD_OPTIONS = 'events.create.options'
const WIZARD_SUBMIT = 'events.create.submit'

test('wizard_within_5_rounds', async ({ page }) => {
  await page.goto('/#/wizard')
  const recorder = new RoundRecorder(page)

  // Start from the (summary) manifest that first lists the wizard's tools.
  const manifest = await recorder.attach([WIZARD_FILL, WIZARD_OPTIONS, WIZARD_SUBMIT])
  expect(manifest.tools.map((t) => t.name)).toEqual(
    expect.arrayContaining([WIZARD_FILL, WIZARD_OPTIONS, WIZARD_SUBMIT]),
  )

  // Round 1: describe the fill tool to learn the steps' schemas.
  const [described] = await recorder.turn([
    { type: 'describe', id: 'r1-describe', tool: WIZARD_FILL },
  ])
  expect(described).toMatchObject({ type: 'result', result: { status: 'ok' } })

  // Round 2: look up the owner by name through the async options provider.
  const [optioned] = await recorder.turn([
    {
      type: 'call',
      id: 'r2-options',
      tool: WIZARD_OPTIONS,
      input: { field: 'people.ownerId', query: 'Grace' },
    },
  ])
  if (optioned?.type !== 'result' || optioned.result.status !== 'ok') {
    throw new Error(`expected ok, got ${JSON.stringify(optioned)}`)
  }
  const options = (optioned.result.data as { options: { value: string; title: string }[] }).options
  expect(options).toEqual([{ value: 'grace-hopper', title: 'Grace Hopper' }])
  const ownerId = options[0]!.value

  // Round 3: fill every step in one call (the owner id resolved in round 2).
  const [filled] = await recorder.turn([
    {
      type: 'call',
      id: 'r3-fill',
      tool: WIZARD_FILL,
      input: {
        steps: {
          basics: { title: 'Innovation Summit', category: 'community' },
          schedule: { startsAt: '2026-11-01', endsAt: '2026-11-02' },
          people: { ownerId, reviewers: [{ name: 'Alan Turing' }] },
        },
      },
    },
  ])
  expect(filled).toMatchObject({ type: 'result', result: { status: 'ok' } })

  // Round 4: submit → needs_confirmation (the in-app caller's deferred mode).
  const [submitted] = await recorder.turn([
    { type: 'call', id: 'r4-submit', tool: WIZARD_SUBMIT, input: {} },
  ])
  if (submitted?.type !== 'result' || submitted.result.status !== 'needs_confirmation') {
    throw new Error(`expected needs_confirmation, got ${JSON.stringify(submitted)}`)
  }

  // The human approves on the confirm card (not a round) → `confirmed` with `ok`.
  const card = page.getByRole('dialog', { name: 'Confirm action' })
  await card.getByRole('button', { name: 'Approve' }).click()
  const confirmed = await recorder.confirmed(submitted.result.confirmId)
  expect(confirmed.result.status).toBe('ok')

  // Every step's values ended up on the page (the last, "people" step was current at submit).
  await expect(page.getByTestId('events-created')).toContainText('Innovation Summit')
  await expect(page.getByTestId('events-created')).toContainText('2026-11-01')
  await expect(page.getByTestId('events-created')).toContainText('grace-hopper')
  await expect(page.getByTestId('events-created')).toContainText('Alan Turing')

  expect(recorder.rounds).toBeLessThanOrEqual(5)
  expect(recorder.failures).toEqual([])
  const entry = await recorder.report('wizard')
  expect(entry.rounds).toBe(4)
})
