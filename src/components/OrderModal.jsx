import React from 'react'
import { X, Package } from 'lucide-react'
import OrderDetailsContent from './OrderDetailsContent'
import OrderReceiptPreview from './OrderReceiptPreview'

const OrderModal = ({ order, orderDetails, isOpen, onClose, isLoadingDetails, detailsError, setOrderDetails }) => {
  if (!isOpen || !order) return null

  const orderNumber = order.ordernum || order.id

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 sm:p-4 order-modal-print-hide">
      <div className="flex max-h-[92vh] w-full max-w-7xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="order-modal-print-hide flex shrink-0 items-center justify-between border-b border-gray-200 px-4 py-4 sm:px-6">
          <div className="flex min-w-0 items-center">
            <Package className="mr-3 h-6 w-6 shrink-0 text-bevvi-primary-600" />
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-gray-900 sm:text-xl">Order Details</h2>
              {orderNumber && (
                <p className="truncate text-sm text-gray-500">{orderNumber}</p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 text-gray-400 transition-colors duration-200 hover:text-gray-600"
            aria-label="Close order details"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(360px,420px)] lg:divide-x lg:divide-gray-200">
            <div className="order-modal-print-hide min-w-0">
              <OrderDetailsContent
                order={order}
                orderDetails={orderDetails}
                isActive={isOpen}
                isLoadingDetails={isLoadingDetails}
                detailsError={detailsError}
                setOrderDetails={setOrderDetails}
                autoFetch={false}
              />
            </div>
            <div className="order-receipt-preview-column p-4 sm:p-5 lg:sticky lg:top-0 lg:self-start min-w-0">
              <OrderReceiptPreview order={order} orderDetails={orderDetails} variant="fit" />
            </div>
          </div>
        </div>

        <div className="order-modal-print-hide flex shrink-0 justify-end border-t border-gray-200 px-4 py-4 sm:px-6">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-gray-500 px-4 py-2 font-semibold text-white shadow-lg transition-all duration-200 hover:bg-gray-600 hover:shadow-xl"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

export default OrderModal
