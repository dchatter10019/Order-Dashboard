import React from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import OrdersTableColgroup from './OrdersTableColgroup'
import { ORDERS_TABLE_COLUMNS } from '../utils/ordersTableColumns'
import { formatDollarAmount } from '../utils/formatCurrency'
import { getOrderGrandTotal } from '../utils/orderTotals'
import {
  getDeliveryYmdForDashboard,
  getOrderYmdForDashboard,
  isDeliveryDateAfterOrderDate
} from '../utils/orderDates'
import { getOrderRowAlertTier } from '../utils/orderRowAlerts'
import { getOrderRetailerName } from '../utils/orderDisplay'

const ORDER_ROW_ALERT_TR_CLASS = {
  pending_stale:
    'bg-rose-50 border-l-4 border-l-rose-500 shadow-sm hover:bg-rose-100/90',
  accepted_deadline:
    'bg-amber-50 border-l-4 border-l-amber-500 shadow-sm hover:bg-amber-100/90',
  transit_deadline:
    'bg-indigo-50 border-l-4 border-l-indigo-500 shadow-sm hover:bg-indigo-100/90'
}

const ORDER_ROW_ALERT_CARD_CLASS = {
  pending_stale:
    'border-rose-300 bg-rose-50 shadow-md ring-2 ring-rose-200/90',
  accepted_deadline:
    'border-amber-300 bg-amber-50 shadow-md ring-2 ring-amber-200/90',
  transit_deadline:
    'border-indigo-300 bg-indigo-50 shadow-md ring-2 ring-indigo-200/90'
}

