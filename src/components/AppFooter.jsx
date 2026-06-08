import React from 'react'
import pkg from '../../package.json'
import { BRAND } from '../constants/brand'
import { useOrdersFooter } from '../context/OrdersFooterContext'
import { formatDollarAmount, formatNumber } from '../utils/formatCurrency'

const formatRefreshTime = (date) =>
  date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })

const AppFooter = () => {
  const { ordersStatus } = useOrdersFooter()

  return (
    <footer className="bevvi-app-footer" role="contentinfo">
      <div className="h-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-3 text-xs sm:text-sm whitespace-nowrap overflow-x-auto">
        {ordersStatus ? (
          <>
            <div className="flex items-center gap-x-3 sm:gap-x-5 min-w-0">
              <div className="flex items-center gap-2 shrink-0">
                <div
                  className={`w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full ${
                    ordersStatus.autoRefresh ? 'bg-green-400 animate-pulse' : 'bg-gray-400'
                  }`}
                />
                <span className="text-white/80">
                  Auto-refresh: {ordersStatus.autoRefresh ? 'Active (20 min)' : 'Inactive'}
                </span>
              </div>
              {ordersStatus.isLoading ? (
                <span className="text-yellow-300 shrink-0">Fetching data…</span>
              ) : (
                <>
                  {ordersStatus.lastRefreshTime && (
                    <span className="text-white/70 shrink-0">
                      Last refresh: {formatRefreshTime(ordersStatus.lastRefreshTime)}
                    </span>
                  )}
                  {ordersStatus.nextRefreshTime && ordersStatus.autoRefresh && (
                    <span className="text-white/70 shrink-0">
                      Next refresh: {formatRefreshTime(ordersStatus.nextRefreshTime)}
                    </span>
                  )}
                  <span className="text-white/70 shrink-0">
                    Orders: {formatNumber(ordersStatus.orderCount)} | Total:{' '}
                    {formatDollarAmount(ordersStatus.orderTotal)}
                  </span>
                </>
              )}
            </div>
            <p className="text-white/70 shrink-0">
              {BRAND.copyright} · v{pkg.version}
            </p>
          </>
        ) : (
          <p className="text-white/70 shrink-0 ml-auto">
            {BRAND.copyright} · v{pkg.version}
          </p>
        )}
      </div>
    </footer>
  )
}

export default AppFooter
