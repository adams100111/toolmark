import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
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
  const connected = await open(page, '/challenges')
  const firstActive = page.getByRole('row').filter({ hasText: 'Active' }).first()
  const id = Number(await firstActive.getByRole('cell').first().textContent())
  const status = page.getByTestId(`challenge-${id}-status`)

  // Deferred: the agent only learns that a confirmation is waiting in the page.
  const { results } = await agent(page, connected, [
    { type: 'call', tool: 'challenges.archive', input: { challenge: id } },
  ])
  expect(results[0]).toMatchObject({ status: 'needs_confirmation' })
  const confirmId = (results[0] as { confirmId: string }).confirmId
  await expect(status).toHaveText('Active')

  // The user approves; the page runs the visit and sends `confirmed`.
  const dialog = page.getByRole('dialog', { name: 'Confirm action' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Approve' }).click()
  await expect(status).toHaveText('Archived')

  // The server appended the outcome and ran exactly one follow-up turn without page tools.
  type Turn = { role: string; meta: Record<string, unknown> | null; tools: string[] | null }
  let turns: Turn[] = []
  await expect
    .poll(async () => {
      const response = await page.request.get(`/testing/agent/turns/${connected.conversationId}`)
      turns = (await response.json()) as Turn[]
      return turns.length
    })
    .toBe(2)
  expect(turns[0]).toMatchObject({ role: 'system', meta: { confirm_id: confirmId } })
  expect(turns[1]!.role).toBe('assistant')
  expect(turns[1]!.tools).not.toContain('page_call')
  expect(turns[1]!.tools).not.toContain('page_describe')
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
    if (request.method() === 'POST' && new URL(request.url()).pathname.startsWith('/toolmark/bridge/')) {
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

test('tour_authored_on_inertia_page', async ({ page }) => {
  await page.goto('/challenges/create?tour=authored')
  const tour = page.locator('.toolmark-tour[role="dialog"]')

  await expect(tour).toBeVisible()
  await expect(tour).toContainText('Step 1 of 3')
  await expect(tour).toContainText('Give the challenge a short English title.')

  const axe = await new AxeBuilder({ page }).include('.toolmark-tour').analyze()
  const blocking = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([])

  await tour.getByRole('button', { name: 'Next' }).click()
  await expect(tour).toContainText('Step 2 of 3')
  await expect(tour).toContainText('Pick what kind of challenge this is.')
  await tour.getByRole('button', { name: 'Next' }).click()
  await expect(tour).toContainText('Step 3 of 3')
  await expect(tour).toContainText('Choose the day the challenge starts.')
  await tour.getByRole('button', { name: 'Done' }).click()
  await expect(page.locator('.toolmark-tour')).toHaveCount(0)
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

  const tour = page.locator('.toolmark-tour[role="dialog"]')
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
