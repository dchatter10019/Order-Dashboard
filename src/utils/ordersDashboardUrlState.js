export const DEFAULT_ORDER_STATUS_FILTER = [
  'delivered',
  'in_transit',
  'accepted',
  'pending',
  'canceled',
  'rejected'
]

export const ORDERS_SCROLL_STORAGE_KEY = 'bevvi_orders_list_scroll_y'

export function parseOrdersDashboardSearchParams(searchParams) {
  const params = searchParams instanceof URLSearchParams ? searchParams : new URLSearchParams(searchParams)
  const start = params.get('start') || params.get('startDate')
  const end = params.get('end') || params.get('endDate')
  const q = params.get('q')
  const status = params.get('status')
  const delivery = params.get('delivery')

  return {
    dateRange: start && end ? { startDate: start, endDate: end } : null,
    searchTerm: q != null ? q : null,
    statusFilter: status ? status.split(',').map((s) => s.trim()).filter(Boolean) : null,
    deliveryFilter: delivery ? delivery.split(',').map((s) => s.trim()).filter(Boolean) : null
  }
}

export function serializeOrdersDashboardSearchParams({
  dateRange,
  searchTerm,
  statusFilter,
  deliveryFilter
}) {
  const params = new URLSearchParams()
  if (dateRange?.startDate && dateRange?.endDate) {
    params.set('start', dateRange.startDate)
    params.set('end', dateRange.endDate)
  }
  const q = String(searchTerm || '').trim()
  if (q) params.set('q', q)

  const statusList = Array.isArray(statusFilter) ? statusFilter : []
  const statusSerialized = statusList.join(',')
  const defaultSerialized = DEFAULT_ORDER_STATUS_FILTER.join(',')
  if (statusSerialized && statusSerialized !== defaultSerialized) {
    params.set('status', statusSerialized)
  }

  if (Array.isArray(deliveryFilter) && deliveryFilter.length > 0) {
    params.set('delivery', deliveryFilter.join(','))
  }

  return params
}

export function ordersListPathWithSearch(searchParams) {
  const serialized =
    searchParams instanceof URLSearchParams
      ? searchParams
      : serializeOrdersDashboardSearchParams(searchParams)
  const qs = serialized.toString()
  return qs ? `/orders?${qs}` : '/orders'
}
