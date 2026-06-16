import React from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, X } from 'lucide-react'
import {
  formatOrderNotificationBody,
  formatOrderNotificationTitle,
  useOrderNotifications
} from '../context/OrderNotificationsContext'

const OrderNotificationToasts = () => {
  const navigate = useNavigate()
  const { toasts, dismissToast } = useOrderNotifications()

  if (toasts.length === 0) {
    return null
  }

  return (
    <div
      className="order-notification-toasts"
      aria-live="polite"
      aria-label="New order notifications"
    >
      {toasts.map((toast) => {
        const orderKey = toast.order.ordernum || toast.order.id
        return (
          <div key={toast.id} className="order-notification-toast">
            <div className="flex items-start gap-3">
              <span className="order-notification-toast-icon" aria-hidden="true">
                <Bell className="h-4 w-4" />
              </span>
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => {
                  if (orderKey) {
                    navigate(`/orders/${encodeURIComponent(orderKey)}`)
                  }
                  dismissToast(toast.id)
                }}
              >
                <p className="order-notification-toast-title">
                  {formatOrderNotificationTitle(toast.order)}
                </p>
                <p className="order-notification-toast-body">
                  {formatOrderNotificationBody(toast.order)}
                </p>
                <p className="order-notification-toast-action">Tap to view order</p>
              </button>
              <button
                type="button"
                className="order-notification-toast-dismiss"
                onClick={() => dismissToast(toast.id)}
                aria-label="Dismiss notification"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default OrderNotificationToasts
