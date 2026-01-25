import React, { useState, useEffect } from 'react'
import CommandInterface from './CommandInterface'

const AIAssistant = ({ persistedState, onStateChange }) => {
  const [isLoading, setIsLoading] = useState(false)
  const [hasMounted, setHasMounted] = useState(false)
  
  // Use persisted state from parent
  const orders = persistedState.orders
  const dateRange = persistedState.dateRange
  const messages = persistedState.messages
  const lastFetchedRange = persistedState.lastFetchedRange
  
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
    console.log('📦 AIAssistant - setOrders called with', Array.isArray(newOrders) ? newOrders.length : 'N/A', 'orders')
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
  
  const setLastFetchedRange = (newRange) => {
    onStateChange(prev => ({ ...prev, lastFetchedRange: newRange }))
  }

  const fetchOrders = async (useStateEnrichment = false) => {
    const requestedRange = { ...dateRange }
    try {
      console.log(`🔍 AI Assistant fetching orders${useStateEnrichment ? ' WITH STATE DATA' : ''}: ${requestedRange.startDate} to ${requestedRange.endDate}`)
      setIsLoading(true)
      // Clear existing orders so we don't process with stale data
      setOrders([])
      setLastFetchedRange(null)
      
      const timestamp = Date.now()
      const randomId = Math.random().toString(36).substring(7)
      
      // Use state-enriched endpoint only when explicitly requested
      const endpoint = useStateEnrichment ? '/api/orders-with-state' : '/api/orders'
      const apiUrl = `${endpoint}?startDate=${requestedRange.startDate}&endDate=${requestedRange.endDate}&t=${timestamp}&r=${randomId}`
      
      const response = await fetch(apiUrl)
      const data = await response.json()
      
      // Check for API error responses (even if status is 200)
      if (!response.ok || (data.error && !data.success)) {
        const errorMessage = data.message || data.error || `HTTP error! status: ${response.status}`
        console.error('❌ API Error:', errorMessage)
        
        // Set empty orders and show error message
        setOrders([])
        setLastFetchedRange(null)
        
        // Add error message to chat if there are messages
        if (setMessages) {
          setMessages(prev => {
            const filtered = prev.filter(m => !m.loading)
            return [...filtered, {
              type: 'assistant',
              content: `❌ ${errorMessage}${data.dateRange ? `\n\nRequested date range: ${data.dateRange.startDate} to ${data.dateRange.endDate}` : ''}${data.today ? `\n\nToday's date: ${data.today}` : ''}${data.maxFuture ? `\n\nMaximum allowed future date: ${data.maxFuture}` : ''}`
            }]
          })
        }
        
        setIsLoading(false)
        return
      }
      
      console.log(`✅ AI Assistant received ${data.data?.length || 0} orders${useStateEnrichment ? ' (state-enriched)' : ''}`)
      console.log(`📅 Date range for fetched orders: ${requestedRange.startDate} to ${requestedRange.endDate}`)
      
      if (data.data && Array.isArray(data.data)) {
        // Log sample of order dates to verify they're in the right range
        if (data.data.length > 0) {
          const sampleDates = data.data.slice(0, 5).map(o => o.orderDate)
          console.log(`📊 Sample order dates from API:`, sampleDates)
          const ordersInRange = data.data.filter(o => {
            const orderDate = o.orderDate
            return orderDate >= dateRange.startDate && orderDate <= dateRange.endDate
          })
          console.log(`✅ ${ordersInRange.length} orders are in the requested date range (${dateRange.startDate} to ${dateRange.endDate})`)
        }
        setOrders(data.data)
        setLastFetchedRange(requestedRange)
      } else {
        console.log('⚠️ No orders data received from API')
        setOrders([])
        setLastFetchedRange(null)
      }
    } catch (error) {
      console.error('Error fetching orders:', error)
      setOrders([])
      setLastFetchedRange(null)
      
      // Show error message in chat
      if (setMessages) {
        setMessages(prev => {
          const filtered = prev.filter(m => !m.loading)
          return [...filtered, {
            type: 'assistant',
            content: `❌ Error fetching orders: ${error.message}. Please try again or check if the date range is valid.`
          }]
        })
      }
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
    if (hasMounted && dateRange && dateRange.startDate && dateRange.endDate) {
      console.log('📅 Date range changed after mount, fetching new orders:', dateRange.startDate, 'to', dateRange.endDate)
      const debounceTimer = setTimeout(() => {
        console.log('🚀 Executing fetchOrders for date range:', dateRange.startDate, 'to', dateRange.endDate)
        fetchOrders()
      }, 500)
      return () => clearTimeout(debounceTimer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateRange, hasMounted])

  return (
    <div className="bg-gray-50 min-h-screen">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
        {/* Gradient Header Banner */}
        <div className="mb-3 bg-gradient-to-r from-blue-600 to-purple-600 rounded-t-xl p-3 shadow-lg">
          <div className="flex items-center">
            <div className="mr-3">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
              </svg>
            </div>
            <div>
              <h1 className="text-lg font-bold text-white">AI Order Assistant</h1>
              <p className="text-blue-100 text-xs">Ask me anything about your orders in natural language</p>
            </div>
          </div>
        </div>
        
        <CommandInterface 
          orders={orders}
          dateRange={dateRange}
          onDateRangeChange={setDateRange}
          onFetchOrders={fetchOrders}
          isLoadingData={isLoading}
          lastFetchedRange={lastFetchedRange}
          messages={messages}
          setMessages={setMessages}
        />
      </div>
    </div>
  )
}

export default AIAssistant

