import { test as base, expect, type Page } from '@playwright/test'

export type Person = 'Ava Martinez' | 'Ben Okafor' | 'Cara Nguyen' | 'Dev Patel' | 'Eli Brooks'

/** Small page object: the app's own words, no test ids. */
export class Ats {
  constructor(readonly page: Page) {}

  async open() {
    await this.page.goto('/')
    // Postgres boots in the tab; wait for the user switcher instead of a fixed sleep.
    await expect(this.page.getByRole('radiogroup', { name: 'Signed-in user' })).toBeVisible({ timeout: 30_000 })
  }

  userButton(name: Person) {
    return this.page.getByRole('radio', { name: new RegExp(`^${name}`) })
  }

  async signInAs(name: Person) {
    await this.userButton(name).click()
    await expect(this.userButton(name)).toHaveAttribute('aria-checked', 'true')
  }

  agency(name: string) {
    return this.page.getByRole('button', { name: new RegExp(`^${name}`) })
  }

  tab(name: 'Pipeline' | 'Margins' | 'RLS lab') {
    return this.page.getByRole('tab', { name })
  }

  get table() {
    return this.page.getByRole('table').first()
  }

  get bodyRows() {
    return this.table.locator('tbody tr')
  }

  stageSelects() {
    return this.table.getByRole('combobox')
  }

  get toast() {
    return this.page.locator('div[role=status].fixed')
  }

  /** Run SQL in the RLS lab and return the result panel. */
  async runSql(sql: string) {
    await this.tab('RLS lab').click()
    const editor = this.page.getByRole('textbox', { name: /SQL as/ })
    await editor.fill(sql)
    await this.page.getByRole('button', { name: 'Run', exact: true }).click()
    const result = this.page.locator('section [role=status]')
    await expect(result).toBeVisible()
    return result
  }

  async firstColumn() {
    return this.bodyRows.locator('td:first-child div.font-medium').allInnerTexts()
  }
}

export const test = base.extend<{ ats: Ats }>({
  ats: async ({ page }, use) => {
    const ats = new Ats(page)
    await ats.open()
    await use(ats)
  },
})

export { expect }
