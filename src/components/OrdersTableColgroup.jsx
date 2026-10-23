import React from 'react'
import { ORDERS_TABLE_COLUMNS } from '../utils/ordersTableColumns'

export default function OrdersTableColgroup({ columnWidths }) {
  return (
    <colgroup>
      {ORDERS_TABLE_COLUMNS.map((col) => (
        <col key={col.id} style={{ width: columnWidths[col.id] ?? col.defaultWidth }} />
      ))}
    </colgroup>
  )
}
