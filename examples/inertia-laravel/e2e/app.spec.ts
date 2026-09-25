import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { validateMessage } from '@toolmark/core/protocol'
import { BASE_URL, ROOT, STORAGE_STATE } from './global-setup.js'

type ToolResult = { status: string; [key: string]: unknown }
type Step = { type: 'call' | 'describe'; tool: string; input?: unknown }

interface ConnectedPage {
  clientId: string
  conversationId: string
}

/** Opens `url` and waits until the page's bridge is attached (its private channel subscribed). */
async function open(page: Page, url: string): Promise<ConnectedPage> {
  await page.goto(url)
  const output = page.getByTestId('toolmark-client-id')
  await expect(output).toHaveAttribute('data-bridge', 'connected')
  return {
    clientId: (await output.textContent())!.trim(),
    conversationId: (await output.getAttribute('data-conversation-id'))!,
  }
}

/** Headers Laravel's CSRF check wants on a same-origin POST made outside the page. */
async function xsrfHeaders(page: Page): Promise<Record<string, string>> {
  const cookie = (await page.context().cookies(BASE_URL)).find((c) => c.name === 'XSRF-TOKEN')
  return {
    'X-XSRF-TOKEN': decodeURIComponent(cookie?.value ?? ''),
    Accept: 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
  }
}

/** Runs the scripted agent (`POST /testing/agent/script`) against the connected page. */
async function agent(
  page: Page,
  connected: ConnectedPage,
  steps: Step[],
): Promise<{ calls: number; results: ToolResult[] }> {
  const response = await page.request.post('/testing/agent/script', {
    headers: await xsrfHeaders(page),
    data: { conversationId: connected.conversationId, clientId: connected.clientId, steps },
    timeout: 45_000,
  })
  expect(response.status(), await response.text()).toBe(200)
  return (await response.json()) as { calls: number; results: ToolResult[] }
}

test('fill_create_form_via_bridge', async ({ page }) => {
  const connected = await open(page, '/challenges/create')

  const { calls, results } = await agent(page, connected, [
    {
      type: 'call',
      tool: 'challenges.create.fill',
      input: {
        values: {
          title: { en: 'Innovation challenge', ar: 'تحدي الابتكار' },
          type: 'hackathon',
          startsAt: '2026-10-01',
        },
      },
    },
  ])

  expect(calls).toBe(1)
  expect(results[0]).toMatchObject({ status: 'ok' })
  await expect(page.getByLabel('Title (English)')).toHaveValue('Innovation challenge')
  await expect(page.getByLabel('Title (Arabic)')).toHaveValue('تحدي الابتكار')
  await expect(page.getByLabel('Type')).toHaveValue('hackathon')
  await expect(page.getByLabel('Starts at')).toHaveValue('2026-10-01')
})

test('wizard_one_call', async ({ page }) => {
  const connected = await open(page, '/wizard')

  const { calls, results } = await agent(page, connected, [
    {
      type: 'call',
      tool: 'onboarding.fill',
      input: {
        steps: {
          team: { name: 'Rockets', size: 4 },
          schedule: { startsAt: '2026-10-05', days: 3 },
          contact: { email: 'rockets@example.test' },
        },
      },
    },
  ])

  // One call filled all three steps.
  expect(calls).toBe(1)
  expect(results[0]).toMatchObject({ status: 'ok' })
  await expect(page.getByLabel('Team name')).toHaveValue('Rockets')
  await expect(page.getByLabel('Team size')).toHaveValue('4')
  await page.getByRole('button', { name: 'Next' }).click()
  await expect(page.getByLabel('First day')).toHaveValue('2026-10-05')
  await expect(page.getByLabel('Days')).toHaveValue('3')
  await page.getByRole('button', { name: 'Next' }).click()
  await expect(page.getByLabel('Contact e-mail')).toHaveValue('rockets@example.test')
})

