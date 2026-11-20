import { test, expect } from './fixtures'

test('a recruiter moves a candidate and the trigger records who did it', async ({ ats, page }) => {
  await ats.signInAs('Ben Okafor')
  await ats.agency('Harbor Staffing').click()

  const select = ats.stageSelects().first()
  const label = (await select.getAttribute('aria-label'))!
  const candidate = label.replace('Stage for ', '')
  const next = (await select.inputValue()) === 'offer' ? 'interview' : 'offer'

  await select.selectOption(next)
  await expect(ats.toast).toHaveText(`Moved to ${next}. Logged to history as Ben Okafor.`)

  // The row moved to the top (most recently updated); open its history.
  await ats.table.getByRole('button', { name: new RegExp(`^${candidate}`) }).first().click()
  const drawer = page.getByRole('complementary', { name: 'Submission history' })
  await expect(drawer).toBeVisible()
  await expect(drawer.locator('li').last()).toContainText(next)
  await expect(drawer.locator('li').last()).toContainText('Ben Okafor')
})

test('a change by one user is visible to another (same database, different rights)', async ({ ats }) => {
  await ats.signInAs('Ava Martinez')
  const select = ats.stageSelects().first()
  const candidate = (await select.getAttribute('aria-label'))!.replace('Stage for ', '')
  await select.selectOption('rejected')
  await expect(ats.toast).toContainText('Moved to rejected')

  await ats.signInAs('Cara Nguyen')
  const row = ats.bodyRows.filter({ hasText: candidate }).first()
  await expect(row).toContainText('rejected')
})

test('stage chips filter the table and their counts match', async ({ ats, page }) => {
  const chip = page.getByRole('button', { name: /^placed \d+$/ })
  const expected = Number((await chip.innerText()).split(' ')[1])
  await chip.click()
  await expect(page.getByText(new RegExp(`^${expected} submissions`))).toBeVisible()
  const stages = await ats.stageSelects().evaluateAll((els) => els.map((e) => (e as HTMLSelectElement).value))
  expect(stages.length).toBeGreaterThan(0)
  expect(new Set(stages)).toEqual(new Set(['placed']))
})

test('search matches skills as well as names', async ({ ats, page }) => {
  await page.getByRole('textbox', { name: 'Search submissions' }).fill('forklift')
  const rows = await ats.bodyRows.allInnerTexts()
  expect(rows.length).toBeGreaterThan(0)
  for (const r of rows) expect(r.toLowerCase()).toContain('forklift')
})

test('sorting by stage follows the funnel order, not the alphabet', async ({ ats, page }) => {
  await page.getByRole('button', { name: /^all \d+$/ }).click()
  await ats.table.getByRole('button', { name: 'Stage' }).click()
  const stages = await ats.stageSelects().evaluateAll((els) => els.map((e) => (e as HTMLSelectElement).value))
  const order = ['sourced', 'screen', 'submitted', 'interview', 'offer', 'placed', 'rejected']
  const idx = stages.map((s) => order.indexOf(s))
  expect(idx).toEqual([...idx].sort((a, b) => a - b))
})
