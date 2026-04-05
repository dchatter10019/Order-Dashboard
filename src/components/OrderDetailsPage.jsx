import React, { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { X } from 'lucide-react'
import OrderDetailsContent from './OrderDetailsContent'

const OrderDetailsPage = () => {
  const { orderNumber } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const [orderDetails, setOrderDetails] = useState(null)
  const [isLoadingDetails, setIsLoadingDetails] = useState(false)
  const [detailsError, setDetailsError] = useState(null)

  const orderFromState = location.state?.order || null

  useEffect(() => {
    if (!orderNumber) return
    setIsLoadingDetails(true)
    setDetailsError(null)
    fetch(`/api/order-details/${encodeURIComponent(orderNumber)}`)
      .then(response => {
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`)
        }
        return response.json()
      })
      .then(data => {
        setOrderDetails(data)
      })
      .catch(error => {
        console.error('Error loading order details:', error)
        setDetailsError({
          message: 'Failed to load order details',
          details: error.message
        })
      })
      .finally(() => {
        setIsLoadingDetails(false)
      })
  }, [orderNumber])

  const fallbackOrder = useMemo(() => {
    if (!orderDetails) return null
    const recipient = Array.isArray(orderDetails.recipientorders) ? orderDetails.recipientorders[0] : null
    const recipientName = recipient ? [recipient.firstName, recipient.lastName].filter(Boolean).join(' ') : ''
    const addressParts = recipient
      ? [recipient.streetAddress, recipient.aptSuiteNum, recipient.city, recipient.state, recipient.zipcode].filter(Boolean)
      : []
    const orderDateTime = orderDetails.createdAt || null
    const orderDate = orderDateTime ? orderDateTime.split('T')[0] : 'N/A'
    const deliveryDateTime = orderDetails.deliveryDate || null
    const deliveryDate = deliveryDateTime ? deliveryDateTime.split('T')[0] : 'N/A'
    const status = orderDetails.corpOrderStatus === 2 ? 'delivered' : 'pending'

    return {
      id: orderDetails.corpOrderNum || orderNumber,
      ordernum: orderDetails.corpOrderNum || orderNumber,
      customerName: recipientName || orderDetails.corpClient || 'Unknown Customer',
      status,
      total: orderDetails.orderTotal || 0,
      revenue: orderDetails.subTotal || 0,
      tax: orderDetails.taxes || 0,
      tip: orderDetails.tipAmt || 0,
      shippingFee: orderDetails.shippingCharges || 0,
      deliveryFee: orderDetails.deliveryCharge || 0,
      serviceCharge: orderDetails.serviceCharge || 0,
      serviceChargeTax: orderDetails.serviceChargeTax || 0,
      giftNoteCharge: orderDetails.giftNoteCharge || 0,
      promoDiscAmt: orderDetails.promodiscAmt || 0,
      totalAmount: orderDetails.orderTotal || 0,
      orderDate,
      orderDateTime,
      deliveryDate,
      deliveryDateTime,
      establishment: orderDetails.establishment?.name || '',
      address: addressParts.join(', '),
      phone: recipient?.phoneNum || ''
    }
  }, [orderDetails, orderNumber])

  const order = orderFromState || fallbackOrder

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Order Details</h1>
            <p className="text-sm text-gray-500">Order {orderNumber}</p>
          </div>
          <button
            type="button"
            onClick={() => navigate('/dashboard')}
            className="inline-flex items-center justify-center h-12 w-12 rounded-full border border-gray-300 text-gray-600 hover:text-gray-900 hover:bg-gray-100"
            aria-label="Close order details"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        {order ? (
          <div className="bg-white rounded-xl shadow border border-gray-200">
            <OrderDetailsContent
              order={order}
              orderDetails={orderDetails}
              isActive={true}
              isLoadingDetails={isLoadingDetails}
              detailsError={detailsError}
              setOrderDetails={setOrderDetails}
              autoFetch={false}
            />
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow border border-gray-200 p-6 text-gray-600">
            Loading order details...
          </div>
        )}
      </div>
    </div>
  )
}

export default OrderDetailsPage
