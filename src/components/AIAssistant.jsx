import React, { useState, useEffect } from 'react'
import CommandInterface from './CommandInterface'

const AIAssistant = ({ persistedState, onStateChange }) => {
  const [isLoading, setIsLoading] = useState(false)
  const [hasMounted, setHasMounted] = useState(false)
  
  // Use persisted state from parent
  const orders = persistedState.orders
  const dateRange = persistedState.dateRange
  const messages = persistedState.messages
  
  // Debug logging
  useEffect(() => {
    console.log('🤖 AIAssistant - State from parent:', {
      orders: orders.length,
      messagesCount: messages.length,
      dateRange,
      persistedState
    })
  }, [orders, messages, dateRange, persistedState])
  
  // Update persisted state
  const setOrders = (newOrders) => {
    onStateChange(prev => ({ ...prev, orders: newOrders }))
  }
  
  const setDateRange = (newDateRange) => {
    onStateChange(prev => ({ ...prev, dateRange: newDateRange }))
  }
  
  const setMessages = (messagesOrUpdater) => {
    if (typeof messagesOrUpdater === 'function') {
      onStateChange(prev => ({ ...prev, messages: messagesOrUpdater(prev.messages) }))
    } else {
      onStateChange(prev => ({ ...prev, messages: messagesOrUpdater }))
    }
  }

  const fetchOrders = async () => {
    try {
      console.log(`🔍 AI Assistant fetching orders: ${dateRange.startDate} to ${dateRange.endDate}`)
      setIsLoading(true)
      
      const timestamp = Date.now()
      const randomId = Math.random().toString(36).substring(7)
      const apiUrl = `/api/orders?startDate=${dateRange.startDate}&endDate=${dateRange.endDate}&t=${timestamp}&r=${randomId}`
      
      const response = await fetch(apiUrl)
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }
      
      const data = await response.json()
      console.log(`✅ AI Assistant received ${data.data?.length || 0} orders`)
      
      if (data.data && Array.isArray(data.data)) {
        setOrders(data.data)
      } else {
        setOrders([])
      }
    } catch (error) {
      console.error('Error fetching orders:', error)
      setOrders([])
    } finally {
      setIsLoading(false)
    }
  }

  // Handle initial mount - only fetch if no orders exist
  useEffect(() => {
    if (orders.length === 0) {
      console.log('🔄 AIAssistant initial mount - no orders, fetching...')
      fetchOrders()
    } else {
      console.log('✅ AIAssistant initial mount - using existing', orders.length, 'orders')
    }
    setHasMounted(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Handle date range changes AFTER initial mount
  useEffect(() => {
    if (hasMounted) {
      console.log('📅 Date range changed after mount, fetching new orders')
      const debounceTimer = setTimeout(() => {
        fetchOrders()
      }, 500)
      return () => clearTimeout(debounceTimer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateRange, hasMounted])

  return (
    <div className="bg-gray-50 min-h-screen">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900">AI Order Assistant</h1>
          <p className="text-gray-600 mt-2">Ask questions about your orders in natural language</p>
          
          {/* Current Data Context */}
          <div className="mt-4 bg-white border border-gray-200 rounded-lg p-3 flex items-center justify-between">
            <div className="text-sm">
              <span className="text-gray-600">Currently loaded: </span>
              <span className="font-semibold text-gray-900">{orders.length.toLocaleString()} orders</span>
              <span className="text-gray-600 ml-2">from</span>
              <span className="font-semibold text-blue-600 ml-1">{dateRange.startDate}</span>
              <span className="text-gray-600 mx-1">to</span>
              <span className="font-semibold text-blue-600">{dateRange.endDate}</span>
            </div>
            {isLoading && (
              <div className="flex items-center text-blue-600 text-sm">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mr-2"></div>
                Loading...
              </div>
            )}
          </div>
        </div>
        
        <CommandInterface 
          orders={orders}
          onDateRangeChange={setDateRange}
          onFetchOrders={fetchOrders}
          isLoadingData={isLoading}
          messages={messages}
          setMessages={setMessages}
        />
      </div>
    </div>
  )
}

export default AIAssistant