test('archive_requires_confirmation', async ({ page }) => {
  // A fresh challenge to archive, so reruns never run out of active ones.
  await page.goto('/challenges')
  const title = `Archive me ${Date.now()}`
  const created = await page.request.post('/challenges', {
    headers: await xsrfHeaders(page),
    data: { title: { en: title, ar: 'أرشفني' }, type: 'workshop', startsAt: '2026-12-01' },
  })
  expect(created.ok(), await created.text()).toBe(true)
  const bridgePosts: unknown[] = []
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      new URL(request.url()).pathname.startsWith('/toolmark/bridge/')
    ) {
      bridgePosts.push(JSON.parse(request.postData() ?? 'null'))
    }
  })
  const connected = await open(page, '/challenges')
  const row = page.getByRole('row').filter({ hasText: title })
  const id = Number(await row.getByRole('cell').first().textContent())
  const status = page.getByTestId(`challenge-${id}-status`)

  // Deferred: the agent only learns that a confirmation is waiting in the page.
  const { results } = await agent(page, connected, [
    { type: 'call', tool: 'challenges.archive', input: { challenge: id } },
  ])
  expect(results[0]).toMatchObject({ status: 'needs_confirmation' })
  const confirmId = String(results[0]?.confirmId)
  await expect(status).toHaveText('Active')

  // The user approves; the page runs the visit and sends `confirmed`.
  const dialog = page.getByRole('dialog', { name: 'Confirm action' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Approve' }).click()
  await expect(status).toHaveText('Archived')
  await expect
    .poll(() => bridgePosts.find((m) => (m as { type?: string }).type === 'confirmed'))
    .toMatchObject({
      type: 'confirmed',
      clientId: connected.clientId,
      confirmId,
      result: { status: 'ok' },
    })
  const confirmed = bridgePosts.find((m) => (m as { type?: string }).type === 'confirmed')
  expect(validateMessage(confirmed, 'toAgent')).toMatchObject({ ok: true })

  // The server appended the outcome and ran exactly one follow-up turn without page tools.
  type Turn = { role: string; meta: Record<string, unknown> | null; tools: string[] | null }
  let after: Turn[] = []
  await expect
    .poll(async () => {
      const response = await page.request.get(`/testing/agent/turns/${connected.conversationId}`)
      const turns = (await response.json()) as Turn[]
      const note = turns.findIndex((t) => t.meta?.confirm_id === confirmId)
      after = note === -1 ? [] : turns.slice(note)
      return after.length
    })
    .toBe(2)
  expect(after[0]).toMatchObject({ role: 'system', meta: { confirm_id: confirmId } })
  expect(after[1]!.role).toBe('assistant')
  expect(after[1]!.tools).not.toContain('page_call')
  expect(after[1]!.tools).not.toContain('page_describe')
})

test('navigation_then_new_page_tools', async ({ page }) => {
  const connected = await open(page, '/challenges')

  const { calls, results } = await agent(page, connected, [
    { type: 'call', tool: 'navigate', input: { route: 'challenges.create' } },
    // Registered by the new page; the same page client (no reload), so the same clientId.
    { type: 'describe', tool: 'challenges.create.fill' },
    {
      type: 'call',
      tool: 'challenges.create.fill',
      input: { values: { title: { en: 'After navigation' } } },
    },
  ])

  expect(calls).toBe(3)
  expect(results[0]).toMatchObject({ status: 'ok' })
  expect(results[1]).toMatchObject({ status: 'ok', data: { name: 'challenges.create.fill' } })
  expect(results[2]).toMatchObject({ status: 'ok' })
  await expect(page).toHaveURL(/\/challenges\/create$/)
  await expect(page.getByTestId('toolmark-client-id')).toHaveText(connected.clientId)
  await expect(page.getByLabel('Title (English)')).toHaveValue('After navigation')
})

