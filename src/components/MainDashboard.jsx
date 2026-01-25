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
  
  // Debug logging for tab switches
  useEffect(() => {
    console.log('📑 MainDashboard - Tab changed to:', activeTab)
    console.log('📑 MainDashboard - AI State:', {
      messagesCount: aiAssistantState.messages.length,
      ordersCount: aiAssistantState.orders.length,
      dateRange: aiAssistantState.dateRange
    })
  }, [activeTab, aiAssistantState])



  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <Logo />
              <h1 className="ml-4 text-xl font-semibold text-gray-900">
                Bevvi Order Tracking System
              </h1>
            </div>

            <div className="flex items-center space-x-2">
              <button
                onClick={onLogout}
                className="hidden md:flex items-center px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                <LogOut className="w-4 h-4 mr-2" />
                Logout
              </button>
              <button
                onClick={() => setIsMobileMenuOpen(prev => !prev)}
                className="md:hidden inline-flex items-center justify-center p-2 rounded-md text-gray-600 hover:text-gray-900 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                aria-label="Toggle navigation menu"
              >
                {isMobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>
            </div>
          </div>
        </div>
      </header>

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
                      ? 'border-blue-500 text-blue-600'
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
          {isMobileMenuOpen && (
            <div className="md:hidden py-2 flex justify-end">
              <div className="w-64">
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
                          ? 'bg-blue-50 text-blue-700'
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
                <div className="border-t border-gray-200 mt-2 pt-2">
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
        </div>
      </div>

      {/* Tab Content */}
      <main className="max-w-7xl mx-auto">
        {activeTab === 'orders' && <Dashboard onSwitchToAI={() => setActiveTab('ai-assistant')} />}
        {activeTab === 'products' && <ProductManagement />}
        {activeTab === 'retailers' && <RetailerManagement />}
        {/* Always render AIAssistant to preserve state, just hide it */}
        <div style={{ display: activeTab === 'ai-assistant' ? 'block' : 'none' }}>
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
