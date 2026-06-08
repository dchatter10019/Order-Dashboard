import React, { createContext, useContext, useMemo, useState } from 'react'

const OrdersFooterContext = createContext(null)

export function OrdersFooterProvider({ children }) {
  const [ordersStatus, setOrdersStatus] = useState(null)

  const value = useMemo(
    () => ({ ordersStatus, setOrdersStatus }),
    [ordersStatus]
  )

  return (
    <OrdersFooterContext.Provider value={value}>
      {children}
    </OrdersFooterContext.Provider>
  )
}

export function useOrdersFooter() {
  const context = useContext(OrdersFooterContext)
  if (!context) {
    throw new Error('useOrdersFooter must be used within OrdersFooterProvider')
  }
  return context
}
