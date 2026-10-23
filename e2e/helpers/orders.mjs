export async function dismissBrowserNotificationPromptIfPresent(page) {
  const dismiss = page.getByRole('button', { name: 'Dismiss notification prompt' })
  if (await dismiss.isVisible().catch(() => false)) {
    await dismiss.click()
  }
}

export async function openFirstOrderDetail(page) {
  await dismissBrowserNotificationPromptIfPresent(page)
  const openBtn = page.getByRole('button', { name: 'Open order details' }).first()
  await openBtn.waitFor({ state: 'visible', timeout: 45_000 })
  await openBtn.scrollIntoViewIfNeeded()
  await openBtn.click()
  await page.waitForURL(/\/orders\/[^/?#]+/, { waitUntil: 'commit', timeout: 45_000 })
}
