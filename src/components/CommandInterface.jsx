import React, { useState, useRef, useEffect } from 'react'
import { Send, Sparkles, TrendingUp, Calendar, DollarSign, Package } from 'lucide-react'
import { formatDollarAmount, formatNumber } from '../utils/formatCurrency'

const CommandInterface = ({ 
  orders, 
  onFilterChange, 
  onDateRangeChange, 
  onFetchOrders, 
  isLoadingData,
  messages: providedMessages,
  setMessages: providedSetMessages
}) => {
  const [input, setInput] = useState('')
  const messagesEndRef = useRef(null)
  const pendingCommandRef = useRef(null)
  const loadingTimeoutRef = useRef(null)
  
  // Default messages if none provided
  const defaultMessages = [
    {
      type: 'assistant',
      content: 'Hi! I can help you analyze your orders. Try one of the suggestions below or ask me anything!'
    }
  ]
  
  // Use provided messages/setMessages or create local state
  const [localMessages, setLocalMessages] = useState(defaultMessages)
  const messages = providedMessages !== undefined ? providedMessages : localMessages
  const setMessages = providedSetMessages || setLocalMessages

  // Debug logging
  useEffect(() => {
    console.log('💬 CommandInterface - Messages State:', {
      providedMessages: providedMessages?.length,
      localMessages: localMessages.length,
      activeMessages: messages.length,
      hasProvidedSetMessages: !!providedSetMessages
    })
  }, [messages, providedMessages, localMessages, providedSetMessages])

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  // Parse natural language date expressions
  const parseDate = (text) => {
    const lower = text.toLowerCase()
    const now = new Date()
    
    // Month names
    const months = {
      january: 0, jan: 0,
      february: 1, feb: 1,
      march: 2, mar: 2,
      april: 3, apr: 3,
      may: 4,
      june: 5, jun: 5,
      july: 6, jul: 6,
      august: 7, aug: 7,
      september: 8, sep: 8, sept: 8,
      october: 9, oct: 9,
      november: 10, nov: 10,
      december: 11, dec: 11
    }
    
    // Check for specific month with optional year
    for (const [monthName, monthNum] of Object.entries(months)) {
      if (lower.includes(monthName)) {
        // Try to extract year (e.g., "Nov 2025", "October 2024")
        const yearMatch = text.match(/\b(20\d{2})\b/)
        const year = yearMatch ? parseInt(yearMatch[1]) : now.getFullYear()
        
        const startDate = new Date(year, monthNum, 1)
        let endDate = new Date(year, monthNum + 1, 0) // Last day of month
        
        // If end date is in the future, use today instead (MTD - Month To Date)
        const today = new Date()
        today.setHours(23, 59, 59, 999) // End of today
        
        if (endDate > today) {
          endDate = today
          console.log(`📅 Future date detected, using MTD: ${monthName} ${year} -> ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]} (Month-to-Date)`)
        } else {
          console.log(`📅 Parsed date: ${monthName} ${year} -> ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`)
        }
        
        return {
          startDate: startDate.toISOString().split('T')[0],
          endDate: endDate.toISOString().split('T')[0],
          isMTD: endDate.getTime() === today.getTime()
        }
      }
    }
    
    // This week
    if (lower.includes('this week')) {
      const startOfWeek = new Date(now)
      startOfWeek.setDate(now.getDate() - now.getDay())
      const endOfWeek = new Date(now)
      endOfWeek.setDate(now.getDate() - now.getDay() + 6)
      
      return {
        startDate: startOfWeek.toISOString().split('T')[0],
        endDate: endOfWeek.toISOString().split('T')[0]
      }
    }
    
    // This month
    if (lower.includes('this month')) {
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0)
      
      return {
        startDate: startOfMonth.toISOString().split('T')[0],
        endDate: endOfMonth.toISOString().split('T')[0]
      }
    }
    
    // Today
    if (lower.includes('today')) {
      const today = now.toISOString().split('T')[0]
      return {
        startDate: today,
        endDate: today
      }
    }
    
    // Try to extract specific dates (Oct 1 to Oct 31, 10/1 to 10/31, etc.)
    const dateRangeMatch = lower.match(/(\w+)\s+(\d+)\s+to\s+(\w+)\s+(\d+)/)
    if (dateRangeMatch) {
      const [, month1, day1, month2, day2] = dateRangeMatch
      const monthNum1 = months[month1]
      const monthNum2 = months[month2]
      
      if (monthNum1 !== undefined && monthNum2 !== undefined) {
        const year = now.getFullYear()
        const startDate = new Date(year, monthNum1, parseInt(day1))
        const endDate = new Date(year, monthNum2, parseInt(day2))
        
        return {
          startDate: startDate.toISOString().split('T')[0],
          endDate: endDate.toISOString().split('T')[0]
        }
      }
    }
    
    return null
  }

  // Process user command
  const processCommand = (command) => {
    const lower = command.toLowerCase()
    
    // Parse date range if present
    const dateRange = parseDate(command)
    
    // Filter orders by date range if specified
    let relevantOrders = orders
    if (dateRange) {
      relevantOrders = orders.filter(order => {
        return order.orderDate >= dateRange.startDate && order.orderDate <= dateRange.endDate
      })
    }
    
    // Determine what the user is asking for
    let response = {
      type: 'assistant',
      content: '',
      data: null
    }
    
    // Delayed orders
    if (lower.includes('delayed')) {
      const delayedOrders = relevantOrders.filter(order => 
        order.deliveryStatus?.toLowerCase() === 'delayed'
      )
      
      const mtdSuffix = dateRange?.isMTD ? ' (Month-to-Date)' : ''
      response.content = dateRange 
        ? `Found ${formatNumber(delayedOrders.length)} delayed orders from ${dateRange.startDate} to ${dateRange.endDate}${mtdSuffix}`
        : `Found ${formatNumber(delayedOrders.length)} delayed orders`
      
      response.data = {
        type: 'orders',
        orders: delayedOrders.slice(0, 10),
        total: delayedOrders.length
      }
      
      if (delayedOrders.length > 0 && onFilterChange) {
        // Apply filters to show delayed orders
        const dateRangeObj = dateRange || { 
          startDate: orders[0]?.orderDate || '', 
          endDate: orders[orders.length - 1]?.orderDate || '' 
        }
        setTimeout(() => {
          onDateRangeChange(dateRangeObj)
        }, 100)
      }
    }
    // Revenue query
    else if (lower.includes('revenue')) {
      const acceptedOrders = relevantOrders.filter(order => 
        !['pending', 'cancelled', 'rejected'].includes(order.status?.toLowerCase())
      )
      const totalRevenue = acceptedOrders.reduce((sum, order) => 
        sum + (parseFloat(order.revenue) || 0), 0
      )
      
      if (relevantOrders.length === 0) {
        response.content = dateRange
          ? `No orders found for ${dateRange.startDate} to ${dateRange.endDate}. The date range might not have any orders, or they haven't been loaded yet.`
          : 'No orders currently loaded. Try specifying a date range.'
      } else {
        const mtdSuffix = dateRange?.isMTD ? ' (Month-to-Date)' : ''
        response.content = dateRange
          ? `Revenue for ${dateRange.startDate} to ${dateRange.endDate}${mtdSuffix}: ${formatDollarAmount(totalRevenue)} from ${formatNumber(acceptedOrders.length)} accepted orders (out of ${formatNumber(relevantOrders.length)} total orders)`
          : `Total revenue: ${formatDollarAmount(totalRevenue)} from ${formatNumber(acceptedOrders.length)} accepted orders`
      }
      
      response.data = acceptedOrders.length > 0 ? {
        type: 'revenue',
        revenue: totalRevenue,
        orderCount: acceptedOrders.length,
        averageOrderValue: acceptedOrders.length > 0 ? totalRevenue / acceptedOrders.length : 0
      } : null
    }
    // Pending orders
    else if (lower.includes('pending')) {
      const pendingOrders = relevantOrders.filter(order => 
        order.status?.toLowerCase() === 'pending'
      )
      
      response.content = `Found ${formatNumber(pendingOrders.length)} pending orders`
      response.data = {
        type: 'orders',
        orders: pendingOrders.slice(0, 10),
        total: pendingOrders.length
      }
    }
    // Delivered orders
    else if (lower.includes('delivered')) {
      const deliveredOrders = relevantOrders.filter(order => 
        order.status?.toLowerCase() === 'delivered'
      )
      
      const mtdSuffix = dateRange?.isMTD ? ' (Month-to-Date)' : ''
      response.content = dateRange
        ? `${formatNumber(deliveredOrders.length)} orders were delivered from ${dateRange.startDate} to ${dateRange.endDate}${mtdSuffix}`
        : `${formatNumber(deliveredOrders.length)} orders have been delivered`
      
      response.data = {
        type: 'orders',
        orders: deliveredOrders.slice(0, 10),
        total: deliveredOrders.length
      }
    }
    // Total orders
    else if (lower.includes('how many orders') || lower.includes('total orders')) {
      const mtdSuffix = dateRange?.isMTD ? ' (Month-to-Date)' : ''
      response.content = dateRange
        ? `There are ${formatNumber(relevantOrders.length)} orders from ${dateRange.startDate} to ${dateRange.endDate}${mtdSuffix}`
        : `There are ${formatNumber(relevantOrders.length)} total orders`
      
      response.data = {
        type: 'count',
        count: relevantOrders.length
      }
    }
    // Average order value
    else if (lower.includes('average') || lower.includes('aov')) {
      const acceptedOrders = relevantOrders.filter(order => 
        !['pending', 'cancelled', 'rejected'].includes(order.status?.toLowerCase())
      )
      const totalRevenue = acceptedOrders.reduce((sum, order) => 
        sum + (parseFloat(order.revenue) || 0), 0
      )
      const avgOrderValue = acceptedOrders.length > 0 ? totalRevenue / acceptedOrders.length : 0
      
      const mtdSuffix = dateRange?.isMTD ? ' (Month-to-Date)' : ''
      const periodText = dateRange ? ` for ${dateRange.startDate} to ${dateRange.endDate}${mtdSuffix}` : ''
      response.content = `Average order value${periodText}: ${formatDollarAmount(avgOrderValue)} (from ${formatNumber(acceptedOrders.length)} orders)`
      response.data = {
        type: 'aov',
        average: avgOrderValue,
        orderCount: acceptedOrders.length
      }
    }
    else {
      response.content = "I'm not sure what you're asking. Try questions like:\n• Find delayed orders from Oct 1 to Oct 31\n• What's the revenue for October?\n• Show me pending orders\n• How many orders were delivered this week?"
    }
    
    return response
  }

  // Watch for orders change after date range update
  useEffect(() => {
    console.log('🔍 Orders or loading status changed:', {
      hasPendingCommand: !!pendingCommandRef.current,
      isLoadingData,
      ordersCount: orders.length,
      pendingCommand: pendingCommandRef.current
    })
    
    if (pendingCommandRef.current && !isLoadingData) {
      console.log('🤖 Processing pending command with loaded data:', orders.length, 'orders')
      
      // Clear any existing timeout
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current)
        loadingTimeoutRef.current = null
      }
      
      // Wait a bit to ensure orders state is fully updated
      setTimeout(() => {
        if (pendingCommandRef.current) {
          const response = processCommand(pendingCommandRef.current)
          console.log('📊 Generated response:', response)
          setMessages(prev => {
            // Remove any loading messages first
            const filtered = prev.filter(m => !m.loading)
            return [...filtered, response]
          })
          pendingCommandRef.current = null
        }
      }, 500) // Increased to 500ms to ensure orders state is updated
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, isLoadingData])
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current)
      }
    }
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!input.trim() || isLoadingData) return
    
    // Add user message
    const userMessage = {
      type: 'user',
      content: input
    }
    setMessages(prev => [...prev, userMessage])
    
    // Check if we need to fetch data for a different date range
    const dateRange = parseDate(input)
    
    if (dateRange && onDateRangeChange && onFetchOrders) {
      console.log('🔍 Date range detected, fetching data:', dateRange)
      // Show loading message
      const loadingMessage = {
        type: 'assistant',
        content: dateRange.isMTD 
          ? `📊 Fetching orders for ${dateRange.startDate} to ${dateRange.endDate} (Month-to-Date)...`
          : `📊 Fetching orders for ${dateRange.startDate} to ${dateRange.endDate}...`,
        loading: true
      }
      setMessages(prev => [...prev, loadingMessage])
      
      // Save the command to process after data loads
      pendingCommandRef.current = input
      
      // Update date range (this will trigger fetchOrders via useEffect)
      onDateRangeChange(dateRange)
      
      // Set a timeout in case data never loads
      loadingTimeoutRef.current = setTimeout(() => {
        if (pendingCommandRef.current) {
          console.log('⏰ Loading timeout reached, processing with available data')
          const response = processCommand(pendingCommandRef.current)
          setMessages(prev => {
            const filtered = prev.filter(m => !m.loading)
            return [...filtered, response]
          })
          pendingCommandRef.current = null
        }
      }, 10000) // 10 second timeout
    } else {
      // Process command immediately with current data
      console.log('🤖 Processing command with current data:', orders.length, 'orders')
      const response = processCommand(input)
      setMessages(prev => [...prev, response])
    }
    
    setInput('')
  }

  const handleSuggestionClick = (suggestion) => {
    setInput(suggestion)
  }

  return (
    <div className="flex flex-col h-[calc(100vh-12rem)] bg-white rounded-xl shadow-2xl overflow-hidden border border-gray-200">
      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-gray-50">
        {/* Centered Greeting for Empty State */}
        {messages.length <= 1 && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <h2 className="text-3xl font-medium text-gray-900 mb-2">
                Hey there. Ready to dive in?
              </h2>
              <p className="text-gray-600 text-lg">Ask me anything about your orders</p>
            </div>
          </div>
        )}
        
        {messages.length > 1 && messages.map((message, index) => (
          <div key={index} className={`flex ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-2xl p-4 ${
              message.type === 'user' 
                ? 'bg-blue-600 text-white shadow-lg' 
                : 'bg-white border border-gray-200 shadow-lg text-gray-900'
            }`}>
              <p className="text-sm whitespace-pre-line leading-relaxed">{message.content}</p>
              
              {/* Data Display */}
              {message.data && message.data.type === 'revenue' && (
                <div className="mt-3 bg-green-50 rounded-lg p-3 border border-green-200">
                  <div className="flex items-center mb-2">
                    <DollarSign className="h-4 w-4 text-green-600 mr-1" />
                    <span className="text-xs font-medium text-green-800">Revenue Breakdown</span>
                  </div>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Total Revenue:</span>
                      <span className="font-bold text-green-900">{formatDollarAmount(message.data.revenue)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Orders:</span>
                      <span className="font-semibold text-gray-900">{formatNumber(message.data.orderCount)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Average Order Value:</span>
                      <span className="font-semibold text-gray-900">{formatDollarAmount(message.data.averageOrderValue)}</span>
                    </div>
                  </div>
                </div>
              )}
              
              {message.data && message.data.type === 'orders' && message.data.orders.length > 0 && (
                <div className="mt-3 bg-blue-50 rounded-lg p-3 border border-blue-200">
                  <div className="flex items-center mb-2">
                    <Package className="h-4 w-4 text-blue-600 mr-1" />
                    <span className="text-xs font-medium text-blue-800">Sample Orders (showing {Math.min(10, message.data.total)})</span>
                  </div>
                  <div className="space-y-2">
                    {message.data.orders.map((order, idx) => (
                      <div key={idx} className="text-xs bg-white rounded p-2 border border-blue-100">
                        <div className="font-semibold text-gray-900">{order.ordernum || order.id}</div>
                        <div className="text-gray-600">{order.customerName} - {formatDollarAmount(order.total)}</div>
                        <div className="text-gray-500">{order.orderDate} - {order.status}</div>
                      </div>
                    ))}
                    {message.data.total > 10 && (
                      <div className="text-xs text-blue-600 text-center pt-1">
                        +{formatNumber(message.data.total - 10)} more orders
                      </div>
                    )}
                  </div>
                </div>
              )}
              
              {message.data && message.data.type === 'aov' && (
                <div className="mt-3 bg-purple-50 rounded-lg p-3 border border-purple-200">
                  <div className="flex items-center mb-2">
                    <TrendingUp className="h-4 w-4 text-purple-600 mr-1" />
                    <span className="text-xs font-medium text-purple-800">Order Statistics</span>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-purple-900">{formatDollarAmount(message.data.average)}</div>
                    <div className="text-xs text-gray-600">Based on {formatNumber(message.data.orderCount)} orders</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area - ChatGPT Style */}
      <form onSubmit={handleSubmit} className="p-6 bg-white border-t border-gray-200">
        <div className="max-w-4xl mx-auto">
          <div className="relative bg-gray-100 rounded-full border border-gray-300 shadow-lg hover:border-gray-400 transition-all duration-200">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={isLoadingData ? "Loading data..." : "Ask anything"}
              disabled={isLoadingData}
              className="w-full px-6 py-4 bg-transparent text-gray-900 placeholder-gray-500 focus:outline-none rounded-full text-base disabled:cursor-not-allowed"
            />
            <button
              type="submit"
              disabled={!input.trim() || isLoadingData}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-2.5 bg-blue-600 text-white rounded-full hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 shadow-lg"
            >
              {isLoadingData ? (
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
              ) : (
                <Send className="h-5 w-5" />
              )}
            </button>
          </div>
        </div>
        
        {/* Suggestion Prompts - Show when minimal messages (GPT-style) */}
        {messages.length <= 1 && (
          <div className="mt-4 max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setInput('Find all delayed orders from Oct 1 to Oct 31')}
              className="text-left px-4 py-3 bg-white hover:bg-gray-50 rounded-xl text-sm text-gray-700 hover:text-gray-900 transition-all duration-200 border border-gray-200 hover:border-gray-300 shadow-sm"
            >
              Find all delayed orders from Oct 1 to Oct 31
            </button>
            <button
              type="button"
              onClick={() => setInput('What\'s the revenue for October?')}
              className="text-left px-4 py-3 bg-white hover:bg-gray-50 rounded-xl text-sm text-gray-700 hover:text-gray-900 transition-all duration-200 border border-gray-200 hover:border-gray-300 shadow-sm"
            >
              What's the revenue for October?
            </button>
            <button
              type="button"
              onClick={() => setInput('Show me pending orders')}
              className="text-left px-4 py-3 bg-white hover:bg-gray-50 rounded-xl text-sm text-gray-700 hover:text-gray-900 transition-all duration-200 border border-gray-200 hover:border-gray-300 shadow-sm"
            >
              Show me pending orders
            </button>
            <button
              type="button"
              onClick={() => setInput('How many orders were delivered this week?')}
              className="text-left px-4 py-3 bg-white hover:bg-gray-50 rounded-xl text-sm text-gray-700 hover:text-gray-900 transition-all duration-200 border border-gray-200 hover:border-gray-300 shadow-sm"
            >
              How many orders were delivered this week?
            </button>
            <button
              type="button"
              onClick={() => setInput('What\'s the total revenue for November 2025?')}
              className="md:col-span-2 text-left px-4 py-3 bg-white hover:bg-gray-50 rounded-xl text-sm text-gray-700 hover:text-gray-900 transition-all duration-200 border border-gray-200 hover:border-gray-300 shadow-sm"
            >
              What's the total revenue for November 2025?
            </button>
          </div>
        )}
      </form>
    </div>
  )
}

export default CommandInterface

