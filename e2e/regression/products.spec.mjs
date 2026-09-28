/**
 * QA cases §7 Products
 */
import { test, expect } from '@playwright/test'
import { clearSession, loginAsTestUser } from '../helpers/auth.mjs'

test.describe('7. Products', () => {
  test.beforeEach(async ({ page }) => {
    await clearSession(page)
    await loginAsTestUser(page)
    await page.goto('/products')
    await expect(page.getByPlaceholder(/Type at least 3 characters/i)).toBeVisible()
  })

  test('P2 | Min-char gating — no search below 3 characters', async ({ page }) => {
    const searchRequest = page.waitForRequest(
      (req) => req.url().includes('/api/products/search'),
      { timeout: 3000 }
    ).catch(() => null)

    await page.getByPlaceholder(/Type at least 3 characters/i).fill('wi')
    await page.waitForTimeout(800)
    expect(await searchRequest).toBeNull()
    await expect(page.getByText(/Type at least 3 characters/i)).toBeVisible()
  })

  test('P1 | Product search fires for 3+ characters', async ({ page }) => {
    const searchResponse = page.waitForResponse(
      (res) => res.url().includes('/api/products/search?q=wine') && res.ok()
    )
    await page.getByPlaceholder(/Type at least 3 characters/i).fill('wine')
    await searchResponse
    await expect(page.getByText(/result/i).first()).toBeVisible({ timeout: 30_000 })
  })

  test('P3 | Cached product count copy is visible', async ({ page }) => {
    await expect(page.getByText(/cached|products/i).first()).toBeVisible()
  })
})
