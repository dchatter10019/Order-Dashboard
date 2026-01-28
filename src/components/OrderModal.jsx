import React from 'react'
import { X, Package } from 'lucide-react'
import OrderDetailsContent from './OrderDetailsContent'

const OrderModal = ({ order, orderDetails, isOpen, onClose, isLoadingDetails, detailsError, setOrderDetails }) => {
  if (!isOpen || !order) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex justify-between items-center p-6 border-b border-gray-200">
          <div className="flex items-center">
            <Package className="h-6 w-6 text-blue-600 mr-3" />
            <h2 className="text-xl font-semibold text-gray-900">
              Order Details
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors duration-200"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        <OrderDetailsContent
          order={order}
          orderDetails={orderDetails}
          isActive={isOpen}
          isLoadingDetails={isLoadingDetails}
          detailsError={detailsError}
          setOrderDetails={setOrderDetails}
          autoFetch={false}
        />

        {/* Footer */}
        <div className="flex justify-end p-6 border-t border-gray-200">
          <button
            onClick={onClose}
            className="bg-gray-500 hover:bg-gray-600 text-white font-semibold py-2 px-4 rounded-xl transition-all duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

export default OrderModal
