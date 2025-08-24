import React from 'react'
import { X, Package, User, MapPin, Phone, Calendar, DollarSign, CheckCircle, Clock, AlertCircle, XCircle, AlertTriangle } from 'lucide-react'

const OrderModal = ({ order, isOpen, onClose }) => {
  if (!isOpen || !order) return null

  const getStatusIcon = (status) => {
    switch (status) {
      case 'delivered':
        return <CheckCircle className="h-5 w-5 text-green-500" />
      case 'in_transit':
        return <Clock className="h-5 w-5 text-blue-500" />
      case 'accepted':
        return <CheckCircle className="h-5 w-5 text-green-500" />
      case 'delayed':
        return <AlertTriangle className="h-5 w-5 text-red-500" />
      case 'pending':
        return <AlertCircle className="h-5 w-5 text-yellow-500" />
      case 'canceled':
        return <XCircle className="h-5 w-5 text-red-500" />
      default:
        return <Package className="h-5 w-5 text-gray-500" />
    }
  }

  const getStatusColor = (status) => {
    switch (status) {
      case 'delivered':
        return 'bg-green-100 text-green-800'
      case 'in_transit':
        return 'bg-blue-100 text-blue-800'
      case 'accepted':
        return 'bg-green-100 text-green-800'
      case 'delayed':
        return 'bg-red-100 text-red-800'
      case 'pending':
        return 'bg-yellow-100 text-yellow-800'
      case 'canceled':
        return 'bg-red-100 text-red-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

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

        {/* Order Information */}
        <div className="p-6 space-y-6">
          {/* Order Header */}
          <div className="flex justify-between items-start">
            <div>
              <h3 className="text-2xl font-bold text-gray-900 mb-2">
                {order.id}
              </h3>
              <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(order.status)}`}>
                {getStatusIcon(order.status)}
                <span className="ml-2 capitalize">{order.status.replace('_', ' ')}</span>
              </span>
            </div>
            <div className="text-right">
              <p className="text-3xl font-bold text-blue-600">
                ${order.total.toFixed(2)}
              </p>
              <p className="text-sm text-gray-500">Total Amount</p>
            </div>
          </div>

          {/* Customer Information */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <h4 className="text-lg font-semibold text-gray-900 flex items-center">
                <User className="h-5 w-5 text-blue-600 mr-2" />
                Customer Information
              </h4>
              <div className="space-y-3">
                <div>
                  <p className="text-sm font-medium text-gray-600">Name</p>
                  <p className="text-gray-900">{order.customerName}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-600">Phone</p>
                  <p className="text-gray-900 flex items-center">
                    <Phone className="h-4 w-4 text-gray-400 mr-2" />
                    {order.phone}
                  </p>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-600">Address</p>
                  <p className="text-gray-900 flex items-start">
                    <MapPin className="h-4 w-4 text-gray-400 mr-2 mt-0.5 flex-shrink-0" />
                    {order.address}
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <h4 className="text-lg font-semibold text-gray-900 flex items-center">
                <Calendar className="h-5 w-5 text-blue-600 mr-2" />
                Order Timeline
              </h4>
              <div className="space-y-3">
                <div>
                  <p className="text-sm font-medium text-gray-600">Order Date</p>
                  <p className="text-gray-900">
                    {order.orderDate ? new Date(order.orderDate + 'T00:00:00').toLocaleDateString('en-US', {
                      weekday: 'long',
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric'
                    }) : 'N/A'}
                  </p>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-600">Expected Delivery</p>
                  <p className="text-gray-900">
                    {order.deliveryDate === 'N/A' ? 'N/A' : new Date(order.deliveryDate + 'T00:00:00').toLocaleDateString('en-US', {
                      weekday: 'long',
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric'
                    })}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Order Items */}
          <div className="space-y-4">
            <h4 className="text-lg font-semibold text-gray-900 flex items-center">
              <Package className="h-5 w-5 text-blue-600 mr-2" />
              Order Items
            </h4>
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="space-y-3">
                {order.items.map((item, index) => (
                  <div key={index} className="flex justify-between items-center py-2 border-b border-gray-200 last:border-b-0">
                    <div className="flex items-center">
                      <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center mr-3">
                        <Package className="h-4 w-4 text-blue-600" />
                      </div>
                      <div>
                        <p className="font-medium text-gray-900">{item.name}</p>
                        <p className="text-sm text-gray-500">Qty: {item.quantity}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-medium text-gray-900">${item.price.toFixed(2)}</p>
                      <p className="text-sm text-gray-500">
                        Total: ${(item.price * item.quantity).toFixed(2)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Financial Breakdown */}
          <div className="space-y-4">
            <h4 className="text-lg font-semibold text-gray-900 flex items-center">
                              <DollarSign className="h-5 w-5 text-blue-600 mr-2" />
              Financial Breakdown
            </h4>
                        <div className="bg-gradient-to-r from-blue-50 to-blue-50 rounded-lg p-6 border border-blue-200">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Revenue & Base Costs */}
                <div className="space-y-3">
                  <div className="flex justify-between items-center py-2 border-b border-blue-200">
                    <span className="text-sm font-medium text-blue-700">Base Revenue</span>
                    <span className="font-semibold text-blue-900">${(order.revenue || 0).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b border-blue-200">
                    <span className="text-sm font-medium text-blue-700">Gift Note Charge</span>
                    <span className="font-semibold text-blue-900">${(order.giftNoteCharge || 0).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b border-blue-200">
                    <span className="text-sm font-medium text-blue-700">Promo Discount</span>
                    <span className="font-semibold text-red-600">-${(order.promoDiscAmt || 0).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b border-blue-200">
                    <span className="text-sm font-medium text-blue-700">Tax</span>
                    <span className="font-semibold text-blue-900">${(order.tax || 0).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b border-blue-200">
                    <span className="text-sm font-medium text-blue-700">Tip</span>
                    <span className="font-semibold text-blue-900">${(order.tip || 0).toFixed(2)}</span>
                  </div>
                </div>

                {/* Fees & Charges */}
                <div className="space-y-3">
                  <div className="flex justify-between items-center py-2 border-b border-blue-200">
                    <span className="text-sm font-medium text-blue-700">Shipping Fee</span>
                    <span className="font-semibold text-blue-900">${(order.shippingFee || 0).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b border-blue-200">
                    <span className="text-sm font-medium text-blue-700">Delivery Fee</span>
                    <span className="font-semibold text-blue-900">${(order.deliveryFee || 0).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b border-blue-200">
                    <span className="text-sm font-medium text-blue-700">Service Charge</span>
                    <span className="font-semibold text-blue-900">${(order.serviceCharge || 0).toFixed(2)}</span>
                    </div>
                  <div className="flex justify-between items-center py-2 border-b border-blue-200">
                    <span className="text-sm font-medium text-blue-700">Service Charge Tax</span>
                    <span className="font-semibold text-blue-900">${(order.serviceChargeTax || 0).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b border-blue-200">
                    <span className="text-sm font-medium text-blue-700">Service Charge Tax</span>
                    <span className="font-semibold text-blue-900">${(order.serviceChargeTax || 0).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b border-blue-200">
                    <span className="text-sm font-medium text-blue-700">API Total Amount</span>
                    <span className="font-semibold text-blue-900">${(order.totalAmount || 0).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b border-blue-200 bg-blue-100 p-2 rounded">
                    <span className="text-sm font-medium text-blue-700">Calculated Total</span>
                    <span className="text-lg font-bold text-blue-900">${order.total.toFixed(2)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>





          {/* Additional Metadata */}
          <div className="space-y-4">
            <h4 className="text-lg font-semibold text-gray-900 flex items-center">
              <Package className="h-5 w-5 text-blue-600 mr-2" />
              Additional Order Metadata
            </h4>
            <div className="bg-gradient-to-r from-amber-50 to-orange-50 rounded-lg p-6 border border-amber-200">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-3">
                  <div className="flex justify-between items-center py-2">
                    <span className="text-sm font-medium text-amber-700">Order ID</span>
                    <span className="font-mono text-xs text-amber-900 break-all">{order.id}</span>
                  </div>
                  <div className="flex justify-between items-center py-2">
                    <span className="text-sm font-medium text-amber-700">Customer Name</span>
                    <span className="font-semibold text-amber-900">{order.customerName}</span>
                  </div>
                  <div className="flex justify-between items-start py-2">
                    <span className="text-sm font-medium text-amber-700 mr-4">Establishment</span>
                    <span className="font-semibold text-amber-900 text-right break-words">{order.establishment || 'Not specified'}</span>
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="flex justify-between items-center py-2">
                    <span className="text-sm font-medium text-amber-700">Order Date</span>
                    <span className="font-semibold text-amber-900">
                      {order.orderDate ? new Date(order.orderDate + 'T00:00:00').toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric'
                      }) : 'N/A'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center py-2">
                    <span className="text-sm font-medium text-amber-700">Delivery Date</span>
                    <span className="font-semibold text-amber-900">
                      {order.deliveryDate === 'N/A' ? 'N/A' : new Date(order.deliveryDate + 'T00:00:00').toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric'
                      })}
                    </span>
                  </div>
                  <div className="flex justify-between items-center py-2">
                    <span className="text-sm font-medium text-amber-700">Status</span>
                    <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(order.status)}`}>
                      {getStatusIcon(order.status)}
                      <span className="ml-1 capitalize">{order.status.replace('_', ' ')}</span>
                    </span>
                  </div>
                  <div className="flex justify-between items-center py-2">
                    <span className="text-sm font-medium text-amber-700">Order Type</span>
                    <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                      (parseFloat(order.shippingFee) || 0) > 0 ? 'bg-purple-100 text-purple-800' : 'bg-blue-100 text-blue-800'
                    }`}>
                      {(parseFloat(order.shippingFee) || 0) > 0 ? '🚢 Shipping' : '🚚 Delivery'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Order Summary */}
          <div className="bg-gradient-to-r from-blue-50 to-green-50 rounded-lg p-6 border border-blue-200">
            <div className="flex justify-between items-center">
              <span className="text-lg font-semibold text-blue-900">Final Order Total</span>
              <span className="text-3xl font-bold text-blue-900">${order.total.toFixed(2)}</span>
            </div>
            <div className="mt-2 text-sm text-blue-700">
              {order.status === 'delivered' ? '✅ Order has been delivered' : 
               order.status === 'in_transit' ? '🚚 Order is in transit' : 
               order.status === 'accepted' ? '✅ Order has been accepted' :
               order.status === 'delayed' ? '⚠️ Order is delayed' :
               '⏳ Order is pending'}
            </div>
          </div>
        </div>

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
