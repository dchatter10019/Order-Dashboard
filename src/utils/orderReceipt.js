import { mergeOrderWithDetails } from './orderDisplay'
import { parseUtcMidnightCalendarDate } from './orderDates'
import { formatCurrency } from './formatCurrency'

const num = (v) => parseFloat(v) || 0

export function formatReceiptMoney(amount) {
  return `$${formatCurrency(amount, 2)}`
}

function parseDateTime(value) {
  if (!value) return null
  const d = new Date(value)
  return isNaN(d.getTime()) ? null : d
}

function formatIssuedDate(dateTime, orderDate) {
  const utcMid = dateTime && parseUtcMidnightCalendarDate(dateTime)
  if (utcMid) {
    const d = new Date(`${utcMid}T12:00:00`)
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }).toUpperCase()
  }
  const d = parseDateTime(dateTime) || (orderDate && orderDate !== 'N/A' ? new Date(`${orderDate}T12:00:00`) : null)
  if (!d || isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }).toUpperCase()
}

function formatOrderDateLong(dateTime, orderDate) {
  const utcMid = dateTime && parseUtcMidnightCalendarDate(dateTime)
  if (utcMid) {
    const d = new Date(`${utcMid}T12:00:00`)
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  }
  const d = parseDateTime(dateTime) || (orderDate && orderDate !== 'N/A' ? new Date(`${orderDate}T12:00:00`) : null)
  if (!d || isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

function formatPlacedAt(dateTime) {
  const d = parseDateTime(dateTime)
  if (!d) return '—'
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}

function pickExternalOrderNumber(order, orderDetails, recipient) {
  const candidates = [
    orderDetails?.externalOrderNumber,
    orderDetails?.origOrderNumber,
    recipient?.externalOrderNumber,
    order?.externalOrderNumber,
    order?.origOrderNumber
  ]
  for (const candidate of candidates) {
    if (candidate != null && String(candidate).trim()) return String(candidate).trim()
  }
  return null
}

function pickEmail(recipient, orderDetails) {
  return recipient?.email || orderDetails?.email || orderDetails?.corpEmail || ''
}

function pickProducts(order, orderDetails, recipient) {
  if (orderDetails?.products?.length) return orderDetails.products
  if (recipient?.products?.length) return recipient.products
  if (order?.items?.length) {
    return order.items.map((item) => ({
      name: item.name,
      quantity: item.quantity,
      price: item.price,
      size: item.size || '',
      units: item.units || '',
      imageUrl: item.imageUrl || null
    }))
  }
  return []
}

function formatTime12Hour(date) {
  const hours = date.getHours()
  const minutes = date.getMinutes()
  const hour12 = hours % 12 || 12
  const ampm = hours >= 12 ? 'PM' : 'AM'
  return `${hour12}:${String(minutes).padStart(2, '0')}${ampm}`
}

function formatDeliveryWindow(order, orderDetails, recipient) {
  const raw =
    orderDetails?.deliveryWindow ||
    orderDetails?.deliverySlot ||
    orderDetails?.scheduledDelivery ||
    recipient?.deliveryWindow ||
    order?.deliveryWindow ||
    null
  if (raw) return String(raw)

  const dt = orderDetails?.deliveryDate || order?.deliveryDateTime || order?.deliveryDate
  if (!dt || dt === 'N/A') return null

  const parsed = parseDateTime(dt)
  if (!parsed) return typeof dt === 'string' ? dt : null

  const yyyy = parsed.getFullYear()
  const mm = String(parsed.getMonth() + 1).padStart(2, '0')
  const dd = String(parsed.getDate()).padStart(2, '0')
  const start = formatTime12Hour(parsed)
  const endDate = new Date(parsed.getTime() + 60 * 60 * 1000)
  const end = formatTime12Hour(endDate)
  const tz =
    parsed.toLocaleTimeString('en-US', { timeZoneName: 'short' }).split(' ').pop() || 'EST'

  return `${yyyy}-${mm}-${dd} ${start}-${end}/${tz}`
}

const STATUS_STEPS = [
  { key: 'ordered', label: 'ORDERED' },
  { key: 'accepted', label: 'ACCEPTED' },
  { key: 'in_transit', label: 'IN TRANSIT' },
  { key: 'delivered', label: 'DELIVERED' }
]

function buildStatusSteps(status) {
  const normalized = String(status || 'pending').toLowerCase()
  const completed = new Set()

  if (normalized === 'delivered') {
    STATUS_STEPS.forEach((step) => completed.add(step.key))
  } else if (normalized === 'in_transit') {
    completed.add('ordered')
    completed.add('accepted')
    completed.add('in_transit')
  } else if (normalized === 'accepted') {
    completed.add('ordered')
    completed.add('accepted')
  } else {
    completed.add('ordered')
  }

  return STATUS_STEPS.map((step) => ({
    ...step,
    complete: completed.has(step.key)
  }))
}

function resolvePaymentLabel(order, orderDetails) {
  const raw = orderDetails?.paymentMethod || orderDetails?.paymentStatus || ''
  if (raw && String(raw).trim()) {
    const upper = String(raw).toUpperCase()
    if (upper.includes('PAID') || upper.includes('CARD')) return 'PAID · BY CARD'
    return upper
  }
  if (['delivered', 'accepted', 'in_transit'].includes(order.status)) {
    return 'PAID · BY CARD'
  }
  return 'PENDING PAYMENT'
}

function productDisplayName(product) {
  const name = String(product.name || 'Product').trim()
  const sizeLabel = product.size ? `${product.size}${product.units ? ` ${product.units}` : ''}`.trim() : (product.units || '')
  if (!sizeLabel) return name
  if (name.toLowerCase().includes(sizeLabel.toLowerCase())) return name
  return `${name} - ${sizeLabel}`
}

function productSizeOnly(product) {
  const sizeLabel = product.size ? `${product.size}${product.units ? ` ${product.units}` : ''}`.trim() : (product.units || '')
  return sizeLabel || '—'
}

function productBadgeText(sizeLabel) {
  if (!sizeLabel || sizeLabel === '—') return 'SINGLE BOTTLE'
  return `${sizeLabel} · SINGLE BOTTLE`
}

/** Build a receipt view-model from dashboard order + getOrderInfo payload. */
export function buildOrderReceiptModel(order, orderDetails) {
  if (!order) return null

  const display = mergeOrderWithDetails(order, orderDetails || null)
  const recipient = Array.isArray(orderDetails?.recipientorders) ? orderDetails.recipientorders[0] : null
  const products = pickProducts(order, orderDetails, recipient)

  const productTotal = products.length
    ? products.reduce((sum, p) => sum + num(p.price) * (num(p.quantity) || 1), 0)
    : num(display.revenue)

  const delivery = num(display.deliveryFee)
  const shipping = num(display.shippingFee)
  const tip = num(display.tip)
  const discount = num(display.promoDiscAmt)
  const storeCreditCardFee = num(orderDetails?.storeCreditCardFee ?? orderDetails?.storeCcFee ?? 0)
  const tax = num(display.tax)
  const serviceCharge = num(display.serviceCharge)
  const serviceChargeTax = num(display.serviceChargeTax)
  const bevviCreditCardFee = num(orderDetails?.bevviCreditCardFee ?? orderDetails?.bevviCcFee ?? 0)

  const storeChargeTotal = productTotal + delivery + shipping + tip - discount + storeCreditCardFee
  const bevviChargeTotal = tax + serviceCharge + serviceChargeTax + bevviCreditCardFee
  const totalPaid = num(display.total) || storeChargeTotal + bevviChargeTotal

  const corpClient = (orderDetails?.corpClient || recipient?.companyName || '').trim()
  const city = (recipient?.city || order.shippingCity || '').trim()
  const clientLocation = [corpClient, city ? city.toUpperCase() : ''].filter(Boolean).join(' · ')
  const orderDateTime = orderDetails?.createdAt || order.orderDateTime

  const hasStructuredAddress = Boolean(recipient?.streetAddress || recipient?.city)
  const fallbackAddress = !hasStructuredAddress && order.address ? String(order.address) : ''

  const sequence =
    orderDetails?.corpOrderId ??
    orderDetails?.orderId ??
    orderDetails?.id ??
    null

  return {
    orderNumber: orderDetails?.corpOrderNum || order.ordernum || order.id,
    sequence: sequence != null ? String(sequence) : null,
    issuedDate: formatIssuedDate(orderDateTime, order.orderDate),
    clientLocation,
    corpClient,
    paymentLabel: resolvePaymentLabel(order, orderDetails),
    orderDate: formatOrderDateLong(orderDateTime, order.orderDate),
    placedAt: formatPlacedAt(orderDateTime),
    serviceType: shipping > 0 ? 'shipping' : 'delivery',
    externalOrderNumber: pickExternalOrderNumber(order, orderDetails, recipient),
    products: products.map((p) => {
      const sizeLabel = productSizeOnly(p)
      const qty = num(p.quantity) || 1
      const price = num(p.price)
      return {
        name: productDisplayName(p),
        size: sizeLabel,
        badge: productBadgeText(sizeLabel),
        quantity: qty,
        price,
        lineTotal: price * qty,
        imageUrl: p.imageUrl || p.image || p.productImage || null
      }
    }),
    storeCharge: {
      total: storeChargeTotal,
      lines: [
        { label: 'PRODUCT TOTAL', amount: productTotal },
        { label: 'DELIVERY / SHIPPING FEE', amount: delivery + shipping },
        { label: 'TIP', amount: tip },
        { label: 'PROMOTION DISCOUNT', amount: discount },
        { label: 'STORE CREDIT CARD FEE', amount: storeCreditCardFee }
      ]
    },
    bevviCharge: {
      total: bevviChargeTotal,
      lines: [
        { label: 'TAX', amount: tax },
        { label: 'SERVICE CHARGE', amount: serviceCharge },
        { label: 'SERVICE CHARGE TAX', amount: serviceChargeTax },
        { label: 'BEVVI CREDIT CARD FEE', amount: bevviCreditCardFee }
      ]
    },
    deliveredTo: {
      name: [recipient?.firstName, recipient?.lastName].filter(Boolean).join(' ') || order.customerName || '—',
      company: corpClient || recipient?.companyName || '',
      street: recipient?.streetAddress || '',
      apt: recipient?.aptSuiteNum || '',
      city: recipient?.city || '',
      state: recipient?.state || '',
      zip: recipient?.zipcode || recipient?.zip || '',
      country: recipient?.country || 'United States',
      email: pickEmail(recipient, orderDetails),
      phone: recipient?.phoneNum || order.phone || '',
      fallbackAddress
    },
    deliveryWindow: formatDeliveryWindow(order, orderDetails, recipient),
    statusSteps: buildStatusSteps(order.status),
    totalPaid,
    totalPaidNote:
      order.status === 'delivered'
        ? 'Settled in full — thank you.'
        : order.status === 'canceled'
          ? 'Order canceled.'
          : order.status === 'rejected'
            ? 'Order rejected.'
            : 'Payment processing.',
    footerClient: (corpClient || order.establishment || orderDetails?.establishment?.name || 'YOUR PARTNER').toUpperCase()
  }
}
