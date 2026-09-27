function parseMoney(value) {
  const parsed = parseFloat(String(value ?? '').replace(/,/g, '').trim())
  return Number.isNaN(parsed) ? 0 : parsed
}

function sumProductSubtotal(products = []) {
  return products.reduce((sum, product) => {
    const qty = parseInt(product?.quantity, 10) || 1
    const price = parseMoney(product?.price)
    return sum + price * qty
  }, 0)
}

function isManualOrderRecord(orderDetails, order) {
  if (orderDetails?.isManualOrder) return true
  const recipient = Array.isArray(orderDetails?.recipientorders) ? orderDetails.recipientorders[0] : null
  if (recipient?.isManualOrder) return true
  const orderNumber = String(
    orderDetails?.corpOrderNum || order?.ordernum || order?.id || orderDetails?.id || ''
  ).trim()
  return /^BEV-MAN-/i.test(orderNumber)
}

/**
 * Bevvi manual orders often include delivery in orderTotal but leave deliveryCharge at 0.
 * Infer the gap only for manual orders when no explicit delivery fee is present.
 */
function deriveManualOrderDeliveryFee(orderDetails, order = null) {
  const explicit = parseMoney(
    orderDetails?.deliveryCharge ??
      orderDetails?.deliveryFee ??
      orderDetails?.delivery ??
      order?.deliveryFee
  )
  if (explicit > 0) return explicit
  if (!isManualOrderRecord(orderDetails, order)) return 0

  const total = parseMoney(orderDetails?.orderTotal ?? order?.total ?? order?.totalAmount)
  if (total <= 0) return 0

  const orderTax = parseMoney(
    orderDetails?.originalSalesTax ?? orderDetails?.taxes ?? orderDetails?.salesTax ?? order?.tax
  )
  const preTaxTotal = orderTax > 0 ? Math.max(0, total - orderTax) : total

  const recipient = Array.isArray(orderDetails?.recipientorders) ? orderDetails.recipientorders[0] : null
  const products =
    (Array.isArray(orderDetails?.products) && orderDetails.products.length
      ? orderDetails.products
      : recipient?.products) || []

  const productSubtotal =
    sumProductSubtotal(products) || parseMoney(orderDetails?.subTotal ?? order?.revenue)

  const accounted =
    productSubtotal +
    parseMoney(orderDetails?.shippingCharges ?? order?.shippingFee) +
    parseMoney(orderDetails?.serviceCharge ?? order?.serviceCharge) +
    parseMoney(orderDetails?.serviceChargeTax ?? order?.serviceChargeTax) +
    parseMoney(orderDetails?.additionalFee ?? order?.networkServiceCharge) +
    parseMoney(orderDetails?.giftNoteCharge ?? order?.giftNoteCharge) +
    parseMoney(orderDetails?.engravingCharge ?? order?.engravingCharge) +
    parseMoney(orderDetails?.giftWrapCharge ?? order?.giftWrapCharge) +
    parseMoney(orderDetails?.tipAmount ?? orderDetails?.tipAmt ?? order?.tip) -
    parseMoney(orderDetails?.promodiscAmt ?? order?.promoDiscAmt)

  const remainder = Math.round((preTaxTotal - accounted) * 100) / 100
  return remainder > 0.02 ? remainder : 0
}

module.exports = {
  deriveManualOrderDeliveryFee,
  isManualOrderRecord,
  parseMoney
}
