/**
 * QA cases §8 Notifications
 */
import { test, expect } from '@playwright/test'
import { clearSession, loginAsTestUser } from '../helpers/auth.mjs'

test.describe('8. Notifications', () => {
  test('N1 | SSE /api/events returns event-stream', async ({ page }) => {
    await clearSession(page)
    await loginAsTestUser(page)

    const result = await page.evaluate(async () => {
      const res = await fetch('/api/events')
      const contentType = res.headers.get('content-type') || ''
      const reader = res.body?.getReader()
      let chunk = ''
      if (reader) {
        const { value } = await reader.read()
        chunk = value ? new TextDecoder().decode(value) : ''
        await reader.cancel()
      }
      return { status: res.status, contentType, chunk }
    })

    expect(result.status).toBe(200)
    expect(result.contentType).toContain('text/event-stream')
    expect(result.chunk).toMatch(/connected|event/i)
  })

  test('N3 | Footer shows auto-refresh status on orders tab', async ({ page }) => {
    await clearSession(page)
    await loginAsTestUser(page)
    await page.goto('/orders')
    await expect(page.getByRole('contentinfo')).toContainText(/Auto-refresh/i, { timeout: 30_000 })
  })

  test.skip('N2 | Notification permission — browser-dependent', () => {})

  test.skip('N4 | New-order dedup — requires localStorage manipulation', () => {})

  test.skip('N5 | In-app toast — requires live new order', () => {})

  test.skip('N6 | OS notification when tab hidden — manual', () => {})

  test.skip('N7 | SSE reconnect on drop — not force-tested', () => {})

  test.skip('N8 | Connect churn at mount — StrictMode', () => {})
})
