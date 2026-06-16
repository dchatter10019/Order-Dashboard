import React from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, ExternalLink, Store, User, X } from 'lucide-react'
import { formatDollarAmount } from '../utils/formatCurrency'
import {
  formatOrderNotificationTime,
  getOrderNotificationStatusClass
} from '../utils/orderNotifications'
import { useOrderNotifications } from '../context/OrderNotificationsContext'

const OrderNotificationToasts = () => {
  const navigate = useNavigate()
  const { toasts, dismissToast, dismissAllToasts } = useOrderNotifications()

  if (toasts.length === 0) {
    return null
  }

  return (
    <aside
      className="order-notification-panel"
      aria-live="polite"
      aria-label={`${toasts.length} new order notification${toasts.length === 1 ? '' : 's'}`}
    >
      <div className="order-notification-panel-header">
        <div className="flex min-w-0 items-center gap-2">
          <span className="order-notification-panel-icon" aria-hidden="true">
            <Bell className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="order-notification-panel-title">New orders</p>
            <p className="order-notification-panel-subtitle">
              {toasts.length} alert{toasts.length === 1 ? '' : 's'} waiting for review
            </p>
          </div>
          <span className="order-notification-panel-count">{toasts.length}</span>
        </div>
        <button
          type="button"
          className="order-notification-panel-dismiss-all"
          onClick={dismissAllToasts}
        >
          Dismiss all
        </button>
      </div>

      <div className="order-notification-panel-list">
        {toasts.map((toast) => {
          const order = toast.order
          const orderKey = order.ordernum || order.id
          const statusClass = getOrderNotificationStatusClass(order.status)
          const orderTime = formatOrderNotificationTime(order.orderDate)

          return (
            <article key={toast.id} className="order-notification-card">
              <div className="order-notification-card-top">
                <div className="min-w-0 flex-1">
                  <p className="order-notification-card-order">{orderKey}</p>
                  {orderTime ? (
                    <p className="order-notification-card-time">{orderTime}</p>
                  ) : null}
                </div>
                <span className={`order-notification-status ${statusClass}`}>
                  {order.status || 'New'}
                </span>
                <button
                  type="button"
                  className="order-notification-card-dismiss"
                  onClick={() => dismissToast(toast.id)}
                  aria-label={`Dismiss alert for order ${orderKey}`}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="order-notification-card-details">
                {order.customerName ? (
                  <p className="order-notification-card-row">
                    <User className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span className="truncate">{order.customerName}</span>
                  </p>
                ) : null}
                {order.establishment ? (
                  <p className="order-notification-card-row">
                    <Store className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span className="truncate">{order.establishment}</span>
                  </p>
                ) : null}
              </div>

              <div className="order-notification-card-footer">
                <p className="order-notification-card-total">
                  {formatDollarAmount(order.total)}
                </p>
                <button
                  type="button"
                  className="order-notification-card-view"
                  onClick={() => {
                    if (orderKey) {
                      navigate(`/orders/${encodeURIComponent(orderKey)}`)
                    }
                  }}
                >
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  View order
                </button>
              </div>
            </article>
          )
        })}
      </div>
    </aside>
  )
}

export default OrderNotificationToasts
