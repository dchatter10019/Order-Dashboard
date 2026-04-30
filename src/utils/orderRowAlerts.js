/**
 * Operational row-highlight tiers for the orders dashboard.
 * Pending-after-15m and accepted-before-delivery rules align with server.js evaluateSlackNotifications.
 *
 * @param {object} order
 * @param {Date} [now]
 * @returns {'pending_stale' | 'accepted_deadline' | 'transit_deadline' | null}
 */
export function getOrderRowAlertTier(order, now = new Date()) {
  if (!order) return null
  const status = (order.status || '').toLowerCase().trim()

  if (status === 'pending' && order.orderDateTime) {
    const orderTime = new Date(order.orderDateTime)
    if (!isNaN(orderTime.getTime())) {
      const minutesSinceReceipt = (now.getTime() - orderTime.getTime()) / (1000 * 60)
      if (minutesSinceReceipt >= 15) return 'pending_stale'
    }
  }

  if (!order.deliveryDateTime) return null
  const deliveryTime = new Date(order.deliveryDateTime)
  if (isNaN(deliveryTime.getTime())) return null
  const minutesUntilDelivery = (deliveryTime.getTime() - now.getTime()) / (1000 * 60)
  if (minutesUntilDelivery > 30 || minutesUntilDelivery < 0) return null

  if (status === 'accepted') return 'accepted_deadline'
  if (status === 'in_transit') return 'transit_deadline'

  return null
}
