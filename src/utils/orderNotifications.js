import { formatDollarAmount } from './formatCurrency'

export const ORDER_NOTIFICATIONS_STORAGE_KEY = 'bevvi_order_notifications_enabled'
export const BROWSER_NOTIFICATION_PROMPT_DISMISSED_KEY = 'bevvi_browser_notification_prompt_dismissed'

export function getBrowserNotificationPermission() {
  if (typeof Notification === 'undefined') {
    return 'unsupported'
  }
  return Notification.permission
}

export function isBrowserNotificationPromptDismissed() {
  try {
    return sessionStorage.getItem(BROWSER_NOTIFICATION_PROMPT_DISMISSED_KEY) === 'true'
  } catch {
    return false
  }
}

export function dismissBrowserNotificationPrompt() {
  try {
    sessionStorage.setItem(BROWSER_NOTIFICATION_PROMPT_DISMISSED_KEY, 'true')
  } catch {
    // ignore storage errors
  }
}

export function clearBrowserNotificationPromptDismissed() {
  try {
    sessionStorage.removeItem(BROWSER_NOTIFICATION_PROMPT_DISMISSED_KEY)
  } catch {
    // ignore storage errors
  }
}

export function isOrderNotificationsEnabled() {
  try {
    return localStorage.getItem(ORDER_NOTIFICATIONS_STORAGE_KEY) !== 'false'
  } catch {
    return true
  }
}

export function setOrderNotificationsEnabled(enabled) {
  try {
    localStorage.setItem(ORDER_NOTIFICATIONS_STORAGE_KEY, enabled ? 'true' : 'false')
  } catch {
    // ignore storage errors
  }
}

export function formatOrderNotificationTitle(order) {
  return `New order: ${order.ordernum || order.id}`
}

export function formatOrderNotificationBody(order) {
  const parts = [
    order.customerName,
    order.establishment,
    order.status,
    formatDollarAmount(order.total)
  ].filter(Boolean)
  return parts.join(' · ')
}

export async function requestBrowserNotificationPermission() {
  if (typeof Notification === 'undefined') {
    return 'unsupported'
  }
  if (Notification.permission === 'granted') {
    return 'granted'
  }
  if (Notification.permission === 'denied') {
    return 'denied'
  }
  return Notification.requestPermission()
}

export function showBrowserOrderNotification(order) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
    return
  }

  try {
    const notification = new Notification(formatOrderNotificationTitle(order), {
      body: formatOrderNotificationBody(order),
      tag: `order-${order.ordernum || order.id}`,
      icon: '/bevvi-icon.svg'
    })
    notification.onclick = () => {
      window.focus()
      notification.close()
    }
  } catch (error) {
    console.warn('Browser notification failed:', error)
  }
}
