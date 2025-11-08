import React, { useState } from 'react'
import { LogOut, Package, FileText, Sparkles } from 'lucide-react'
import Dashboard from './Dashboard'
import ProductManagement from './ProductManagement'
import AIAssistant from './AIAssistant'
import Logo from './Logo'

const MainDashboard = ({ onLogout }) => {
  const [activeTab, setActiveTab] = useState('orders')
  
  // Persist AI Assistant state across tab switches
  const [aiAssistantState, setAIAssistantState] = useState({
    orders: [],
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
        content: 'Hi! I can help you analyze your orders. Try asking me things like:',
        suggestions: [
          'Find all delayed orders from Oct 1 to Oct 31',
          'What\'s the revenue for October?',
          'Show me pending orders',
          'How many orders were delivered this week?',
          'What\'s the total revenue for November 2025?'
        ]
      }
    ]
  })

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
            
            <button
              onClick={onLogout}
              className="flex items-center px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              <LogOut className="w-4 h-4 mr-2" />
              Logout
            </button>
          </div>
        </div>
      </header>

      {/* Navigation Tabs */}
      <div className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="flex space-x-8">
            <button
              onClick={() => setActiveTab('orders')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'orders'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <div className="flex items-center">
                <FileText className="w-5 h-5 mr-2" />
                Order Management
              </div>
            </button>
            
            <button
              onClick={() => setActiveTab('products')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'products'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <div className="flex items-center">
                <Package className="w-5 h-5 mr-2" />
                Product Management
              </div>
            </button>
            
            <button
              onClick={() => setActiveTab('ai-assistant')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'ai-assistant'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <div className="flex items-center">
                <Sparkles className="w-5 h-5 mr-2" />
                AI Assistant
              </div>
            </button>
          </nav>
        </div>
      </div>

      {/* Tab Content */}
      <main className="max-w-7xl mx-auto">
        {activeTab === 'orders' && <Dashboard onSwitchToAI={() => setActiveTab('ai-assistant')} />}
        {activeTab === 'products' && <ProductManagement />}
        {activeTab === 'ai-assistant' && (
          <AIAssistant 
            persistedState={aiAssistantState}
            onStateChange={setAIAssistantState}
          />
        )}
      </main>
    </div>
  )
}

export default MainDashboard
