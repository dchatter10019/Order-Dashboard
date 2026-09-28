/**
 * QA cases §2 Routing & navigation
 */
import { test, expect } from '@playwright/test'
import { clearSession, loginAsTestUser } from '../helpers/auth.mjs'
import { TABS, clickNavTab } from '../helpers/navigation.mjs'

test.describe('2. Routing & navigation', () => {
  test.beforeEach(async ({ page }) => {
    await clearSession(page)
    await loginAsTestUser(page)
  })

  for (const tab of TABS) {
    test(`R1 | Deep-link ${tab.path} renders tab shell`, async ({ page }) => {
      await page.goto(tab.path)
      await expect(page).toHaveURL(new RegExp(`${tab.path.replace('/', '\\/')}(\\/?|\\?)`))
      await expect(page.getByText(tab.context)).toBeVisible()
    })
  }

  test('R2 | Unknown route redirects to orders', async ({ page }) => {
    await page.goto('/this-route-does-not-exist')
    await expect(page).toHaveURL(/\/orders(\/?|\?)/)
  })

  test('R3 | In-app tab navigation visits all six tabs', async ({ page, isMobile }) => {
    const consoleErrors = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })

    for (const tab of TABS) {
      await clickNavTab(page, tab.label, isMobile)
      await expect(page).toHaveURL(new RegExp(`${tab.path.replace('/', '\\/')}(\\/?|\\?)`))
      await expect(page.getByText(tab.context)).toBeVisible()
    }

    const hardErrors = consoleErrors.filter(
      (t) => !t.includes('favicon') && !/Failed to load resource.*404/.test(t)
    )
    expect(hardErrors, `console errors: ${hardErrors.join('\n')}`).toEqual([])
  })

  test('R4 | Order detail deep-link renders shell', async ({ page }) => {
    await page.goto('/orders/E2E-ORDER-NOT-REAL')
    await expect(page.getByRole('heading', { name: 'Order Details' })).toBeVisible()
    await expect(page.getByText('E2E-ORDER-NOT-REAL')).toBeVisible()
  })

  test('R5 | AI assistant URL persists (no redirect to orders)', async ({ page }) => {
    await page.goto('/ai-assistant')
    await expect(page).toHaveURL(/\/ai-assistant(\/?|\?)/)
    await expect(page.getByText(/AI Assistant —/)).toBeVisible()
  })
})
