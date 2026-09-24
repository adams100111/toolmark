import { test, expect, MISSING_HOOK_MESSAGE } from '@toolmark/testing'

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

test('lists_and_calls_tools', async ({ page, tools }) => {
  await page.goto('/')
  await expect(tools).toHaveTools(['ping', 'save'])
  const result = await tools.call('ping', { x: 1 })
  expect(result).toEqual({ status: 'ok', data: { echo: { x: 1 } } })
})

test('auto_confirm_runs_consequential', async ({ page, tools }) => {
  await page.goto('/')
  tools.autoConfirm(true)
  const result = await tools.call('save', { title: 'Auto' })
  expect(result.status).toBe('ok')
})

test('missing_hook_error_message', async ({ page, tools }) => {
  await page.goto('/?nohook=1')
  let message = ''
  try {
    await tools.list()
  } catch (e) {
    message = errorMessage(e)
  }
  expect(message).toBe(MISSING_HOOK_MESSAGE)
})

test('matchers_pass_and_fail_with_messages', async ({ page, tools }) => {
  await page.goto('/')

  await expect(tools).toHaveTools(['ping', 'save'])
  let listFail = ''
  try {
    await expect(tools).toHaveTools(['nope.tool'])
  } catch (e) {
    listFail = errorMessage(e)
  }
  expect(listFail).toContain('nope.tool')

  const save = await tools.get('save')
  const ping = await tools.get('ping')
  expect(save).toBeConsequential()
  expect(ping).toBeReadOnly()

  let hintFail = ''
  try {
    expect(save).toBeReadOnly()
  } catch (e) {
    hintFail = errorMessage(e)
  }
  expect(hintFail).toContain('readOnly')

  tools.autoConfirm(true)
  const result = await tools.call('save', { title: 'Hi' })
  expect(result).toHaveChanged('title', 'Hi')

  let changeFail = ''
  try {
    expect(result).toHaveChanged('title', 'Nope')
  } catch (e) {
    changeFail = errorMessage(e)
  }
  expect(changeFail).toContain('title')
})

test('hook_rejects_human_caller', async ({ page }) => {
  await page.goto('/')
  const message = await page.evaluate(async () => {
    // Cast past the compile-time `TestHookCaller` exclusion: this exercises the hook's runtime
    // guard against an untyped caller (e.g. from a non-TypeScript agent driving the page).
    const hook = globalThis.__toolmark_test__!
    const call = (name: string, input: unknown, opts: { caller: string }): Promise<unknown> =>
      (hook.call as (n: string, i: unknown, o: { caller: string }) => Promise<unknown>)(
        name,
        input,
        opts,
      )
    try {
      await call('ping', {}, { caller: 'human' })
      return null
    } catch (e) {
      return e instanceof Error ? e.message : String(e)
    }
  })
  expect(message).toBe('caller human is not allowed through the test hook')
})
