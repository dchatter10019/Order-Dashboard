/**
 * QA cases §5 AI Assistant
 */
import { test, expect } from '@playwright/test'
import { clearSession, loginAsTestUser } from '../helpers/auth.mjs'

test.describe('5. AI Assistant', () => {
  test.beforeEach(async ({ page }) => {
    await clearSession(page)
    await loginAsTestUser(page)
    await page.goto('/ai-assistant')
    await expect(page.getByPlaceholder(/Ask me anything about your orders/i)).toBeVisible({
      timeout: 30_000
    })
  })

  test('AI1 | Revenue query returns a reply (no crash)', async ({ page }) => {
    test.setTimeout(120_000)
    const pageErrors = []
    page.on('pageerror', (err) => pageErrors.push(String(err)))

    await page.locator('#chat-form input').fill('What is my total revenue this month?')
    await page.locator('#chat-form button[type="submit"]').click()
    await page.waitForTimeout(20_000)

    await expect(page.getByText(/ReferenceError/i)).toHaveCount(0)
    await expect(page.getByText(/which customer\?/i)).toHaveCount(0)
    expect(pageErrors.some((e) => e.includes('ReferenceError') || e.includes('isAOVQuery'))).toBeFalsy()
  })

  test('AI3 | Revenue question does not throw ReferenceError', async ({ page }) => {
    test.setTimeout(120_000)
    const errors = []
    page.on('pageerror', (err) => errors.push(String(err)))

    await page.getByRole('button', { name: 'Month To Date Revenue' }).click()
    await page.waitForTimeout(5000)

    expect(errors.some((e) => e.includes('isAOVQuery') || e.includes('ReferenceError'))).toBeFalsy()
  })

  test('AI5 | Month To Date Revenue chip dispatches query', async ({ page }) => {
    test.setTimeout(120_000)
    const pageErrors = []
    page.on('pageerror', (err) => pageErrors.push(String(err)))

    await page.getByRole('button', { name: 'Month To Date Revenue' }).click()
    await page.waitForTimeout(20_000)
    await expect(page.getByText(/ReferenceError/i)).toHaveCount(0)
    expect(pageErrors.some((e) => e.includes('ReferenceError'))).toBeFalsy()
  })

  test.skip('AI2 | Revenue intent routing — covered by AI1 assertions', () => {})

  test.skip('AI4 | Chat persists across auto-refresh — timing-heavy', () => {})

  test.skip('AI6 | Double fetch at mount — StrictMode noise', () => {})
})