test('messages_conform_to_protocol_schemas', async ({ page }) => {
  const toPage: unknown[] = []
  const toAgent: unknown[] = []
  page.on('websocket', (ws) => {
    ws.on('framereceived', ({ payload }) => {
      const frame = JSON.parse(String(payload)) as { event?: string; data?: unknown }
      if (frame.event !== 'toolmark.message') return
      const data = typeof frame.data === 'string' ? JSON.parse(frame.data) : frame.data
      toPage.push((data as { message: unknown }).message)
    })
  })
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      new URL(request.url()).pathname.startsWith('/toolmark/bridge/')
    ) {
      toAgent.push(JSON.parse(request.postData() ?? 'null'))
    }
  })

  const connected = await open(page, '/challenges/create')
  await agent(page, connected, [
    { type: 'describe', tool: 'challenges.create.fill' },
    { type: 'call', tool: 'challenges.create.fill', input: { values: { type: 'workshop' } } },
    { type: 'call', tool: 'challenges.create.fill', input: { values: { type: 'not-a-type' } } },
    { type: 'call', tool: 'navigate', input: { route: 'wizard.show' } },
    { type: 'call', tool: 'onboarding.goTo', input: { step: 'schedule' } },
  ])
  await expect(page.getByLabel('First day')).toBeVisible()

  for (const message of toPage) {
    expect(validateMessage(message, 'toPage'), JSON.stringify(message)).toMatchObject({ ok: true })
  }
  for (const message of toAgent) {
    expect(validateMessage(message, 'toAgent'), JSON.stringify(message)).toMatchObject({ ok: true })
  }
  const types = (list: unknown[]): string[] => list.map((m) => (m as { type: string }).type)
  expect(types(toPage)).toEqual(['describe', 'call', 'call', 'call', 'call'])
  expect(types(toAgent)).toEqual(expect.arrayContaining(['manifest', 'result']))
  expect(types(toAgent).filter((t) => t === 'result')).toHaveLength(5)
})

