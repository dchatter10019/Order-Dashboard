/**
 * QA cases §1 Authentication — see docs/QA_PLAYWRIGHT_CASES.md
 */
import { test, expect } from '@playwright/test'
import { E2E_PASSWORD, E2E_USERNAME } from '../constants.mjs'
import { clearSession, loginAsTestUser } from '../helpers/auth.mjs'
import { logout } from '../helpers/navigation.mjs'

test.describe('1. Authentication', () => {
  test.beforeEach(async ({ page }) => {
    await clearSession(page)
  })

  test('A1 | Reject wrong password', async ({ page }) => {
    await page.goto('/login')
    await page.locator('#username').fill(E2E_USERNAME)
    await page.locator('#password').fill('wrong-password')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByRole('alert')).toContainText(/invalid|password|sign in failed/i)
    await expect(page).toHaveURL(/\/login/)
  })

  test('A2 | Login with valid credentials lands on orders', async ({ page, isMobile }) => {
    await loginAsTestUser(page)
    await expect(page).toHaveURL(/\/orders(\/?|\?)/)
    if (isMobile) {
      await expect(page.getByRole('button', { name: 'Toggle navigation menu' })).toBeVisible()
    } else {
      await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible()
    }
  })

  test('A3 | No demo credentials in UI; uses server login API', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByText('Bevvi_User')).toHaveCount(0)
    await expect(page.getByText('Bevvi_123#')).toHaveCount(0)

    const loginRequest = page.waitForRequest(
      (req) => req.url().includes('/api/auth/login') && req.method() === 'POST'
    )
    await page.locator('#username').fill(E2E_USERNAME)
    await page.locator('#password').fill(E2E_PASSWORD)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await loginRequest
    await expect(page).toHaveURL(/\/orders(\/?|\?)/)
  })

  test('Auth | Protected routes redirect when signed out', async ({ page }) => {
    await page.goto('/products')
    await expect(page).toHaveURL(/\/login/)
  })

  test('Auth | Log out returns to sign in', async ({ page, isMobile }) => {
    await loginAsTestUser(page)
    await logout(page, isMobile)
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  })
})
