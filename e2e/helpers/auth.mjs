import { expect } from '@playwright/test'
import { E2E_PASSWORD, E2E_USERNAME } from '../constants.mjs'

export async function loginAsTestUser(page) {
  await page.goto('/login')
  await page.locator('#username').fill(E2E_USERNAME)
  await page.locator('#password').fill(E2E_PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/orders(\/?|\?)/)
}

export async function clearSession(page) {
  await page.goto('/login')
  await page.evaluate(() => localStorage.removeItem('bevvi_token'))
}
