import AxeBuilder from '@axe-core/playwright'
import { test, expect, type Person } from './fixtures'

// Every view, as every kind of user, in both color schemes.
const VIEWS: Array<[Person, 'Pipeline' | 'Margins' | 'RLS lab' | null]> = [
  ['Ava Martinez', 'Pipeline'],
  ['Ava Martinez', 'Margins'],
  ['Ava Martinez', 'RLS lab'],
  ['Cara Nguyen', 'Pipeline'],
  ['Cara Nguyen', 'Margins'],
  ['Eli Brooks', null],
]

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`${scheme} mode`, () => {
    test.use({ colorScheme: scheme })

    for (const [person, view] of VIEWS) {
      test(`${person}${view ? ` · ${view}` : ''} has no WCAG A/AA violations`, async ({ ats, page }) => {
        await ats.signInAs(person)
        if (view) await ats.tab(view).click()
        await expect(page.getByRole('radiogroup', { name: 'Signed-in user' })).toBeVisible()

        const { violations } = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .analyze()
        const summary = violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.length} × ${v.nodes[0]?.target.join(' ')}`)
        expect(summary).toEqual([])
      })
    }
  })
}

test('the history drawer is reachable and closable', async ({ ats, page }) => {
  await ats.bodyRows.first().getByRole('button').first().click()
  const drawer = page.getByRole('complementary', { name: 'Submission history' })
  await expect(drawer).toBeVisible()
  await drawer.getByRole('button', { name: 'Close' }).click()
  await expect(drawer).toHaveCount(0)
})
