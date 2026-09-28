/**
 * QA cases §4 Order detail & filter persistence
 */
import { test, expect } from '@playwright/test'
import { clearSession, loginAsTestUser } from '../helpers/auth.mjs'
import { openFirstOrderDetail } from '../helpers/orders.mjs'

test.describe('4. Order detail & filter persistence', () => {
  test.beforeEach(async ({ page }) => {
    await clearSession(page)
    await loginAsTestUser(page)
  })

  test('D1 | Open detail shows order details heading', async ({ page }) => {
    await page.goto('/orders')
    await expect(page.locator('#dashboard-order-search')).toBeVisible({ timeout: 60_000 })
    await openFirstOrderDetail(page)
    await expect(page.getByRole('heading', { name: 'Order Details' })).toBeVisible()
  })

  test('D3 | Search survives detail round-trip', async ({ page }) => {
    await page.goto('/orders?q=SDL')
    await expect(page.locator('#dashboard-order-search')).toBeVisible({ timeout: 60_000 })
    await openFirstOrderDetail(page)
    await expect(page.getByRole('heading', { name: 'Order Details' })).toBeVisible()
    await page.getByRole('button', { name: 'Close order details' }).click()
    await expect(page).toHaveURL(/[?&]q=SDL/)
    await expect(page.locator('#dashboard-order-search')).toHaveValue('SDL')
  })

  test('D4 | Date range survives detail round-trip', async ({ page }) => {
    await page.goto('/orders?start=2026-09-01&end=2026-09-26')
    await expect(page.locator('#dashboard-order-search')).toBeVisible({ timeout: 60_000 })
    await expect(page.getByLabel('Start Date').first()).toHaveValue('2026-09-01')
    await expect(page.getByLabel('End Date').first()).toHaveValue('2026-09-26')

    await openFirstOrderDetail(page)
    await page.getByRole('button', { name: 'Close order details' }).click()
    await expect(page.getByLabel('Start Date').first()).toHaveValue('2026-09-01')
    await expect(page.getByLabel('End Date').first()).toHaveValue('2026-09-26')
  })

  test('D2 | Detail page shows customer section when data loads', async ({ page }) => {
    await page.goto('/orders')
    await openFirstOrderDetail(page)
    await expect(page.getByRole('heading', { name: 'Order Details' })).toBeVisible()
    await expect(page.getByText(/Total Amount|Customer|Phone|Address/i).first()).toBeVisible({
      timeout: 20_000
    })
  })

  test.skip('D6 | Close detail on heavy list — manual only', () => {})

  test.skip('D7 | Scroll position restored — not implemented', () => {})

  test.skip('O5 | TOTAL column vs detail — requires order pair comparison', () => {})
})
