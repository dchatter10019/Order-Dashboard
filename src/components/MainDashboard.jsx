import React, { useState, useEffect } from 'react'
import { LogOut, Package, FileText, Sparkles, Store, Menu, X, ClipboardCheck, ShoppingCart } from 'lucide-react'
import Dashboard from './Dashboard'
import ProductManagement from './ProductManagement'
import RetailerManagement from './RetailerManagement'
import AIAssistant from './AIAssistant'
import GoPuffOrderChecker from './GoPuffOrderChecker'
import ManualOrderAdd from './ManualOrderAdd'
import Logo from './Logo'
import { BRAND, TAB_COPY } from '../constants/brand'

const MainDashboard = ({ onLogout }) => {
  const [activeTab, setActiveTab] = useState('orders')
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)

  const tabs = [
    { id: 'orders', label: 'Orders', icon: FileText },
    { id: 'products', label: 'Products', icon: Package },
    { id: 'retailers', label: 'Retailers', icon: Store },
    { id: 'gopuff-checker', label: 'GoPuff', icon: ClipboardCheck },
    { id: 'manual-order', label: 'Manual Order', icon: ShoppingCart },
    { id: 'ai-assistant', label: 'AI Assistant', icon: Sparkles }
  ]

  const [aiAssistantState, setAIAssistantState] = useState({
    orders: [],
    lastFetchedRange: null,
    dateRange: (() => {
      const today = new Date()
      const todayString = today.getFullYear() + '-' +
                         String(today.getMonth() + 1).padStart(2, '0') + '-' +
                         String(today.getDate()).padStart(2, '0')
      return {
        startDate: todayString,
        endDate: todayString
      }
    })(),
    messages: [
      {
        type: 'assistant',
        content: 'Hi! I\'m your Bevvi AI assistant. Ask me about orders by date, status, customer, or revenue — I\'ll help you find answers fast.'
      }
    ]
  })

  useEffect(() => {
    document.body.style.overflow = isMobileMenuOpen ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [isMobileMenuOpen])

  const activeCopy = TAB_COPY[activeTab]

  return (
    <div className="bevvi-shell">
      <header className="bevvi-shell-header">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16 lg:h-[4.25rem]">
            <div className="flex items-center min-w-0 flex-1 gap-3 sm:gap-4">
              <Logo onDark />
              <div className="min-w-0 border-l border-white/15 pl-3 sm:pl-4">
                <p className="font-display text-sm sm:text-base font-semibold text-white truncate">
                  {BRAND.platformTitle}
                </p>
                <p className="hidden sm:block text-xs text-white/70 truncate">{BRAND.tagline}</p>
              </div>
            </div>

            <div className="flex items-center space-x-2 flex-shrink-0">
              <button
                type="button"
                onClick={onLogout}
                className="hidden md:inline-flex items-center px-4 py-2 text-sm font-medium text-white/90 bg-white/10 border border-white/20 rounded-lg hover:bg-white/15 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-bevvi-900 focus:ring-white/40"
              >
                <LogOut className="w-4 h-4 mr-2" />
                Log out
              </button>
              <button
                type="button"
                onClick={() => setIsMobileMenuOpen(prev => !prev)}
                className="md:hidden inline-flex items-center justify-center p-2 rounded-lg text-white/90 hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/40 -mr-1"
                aria-expanded={isMobileMenuOpen}
                aria-controls="mobile-nav-drawer"
                aria-label="Toggle navigation menu"
              >
                {isMobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>
            </div>
          </div>
        </div>
      </header>

      {isMobileMenuOpen && (
        <div className="md:hidden">
          <div
            className="fixed inset-0 bg-bevvi-950/40 z-40"
            onClick={() => setIsMobileMenuOpen(false)}
            aria-hidden="true"
          />
          <div
            id="mobile-nav-drawer"
            dir="ltr"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
            className="fixed inset-y-0 right-0 left-auto w-72 max-w-[min(18rem,85vw)] bg-white shadow-xl z-50 flex flex-col animate-drawer-slide-in-right motion-reduce:animate-none"
          >
            <div className="flex items-center justify-between px-4 py-4 border-b border-bevvi-100 bg-bevvi-50">
              <span className="font-display text-base font-semibold text-bevvi-900">Menu</span>
              <button
                type="button"
                onClick={() => setIsMobileMenuOpen(false)}
                className="inline-flex items-center justify-center p-2 rounded-lg text-bevvi-dark-600 hover:bg-bevvi-100"
                aria-label="Close navigation menu"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <nav className="px-2 py-4 space-y-1">
                {tabs.map(tab => {
                  const Icon = tab.icon
                  return (
                    <button
                      key={tab.id}
                      onClick={() => {
                        setActiveTab(tab.id)
                        setIsMobileMenuOpen(false)
                      }}
                      className={`w-full text-left px-3 py-2.5 rounded-lg text-sm font-medium ${
                        activeTab === tab.id
                          ? 'bg-bevvi-100 text-bevvi-900'
                          : 'text-bevvi-dark-700 hover:bg-bevvi-50'
                      }`}
                    >
                      <span className="inline-flex items-center">
                        <Icon className="w-4 h-4 mr-2" />
                        {tab.label}
                      </span>
                    </button>
                  )
                })}
              </nav>
            </div>
            <div className="border-t border-bevvi-100 px-2 py-3">
              <button
                onClick={() => {
                  setIsMobileMenuOpen(false)
                  onLogout()
                }}
                className="w-full text-left px-3 py-2.5 rounded-lg text-sm font-medium text-bevvi-dark-700 hover:bg-bevvi-50"
              >
                <span className="inline-flex items-center">
                  <LogOut className="w-4 h-4 mr-2" />
                  Log out
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="bevvi-nav-bar">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="hidden md:flex space-x-6 lg:space-x-8 overflow-x-auto scrollbar-hide">
            {tabs.map(tab => {
              const Icon = tab.icon
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`bevvi-nav-tab whitespace-nowrap ${
                    activeTab === tab.id ? 'bevvi-nav-tab-active' : 'bevvi-nav-tab-inactive'
                  }`}
                >
                  <span className="inline-flex items-center">
                    <Icon className="w-4 h-4 mr-2 lg:w-5 lg:h-5" />
                    {tab.label}
                  </span>
                </button>
              )
            })}
          </nav>
        </div>
      </div>

      {activeCopy?.description && (
        <div className="bevvi-context-strip">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
            <p className="text-sm text-bevvi-dark-700">
              <span className="font-semibold text-bevvi-900">{activeCopy.title} — </span>
              {activeCopy.description}
            </p>
          </div>
        </div>
      )}

      <main className="flex-1 max-w-7xl mx-auto w-full">
        <div className={activeTab === 'orders' ? 'block' : 'hidden'} aria-hidden={activeTab !== 'orders'}>
          <Dashboard onSwitchToAI={() => setActiveTab('ai-assistant')} />
        </div>
        <div className={activeTab === 'products' ? 'block' : 'hidden'} aria-hidden={activeTab !== 'products'}>
          <ProductManagement />
        </div>
        <div className={activeTab === 'retailers' ? 'block' : 'hidden'} aria-hidden={activeTab !== 'retailers'}>
          <RetailerManagement />
        </div>
        <div className={activeTab === 'gopuff-checker' ? 'block' : 'hidden'} aria-hidden={activeTab !== 'gopuff-checker'}>
          <GoPuffOrderChecker />
        </div>
        <div className={activeTab === 'manual-order' ? 'block' : 'hidden'} aria-hidden={activeTab !== 'manual-order'}>
          <ManualOrderAdd />
        </div>
        <div className={activeTab === 'ai-assistant' ? 'block' : 'hidden'} aria-hidden={activeTab !== 'ai-assistant'}>
          <AIAssistant
            persistedState={aiAssistantState}
            onStateChange={setAIAssistantState}
          />
        </div>
      </main>
    </div>
  )
}

export default MainDashboard
