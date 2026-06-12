import React from 'react'
import pkg from '../../package.json'
import { BRAND } from '../constants/brand'
import { useOrdersFooter } from '../context/OrdersFooterContext'
import { formatDollarAmount, formatNumber } from '../utils/formatCurrency'

const formatRefreshTime = (date) =>
  date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })

const AppFooter = () => {
  const { ordersStatus } = useOrdersFooter()

  const copyrightLine = (
    <>
      {BRAND.copyright} · v{pkg.version}
    </>
  )

  return (
    <footer className="bevvi-app-footer" role="contentinfo">
      <div className="bevvi-app-footer-inner max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {ordersStatus ? (
          <div className="bevvi-app-footer-status">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 sm:gap-x-3">
              <div className="flex items-center gap-1.5 shrink-0">
                <div
                  className={`h-1.5 w-1.5 sm:h-2 sm:w-2 rounded-full ${
                    ordersStatus.autoRefresh ? 'bg-green-400 animate-pulse' : 'bg-gray-400'
                  }`}
                  aria-hidden="true"
                />
                <span className="text-white/90 font-medium">
                  <span className="sm:hidden">
                    {ordersStatus.autoRefresh ? 'Auto-refresh on' : 'Auto-refresh off'}
                  </span>
                  <span className="hidden sm:inline">
                    Auto-refresh: {ordersStatus.autoRefresh ? 'Active (20 min)' : 'Inactive'}
                  </span>
                </span>
              </div>

              {ordersStatus.isLoading ? (
                <span className="text-yellow-300">Fetching…</span>
              ) : (
                <>
                  {ordersStatus.lastRefreshTime && (
                    <span className="text-white/70">
                      <span className="sm:hidden">Last {formatRefreshTime(ordersStatus.lastRefreshTime)}</span>
                      <span className="hidden sm:inline">
                        Last refresh: {formatRefreshTime(ordersStatus.lastRefreshTime)}
                      </span>
                    </span>
                  )}
                  {ordersStatus.nextRefreshTime && ordersStatus.autoRefresh && (
                    <span className="hidden text-white/70 md:inline">
                      Next refresh: {formatRefreshTime(ordersStatus.nextRefreshTime)}
                    </span>
                  )}
                  <span className="text-white/70">
                    {formatNumber(ordersStatus.orderCount)} orders ·{' '}
                    {formatDollarAmount(ordersStatus.orderTotal)}
                  </span>
                </>
              )}
            </div>

            <p className="bevvi-app-footer-meta text-white/60">{copyrightLine}</p>
          </div>
        ) : (
          <p className="bevvi-app-footer-meta text-white/70 ml-auto">{copyrightLine}</p>
        )}
      </div>
    </footer>
  )
}

export default AppFooter
