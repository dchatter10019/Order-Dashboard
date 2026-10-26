/** Keep in sync with lib/orderListPinning.cjs */

export function normalizeOrderStatus(order) {
  return String(order?.status || '')
    .toLowerCase()
    .trim()
}

export function isDeliveredOrder(order) {
  const status = normalizeOrderStatus(order)
  if (status === 'delivered' || status.includes('delivered')) return true
  const deliveryStatus = String(order?.deliveryStatus || '')
    .toLowerCase()
    .trim()
  return deliveryStatus.includes('delivered')
}

/** Same rule as orders table: shippingFee > 0 → shipping, else delivery. */
export function isShippingOrder(order) {
  return (parseFloat(order?.shippingFee) || 0) > 0
}

function isPendingOrder(order) {
  const status = normalizeOrderStatus(order)
  return Boolean(status && (status === 'pending' || status.includes('pending')))
}

export function isAcceptedNotDeliveredOrder(order) {
  if (isDeliveredOrder(order)) return false
  const status = normalizeOrderStatus(order)
  return Boolean(status && (status === 'accepted' || status.includes('accepted')))
}

/** Pending or accepted (not yet delivered) — shown outside in-range totals and main table. */
export function isOpenAwaitingFulfillmentOrder(order) {
  if (isDeliveredOrder(order)) return false
  const status = normalizeOrderStatus(order)
  if (!status) return false
  if (status === 'pending' || status.includes('pending')) return true
  return isAcceptedNotDeliveredOrder(order)
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
export function isPinnedOpenOrder(order) {
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

export function orderMatchesStrictCalendarRange(
  order,
  startDate,
  endDate,
  { getOrderLocalDate, getDeliveryLocalDate, timeZone }
) {
  const orderLocalDate = getOrderLocalDate(order, timeZone)
  const deliveryLocalDate = getDeliveryLocalDate(order, timeZone)
  return isOrderInCalendarRange(orderLocalDate, deliveryLocalDate, startDate, endDate)
}

export function orderMatchesDisplayDateRange(
  order,
  startDate,
  endDate,
  ctx
) {
  if (orderMatchesStrictCalendarRange(order, startDate, endDate, ctx)) {
    return true
  }
  return isPinnedOpenOrder(order)
}
