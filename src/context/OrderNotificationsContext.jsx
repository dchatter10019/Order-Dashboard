import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { getApiUrl } from '../utils/api'
import {
  addNotifiedOrderKeys,
  clearBrowserNotificationPromptDismissed,
  dismissBrowserNotificationPrompt,
  fetchNotifiedOrderKeysFromServer,
  formatOrderNotificationBody,
  formatOrderNotificationTitle,
  getBrowserNotificationPermission,
  getNotifiedOrderKeysForDate,
  getOrderNotificationKey,
  getTodayYmd,
  isBrowserNotificationPromptDismissed,
  isOrderFromToday,
  isOrderNotificationsEnabled,
  mergeNotifiedOrderKeys,
  requestBrowserNotificationPermission,
  setOrderNotificationsEnabled,
  showBrowserOrderNotification,
  syncNotifiedOrderKeysToServer
} from '../utils/orderNotifications'

const OrderNotificationsContext = createContext(null)

export function OrderNotificationsProvider({ children, isAuthenticated }) {
  const [enabled, setEnabled] = useState(isOrderNotificationsEnabled)
  const [toasts, setToasts] = useState([])
  const [browserPermission, setBrowserPermission] = useState(getBrowserNotificationPermission)
  const [promptDismissed, setPromptDismissed] = useState(isBrowserNotificationPromptDismissed)
  const clientTimeZone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    []
  )
  const recentOrderKeysRef = useRef(getNotifiedOrderKeysForDate(getTodayYmd(clientTimeZone)))

  const markOrdersSeen = useCallback((orders) => {
    if (!Array.isArray(orders) || orders.length === 0) {
      return
    }

    const todayYmd = getTodayYmd(clientTimeZone)
    const todayOrders = orders.filter((order) => isOrderFromToday(order, clientTimeZone))
    if (todayOrders.length === 0) {
      return
    }

    for (const order of todayOrders) {
      const key = getOrderNotificationKey(order)
      if (key) recentOrderKeysRef.current.add(key)
    }

    addNotifiedOrderKeys(todayOrders, todayYmd)
    void syncNotifiedOrderKeysToServer(todayOrders, todayYmd)
  }, [clientTimeZone])

  const notifyNewOrders = useCallback((orders) => {
    if (!enabled || !Array.isArray(orders) || orders.length === 0) {
      return
    }

    const todayYmd = getTodayYmd(clientTimeZone)
    const freshOrders = orders.filter((order) => {
      if (!isOrderFromToday(order, clientTimeZone)) {
        return false
      }
      const key = getOrderNotificationKey(order)
      if (!key || recentOrderKeysRef.current.has(key)) {
        return false
      }
      recentOrderKeysRef.current.add(key)
      return true
    })

    if (freshOrders.length === 0) {
      return
    }

    addNotifiedOrderKeys(freshOrders, todayYmd)
    void syncNotifiedOrderKeysToServer(freshOrders, todayYmd)

    if (recentOrderKeysRef.current.size > 500) {
      recentOrderKeysRef.current = new Set(
        Array.from(recentOrderKeysRef.current).slice(-250)
      )
    }

    freshOrders.forEach((order) => {
      showBrowserOrderNotification(order)
    })

    const createdAt = Date.now()
    setToasts((current) => {
      const next = freshOrders.map((order, index) => ({
        id: `${order.ordernum || order.id}-${createdAt}-${index}`,
        order,
        createdAt
      }))
      return [...next, ...current]
    })
  }, [enabled, clientTimeZone])

  const refreshBrowserPermission = useCallback(() => {
    setBrowserPermission(getBrowserNotificationPermission())
  }, [])

  const dismissToast = useCallback((toastId) => {
    setToasts((current) => current.filter((toast) => toast.id !== toastId))
  }, [])

  const dismissAllToasts = useCallback(() => {
    setToasts([])
  }, [])

  useEffect(() => {
    if (!isAuthenticated) {
      return undefined
    }

    let cancelled = false

    const syncNotifiedKeys = async () => {
      const todayYmd = getTodayYmd(clientTimeZone)
      const localKeys = getNotifiedOrderKeysForDate(todayYmd)
      const serverKeys = await fetchNotifiedOrderKeysFromServer(todayYmd)
      if (cancelled) return

      const merged = mergeNotifiedOrderKeys(localKeys, serverKeys)
      recentOrderKeysRef.current = merged

      if (serverKeys.size > 0) {
        addNotifiedOrderKeys(
          Array.from(serverKeys).map((key) => ({ ordernum: key })),
          todayYmd
        )
      }
    }

    void syncNotifiedKeys()

    return () => {
      cancelled = true
    }
  }, [isAuthenticated, clientTimeZone])

  const requestBrowserPermission = useCallback(async () => {
    const result = await requestBrowserNotificationPermission()
    refreshBrowserPermission()
    if (result === 'granted') {
      clearBrowserNotificationPromptDismissed()
      setPromptDismissed(false)
    }
    return result
  }, [refreshBrowserPermission])

  const dismissBrowserPrompt = useCallback(() => {
    dismissBrowserNotificationPrompt()
    setPromptDismissed(true)
  }, [])

  const toggleEnabled = useCallback(async () => {
    const nextEnabled = !enabled
    if (nextEnabled) {
      clearBrowserNotificationPromptDismissed()
      setPromptDismissed(false)
      await requestBrowserPermission()
    }
    setEnabled(nextEnabled)
    setOrderNotificationsEnabled(nextEnabled)
  }, [enabled, requestBrowserPermission])

  const showBrowserPrompt =
    isAuthenticated &&
    enabled &&
    browserPermission !== 'granted' &&
    browserPermission !== 'unsupported' &&
    !promptDismissed

  useEffect(() => {
    if (!isAuthenticated) {
      return undefined
    }

    refreshBrowserPermission()
  }, [isAuthenticated, refreshBrowserPermission])

  useEffect(() => {
    if (!isAuthenticated) {
      return undefined
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refreshBrowserPermission()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [isAuthenticated, refreshBrowserPermission])

  useEffect(() => {
    if (!isAuthenticated) {
      return undefined
    }

    let eventSource = null
    let reconnectTimer = null

    const connect = () => {
      try {
        eventSource = new EventSource(getApiUrl('/api/events'))

        eventSource.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data)
            if (data.type === 'new_orders' && Array.isArray(data.orders)) {
              notifyNewOrders(data.orders)
            }
          } catch (error) {
            console.error('Failed to parse order notification event:', error)
          }
        }

        eventSource.onerror = () => {
          eventSource?.close()
          eventSource = null
          reconnectTimer = window.setTimeout(connect, 5000)
        }
      } catch (error) {
        console.error('Failed to connect to order notifications:', error)
        reconnectTimer = window.setTimeout(connect, 5000)
      }
    }

    connect()

    return () => {
      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer)
      }
      eventSource?.close()
    }
  }, [isAuthenticated, notifyNewOrders])

  const value = useMemo(
    () => ({
      enabled,
      toasts,
      browserPermission,
      showBrowserPrompt,
      toggleEnabled,
      dismissToast,
      dismissAllToasts,
      notifyNewOrders,
      markOrdersSeen,
      requestBrowserPermission,
      dismissBrowserPrompt
    }),
    [
      enabled,
      toasts,
      browserPermission,
      showBrowserPrompt,
      toggleEnabled,
      dismissToast,
      dismissAllToasts,
      notifyNewOrders,
      markOrdersSeen,
      requestBrowserPermission,
      dismissBrowserPrompt
    ]
  )

  return (
    <OrderNotificationsContext.Provider value={value}>
      {children}
    </OrderNotificationsContext.Provider>
  )
}

export function useOrderNotifications() {
  const context = useContext(OrderNotificationsContext)
  if (!context) {
    throw new Error('useOrderNotifications must be used within OrderNotificationsProvider')
  }
  return context
}

export { formatOrderNotificationBody, formatOrderNotificationTitle }
