import { expect, test } from '@toolmark/testing'

const FILL = 'signup.fill'
const SUBMIT = 'signup.submit'
const TABLE = 'people'

test.beforeEach(async ({ page, tools }) => {
  await page.goto('/plain-form.html')
  await expect(tools).toHaveTools([FILL, SUBMIT, TABLE])
})

test('plain_form_filled_and_skips_user_field', async ({ page, tools }) => {
  await page.locator('input[name="name"]').fill('Typed by the user')
  const result = await tools.call(FILL, {
    values: { name: 'Agent Name', email: 'agent@example.com' },
  })
  expect(result.status).toBe('ok')
  if (result.status !== 'ok') return
  const data = result.data as { skipped: string[] }
  expect(data.skipped).toContain('name')
  expect(result).not.toHaveChanged('name', 'Agent Name')
  expect(result).toHaveChanged('email', 'agent@example.com')
  await expect(page.locator('input[name="name"]')).toHaveValue('Typed by the user')
  await expect(page.locator('input[name="email"]')).toHaveValue('agent@example.com')
})

test('table_query_returns_rows', async ({ tools }) => {
  const result = await tools.call(TABLE, { where: { name: 'Ada' } })
  expect(result.status).toBe('ok')
  if (result.status !== 'ok') return
  const data = result.data as { rows: Record<string, unknown>[]; total: number }
  expect(data.total).toBe(1)
  expect(data.rows).toEqual([{ name: 'Ada Lovelace', role: 'Engineer' }])
})

test('hidden_token_not_in_schema', async ({ page, tools }) => {
  const entry = await tools.get(FILL)
  expect(entry).toBeDefined()
  expect(JSON.stringify(entry?.inputSchema)).not.toContain('_token')

  const before = await page.locator('input[name="_token"]').inputValue()
  const result = await tools.call(FILL, {
    values: { name: 'Agent Name', email: 'agent@example.com' },
  })
  expect(result.status).toBe('ok')
  if (result.status === 'ok') {
    const data = result.data as { changes: { path: string }[] }
    expect(data.changes.some((c) => c.path === '_token')).toBe(false)
  }
  await expect(page.locator('input[name="_token"]')).toHaveValue(before)
})
