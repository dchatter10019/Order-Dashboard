export async function openFirstOrderDetail(page) {
  const openBtn = page.getByRole('button', { name: 'Open order details' }).first()
  await openBtn.waitFor({ state: 'visible', timeout: 45_000 })
  await Promise.all([page.waitForURL(/\/orders\/[^/?#]+/), openBtn.click()])
}
