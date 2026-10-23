/**
 * Aggregate Bevvi fee invoice amounts for a retailer over a date range (matches Retailer tab logic).
 */
function filterBillableOrders(orders, startDate, endDate, invoicingEngine) {
  return (orders || []).filter((order) => {
    const orderDate = order.orderDate
    if (!orderDate || orderDate < startDate || orderDate > endDate) return false
    if (invoicingEngine?.isIncludedOrderStatus) {
      return invoicingEngine.isIncludedOrderStatus(order.status)
    }
    const s = String(order.status || '').toLowerCase()
    return ['delivered', 'in_transit', 'accepted', 'pending'].includes(s)
  })
}

function aggregateRetailerInvoice(orders, retailerName, startDate, endDate, invoicingEngine) {
  const name = String(retailerName || '').trim()
  const billable = filterBillableOrders(orders, startDate, endDate, invoicingEngine).filter(
    (o) => String(o.establishment || '').trim() === name
  )

  let totalCharges = 0
  let serviceFee = 0
  let retailerFee = 0
  let orderCount = 0
  const orderNumbers = []

  for (const order of billable) {
    orderCount += 1
    orderNumbers.push(order.ordernum || order.id || '')
    if (invoicingEngine?.calculateOrderFees) {
      const fees = invoicingEngine.calculateOrderFees(order)
      serviceFee += fees.serviceFee || 0
      retailerFee += fees.retailerFee || 0
      totalCharges += (fees.serviceFee || 0) + (fees.retailerFee || 0)
    } else {
      const sc = parseFloat(order.serviceCharge) || 0
      serviceFee += sc
      totalCharges += sc
    }
  }

  totalCharges = Math.round(totalCharges * 100) / 100
  serviceFee = Math.round(serviceFee * 100) / 100
  retailerFee = Math.round(retailerFee * 100) / 100

  return {
    retailerName: name,
    startDate,
    endDate,
    orderCount,
    serviceFee,
    retailerFee,
    totalCharges,
    orderNumbers: orderNumbers.filter(Boolean).slice(0, 50)
  }
}

function listRetailersInRange(orders, startDate, endDate, invoicingEngine) {
  const billable = filterBillableOrders(orders, startDate, endDate, invoicingEngine)
  const names = new Set()
  for (const order of billable) {
    const n = String(order.establishment || '').trim()
    if (n) names.add(n)
  }
  return [...names].sort((a, b) => a.localeCompare(b))
}

module.exports = {
  filterBillableOrders,
  aggregateRetailerInvoice,
  listRetailersInRange
}
