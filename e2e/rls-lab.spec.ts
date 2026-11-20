import { test, expect } from './fixtures'

const SUMMIT = '20000000-0000-4000-8000-000000000002'
const HARBOR = '10000000-0000-4000-8000-000000000001'
const CARA = '00000000-0000-4000-8000-0000000000c3'

test.describe('the RLS lab talks to the same Postgres the UI uses', () => {
  test('the JWT subject Postgres sees follows the user switcher', async ({ ats }) => {
    await ats.signInAs('Cara Nguyen')
    const result = await ats.runSql('select current_user, auth.uid()::text as uid')
    await expect(result).toContainText('authenticated')
    await expect(result).toContainText(CARA)
  })

  test('cross-tenant insert is rejected with the RLS error code', async ({ ats }) => {
    await ats.signInAs('Ava Martinez')
    const result = await ats.runSql(
      `insert into public.candidates (agency_id, full_name, email) values ('${SUMMIT}', 'Planted', 'p@x.test')`)
    await expect(result).toContainText('ERROR 42501')
    await expect(result).toContainText('row-level security')
  })

  test('cross-tenant read returns zero rows, not an error', async ({ ats }) => {
    await ats.signInAs('Ava Martinez')
    const result = await ats.runSql(`select * from public.candidates where agency_id = '${SUMMIT}'`)
    await expect(result).toContainText('0 rows')
  })

  test('history cannot be forged', async ({ ats }) => {
    const result = await ats.runSql(
      `insert into public.stage_events (agency_id, submission_id, to_stage) select agency_id, id, 'placed' from public.submissions limit 1`)
    await expect(result).toContainText('permission denied')
  })

  test('a viewer\'s mass update touches nothing', async ({ ats }) => {
    await ats.signInAs('Cara Nguyen')
    const result = await ats.runSql(`update public.submissions set stage = 'placed' where agency_id = '${HARBOR}'`)
    await expect(result).toContainText('0 affected')
  })

  test('an owner\'s mass update succeeds but the lab rolls it back', async ({ ats, page }) => {
    await ats.signInAs('Ava Martinez')
    await ats.tab('Pipeline').click()
    const before = await page.getByRole('button', { name: /^placed \d+$/ }).innerText()

    const result = await ats.runSql(`update public.submissions set stage = 'placed' where agency_id = '${HARBOR}'`)
    await expect(result).toContainText(/[1-9]\d* affected \(rolled back\)/)

    await ats.tab('Pipeline').click()
    await expect(page.getByRole('button', { name: /^placed \d+$/ })).toHaveText(before)
  })
})
