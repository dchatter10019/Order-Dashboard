/**
 * QA cases §3 Orders dashboard
 */
import { test, expect } from '@playwright/test'
import { clearSession, loginAsTestUser } from '../helpers/auth.mjs'

test.describe('3. Orders dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await clearSession(page)
    await loginAsTestUser(page)
    await page.goto('/orders')
    await expect(page.locator('#dashboard-order-search')).toBeVisible({ timeout: 60_000 })
  })

  test('O1 | Search by customer updates URL and filter copy', async ({ page }) => {
    const search = page.locator('#dashboard-order-search')
    await search.fill('SDL')
    await expect(page).toHaveURL(/[?&]q=SDL/)
    await expect(page.getByText(/Found \d+ matching/i)).toBeVisible({ timeout: 15_000 })
  })

  test('O2 | Search no-match shows empty filtered state', async ({ page }) => {
    await page.locator('#dashboard-order-search').fill('zzzznomatch')
    await expect(page).toHaveURL(/[?&]q=zzzznomatch/)
    await expect(page.getByText(/Showing 0 of \d+ orders/i)).toBeVisible({ timeout: 15_000 })
  })

  test('O3 | Status filter via URL (accepted only)', async ({ page }) => {
    await page.goto('/orders?status=accepted')
    await expect(page).toHaveURL(/status=accepted/)
    await expect(page.getByText(/Showing \d+ of \d+ orders/i)).toBeVisible()
  })

  test('O4 | Fetch Orders requests API for date range', async ({ page }) => {
    const fetchResponse = page.waitForResponse(
      (res) => res.url().includes('/api/orders?') && res.request().method() === 'GET'
    )
    await page.getByRole('button', { name: 'Fetch Orders' }).click()
    const response = await fetchResponse
    expect(response.ok()).toBeTruthy()
  })

  test('O6 | delayed keyword search applies filter', async ({ page }) => {
    await page.locator('#dashboard-order-search').fill('delayed')
    await expect(page).toHaveURL(/[?&]q=delayed/)
  })

  test('O7 | Date range over 31 days shows validation error', async ({ page }) => {
    const start = page.getByLabel('Start Date').first()
    const end = page.getByLabel('End Date').first()
    await start.fill('2025-01-01')
    await end.fill('2025-02-15')
    await end.blur()
    await expect(page.getByText(/cannot exceed 31 days/i).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Fetch Orders' }).first()).toBeDisabled()
  })

  test('D5 | Filter deep-link pre-applies search', async ({ page }) => {
    await page.goto('/orders?q=SDL&start=2026-09-01&end=2026-09-26')
    await expect(page.locator('#dashboard-order-search')).toBeVisible({ timeout: 60_000 })
    await expect(page.locator('#dashboard-order-search')).toHaveValue('SDL')
    await expect(page).toHaveURL(/start=2026-09-01/)
    await expect(page).toHaveURL(/end=2026-09-26/)
  })
})
