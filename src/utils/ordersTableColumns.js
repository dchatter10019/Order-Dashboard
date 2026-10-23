export const ORDERS_TABLE_COLUMN_WIDTHS_STORAGE_KEY = 'bevvi_orders_table_column_widths'

export const ORDERS_TABLE_COLUMNS = [
  { id: 'ordernum', label: 'Order Number', sortKey: 'ordernum', defaultWidth: 192, padding: 'first' },
  { id: 'customerName', label: 'Customer', sortKey: 'customerName', defaultWidth: 160 },
  { id: 'establishment', label: 'Retailer', sortKey: 'establishment', defaultWidth: 176 },
  { id: 'orderDate', label: 'Order Date', sortKey: 'orderDate', defaultWidth: 112 },
  { id: 'orderTime', label: 'Order Time', sortKey: 'orderTime', defaultWidth: 96 },
  { id: 'deliveryDate', label: 'Delivery Date', sortKey: 'deliveryDate', defaultWidth: 112 },
  { id: 'deliveryTime', label: 'Delivery Time', sortKey: 'deliveryTime', defaultWidth: 96 },
  { id: 'status', label: 'Status', sortKey: 'status', defaultWidth: 96 },
  { id: 'orderType', label: 'Order Type', sortKey: 'orderType', defaultWidth: 112 },
  { id: 'deliveryStatus', label: 'Delivery Status', sortKey: 'deliveryStatus', defaultWidth: 96 },
  { id: 'serviceFee', label: 'Service Fee', sortKey: null, defaultWidth: 96 },
  { id: 'retailerFee', label: 'Retailer Fee', sortKey: null, defaultWidth: 96 },
  { id: 'total', label: 'Total', sortKey: 'total', defaultWidth: 88 }
]

export const ORDERS_TABLE_MIN_COLUMN_WIDTH = 56

export function getDefaultOrdersTableColumnWidths() {
  return Object.fromEntries(ORDERS_TABLE_COLUMNS.map((col) => [col.id, col.defaultWidth]))
}

export function loadOrdersTableColumnWidths() {
  const defaults = getDefaultOrdersTableColumnWidths()
  try {
    const raw = localStorage.getItem(ORDERS_TABLE_COLUMN_WIDTHS_STORAGE_KEY)
    if (!raw) return defaults
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return defaults
    const merged = { ...defaults }
    for (const col of ORDERS_TABLE_COLUMNS) {
      const value = parsed[col.id]
      if (typeof value === 'number' && Number.isFinite(value) && value >= ORDERS_TABLE_MIN_COLUMN_WIDTH) {
        merged[col.id] = Math.round(value)
      }
    }
    return merged
  } catch {
    return defaults
  }
}

export function saveOrdersTableColumnWidths(widths) {
  try {
    localStorage.setItem(ORDERS_TABLE_COLUMN_WIDTHS_STORAGE_KEY, JSON.stringify(widths))
  } catch {
    /* ignore quota / private mode */
  }
}

export function sumOrdersTableColumnWidths(widths) {
  return ORDERS_TABLE_COLUMNS.reduce((sum, col) => sum + (widths[col.id] ?? col.defaultWidth), 0)
}
