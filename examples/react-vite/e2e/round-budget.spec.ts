import { expect, test } from '@toolmark/testing'
import { RoundRecorder } from './support/round-recorder.js'

// Serial: report appends never race (overview "Success criterion 1").
test.describe.configure({ mode: 'serial' })

const FILL = 'challenges.create.fill'
const SUBMIT = 'challenges.create.submit'

test('simple_form_within_3_rounds', async ({ page }) => {
  await page.goto('/')
  const recorder = new RoundRecorder(page)

  // Start from the attach (summary) manifest only.
  const manifest = await recorder.attach()
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
