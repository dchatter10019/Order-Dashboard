const { parseYyyyMmDdUtc } = require('./orderDateRange.cjs')

/** Days before today to pull open orders from Bevvi CSV (pending / accepted). */
const OPEN_ORDER_LOOKBACK_DAYS = 60
/** Allow scheduled deliveries slightly in the future when expanding fetch. */
const OPEN_ORDER_FUTURE_DAYS = 7

function formatYyyyMmDdUtc(date) {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function addDaysYmd(ymd, days) {
  const parsed = parseYyyyMmDdUtc(ymd)
  if (!parsed) return ymd
  parsed.setUTCDate(parsed.getUTCDate() + days)
  return formatYyyyMmDdUtc(parsed)
}

function minYmd(a, b) {
  if (!a) return b
  if (!b) return a
  return a <= b ? a : b
}

function maxYmd(a, b) {
  if (!a) return b
  if (!b) return a
  return a >= b ? a : b
}

function normalizeOrderStatus(order) {
  return String(order?.status || '')
    .toLowerCase()
    .trim()
}

function isDeliveredOrder(order) {
  const status = normalizeOrderStatus(order)
  if (status === 'delivered' || status.includes('delivered')) return true
  const deliveryStatus = String(order?.deliveryStatus || '')
    .toLowerCase()
    .trim()
  return deliveryStatus.includes('delivered')
}

/** Same rule as orders table: shippingFee > 0 → shipping, else delivery. */
function isShippingOrder(order) {
  return (parseFloat(order?.shippingFee) || 0) > 0
}

function isPendingOrder(order) {
  const status = normalizeOrderStatus(order)
  return Boolean(status && (status === 'pending' || status.includes('pending')))
}

function isAcceptedNotDeliveredOrder(order) {
  if (isDeliveredOrder(order)) return false
  const status = normalizeOrderStatus(order)
  return Boolean(status && (status === 'accepted' || status.includes('accepted')))
}

function isExcludedFromOutsideRangePin(order) {
  const status = normalizeOrderStatus(order)
  if (!status || isDeliveredOrder(order)) return true
  return (
    status === 'canceled' ||
    status === 'cancelled' ||
    status === 'rejected' ||
    status === 'in_transit' ||
    status.includes('cancel') ||
    status.includes('reject') ||
    status.includes('in_transit') ||
    status.includes('transit')
  )
}

/**
 * Outside the selected date range:
 * - Shipping → pending only
 * - Delivery → pending + accepted (not delivered)
 */
function isPinnedOpenOrder(order) {
  if (isExcludedFromOutsideRangePin(order)) return false
  if (isShippingOrder(order)) return isPendingOrder(order)
  return isPendingOrder(order) || isAcceptedNotDeliveredOrder(order)
}

function isOrderInCalendarRange(orderLocalDate, deliveryLocalDate, startDate, endDate) {
  if (orderLocalDate) {
    return orderLocalDate >= startDate && orderLocalDate <= endDate
  }
  return Boolean(
    deliveryLocalDate && deliveryLocalDate >= startDate && deliveryLocalDate <= endDate
  )
}

function filterOrdersForDisplay(orders, startDate, endDate, getOrderLocalDate, getDeliveryLocalDate, timeZone) {
  if (!startDate || !endDate) return orders
  return orders.filter((order) => {
    const orderLocalDate = getOrderLocalDate(order, timeZone)
    const deliveryLocalDate = getDeliveryLocalDate(order, timeZone)
    if (isOrderInCalendarRange(orderLocalDate, deliveryLocalDate, startDate, endDate)) {
      return true
    }
    return isPinnedOpenOrder(order)
  })
}

function computeOpenOrdersWindowYmd(todayYmd) {
  const anchor = todayYmd || formatYyyyMmDdUtc(new Date())
  return {
    start: addDaysYmd(anchor, -OPEN_ORDER_LOOKBACK_DAYS),
    end: addDaysYmd(anchor, OPEN_ORDER_FUTURE_DAYS)
  }
}

function computeOrdersFetchRangeForDisplay(displayStart, displayEnd, todayYmd) {
  const window = computeOpenOrdersWindowYmd(todayYmd)
  return {
    fetchStart: minYmd(displayStart, window.start),
    fetchEnd: maxYmd(displayEnd, window.end),
    openWindow: window
  }
}

function mergeOrdersById(primary, extra) {
  const map = new Map()
  const keyOf = (order) =>
    String(order?.id || order?.ordernum || order?.corpOrderNum || '').trim() || null

  for (const order of primary || []) {
    const key = keyOf(order)
    if (key) map.set(key, order)
  }
  for (const order of extra || []) {
    const key = keyOf(order)
    if (key && !map.has(key)) map.set(key, order)
  }
  return [...map.values()]
}

function rangeCoversWindow(rangeStart, rangeEnd, windowStart, windowEnd) {
  return rangeStart <= windowStart && rangeEnd >= windowEnd
}

module.exports = {
  OPEN_ORDER_FUTURE_DAYS,
  OPEN_ORDER_LOOKBACK_DAYS,
  addDaysYmd,
  computeOpenOrdersWindowYmd,
  computeOrdersFetchRangeForDisplay,
  filterOrdersForDisplay,
  isDeliveredOrder,
  isShippingOrder,
  isPinnedOpenOrder,
  mergeOrdersById,
  rangeCoversWindow
}
