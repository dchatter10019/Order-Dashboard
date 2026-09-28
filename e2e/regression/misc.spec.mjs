/**
 * QA cases §9 Export / misc
 */
import { test, expect } from '@playwright/test'
import { clearSession, loginAsTestUser } from '../helpers/auth.mjs'
import { TABS, clickNavTab } from '../helpers/navigation.mjs'

test.describe('9. Export / misc', () => {
  test('X2 | Footer auto-refresh mentions interval minutes', async ({ page }) => {
    await clearSession(page)
    await loginAsTestUser(page)
    await page.goto('/orders')
    await expect(page.getByRole('contentinfo')).toContainText(/Auto-refresh|min/i, {
      timeout: 30_000
    })
  })

  test('X3 | Tab sweep — no uncaught page errors', async ({ page, isMobile }) => {
    await clearSession(page)
    await loginAsTestUser(page)

    const pageErrors = []
    page.on('pageerror', (err) => pageErrors.push(String(err)))

    for (const tab of TABS) {
      await clickNavTab(page, tab.label, isMobile)
      await expect(page.getByText(tab.context)).toBeVisible()
      await page.waitForTimeout(500)
    }

    const fatal = pageErrors.filter((e) => !e.includes('ResizeObserver'))
    expect(fatal).toEqual([])
  })

  test.skip('X1 | Bulk export file — not automated', () => {})
})
