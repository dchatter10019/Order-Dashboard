/** Grand total paid (matches order detail when CSV total is populated). */
export function getOrderGrandTotal(order) {
  if (!order) return 0

  const fromField = parseFloat(order.total ?? order.totalAmount)
  if (!Number.isNaN(fromField) && fromField > 0) {
    return Math.round(fromField * 100) / 100
  }

  const revenue = parseFloat(order.revenue) || 0
  const tax = parseFloat(order.tax) || 0
  const tip = parseFloat(order.tip) || 0
  const shippingFee = parseFloat(order.shippingFee) || 0
  const deliveryFee = parseFloat(order.deliveryFee) || 0
  const serviceCharge = parseFloat(order.serviceCharge) || 0
  const serviceChargeTax = parseFloat(order.serviceChargeTax) || 0
  const giftNoteCharge = parseFloat(order.giftNoteCharge) || 0
  const promoDiscAmt = parseFloat(order.promoDiscAmt) || 0

  return Math.round(
    (revenue +
      tax +
      tip +
      shippingFee +
      deliveryFee +
      serviceCharge +
      serviceChargeTax +
      giftNoteCharge -
      promoDiscAmt) *
      100
  ) / 100
}