/** Serious or critical axe violations inside the tour overlay. */
async function tourAxeViolations(page: Page): Promise<string[]> {
  const axe = await new AxeBuilder({ page }).include('.toolmark-tour').analyze()
  return axe.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.help}`)
}

/** The spotlight cut-out encloses the anchor (the overlay pads it by a few pixels). */
async function expectSpotlightAround(page: Page, anchor: Locator): Promise<void> {
  const cutout = page.locator('.toolmark-tour__cutout')
  await expect(cutout).toBeVisible()
  await expect(async () => {
    const hole = (await cutout.boundingBox())!
    const box = (await anchor.boundingBox())!
    expect(hole.x).toBeLessThanOrEqual(box.x + 0.5)
    expect(hole.y).toBeLessThanOrEqual(box.y + 0.5)
    expect(hole.x + hole.width).toBeGreaterThanOrEqual(box.x + box.width - 0.5)
    expect(hole.y + hole.height).toBeGreaterThanOrEqual(box.y + box.height - 0.5)
    // Tight: the hole is the anchor plus padding, not the whole page.
    expect(hole.width).toBeLessThan(box.width + 24)
    expect(hole.height).toBeLessThan(box.height + 24)
  }).toPass({ timeout: 5_000 })
}

test('tour_authored_on_inertia_page', async ({ page }) => {
  // M4 exit 3: the authored three-step `show` tour on an Inertia page (react-hook-form +
  // useFormTool, anchors from `rhfAdapter(form, { elementFor })`).
  await page.goto('/challenges/create?tour=authored')
  const overlay = page.locator('.toolmark-tour')
  const tour = page.locator('.toolmark-tour [role="dialog"]')
  const titleEn = page.getByLabel('Title (English)')
  const titleAr = page.getByLabel('Title (Arabic)')
  const type = page.getByRole('combobox', { name: 'Type' })
  const startsAt = page.getByLabel('Starts at')

  await expect(tour).toBeVisible()
  await expect(overlay).toHaveAttribute('data-mode', 'show')
  // `show` is not modal: no focus trap, the page stays operable.
  await expect(tour).toHaveAttribute('aria-modal', 'false')

  // Step 1 anchors on `title.en`.
  await expect(tour).toContainText('Step 1 of 3')
  await expect(tour.getByRole('heading', { name: 'Title' })).toBeVisible()
  await expect(tour).toContainText('Give the challenge a short English title.')
  await expectSpotlightAround(page, titleEn)
  expect(await tourAxeViolations(page)).toEqual([])

  // Interaction: the anchor stays clickable and editable through the spotlight; in `show` mode
  // the user's input neither advances nor ends the tour.
  await titleEn.click()
  await expect(titleEn).toBeFocused()
  await titleEn.fill('Typed by the user')
  await expect(titleEn).toHaveValue('Typed by the user')
  await expect(tour).toContainText('Step 1 of 3')

  // Step 2 anchors on `type`.
  await tour.getByRole('button', { name: 'Next' }).click()
  await expect(tour).toContainText('Step 2 of 3')
  await expect(tour).toContainText('Pick what kind of challenge this is.')
  await expectSpotlightAround(page, type)
  expect(await tourAxeViolations(page)).toEqual([])

  // Back returns to the first anchor; Next again.
  await tour.getByRole('button', { name: 'Back' }).click()
  await expect(tour).toContainText('Step 1 of 3')
  await expectSpotlightAround(page, titleEn)
  await tour.getByRole('button', { name: 'Next' }).click()
  await expect(tour).toContainText('Step 2 of 3')

  // Step 3 anchors on `startsAt`; the last step's Next reads Done.
  await tour.getByRole('button', { name: 'Next' }).click()
  await expect(tour).toContainText('Step 3 of 3')
  await expect(tour).toContainText('Choose the day the challenge starts.')
  await expectSpotlightAround(page, startsAt)
  expect(await tourAxeViolations(page)).toEqual([])

  await tour.getByRole('button', { name: 'Done' }).click()
  await expect(overlay).toHaveCount(0)

  // `show` never fills: only the user's own typing is in the form, and nothing was submitted.
  await expect(titleEn).toHaveValue('Typed by the user')
  await expect(titleAr).toHaveValue('')
  await expect(type).toHaveValue('workshop')
  await expect(startsAt).toHaveValue('')
  await expect(page).toHaveURL(/\/challenges\/create\?tour=authored$/)
})

test('planned_tour_from_server_planner', async ({ page }) => {
  const plan = page.waitForResponse(
    (r) => new URL(r.url()).pathname === '/tour/plan' && r.request().method() === 'POST',
  )
  await page.goto('/challenges/create?tour=planned')
  const response = await plan
  expect(response.status()).toBe(200)
  const body = JSON.parse(response.request().postData() ?? '{}') as {
    goal: string
    tools: { name: string }[]
  }
  expect(body.goal).toBe('Create a challenge')
  expect(body.tools.map((t) => t.name)).toContain('challenges.create.fill')

  const tour = page.locator('.toolmark-tour [role="dialog"]')
  await expect(tour).toContainText('Step 1 of 3')
  await expect(tour).toContainText('Start with the English title of the challenge.')
  await tour.getByRole('button', { name: 'Next' }).click()
  await expect(tour).toContainText('Add the Arabic title; both languages are required.')
})

test('lint_clean', async () => {
  const require = createRequire(import.meta.url)
  const lintDir = path.dirname(require.resolve('@toolmark/lint/package.json'))
  const pages = ['/challenges', '/challenges/create', '/wizard', '/feedback']
  const args = [
    path.join(lintDir, 'dist', 'cli.js'),
    'lint',
    ...pages.flatMap((p) => ['--url', BASE_URL + p]),
    '--storage-state',
    STORAGE_STATE,
  ]
  const exitCode = await new Promise<number>((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: ROOT, stdio: 'inherit' })
    child.once('exit', (code) => resolve(code ?? 1))
    child.once('error', reject)
  })
  expect(exitCode).toBe(0)
})
