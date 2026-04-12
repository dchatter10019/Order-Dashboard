/** Default when query TZ is missing or invalid — keep in sync with server BEVVI_ORDER_TIMEZONE. */
const DEFAULT_ORDER_TIMEZONE =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_BEVVI_ORDER_TIMEZONE) ||
  'America/New_York'

/** Same rules as server.js resolveOrderTimeZone. */
export function resolveOrderTimeZone(raw) {
  if (!raw || typeof raw !== 'string') return DEFAULT_ORDER_TIMEZONE
  const t = decodeURIComponent(raw.trim())
  if (t.length > 80 || !/^[\w/+_-]+$/.test(t)) return DEFAULT_ORDER_TIMEZONE
  try {
    Intl.DateTimeFormat('en-US', { timeZone: t }).format(new Date(0))
    return t
  } catch {
    return DEFAULT_ORDER_TIMEZONE
  }
}

/**
 * Calendar YYYY-MM-DD for an instant in an IANA timezone.
 * Mirrors server.js getYyyyMmDdInTimeZone so /api/orders and the dashboard stay aligned.
 */
export function getYyyyMmDdInTimeZone(dateInput, timeZone) {
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput)
  if (isNaN(d.getTime())) return null
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(d)
    const y = parts.find(p => p.type === 'year')?.value
    const m = parts.find(p => p.type === 'month')?.value
    const day = parts.find(p => p.type === 'day')?.value
    if (!y || !m || !day) return null
    return `${y}-${m}-${day}`
  } catch {
    return null
  }
}

export function getOrderLocalDate(order, timeZone) {
  if (order.orderDateTime) {
    const z = getYyyyMmDdInTimeZone(order.orderDateTime, timeZone)
    if (z) return z
    try {
      const date = new Date(order.orderDateTime)
      if (!isNaN(date.getTime())) {
        return date.getFullYear() + '-' +
          String(date.getMonth() + 1).padStart(2, '0') + '-' +
          String(date.getDate()).padStart(2, '0')
      }
    } catch { /* */ }
  }
  return order.orderDate || null
}

/**
 * Local YYYY-MM-DD for the Order Date column (must stay in sync with Dashboard.jsx).
 * If orderDateTime is present but invalid, falls back to order.orderDate like the UI.
 */
export function getOrderYmdForDashboard(order) {
  if (!order || !order.orderDate) return null
  if (order.orderDateTime) {
    try {
      const date = new Date(order.orderDateTime)
      if (isNaN(date.getTime())) return order.orderDate
      return (
        `${date.getFullYear()}-` +
        `${String(date.getMonth() + 1).padStart(2, '0')}-` +
        `${String(date.getDate()).padStart(2, '0')}`
      )
    } catch {
      return order.orderDate
    }
  }
  return order.orderDate
}

/**
 * Local YYYY-MM-DD for the Delivery Date column (must stay in sync with Dashboard.jsx).
 */
export function getDeliveryYmdForDashboard(order) {
  if (!order || order.deliveryDate === 'N/A') return null
  if (order.deliveryDateTime) {
    try {
      const d = new Date(order.deliveryDateTime)
      if (isNaN(d.getTime())) return order.deliveryDate
      return (
        `${d.getFullYear()}-` +
        `${String(d.getMonth() + 1).padStart(2, '0')}-` +
        `${String(d.getDate()).padStart(2, '0')}`
      )
    } catch {
      return order.deliveryDate
    }
  }
  return order.deliveryDate
}

/**
 * True when the delivery calendar date is strictly after the order (creation) calendar date,
 * using the same YYYY-MM-DD rules as the dashboard table. Same calendar day → no highlight.
 */
export function isDeliveryDateAfterOrderDate(order) {
  const orderYmd = getOrderYmdForDashboard(order)
  const deliveryYmd = getDeliveryYmdForDashboard(order)
  if (!orderYmd || !deliveryYmd) return false
  return deliveryYmd > orderYmd
}

export function getDeliveryLocalDate(order, timeZone) {
  if (!order.deliveryDate || order.deliveryDate === 'N/A') return null
  if (order.deliveryDateTime) {
    const z = getYyyyMmDdInTimeZone(order.deliveryDateTime, timeZone)
    if (z) return z
    try {
      const date = new Date(order.deliveryDateTime)
      if (!isNaN(date.getTime())) {
        return date.getFullYear() + '-' +
          String(date.getMonth() + 1).padStart(2, '0') + '-' +
          String(date.getDate()).padStart(2, '0')
      }
    } catch { /* */ }
  }
  return order.deliveryDate
}

/** Same date-range membership as server-side order filtering for /api/orders. */
export function filterOrdersByCalendarRange(orders, startDate, endDate, timeZone) {
  if (!startDate || !endDate) return orders
  return orders.filter((order) => {
    const orderLocalDate = getOrderLocalDate(order, timeZone)
    if (orderLocalDate) {
      return orderLocalDate >= startDate && orderLocalDate <= endDate
    }
    const deliveryLocalDate = getDeliveryLocalDate(order, timeZone)
    return deliveryLocalDate && deliveryLocalDate >= startDate && deliveryLocalDate <= endDate
  })
}
