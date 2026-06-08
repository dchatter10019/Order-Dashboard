/** Merge list/CSV order row with getOrderInfo API payload for details display. */
export function mergeOrderWithDetails(order, orderDetails) {
  if (!order) return null
  if (!orderDetails) return order

  return {
    ...order,
    revenue: orderDetails.subTotal ?? order.revenue,
    tax: orderDetails.taxes ?? order.tax,
    tip: orderDetails.tipAmount ?? orderDetails.tipAmt ?? order.tip,
    shippingFee: orderDetails.shippingCharges ?? order.shippingFee,
    deliveryFee: orderDetails.deliveryCharge ?? order.deliveryFee,
    serviceCharge: orderDetails.serviceCharge ?? order.serviceCharge,
    serviceChargeTax: orderDetails.serviceChargeTax ?? order.serviceChargeTax,
    giftNoteCharge: orderDetails.giftNoteCharge ?? order.giftNoteCharge,
    promoDiscAmt: orderDetails.promodiscAmt ?? order.promoDiscAmt,
    networkServiceCharge: orderDetails.additionalFee ?? order.networkServiceCharge ?? 0,
    total: orderDetails.orderTotal ?? order.total,
    totalAmount: orderDetails.orderTotal ?? order.totalAmount
  }
}

export function buildOrderFromDetails(orderDetails, orderNumber) {
  if (!orderDetails) return null

  const recipient = Array.isArray(orderDetails.recipientorders) ? orderDetails.recipientorders[0] : null
  const recipientName = recipient ? [recipient.firstName, recipient.lastName].filter(Boolean).join(' ') : ''
  const addressParts = recipient
    ? [recipient.streetAddress, recipient.aptSuiteNum, recipient.city, recipient.state, recipient.zipcode].filter(Boolean)
    : []
  const orderDateTime = orderDetails.createdAt || null
  const orderDate = orderDateTime ? orderDateTime.split('T')[0] : 'N/A'
  const deliveryDateTime = orderDetails.deliveryDate || null
  const deliveryDate = deliveryDateTime ? deliveryDateTime.split('T')[0] : 'N/A'
  const status = orderDetails.corpOrderStatus === 2 ? 'delivered' : 'pending'

  return mergeOrderWithDetails(
    {
      id: orderDetails.corpOrderNum || orderNumber,
      ordernum: orderDetails.corpOrderNum || orderNumber,
      customerName: recipientName || orderDetails.corpClient || 'Unknown Customer',
      status,
      total: orderDetails.orderTotal || 0,
      revenue: orderDetails.subTotal || 0,
      tax: orderDetails.taxes || 0,
      tip: orderDetails.tipAmount || orderDetails.tipAmt || 0,
      shippingFee: orderDetails.shippingCharges || 0,
      deliveryFee: orderDetails.deliveryCharge || 0,
      serviceCharge: orderDetails.serviceCharge || 0,
      serviceChargeTax: orderDetails.serviceChargeTax || 0,
      giftNoteCharge: orderDetails.giftNoteCharge || 0,
      promoDiscAmt: orderDetails.promodiscAmt || 0,
      networkServiceCharge: orderDetails.additionalFee || 0,
      totalAmount: orderDetails.orderTotal || 0,
      orderDate,
      orderDateTime,
      deliveryDate,
      deliveryDateTime,
      establishment: orderDetails.establishment?.name || orderDetails.estDetails?.name || '',
      address: addressParts.join(', '),
      phone: recipient?.phoneNum || ''
    },
    orderDetails
  )
}
