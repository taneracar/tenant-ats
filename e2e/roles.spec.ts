import { test, expect } from './fixtures'

test.describe('what each role sees', () => {
  test('owner: pay and margin columns, editable stages, margin report', async ({ ats, page }) => {
    await ats.signInAs('Ava Martinez')
    await expect(ats.table.getByRole('columnheader', { name: 'Pay' })).toBeVisible()
    await expect(ats.table.getByRole('columnheader', { name: 'Margin' })).toBeVisible()
    await expect(ats.stageSelects().first()).toBeVisible()
    await ats.tab('Margins').click()
    await expect(ats.table.getByRole('columnheader', { name: 'Gross margin' })).toBeVisible()
    await expect(page.getByText('The database refused this report.')).toHaveCount(0)
  })

  test('viewer: no pay data, read-only stages, margin report refused by Postgres', async ({ ats, page }) => {
    await ats.signInAs('Cara Nguyen')
    await expect(ats.agency('Harbor Staffing')).toContainText(/viewer/i)
    await expect(ats.bodyRows.first()).toBeVisible()
    await expect(ats.table.getByRole('columnheader', { name: 'Pay' })).toHaveCount(0)
    await expect(ats.stageSelects()).toHaveCount(0)
    await expect(page.getByText('pay rates hidden for your role')).toBeVisible()

    await ats.tab('Margins').click()
    await expect(page.getByText('margin report needs owner or recruiter role')).toBeVisible()
  })

  test('another agency\'s owner cannot find Harbor\'s clients', async ({ ats, page }) => {
    await ats.signInAs('Dev Patel')
    await expect(ats.agency('Summit Talent')).toBeVisible()
    await expect(ats.agency('Harbor Staffing')).toHaveCount(0)
    for (const harborClient of ['Bayview Health', 'Irvine Robotics', 'Newport Dental Group']) {
      await page.getByRole('textbox', { name: 'Search submissions' }).fill(harborClient)
      await expect(page.getByText(/^No rows\./)).toBeVisible()
    }
  })

  test('one person, two agencies, two roles', async ({ ats }) => {
    await ats.signInAs('Ben Okafor')
    await ats.agency('Harbor Staffing').click()
    await expect(ats.stageSelects().first()).toBeVisible()

    await ats.agency('Summit Talent').click()
    await expect(ats.agency('Summit Talent')).toContainText(/viewer/i)
    await expect(ats.bodyRows.first()).toBeVisible()
    await expect(ats.stageSelects()).toHaveCount(0)
  })

  test('a user with no membership sees an empty product', async ({ ats, page }) => {
    await ats.signInAs('Eli Brooks')
    await expect(page.getByText('Eli Brooks belongs to no agency.')).toBeVisible()
    await expect(page.getByText('Open job orders')).toHaveCount(0)
  })
})
