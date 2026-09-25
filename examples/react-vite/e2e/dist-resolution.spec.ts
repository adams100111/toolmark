import { expect, test } from '@playwright/test'

// M5 final review m-9: the release-candidate e2e runs (`TOOLMARK_DIST=1`, ci.yml `browser` and
// release.yml `release-dry-run`) must really exercise the built packages. This spec fails if the
// page loaded `@toolmark/core` from the other build than the one the environment asks for: `dist/`
// with `TOOLMARK_DIST=1`, `src/` (the `@toolmark/source` condition) otherwise.
test('@toolmark/core is served from dist with TOOLMARK_DIST=1, else from src', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => globalThis.__toolmark_test__ !== undefined)
  const urls = await page.evaluate(() =>
    performance.getEntriesByType('resource').map((entry) => entry.name),
  )
  const core = urls.filter((url) => /\/packages\/core\/(dist|src)\//.test(url))
  expect(core.length, 'the page loaded @toolmark/core modules').toBeGreaterThan(0)
  const want = process.env.TOOLMARK_DIST === '1' ? 'dist' : 'src'
  expect(core.filter((url) => !url.includes(`/packages/core/${want}/`))).toEqual([])
})
