import React, { useState, useEffect } from 'react'
import { LogOut, Package, FileText, Sparkles, Store, Menu, X } from 'lucide-react'
import Dashboard from './Dashboard'
import ProductManagement from './ProductManagement'
import RetailerManagement from './RetailerManagement'
import AIAssistant from './AIAssistant'
import Logo from './Logo'

const MainDashboard = ({ onLogout }) => {
  const [activeTab, setActiveTab] = useState('orders')
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  
  const tabs = [
    { id: 'orders', label: 'Order Management', icon: FileText },
    { id: 'products', label: 'Product Management', icon: Package },
    { id: 'retailers', label: 'Retailers', icon: Store },
    { id: 'ai-assistant', label: 'AI Assistant', icon: Sparkles }
  ]
  
  // Persist AI Assistant state across tab switches
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
        content: 'Hi! I can help you analyze your orders by date, status, customer, and more. Try one of the suggestions below or ask me anything!'
      }
    ]
  })
  
  useEffect(() => {
    document.body.style.overflow = isMobileMenuOpen ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [isMobileMenuOpen])



  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center min-w-0 flex-1">
              <Logo />
              <h1 className="ml-3 sm:ml-4 text-base sm:text-xl font-semibold text-gray-900 truncate min-w-0">
                Bevvi Order Tracking System
              </h1>
            </div>

            <div className="flex items-center space-x-2 flex-shrink-0">
              <button
                type="button"
                onClick={onLogout}
                className="hidden md:flex items-center px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-bevvi-primary-500"
              >
                <LogOut className="w-4 h-4 mr-2" />
                Logout
              </button>
              <button
                type="button"
                onClick={() => setIsMobileMenuOpen(prev => !prev)}
                className="md:hidden inline-flex items-center justify-center p-2 rounded-md text-gray-600 hover:text-gray-900 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-bevvi-primary-500 -mr-1"
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

      {/* Mobile Drawer */}
      {isMobileMenuOpen && (
        <div className="md:hidden">
          <div
            className="fixed inset-0 bg-black/30 z-40"
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
            <div className="flex items-center justify-between px-4 py-4 border-b">
              <span className="text-base font-semibold text-gray-900">Navigation</span>
              <button
                type="button"
                onClick={() => setIsMobileMenuOpen(false)}
                className="inline-flex items-center justify-center p-2 rounded-md text-gray-600 hover:text-gray-900 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-bevvi-primary-500"
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
                      className={`w-full text-left px-3 py-2 rounded-md text-sm font-medium ${
                        activeTab === tab.id
                          ? 'bg-bevvi-primary-50 text-bevvi-primary-700'
                          : 'text-gray-700 hover:bg-gray-50'
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
            <div className="border-t px-2 py-3">
              <button
                onClick={() => {
                  setIsMobileMenuOpen(false)
                  onLogout()
                }}
                className="w-full text-left px-3 py-2 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                <span className="inline-flex items-center">
                  <LogOut className="w-4 h-4 mr-2" />
                  Logout
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="hidden md:flex space-x-8">
            {tabs.map(tab => {
              const Icon = tab.icon
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`py-4 px-1 border-b-2 font-medium text-sm ${
                    activeTab === tab.id
                      ? 'border-bevvi-primary-600 text-bevvi-primary-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  <span className="inline-flex items-center">
                    <Icon className="w-5 h-5 mr-2" />
                    {tab.label}
                  </span>
                </button>
              )
            })}
          </nav>
        </div>
      </div>

      {/* Tab content: keep all panels mounted so filters, scroll, and form state survive tab switches */}
      <main className="max-w-7xl mx-auto">
        <div className={activeTab === 'orders' ? 'block' : 'hidden'} aria-hidden={activeTab !== 'orders'}>
          <Dashboard onSwitchToAI={() => setActiveTab('ai-assistant')} />
        </div>
        <div className={activeTab === 'products' ? 'block' : 'hidden'} aria-hidden={activeTab !== 'products'}>
          <ProductManagement />
        </div>
        <div className={activeTab === 'retailers' ? 'block' : 'hidden'} aria-hidden={activeTab !== 'retailers'}>
          <RetailerManagement />
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
