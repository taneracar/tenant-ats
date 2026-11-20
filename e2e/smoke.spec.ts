import { test, expect } from './fixtures'

test('boots Postgres in the tab and renders the pipeline', async ({ ats, page }) => {
  await expect(page.getByText(/to boot, migrate and seed/)).toBeVisible()
  await expect(page.getByText('Open job orders')).toBeVisible()
  await expect(ats.bodyRows.first()).toBeVisible()
})

test('no console errors or failed requests on load', async ({ page }) => {
  const problems: string[] = []
  page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()) })
  page.on('pageerror', (e) => problems.push(e.message))
  page.on('requestfailed', (r) => problems.push(`${r.url()} ${r.failure()?.errorText}`))
  await page.goto('/')
  await expect(page.getByRole('radiogroup', { name: 'Signed-in user' })).toBeVisible({ timeout: 30_000 })
  expect(problems).toEqual([])
})

test('no horizontal scroll at this viewport', async ({ ats, page }) => {
  for (const tab of ['Pipeline', 'Margins', 'RLS lab'] as const) {
    await ats.tab(tab).click()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow, tab).toBeLessThanOrEqual(0)
  }
})
