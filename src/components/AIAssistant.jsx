import React, { useState, useEffect } from 'react'
import CommandInterface from './CommandInterface'

const AIAssistant = () => {
  const [orders, setOrders] = useState([])
  const [dateRange, setDateRange] = useState(() => {
    const today = new Date()
    const todayString = today.getFullYear() + '-' + 
                       String(today.getMonth() + 1).padStart(2, '0') + '-' + 
                       String(today.getDate()).padStart(2, '0')
    return {
      startDate: todayString,
      endDate: todayString
    }
  })

  const fetchOrders = async () => {
    try {
      const timestamp = Date.now()
      const randomId = Math.random().toString(36).substring(7)
      const apiUrl = `/api/orders?startDate=${dateRange.startDate}&endDate=${dateRange.endDate}&t=${timestamp}&r=${randomId}`
      
      const response = await fetch(apiUrl)
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }
      
      const data = await response.json()
      if (data.data && Array.isArray(data.data)) {
        setOrders(data.data)
      } else {
        setOrders([])
      }
    } catch (error) {
      console.error('Error fetching orders:', error)
      setOrders([])
    }
  }

  useEffect(() => {
    const debounceTimer = setTimeout(() => {
      fetchOrders()
    }, 500)
    
    return () => clearTimeout(debounceTimer)
  }, [dateRange])

  return (
    <div className="bg-gray-50 min-h-screen">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900">AI Order Assistant</h1>
          <p className="text-gray-600 mt-2">Ask questions about your orders in natural language</p>
        </div>
        
        <CommandInterface 
          orders={orders}
          onDateRangeChange={setDateRange}
          onFetchOrders={fetchOrders}
        />
        
        {/* Info Section */}
        <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h3 className="text-sm font-medium text-blue-800 mb-2">💡 Tips:</h3>
          <ul className="text-sm text-blue-700 space-y-1">
            <li>• Ask about specific months: "What's the revenue for October?"</li>
            <li>• Find specific order types: "Show me all delayed orders"</li>
            <li>• Query date ranges: "Find pending orders from Oct 1 to Oct 31"</li>
            <li>• Get statistics: "What's the average order value this month?"</li>
            <li>• Use natural language: "How many orders were delivered this week?"</li>
          </ul>
        </div>
      </div>
    </div>
  )
}

export default AIAssistant

