/**
 * QA cases §6 GoPuff checker
 */
import { test, expect } from '@playwright/test'
import { clearSession, loginAsTestUser } from '../helpers/auth.mjs'

test.describe('6. GoPuff checker', () => {
  test.beforeEach(async ({ page }) => {
    await clearSession(page)
    await loginAsTestUser(page)
    await page.goto('/gopuff')
  })

  test('G1 | Invalid order shows friendly error without validation JSON panel', async ({ page }) => {
    await page.locator('#gopuff-order-number').fill('JUNK-123')
    await page.getByRole('button', { name: 'Validate order' }).click()

    await expect(page.getByRole('alert')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('alert')).toContainText(/GoPuff|order|found|wrong/i)
    await expect(page.getByText('Validation response')).toHaveCount(0)
  })

  test.skip('G2 | Valid order validate and submit — skipped (no live GoPuff submit)', () => {})
})
