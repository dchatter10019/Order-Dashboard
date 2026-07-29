import { formatDollarAmount } from './formatCurrency'
import { getOrderLocalDate, getYyyyMmDdInTimeZone, resolveOrderTimeZone } from './orderDates'
import { apiFetch } from './api'

export const ORDER_NOTIFICATIONS_STORAGE_KEY = 'bevvi_order_notifications_enabled'
export const BROWSER_NOTIFICATION_PROMPT_DISMISSED_KEY = 'bevvi_browser_notification_prompt_dismissed'
export const NOTIFIED_ORDERS_STORAGE_KEY = 'bevvi_notified_order_keys_by_date'

export function getOrderNotificationKey(order) {
  const key = order?.ordernum || order?.id
  return key ? String(key) : null
}

export function getTodayYmd(timeZone) {
  const tz = resolveOrderTimeZone(timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone)
  return getYyyyMmDdInTimeZone(new Date(), tz)
}

export function isOrderFromToday(order, timeZone) {
  const today = getTodayYmd(timeZone)
  if (!today) return false
  const tz = resolveOrderTimeZone(timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone)
  const orderLocalDate = getOrderLocalDate(order, tz)
  return Boolean(orderLocalDate && orderLocalDate === today)
}

function readNotifiedOrdersStore() {
  try {
    const raw = localStorage.getItem(NOTIFIED_ORDERS_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeNotifiedOrdersStore(store) {
  try {
    localStorage.setItem(NOTIFIED_ORDERS_STORAGE_KEY, JSON.stringify(store))
  } catch {
    // ignore storage errors
  }
}

export function getNotifiedOrderKeysForDate(dateYmd) {
  if (!dateYmd) return new Set()
  const store = readNotifiedOrdersStore()
  const keys = store[dateYmd]
  return new Set(Array.isArray(keys) ? keys.map(String) : [])
}

export function addNotifiedOrderKeys(orders, dateYmd) {
  if (!dateYmd || !Array.isArray(orders) || orders.length === 0) return

  const store = readNotifiedOrdersStore()
  const existing = new Set(Array.isArray(store[dateYmd]) ? store[dateYmd].map(String) : [])

  for (const order of orders) {
    const key = getOrderNotificationKey(order)
    if (key) existing.add(key)
  }

  store[dateYmd] = Array.from(existing)

  // Drop entries older than 7 days to keep storage small.
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 7)
  const cutoffYmd =
    `${cutoff.getFullYear()}-` +
    `${String(cutoff.getMonth() + 1).padStart(2, '0')}-` +
    `${String(cutoff.getDate()).padStart(2, '0')}`

  for (const key of Object.keys(store)) {
    if (key < cutoffYmd) {
      delete store[key]
    }
  }

  writeNotifiedOrdersStore(store)
}

export async function fetchNotifiedOrderKeysFromServer(dateYmd) {
  if (!dateYmd) return new Set()

  try {
    const response = await apiFetch(
      `/api/order-notifications/notified?date=${encodeURIComponent(dateYmd)}`
    )
    if (!response.ok) return new Set()
    const data = await response.json()
    return new Set(Array.isArray(data.orderKeys) ? data.orderKeys.map(String) : [])
  } catch {
    return new Set()
  }
}

export async function syncNotifiedOrderKeysToServer(orders, dateYmd) {
  if (!dateYmd || !Array.isArray(orders) || orders.length === 0) return

  const orderKeys = orders
    .map((order) => getOrderNotificationKey(order))
    .filter(Boolean)

  if (orderKeys.length === 0) return

  try {
    await apiFetch('/api/order-notifications/mark-seen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dateYmd, orderKeys })
    })
  } catch {
    // ignore network errors — localStorage still tracks seen orders
  }
}

export function mergeNotifiedOrderKeys(localKeys, serverKeys) {
  return new Set([...localKeys, ...serverKeys])
}

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

export function formatOrderNotificationTime(orderDate) {
  if (!orderDate) return ''
  const date = new Date(orderDate)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
}

export function getOrderNotificationStatusClass(status) {
  const normalized = String(status || '').toLowerCase()
  if (normalized.includes('pending') || normalized.includes('new')) {
    return 'order-notification-status-pending'
  }
  if (normalized.includes('accept')) {
    return 'order-notification-status-accepted'
  }
  if (normalized.includes('deliver') || normalized.includes('complete')) {
    return 'order-notification-status-delivered'
  }
  if (normalized.includes('cancel') || normalized.includes('reject')) {
    return 'order-notification-status-cancelled'
  }
  return 'order-notification-status-default'
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