export default function OrdersDashboardOrderList({
  orders,
  ordersTableWidthStyle,
  ordersTableColumnWidths,
  sortConfig,
  onSort,
  onColumnResizeStart,
  onColumnResizeReset,
  alertNowMs,
  onOpenOrder,
  parseLocalDateTime,
  orderRetailerFee,
  showOutsideRangeBadge = false,
  isOrderOutsideDateRange,
  tableMaxHeightClass = 'max-h-96'
}) {
  if (!orders.length) return null

  return (
    <>
      <div className="hidden md:block max-w-full">
        <div className="shadow ring-1 ring-black ring-opacity-5 rounded-lg">
          <div className={`${tableMaxHeightClass} overflow-auto`}>
            <div className="sticky top-0 z-20 bg-gray-50 border-b border-gray-200">
              <table className="table-fixed min-w-0" style={ordersTableWidthStyle}>
                <OrdersTableColgroup columnWidths={ordersTableColumnWidths} />
                <thead className="bg-gray-50">
                  <tr>
                    {ORDERS_TABLE_COLUMNS.map((col) => (
                      <th
                        key={col.id}
                        className={`${
                          col.padding === 'first' ? 'pl-2 pr-3' : 'px-3'
                        } py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider relative select-none ${
                          col.sortKey ? 'cursor-pointer hover:bg-gray-100' : ''
                        }`}
                        onClick={col.sortKey ? () => onSort(col.sortKey) : undefined}
                      >
                        <div className="flex items-center space-x-1 pr-2">
                          <span>{col.label}</span>
                          {col.sortKey && sortConfig.key === col.sortKey
                            ? sortConfig.direction === 'asc'
                              ? <ChevronUp className="h-4 w-4" />
                              : <ChevronDown className="h-4 w-4" />
                            : null}
                        </div>
                        <div
                          role="separator"
                          aria-orientation="vertical"
                          aria-label={`Resize ${col.label} column`}
                          title="Drag to resize · double-click to reset"
                          className="absolute right-0 top-0 z-10 h-full w-2 cursor-col-resize touch-none hover:bg-bevvi-primary-200/80"
                          onMouseDown={(event) => onColumnResizeStart(col.id, event)}
                          onDoubleClick={(event) => onColumnResizeReset(col.id, event)}
                          onClick={(event) => event.stopPropagation()}
                        />
                      </th>
                    ))}
                  </tr>
                </thead>
              </table>
            </div>
            <table className="table-fixed min-w-0" style={ordersTableWidthStyle}>
              <OrdersTableColgroup columnWidths={ordersTableColumnWidths} />
              <tbody className="bg-white divide-y divide-gray-200">
                {orders.map((order) => {
                  const deliveryFuture = isDeliveryDateAfterOrderDate(order)
                  const deliveryCellClass = deliveryFuture ? 'text-bevvi-primary-700 font-medium' : 'text-gray-900'
                  const rowAlertTier = getOrderRowAlertTier(order, new Date(alertNowMs))
                  const trAlertClass = rowAlertTier
                    ? ORDER_ROW_ALERT_TR_CLASS[rowAlertTier]
                    : 'hover:bg-gray-50'
                  const outsideRange =
                    showOutsideRangeBadge && isOrderOutsideDateRange?.(order)
                  return (
                    <tr key={order.id} className={`bevvi-orders-table-row ${trAlertClass}`}>
                      <td className="pl-2 pr-3 py-4 text-sm font-medium text-gray-900">
                        <button
                          type="button"
                          onClick={() => onOpenOrder(order)}
                          className="truncate block w-full text-left text-bevvi-primary-600 hover:text-bevvi-primary-700 hover:underline"
                          title={order.ordernum || order.id}
                          aria-label="Open order details"
                        >
                          {order.ordernum || order.id}
                        </button>
                        {outsideRange ? (
                          <span className="mt-1 inline-flex rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-600">
                            Outside range
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-4 text-sm text-gray-900">
                        <div className="truncate" title={order.customerName}>
                          {order.customerName}
                        </div>
                      </td>
                      <td className="px-3 py-4 text-sm text-gray-900">
                        <div className="truncate" title={getOrderRetailerName(order)}>
                          {getOrderRetailerName(order)}
                        </div>
                      </td>
                      <td className="px-3 py-4 text-sm text-gray-900">
                        <div
                          className="truncate"
                          title={`Raw: orderDate="${order.orderDate}", orderDateTime="${order.orderDateTime || 'null'}"`}
                        >
                          {order.orderDate ? getOrderYmdForDashboard(order) : 'N/A'}
                        </div>
                      </td>
                      <td className="px-3 py-4 text-sm text-gray-900">
                        <div className="truncate" title={`Raw orderDateTime: "${order.orderDateTime || 'null'}"`}>
                          {order.orderDateTime
                            ? parseLocalDateTime(order.orderDateTime).toLocaleTimeString('en-US', {
                                hour: 'numeric',
                                minute: '2-digit',
                                hour12: true
                              })
                            : 'N/A'}
                        </div>
                      </td>
                      <td className={`px-3 py-4 text-sm ${deliveryCellClass}`}>
                        <div
                          className="truncate"
                          title={`Raw: deliveryDate="${order.deliveryDate}", deliveryDateTime="${order.deliveryDateTime || 'null'}"`}
                        >
                          {order.deliveryDate === 'N/A' ? 'N/A' : getDeliveryYmdForDashboard(order)}
                        </div>
                      </td>
                      <td className={`px-3 py-4 text-sm ${deliveryCellClass}`}>
                        <div className="truncate" title={`Raw deliveryDateTime: "${order.deliveryDateTime || 'null'}"`}>
                          {order.deliveryDateTime
                            ? parseLocalDateTime(order.deliveryDateTime).toLocaleTimeString('en-US', {
                                hour: 'numeric',
                                minute: '2-digit',
                                hour12: true
                              })
                            : 'N/A'}
                        </div>
                      </td>
                      <td className="px-3 py-4 text-sm text-gray-900">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            order.status === 'delivered'
                              ? 'bg-green-100 text-green-800'
                              : order.status === 'in_transit'
                                ? 'bg-bevvi-primary-100 text-bevvi-primary-800'
                                : order.status === 'accepted'
                                  ? 'bg-yellow-100 text-yellow-800'
                                  : order.status === 'pending'
                                    ? 'bg-orange-100 text-orange-800'
                                    : order.status === 'canceled'
                                      ? 'bg-red-100 text-red-800'
                                      : order.status === 'rejected'
                                        ? 'bg-red-100 text-red-800'
                                        : 'bg-gray-100 text-gray-800'
                          }`}
                        >
                          {order.status.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())}
                        </span>
                      </td>
                      <td className="px-3 py-4 text-sm text-gray-900">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            (parseFloat(order.shippingFee) || 0) > 0
                              ? 'bg-bevvi-primary-100 text-bevvi-primary-800'
                              : 'bg-gray-100 text-gray-800'
                          }`}
                        >
                          {(parseFloat(order.shippingFee) || 0) > 0 ? '🚢 Shipping' : '🚚 Delivery'}
                        </span>
                      </td>
                      <td className="px-3 py-4 text-sm text-gray-900">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            order.deliveryStatus === 'Delayed'
                              ? 'bg-red-100 text-red-800'
                              : order.deliveryStatus === 'On Time'
                                ? 'bg-green-100 text-green-800'
                                : 'bg-gray-100 text-gray-800'
                          }`}
                        >
                          {order.deliveryStatus || 'N/A'}
                        </span>
                      </td>
                      <td className="px-3 py-4 text-sm text-gray-900">
                        <div className="truncate" title={formatDollarAmount(parseFloat(order.serviceCharge) || 0)}>
                          {formatDollarAmount(parseFloat(order.serviceCharge) || 0)}
                        </div>
                      </td>
                      <td className="px-3 py-4 text-sm text-gray-900">
                        <div className="truncate" title={formatDollarAmount(orderRetailerFee(order))}>
                          {formatDollarAmount(orderRetailerFee(order))}
                        </div>
                      </td>
                      <td className="px-3 py-4 text-sm text-gray-900">
                        <div className="truncate" title={formatDollarAmount(getOrderGrandTotal(order))}>
                          {formatDollarAmount(getOrderGrandTotal(order))}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="md:hidden space-y-3">
        {orders.map((order) => {
          const deliveryDateDisplay =
            order.deliveryDate === 'N/A' ? 'N/A' : getDeliveryYmdForDashboard(order)
          const deliveryTimeDisplay = order.deliveryDateTime
            ? parseLocalDateTime(order.deliveryDateTime).toLocaleTimeString('en-US', {
                hour: 'numeric',
                minute: '2-digit',
                hour12: true
              })
            : 'N/A'
          const deliveryFuture = isDeliveryDateAfterOrderDate(order)
          const deliveryValueClass = deliveryFuture ? 'text-bevvi-primary-700 font-medium' : 'text-gray-900'
          const orderTimeDisplay = order.orderDateTime
            ? parseLocalDateTime(order.orderDateTime).toLocaleTimeString('en-US', {
                hour: 'numeric',
                minute: '2-digit',
                hour12: true
              })
            : 'N/A'
          const cardAlertTier = getOrderRowAlertTier(order, new Date(alertNowMs))
          const cardSurfaceClass = cardAlertTier
            ? ORDER_ROW_ALERT_CARD_CLASS[cardAlertTier]
            : 'bg-white border-gray-200'
          const outsideRange =
            showOutsideRangeBadge && isOrderOutsideDateRange?.(order)

          return (
            <div
              key={order.id}
              className={`border rounded-lg p-4 transition-shadow ${cardSurfaceClass} ${
                cardAlertTier ? 'hover:shadow-lg' : 'shadow-sm hover:shadow-md'
              }`}
            >
              <div className="flex items-start justify-between mb-3 pb-3 border-b border-gray-100">
                <div className="flex-1 min-w-0">
                  <button
                    type="button"
                    onClick={() => onOpenOrder(order)}
                    className="text-bevvi-primary-600 hover:text-bevvi-primary-700 hover:underline font-semibold text-base mb-1 block truncate w-full text-left"
                    aria-label="Open order details"
                  >
                    {order.ordernum || order.id}
                  </button>
                  {outsideRange ? (
                    <span className="mb-1 inline-flex rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-600">
                      Outside range
                    </span>
                  ) : null}
                  <p className="text-sm text-gray-600 truncate">{order.customerName}</p>
                  <p className="text-sm text-gray-500 truncate mt-0.5" title={getOrderRetailerName(order)}>
                    {getOrderRetailerName(order)}
                  </p>
                </div>
                <div className="ml-2 flex-shrink-0 flex items-center gap-2">
                  <span
                    className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                      order.status === 'delivered'
                        ? 'bg-green-100 text-green-800'
                        : order.status === 'in_transit'
                          ? 'bg-bevvi-primary-100 text-bevvi-primary-800'
                          : order.status === 'accepted'
                            ? 'bg-yellow-100 text-yellow-800'
                            : order.status === 'pending'
                              ? 'bg-orange-100 text-orange-800'
                              : order.status === 'canceled'
                                ? 'bg-red-100 text-red-800'
                                : order.status === 'rejected'
                                  ? 'bg-red-100 text-red-800'
                                  : 'bg-gray-100 text-gray-800'
                    }`}
                  >
                    {order.status.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())}
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <p className="text-xs text-gray-500 mb-0.5">Order Date</p>
                  <p className="text-sm font-medium text-gray-900">
                    {order.orderDate ? getOrderYmdForDashboard(order) : 'N/A'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-0.5">Order Time</p>
                  <p className="text-sm font-medium text-gray-900">{orderTimeDisplay}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-0.5">Delivery Date</p>
                  <p className={`text-sm font-medium ${deliveryValueClass}`}>{deliveryDateDisplay}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-0.5">Delivery Time</p>
                  <p className={`text-sm font-medium ${deliveryValueClass}`}>{deliveryTimeDisplay}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-0.5">Service Fee</p>
                  <p className="text-sm font-medium text-gray-900">
                    {formatDollarAmount(parseFloat(order.serviceCharge) || 0)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-0.5">Retailer Fee</p>
                  <p className="text-sm font-medium text-gray-900">{formatDollarAmount(orderRetailerFee(order))}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-0.5">Total</p>
                  <p className="text-sm font-semibold text-gray-900">
                    {formatDollarAmount(getOrderGrandTotal(order))}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-100">
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                    (parseFloat(order.shippingFee) || 0) > 0
                      ? 'bg-bevvi-primary-100 text-bevvi-primary-800'
                      : 'bg-gray-100 text-gray-800'
                  }`}
                >
                  {(parseFloat(order.shippingFee) || 0) > 0 ? '🚢 Shipping' : '🚚 Delivery'}
                </span>
                {order.deliveryStatus ? (
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                      order.deliveryStatus === 'Delayed'
                        ? 'bg-red-100 text-red-800'
                        : order.deliveryStatus === 'On Time'
                          ? 'bg-green-100 text-green-800'
                          : 'bg-gray-100 text-gray-800'
                    }`}
                  >
                    {order.deliveryStatus}
                  </span>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}
