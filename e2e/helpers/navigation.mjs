import { expect } from '@playwright/test'

/** Nav labels match MainDashboard.jsx tab labels. */
export const TABS = [
  { path: '/orders', label: 'Orders', context: /Orders —/ },
  { path: '/products', label: 'Products', context: /Products —/ },
  { path: '/retailers', label: 'Retailers', context: /Retailers —/ },
  { path: '/gopuff', label: 'GoPuff', context: /GoPuff Checker —/ },
  { path: '/manual-order', label: 'Manual Order', context: /Manual Order —/ },
  { path: '/ai-assistant', label: 'AI Assistant', context: /AI Assistant —/ }
]

export async function clickNavTab(page, label, isMobile) {
  if (isMobile) {
    await page.getByRole('button', { name: 'Toggle navigation menu' }).click()
    await page.getByRole('dialog', { name: 'Navigation menu' }).getByRole('button', { name: label }).click()
  } else {
    await page.locator('.bevvi-nav-bar').getByRole('button', { name: label }).click()
  }
}

export async function logout(page, isMobile) {
  if (isMobile) {
    await page.getByRole('button', { name: 'Toggle navigation menu' }).click()
    const logoutBtn = page.getByRole('dialog', { name: 'Navigation menu' }).getByRole('button', { name: 'Log out' })
    await logoutBtn.evaluate((node) => node.click())
  } else {
    await page.getByRole('button', { name: 'Log out' }).click()
  }
  await expect(page).toHaveURL(/\/login/, { timeout: 15_000 })
}
