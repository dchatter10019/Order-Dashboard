import { formatDollarAmount } from './formatCurrency'

export function buildPaymentEmailMailto({ customerEmail, customerName, orderNumber, totalAmount, paymentUrl }) {
  const to = String(customerEmail || '').trim()
  const greeting = customerName?.trim() ? `Hi ${customerName.trim()},` : 'Hi,'
  const orderLine = orderNumber ? `Order number: ${orderNumber}\n` : ''
  const totalLine =
    totalAmount != null && !Number.isNaN(Number(totalAmount))
      ? `Order total: ${formatDollarAmount(totalAmount)}\n`
      : ''

  const body = [
    greeting,
    '',
    'Your Bevvi order is ready. Please use the secure link below to complete payment:',
    '',
    paymentUrl,
    '',
    orderLine + totalLine,
    'If you have any questions, reply to this email.',
    '',
    'Thank you,',
    'Bevvi'
  ]
    .filter((line, index, arr) => !(line === '' && arr[index + 1] === ''))
    .join('\n')

  const subject = orderNumber
    ? `Payment link for your Bevvi order ${orderNumber}`
    : 'Payment link for your Bevvi order'

  const params = new URLSearchParams()
  params.set('subject', subject)
  params.set('body', body)
  return `${to ? `mailto:${to}` : 'mailto:'}?${params.toString()}`
}

function extractZipFromAddress(address) {
  const match = String(address || '').match(/\b(\d{5})(?:-\d{4})?\b/)
  return match ? match[1] : ''
}

export function isManualOrder(order, orderDetails) {
  if (orderDetails?.isManualOrder) return true
  const recipient = Array.isArray(orderDetails?.recipientorders) ? orderDetails.recipientorders[0] : null
  if (recipient?.isManualOrder) return true
  const orderNumber = String(orderDetails?.corpOrderNum || order?.ordernum || order?.id || '')
  return /^BEV-MAN-/i.test(orderNumber)
}

export function buildManualOrderPaymentContext(order, orderDetails) {
  const recipient = Array.isArray(orderDetails?.recipientorders) ? orderDetails.recipientorders[0] : null
  const orderNumber = orderDetails?.corpOrderNum || order?.ordernum || order?.id || ''
  const products = orderDetails?.products?.length
    ? orderDetails.products
    : recipient?.products || []

  return {
    orderNumber,
    email: recipient?.email || orderDetails?.email || '',
    customerName:
      recipient?.companyName ||
      [recipient?.firstName, recipient?.lastName].filter(Boolean).join(' ') ||
      order?.customerName ||
      '',
    storeName:
      orderDetails?.establishment?.name ||
      orderDetails?.estDetails?.name ||
      order?.establishment ||
      '',
    streetAddress: recipient?.streetAddress || '',
    city: recipient?.city || '',
    state: recipient?.state || '',
    zip: recipient?.zipcode || recipient?.zip || extractZipFromAddress(order?.address) || '',
    country: recipient?.country || 'US',
    salesTax: orderDetails?.salesTax ?? orderDetails?.taxes ?? order?.tax ?? null,
    delivery: orderDetails?.deliveryCharge ?? order?.deliveryFee ?? 0,
    shipping: orderDetails?.shippingCharges ?? order?.shippingFee ?? 0,
    service: orderDetails?.serviceCharge ?? order?.serviceCharge ?? 0,
    serviceChargeTax: orderDetails?.serviceChargeTax ?? order?.serviceChargeTax ?? 0,
    networkServiceCharge: orderDetails?.additionalFee ?? order?.networkServiceCharge ?? 0,
    giftNoteCharge: orderDetails?.giftNoteCharge ?? order?.giftNoteCharge ?? 0,
    tip: orderDetails?.tipAmount ?? orderDetails?.tipAmt ?? order?.tip ?? 0,
    discount: orderDetails?.promodiscAmt ?? order?.promoDiscAmt ?? 0,
    totalAmount: orderDetails?.orderTotal ?? order?.total ?? null,
    matchedProducts: products.map((product) => ({
      name: product.name,
      quantity: product.quantity,
      price: product.price
    }))
  }
}
