import React, { useState, useRef, useEffect } from 'react'
import { Send, Sparkles, TrendingUp, Calendar, DollarSign, Package, Trash2 } from 'lucide-react'
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
  const [expandedOrders, setExpandedOrders] = useState({}) // Track which message's orders are expanded
  const messagesEndRef = useRef(null)
  const pendingCommandRef = useRef(null)
  const loadingTimeoutRef = useRef(null)
  
  // Default messages if none provided
  const defaultMessages = [
    {
      type: 'assistant',
      content: 'Hi! I can help you analyze your orders by date, status, customer, and more. Try one of the suggestions below or ask me anything!'
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
    console.log('🔄 Processing command:', command, 'with', orders.length, 'orders')
    const lower = command.toLowerCase()
    
    // Parse date range if present
    const dateRange = parseDate(command)
    console.log('📅 Date range from command:', dateRange)
    
    // Filter orders by date range if specified
    let relevantOrders = orders
    if (dateRange) {
      relevantOrders = orders.filter(order => {
        return order.orderDate >= dateRange.startDate && order.orderDate <= dateRange.endDate
      })
      console.log('📊 Filtered to', relevantOrders.length, 'orders for date range')
    } else {
      console.log('📊 Using all', orders.length, 'orders (no date filter in command)')
    }
    
    // Determine what the user is asking for
    let response = {
      type: 'assistant',
      content: '',
      data: null
    }
    
    // Delayed orders by customer
    if (lower.includes('delayed') && (lower.includes(' for ') || lower.includes(' from ') || lower.includes(' by '))) {
      // Extract customer name
      let customerName = ''
      const forMatch = text.match(/(?:delayed|delay)\s+(?:orders?\s+)?(?:for|from|by)\s+([a-zA-Z0-9\s]+?)(?:\s+for\s+|\s+from\s+|\s+in\s+|$)/i)
      
      if (forMatch && forMatch[1]) {
        customerName = forMatch[1].trim()
        // Remove common date-related words
        customerName = customerName.replace(/\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|may|june|july|august|september|october|november|december|in|during|on|this|month)\s*$/i, '').trim()
      }
      
      if (customerName) {
        // Filter by customer first, then by delayed status
        const customerOrders = relevantOrders.filter(order => 
          order.customerName?.toLowerCase().includes(customerName.toLowerCase())
        )
        
        const delayedOrders = customerOrders.filter(order => 
          order.deliveryStatus?.toLowerCase() === 'delayed'
        )
        
        if (delayedOrders.length === 0) {
          response.content = `No delayed orders found for customer "${customerName}"`
          if (dateRange) {
            response.content += ` from ${dateRange.startDate} to ${dateRange.endDate}`
          }
        } else {
          const mtdSuffix = dateRange?.isMTD ? ' (Month-to-Date)' : ''
          const dateInfo = dateRange ? ` from ${dateRange.startDate} to ${dateRange.endDate}${mtdSuffix}` : ''
          response.content = `Found ${formatNumber(delayedOrders.length)} delayed orders for ${customerName}${dateInfo}`
        }
        
        response.data = delayedOrders.length > 0 ? {
          type: 'orders',
          orders: delayedOrders,
          total: delayedOrders.length,
          customerName: customerName
        } : null
      } else {
        // Fall through to general delayed orders
        const delayedOrders = relevantOrders.filter(order => 
          order.deliveryStatus?.toLowerCase() === 'delayed'
        )
        
        const mtdSuffix = dateRange?.isMTD ? ' (Month-to-Date)' : ''
        response.content = dateRange 
          ? `Found ${formatNumber(delayedOrders.length)} delayed orders from ${dateRange.startDate} to ${dateRange.endDate}${mtdSuffix}`
          : `Found ${formatNumber(delayedOrders.length)} delayed orders`
        
        response.data = {
          type: 'orders',
          orders: delayedOrders,
          total: delayedOrders.length
        }
        
        if (delayedOrders.length > 0 && onFilterChange) {
          const dateRangeObj = dateRange || { 
            startDate: orders[0]?.orderDate || '', 
            endDate: orders[orders.length - 1]?.orderDate || '' 
          }
          setTimeout(() => {
            onDateRangeChange(dateRangeObj)
          }, 100)
        }
      }
    }
    // General delayed orders
    else if (lower.includes('delayed')) {
      const delayedOrders = relevantOrders.filter(order => 
        order.deliveryStatus?.toLowerCase() === 'delayed'
      )
      
      const mtdSuffix = dateRange?.isMTD ? ' (Month-to-Date)' : ''
      response.content = dateRange 
        ? `Found ${formatNumber(delayedOrders.length)} delayed orders from ${dateRange.startDate} to ${dateRange.endDate}${mtdSuffix}`
        : `Found ${formatNumber(delayedOrders.length)} delayed orders`
      
      response.data = {
        type: 'orders',
        orders: delayedOrders,
        total: delayedOrders.length
      }
      
      if (delayedOrders.length > 0 && onFilterChange) {
        const dateRangeObj = dateRange || { 
          startDate: orders[0]?.orderDate || '', 
          endDate: orders[orders.length - 1]?.orderDate || '' 
        }
        setTimeout(() => {
          onDateRangeChange(dateRangeObj)
        }, 100)
      }
    }
    // Revenue by customer query
    else if (lower.includes('revenue') && (lower.includes(' for ') || lower.includes(' from '))) {
      // Extract customer name - look for patterns like "revenue for CustomerName" or "revenue from CustomerName"
      let customerName = ''
      const forMatch = text.match(/(?:revenue|sales)\s+(?:for|from)\s+([a-zA-Z0-9\s]+?)(?:\s+for\s+|\s+from\s+|$)/i)
      
      if (forMatch && forMatch[1]) {
        customerName = forMatch[1].trim()
        // Remove common date-related words that might have been captured
        customerName = customerName.replace(/\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|may|june|july|august|september|october|november|december|in|during|on|20\d{2})\s*$/i, '').trim()
      }
      
      console.log('💼 Extracted customer name:', customerName)
      
      if (customerName && customerName.length >= 3 && !/^\d/.test(customerName)) {
        // Filter orders by customer name (case-insensitive partial match)
        const customerOrders = relevantOrders.filter(order => 
          order.customerName?.toLowerCase().includes(customerName.toLowerCase())
        )
        
        const acceptedOrders = customerOrders.filter(order => 
          !['pending', 'cancelled', 'rejected'].includes(order.status?.toLowerCase())
        )
        
        const totalRevenue = acceptedOrders.reduce((sum, order) => 
          sum + (parseFloat(order.revenue) || 0), 0
        )
        
        if (customerOrders.length === 0) {
          response.content = `No orders found for customer "${customerName}"`
          if (dateRange) {
            response.content += ` from ${dateRange.startDate} to ${dateRange.endDate}`
          }
        } else {
          const mtdSuffix = dateRange?.isMTD ? ' (Month-to-Date)' : ''
          const dateInfo = dateRange ? ` from ${dateRange.startDate} to ${dateRange.endDate}${mtdSuffix}` : ''
          response.content = `Revenue for ${customerName}${dateInfo}: ${formatDollarAmount(totalRevenue)} from ${formatNumber(acceptedOrders.length)} accepted orders (out of ${formatNumber(customerOrders.length)} total orders)`
        }
        
        response.data = acceptedOrders.length > 0 ? {
          type: 'revenue',
          revenue: totalRevenue,
          orderCount: acceptedOrders.length,
          averageOrderValue: acceptedOrders.length > 0 ? totalRevenue / acceptedOrders.length : 0,
          customerName: customerName
        } : null
      } else {
        // Fall through to general revenue query
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
    }
    // Revenue by month breakdown
    else if ((lower.includes('revenue') || lower.includes('sales')) && lower.includes('by month')) {
      const acceptedOrders = relevantOrders.filter(order => 
        !['pending', 'cancelled', 'rejected'].includes(order.status?.toLowerCase())
      )
      
      // Group revenue by month
      const revenueByMonth = {}
      acceptedOrders.forEach(order => {
        const orderDate = new Date(order.orderDate)
        const monthKey = `${orderDate.getFullYear()}-${String(orderDate.getMonth() + 1).padStart(2, '0')}`
        const monthName = orderDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
        
        if (!revenueByMonth[monthKey]) {
          revenueByMonth[monthKey] = { 
            revenue: 0, 
            count: 0, 
            monthName,
            sortKey: orderDate.getTime()
          }
        }
        revenueByMonth[monthKey].revenue += parseFloat(order.revenue) || 0
        revenueByMonth[monthKey].count += 1
      })
      
      // Sort by date (oldest to newest)
      const sortedMonths = Object.entries(revenueByMonth)
        .sort((a, b) => a[1].sortKey - b[1].sortKey)
        .map(([key, data]) => ({
          month: data.monthName,
          revenue: data.revenue,
          count: data.count
        }))
      
      const totalRevenue = acceptedOrders.reduce((sum, order) => sum + (parseFloat(order.revenue) || 0), 0)
      
      if (sortedMonths.length === 0) {
        response.content = 'No revenue data available for the selected period'
      } else {
        const dateInfo = dateRange ? ` for ${dateRange.startDate} to ${dateRange.endDate}` : ''
        const monthList = sortedMonths.map((data, idx) => 
          `  ${idx + 1}. ${data.month}: ${formatDollarAmount(data.revenue)} (${formatNumber(data.count)} orders)`
        ).join('\n')
        
        response.content = `Revenue breakdown by month${dateInfo}:\n\n${monthList}\n\nTotal: ${formatDollarAmount(totalRevenue)} from ${formatNumber(acceptedOrders.length)} orders`
      }
      
      response.data = sortedMonths.length > 0 ? {
        type: 'monthBreakdown',
        breakdownType: 'revenue',
        months: sortedMonths,
        total: totalRevenue,
        orderCount: acceptedOrders.length
      } : null
    }
    // General revenue query
    else if (lower.includes('revenue') || lower.includes('sales')) {
      console.log('💰 General revenue query - relevant orders:', relevantOrders.length)
      const acceptedOrders = relevantOrders.filter(order => 
        !['pending', 'cancelled', 'rejected'].includes(order.status?.toLowerCase())
      )
      console.log('💰 Accepted orders:', acceptedOrders.length)
      const totalRevenue = acceptedOrders.reduce((sum, order) => 
        sum + (parseFloat(order.revenue) || 0), 0
      )
      console.log('💰 Total revenue:', totalRevenue)
      
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
    // Sales/Revenue by state query
    else if ((lower.includes('sales') || lower.includes('revenue')) && lower.includes('by state')) {
      // Check if asking for breakdown by ALL states or a specific state
      const specificStateMatch = text.match(/(?:sales|revenue)\s+by\s+state\s+([a-zA-Z]{2,}?)(?:\s+for\s+|\s+from\s+|\s+in\s+|$)/i)
      let stateName = ''
      
      if (specificStateMatch && specificStateMatch[1]) {
        stateName = specificStateMatch[1].trim()
        // Remove common date-related words and years
        stateName = stateName.replace(/\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|may|june|july|august|september|october|november|december|this|month|20\d{2})\s*$/i, '').trim()
      }
      
      // If no specific state, show breakdown by ALL states
      if (!stateName || stateName === 'for' || stateName === 'in' || stateName.length < 2) {
        // Group revenue by state
        const acceptedOrders = relevantOrders.filter(order => 
          !['pending', 'cancelled', 'rejected'].includes(order.status?.toLowerCase())
        )
        
        const revenueByState = {}
        acceptedOrders.forEach(order => {
          const state = order.shippingState || order.billingState || 'Unknown'
          if (!revenueByState[state]) {
            revenueByState[state] = { revenue: 0, count: 0 }
          }
          revenueByState[state].revenue += parseFloat(order.revenue) || 0
          revenueByState[state].count += 1
        })
        
        // Sort by revenue amount descending
        const sortedStates = Object.entries(revenueByState)
          .sort((a, b) => b[1].revenue - a[1].revenue)
          .slice(0, 10) // Top 10 states
        
        const totalRevenue = acceptedOrders.reduce((sum, order) => sum + (parseFloat(order.revenue) || 0), 0)
        
        if (sortedStates.length === 0) {
          response.content = 'No sales data available for the selected period'
        } else {
          const mtdSuffix = dateRange?.isMTD ? ' (Month-to-Date)' : ''
          const dateInfo = dateRange ? ` for ${dateRange.startDate} to ${dateRange.endDate}${mtdSuffix}` : ''
          const stateList = sortedStates.map(([state, data]) => 
            `  • ${state}: ${formatDollarAmount(data.revenue)} (${formatNumber(data.count)} orders)`
          ).join('\n')
          
          response.content = `Sales breakdown by state${dateInfo}:\n\n${stateList}\n\nTotal: ${formatDollarAmount(totalRevenue)} from ${formatNumber(acceptedOrders.length)} orders`
        }
        
        response.data = sortedStates.length > 0 ? {
          type: 'stateBreakdown',
          breakdownType: 'revenue',
          states: sortedStates.map(([state, data]) => ({
            state,
            amount: data.revenue,
            count: data.count
          })),
          total: totalRevenue,
          orderCount: acceptedOrders.length
        } : null
      }
      // Specific state query
      else if (stateName && stateName.length >= 2 && !stateName.match(/^\d/)) {
        // Filter orders by state (check both shipping and billing state)
        const stateOrders = relevantOrders.filter(order => 
          order.shippingState?.toLowerCase().includes(stateName.toLowerCase()) ||
          order.billingState?.toLowerCase().includes(stateName.toLowerCase())
        )
        
        const acceptedOrders = stateOrders.filter(order => 
          !['pending', 'cancelled', 'rejected'].includes(order.status?.toLowerCase())
        )
        
        const totalRevenue = acceptedOrders.reduce((sum, order) => 
          sum + (parseFloat(order.revenue) || 0), 0
        )
        
        if (stateOrders.length === 0) {
          response.content = `No orders found for state "${stateName}"`
          if (dateRange) {
            response.content += ` from ${dateRange.startDate} to ${dateRange.endDate}`
          }
        } else {
          const mtdSuffix = dateRange?.isMTD ? ' (Month-to-Date)' : ''
          const dateInfo = dateRange ? ` from ${dateRange.startDate} to ${dateRange.endDate}${mtdSuffix}` : ''
          response.content = `Revenue for ${stateName}${dateInfo}: ${formatDollarAmount(totalRevenue)} from ${formatNumber(acceptedOrders.length)} accepted orders (out of ${formatNumber(stateOrders.length)} total orders)`
        }
        
        response.data = acceptedOrders.length > 0 ? {
          type: 'revenue',
          revenue: totalRevenue,
          orderCount: acceptedOrders.length,
          averageOrderValue: acceptedOrders.length > 0 ? totalRevenue / acceptedOrders.length : 0,
          stateName: stateName
        } : null
      } else {
        // Fall through to general revenue if state can't be extracted
        const acceptedOrders = relevantOrders.filter(order => 
          !['pending', 'cancelled', 'rejected'].includes(order.status?.toLowerCase())
        )
        const totalRevenue = acceptedOrders.reduce((sum, order) => 
          sum + (parseFloat(order.revenue) || 0), 0
        )
        
        if (relevantOrders.length === 0) {
          response.content = dateRange
            ? `No orders found for ${dateRange.startDate} to ${dateRange.endDate}.`
            : 'No orders currently loaded. Try specifying a date range.'
        } else {
          const mtdSuffix = dateRange?.isMTD ? ' (Month-to-Date)' : ''
          response.content = dateRange
            ? `Revenue for ${dateRange.startDate} to ${dateRange.endDate}${mtdSuffix}: ${formatDollarAmount(totalRevenue)} from ${formatNumber(acceptedOrders.length)} accepted orders`
            : `Total revenue: ${formatDollarAmount(totalRevenue)} from ${formatNumber(acceptedOrders.length)} accepted orders`
        }
        
        response.data = acceptedOrders.length > 0 ? {
          type: 'revenue',
          revenue: totalRevenue,
          orderCount: acceptedOrders.length,
          averageOrderValue: acceptedOrders.length > 0 ? totalRevenue / acceptedOrders.length : 0
        } : null
      }
    }
    // Tax by state query
    else if (lower.includes('tax') && lower.includes('by state')) {
      // Check if asking for breakdown by ALL states or a specific state
      const specificStateMatch = text.match(/tax\s+by\s+state\s+([a-zA-Z]{2,}?)(?:\s+for\s+|\s+from\s+|\s+in\s+|$)/i)
      let stateName = ''
      
      if (specificStateMatch && specificStateMatch[1]) {
        stateName = specificStateMatch[1].trim()
        // Remove common date-related words
        stateName = stateName.replace(/\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|may|june|july|august|september|october|november|december|this|month|20\d{2})\s*$/i, '').trim()
      }
      
      // If no specific state, show breakdown by ALL states
      if (!stateName || stateName === 'for' || stateName === 'in' || stateName.length < 2) {
        // Group tax by state
        const acceptedOrders = relevantOrders.filter(order => 
          !['pending', 'cancelled', 'rejected'].includes(order.status?.toLowerCase())
        )
        
        const taxByState = {}
        acceptedOrders.forEach(order => {
          const state = order.shippingState || order.billingState || 'Unknown'
          if (!taxByState[state]) {
            taxByState[state] = { tax: 0, count: 0 }
          }
          taxByState[state].tax += parseFloat(order.tax) || 0
          taxByState[state].count += 1
        })
        
        // Sort by tax amount descending
        const sortedStates = Object.entries(taxByState)
          .sort((a, b) => b[1].tax - a[1].tax)
          .slice(0, 10) // Top 10 states
        
        const totalTax = acceptedOrders.reduce((sum, order) => sum + (parseFloat(order.tax) || 0), 0)
        
        if (sortedStates.length === 0) {
          response.content = 'No tax data available for the selected period'
        } else {
          const mtdSuffix = dateRange?.isMTD ? ' (Month-to-Date)' : ''
          const dateInfo = dateRange ? ` for ${dateRange.startDate} to ${dateRange.endDate}${mtdSuffix}` : ''
          const stateList = sortedStates.map(([state, data]) => 
            `  • ${state}: ${formatDollarAmount(data.tax)} (${formatNumber(data.count)} orders)`
          ).join('\n')
          
          response.content = `Tax breakdown by state${dateInfo}:\n\n${stateList}\n\nTotal: ${formatDollarAmount(totalTax)} from ${formatNumber(acceptedOrders.length)} orders`
        }
        
        response.data = sortedStates.length > 0 ? {
          type: 'stateBreakdown',
          breakdownType: 'tax',
          states: sortedStates.map(([state, data]) => ({
            state,
            amount: data.tax,
            count: data.count
          })),
          total: totalTax,
          orderCount: acceptedOrders.length
        } : null
      }
      // Specific state query
      else if (stateName && stateName.length >= 2 && !stateName.match(/^\d/)) {
        // Filter orders by state (check both shipping and billing state)
        const stateOrders = relevantOrders.filter(order => 
          order.shippingState?.toLowerCase().includes(stateName.toLowerCase()) ||
          order.billingState?.toLowerCase().includes(stateName.toLowerCase())
        )
        
        const acceptedOrders = stateOrders.filter(order => 
          !['pending', 'cancelled', 'rejected'].includes(order.status?.toLowerCase())
        )
        
        const totalTax = acceptedOrders.reduce((sum, order) => 
          sum + (parseFloat(order.tax) || 0), 0
        )
        
        if (stateOrders.length === 0) {
          response.content = `No orders found for state "${stateName}"`
          if (dateRange) {
            response.content += ` from ${dateRange.startDate} to ${dateRange.endDate}`
          }
        } else {
          const mtdSuffix = dateRange?.isMTD ? ' (Month-to-Date)' : ''
          const dateInfo = dateRange ? ` from ${dateRange.startDate} to ${dateRange.endDate}${mtdSuffix}` : ''
          response.content = `Tax for ${stateName}${dateInfo}: ${formatDollarAmount(totalTax)} from ${formatNumber(acceptedOrders.length)} accepted orders (out of ${formatNumber(stateOrders.length)} total orders)`
        }
        
        response.data = acceptedOrders.length > 0 ? {
          type: 'tax',
          totalTax: totalTax,
          orderCount: acceptedOrders.length,
          averageTaxPerOrder: acceptedOrders.length > 0 ? totalTax / acceptedOrders.length : 0,
          stateName: stateName
        } : null
      } else {
        // Fall through to general tax if state can't be extracted
        const acceptedOrders = relevantOrders.filter(order => 
          !['pending', 'cancelled', 'rejected'].includes(order.status?.toLowerCase())
        )
        const totalTax = acceptedOrders.reduce((sum, order) => 
          sum + (parseFloat(order.tax) || 0), 0
        )
        
        if (relevantOrders.length === 0) {
          response.content = dateRange
            ? `No orders found for ${dateRange.startDate} to ${dateRange.endDate}.`
            : 'No orders currently loaded. Try specifying a date range.'
        } else {
          const mtdSuffix = dateRange?.isMTD ? ' (Month-to-Date)' : ''
          response.content = dateRange
            ? `Total tax for ${dateRange.startDate} to ${dateRange.endDate}${mtdSuffix}: ${formatDollarAmount(totalTax)} from ${formatNumber(acceptedOrders.length)} accepted orders`
            : `Total tax: ${formatDollarAmount(totalTax)} from ${formatNumber(acceptedOrders.length)} accepted orders`
        }
        
        response.data = acceptedOrders.length > 0 ? {
          type: 'tax',
          totalTax: totalTax,
          orderCount: acceptedOrders.length,
          averageTaxPerOrder: acceptedOrders.length > 0 ? totalTax / acceptedOrders.length : 0
        } : null
      }
    }
    // General tax query
    else if (lower.includes('tax')) {
      const acceptedOrders = relevantOrders.filter(order => 
        !['pending', 'cancelled', 'rejected'].includes(order.status?.toLowerCase())
      )
      const totalTax = acceptedOrders.reduce((sum, order) => 
        sum + (parseFloat(order.tax) || 0), 0
      )
      
      if (relevantOrders.length === 0) {
        response.content = dateRange
          ? `No orders found for ${dateRange.startDate} to ${dateRange.endDate}. The date range might not have any orders, or they haven't been loaded yet.`
          : 'No orders currently loaded. Try specifying a date range.'
      } else {
        const mtdSuffix = dateRange?.isMTD ? ' (Month-to-Date)' : ''
        response.content = dateRange
          ? `Total tax for ${dateRange.startDate} to ${dateRange.endDate}${mtdSuffix}: ${formatDollarAmount(totalTax)} from ${formatNumber(acceptedOrders.length)} accepted orders (out of ${formatNumber(relevantOrders.length)} total orders)`
          : `Total tax: ${formatDollarAmount(totalTax)} from ${formatNumber(acceptedOrders.length)} accepted orders`
      }
      
      response.data = acceptedOrders.length > 0 ? {
        type: 'tax',
        totalTax: totalTax,
        orderCount: acceptedOrders.length,
        averageTaxPerOrder: acceptedOrders.length > 0 ? totalTax / acceptedOrders.length : 0
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
        orders: pendingOrders, // Store all orders
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
        orders: deliveredOrders, // Store all orders
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
    
    console.log('✅ Response generated:', {
      content: response.content.substring(0, 100),
      hasData: !!response.data,
      dataType: response.data?.type
    })
    
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
    
    // Check if this is a query with specific filters (customer, specific state) that should use existing data
    const lower = input.toLowerCase()
    
    // Check for specific state name (not just "by state" which is a breakdown query)
    const hasSpecificState = 
      (/(?:by|for|in)\s+state\s+([a-z]{2,})/i.test(input) && !/(by state for |by state in |by state from )/i.test(input))
    
    const hasSpecificFilter = 
      hasSpecificState ||
      lower.includes('by month') || // Month breakdown should use existing data
      lower.includes('by state') || // State breakdown should use existing data  
      (lower.includes('for ') && (lower.includes('sendoso') || lower.includes('airculinaire') || lower.includes('ongoody'))) ||
      (lower.includes('from ') && (lower.includes('sendoso') || lower.includes('airculinaire') || lower.includes('ongoody')))
    
    // Check if we need to fetch data for a different date range
    const dateRange = parseDate(input)
    
    // Only fetch new data if:
    // 1. A date range is detected
    // 2. AND it's NOT a query with specific filters (those use existing data)
    if (dateRange && onDateRangeChange && onFetchOrders && !hasSpecificFilter) {
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

  const handleClearChat = () => {
    // Reset to initial welcome message
    const initialMessage = {
      type: 'assistant',
      content: 'Hi! I can help you analyze your orders by date, status, customer, and more. Try one of the suggestions below or ask me anything!'
    }
    setMessages([initialMessage])
    setInput('')
    setExpandedOrders({}) // Also reset expanded orders state
    console.log('🧹 Chat cleared - conversation reset')
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
            <div className={`max-w-[80%] rounded-lg p-4 ${
              message.type === 'user' 
                ? 'bg-blue-600 text-white shadow-sm' 
                : 'bg-white border border-gray-300 shadow-sm text-gray-900'
            }`}>
              <p className="text-sm whitespace-pre-line leading-relaxed">{message.content}</p>
              
              {/* Data Display */}
              {message.data && message.data.type === 'revenue' && (
                <div className="mt-3 bg-green-50 rounded-lg p-3 border border-green-200">
                  <div className="flex items-center mb-2">
                    <DollarSign className="h-4 w-4 text-green-600 mr-1" />
                    <span className="text-xs font-medium text-green-800">
                      {message.data.customerName 
                        ? `Revenue for ${message.data.customerName}` 
                        : message.data.stateName
                          ? `Revenue for ${message.data.stateName}`
                          : 'Revenue Breakdown'}
                    </span>
                  </div>
                  <div className="space-y-1 text-sm">
                    {message.data.customerName && (
                      <div className="flex justify-between pb-1 border-b border-green-200">
                        <span className="text-gray-600">Customer:</span>
                        <span className="font-semibold text-gray-900">{message.data.customerName}</span>
                      </div>
                    )}
                    {message.data.stateName && (
                      <div className="flex justify-between pb-1 border-b border-green-200">
                        <span className="text-gray-600">State:</span>
                        <span className="font-semibold text-gray-900">{message.data.stateName}</span>
                      </div>
                    )}
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
              
              {message.data && message.data.type === 'tax' && (
                <div className="mt-3 bg-orange-50 rounded-lg p-3 border border-orange-200">
                  <div className="flex items-center mb-2">
                    <DollarSign className="h-4 w-4 text-orange-600 mr-1" />
                    <span className="text-xs font-medium text-orange-800">
                      {message.data.stateName ? `Tax for ${message.data.stateName}` : 'Tax Breakdown'}
                    </span>
                  </div>
                  <div className="space-y-1 text-sm">
                    {message.data.stateName && (
                      <div className="flex justify-between pb-1 border-b border-orange-200">
                        <span className="text-gray-600">State:</span>
                        <span className="font-semibold text-gray-900">{message.data.stateName}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-gray-600">Total Tax:</span>
                      <span className="font-bold text-orange-900">{formatDollarAmount(message.data.totalTax)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Orders:</span>
                      <span className="font-semibold text-gray-900">{formatNumber(message.data.orderCount)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Average Tax Per Order:</span>
                      <span className="font-semibold text-gray-900">{formatDollarAmount(message.data.averageTaxPerOrder)}</span>
                    </div>
                  </div>
                </div>
              )}
              
              {message.data && message.data.type === 'monthBreakdown' && (
                <div className="mt-3 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-lg p-3 border border-blue-200">
                  <div className="flex items-center mb-2">
                    <Calendar className="h-4 w-4 text-blue-600 mr-1" />
                    <span className="text-xs font-medium text-blue-800">
                      {message.data.breakdownType === 'revenue' ? 'Revenue by Month' : 'Tax by Month'}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {message.data.months.map((monthData, idx) => (
                      <div key={idx} className="flex justify-between items-center text-sm py-1.5 px-2 bg-white rounded border border-blue-100">
                        <div className="flex items-center">
                          <span className="text-gray-700 font-medium mr-2">{idx + 1}.</span>
                          <span className="text-gray-900 font-semibold">{monthData.month}</span>
                          <span className="text-gray-500 text-xs ml-2">({formatNumber(monthData.count)} orders)</span>
                        </div>
                        <span className="font-bold text-blue-900">{formatDollarAmount(monthData.revenue)}</span>
                      </div>
                    ))}
                    <div className="flex justify-between items-center text-sm pt-2 mt-2 border-t border-blue-200">
                      <span className="text-gray-700 font-bold">Total ({formatNumber(message.data.orderCount)} orders):</span>
                      <span className="font-bold text-blue-900 text-base">{formatDollarAmount(message.data.total)}</span>
                    </div>
                  </div>
                </div>
              )}
              
              {message.data && message.data.type === 'stateBreakdown' && (
                <div className={`mt-3 rounded-lg p-3 border ${
                  message.data.breakdownType === 'tax' 
                    ? 'bg-gradient-to-br from-orange-50 to-yellow-50 border-orange-200'
                    : 'bg-gradient-to-br from-green-50 to-emerald-50 border-green-200'
                }`}>
                  <div className="flex items-center mb-2">
                    <TrendingUp className={`h-4 w-4 mr-1 ${
                      message.data.breakdownType === 'tax' ? 'text-orange-600' : 'text-green-600'
                    }`} />
                    <span className={`text-xs font-medium ${
                      message.data.breakdownType === 'tax' ? 'text-orange-800' : 'text-green-800'
                    }`}>
                      {message.data.breakdownType === 'tax' ? 'Tax by State' : 'Sales by State'}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {message.data.states.map((stateData, idx) => (
                      <div key={idx} className={`flex justify-between items-center text-sm py-1.5 px-2 bg-white rounded border ${
                        message.data.breakdownType === 'tax' ? 'border-orange-100' : 'border-green-100'
                      }`}>
                        <div className="flex items-center">
                          <span className="text-gray-700 font-medium mr-2">{idx + 1}.</span>
                          <span className="text-gray-900 font-semibold">{stateData.state}</span>
                          <span className="text-gray-500 text-xs ml-2">({formatNumber(stateData.count)} orders)</span>
                        </div>
                        <span className={`font-bold ${
                          message.data.breakdownType === 'tax' ? 'text-orange-900' : 'text-green-900'
                        }`}>{formatDollarAmount(stateData.amount)}</span>
                      </div>
                    ))}
                    <div className={`flex justify-between items-center text-sm pt-2 mt-2 border-t ${
                      message.data.breakdownType === 'tax' ? 'border-orange-200' : 'border-green-200'
                    }`}>
                      <span className="text-gray-700 font-bold">Total ({formatNumber(message.data.orderCount)} orders):</span>
                      <span className={`font-bold text-base ${
                        message.data.breakdownType === 'tax' ? 'text-orange-900' : 'text-green-900'
                      }`}>{formatDollarAmount(message.data.total)}</span>
                    </div>
                  </div>
                </div>
              )}
              
              {message.data && message.data.type === 'orders' && message.data.orders.length > 0 && (
                <div className="mt-3 bg-blue-50 rounded-lg p-3 border border-blue-200">
                  <div className="flex items-center mb-2">
                    <Package className="h-4 w-4 text-blue-600 mr-1" />
                    <span className="text-xs font-medium text-blue-800">
                      {message.data.customerName 
                        ? (expandedOrders[index] 
                            ? `All Orders for ${message.data.customerName} (${message.data.total})`
                            : `Orders for ${message.data.customerName} (showing ${Math.min(10, message.data.total)} of ${message.data.total})`)
                        : (expandedOrders[index] 
                            ? `All Orders (${message.data.total})`
                            : `Sample Orders (showing ${Math.min(10, message.data.total)} of ${message.data.total})`)
                      }
                    </span>
                  </div>
                  <div className="space-y-2">
                    {(expandedOrders[index] ? message.data.orders : message.data.orders.slice(0, 10)).map((order, idx) => (
                      <div key={idx} className="text-xs bg-white rounded p-2 border border-blue-100">
                        <div className="font-semibold text-gray-900">{order.ordernum || order.id}</div>
                        <div className="text-gray-600">{order.customerName} - {formatDollarAmount(order.total)}</div>
                        <div className="text-gray-500">{order.orderDate} - {order.status}</div>
                      </div>
                    ))}
                    {message.data.total > 10 && (
                      <button
                        type="button"
                        onClick={() => setExpandedOrders(prev => ({ ...prev, [index]: !prev[index] }))}
                        className="w-full text-xs text-blue-600 hover:text-blue-800 hover:bg-blue-100 text-center py-2 rounded transition-colors duration-200"
                      >
                        {expandedOrders[index] 
                          ? 'Show less' 
                          : `+${formatNumber(message.data.total - 10)} more orders`
                        }
                      </button>
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

      {/* Input Area */}
      <form onSubmit={handleSubmit} className="p-6 bg-white border-t border-gray-200">
        <div className="max-w-4xl mx-auto">
          {/* Clear Chat Button - Show when there are messages */}
          {messages.length > 1 && (
            <div className="flex justify-end mb-3">
              <button
                type="button"
                onClick={handleClearChat}
                className="flex items-center px-3 py-1.5 text-xs text-gray-600 hover:text-red-600 bg-gray-100 hover:bg-red-50 rounded-lg transition-all duration-200 border border-gray-300 hover:border-red-300"
              >
                <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                Clear Chat
              </button>
            </div>
          )}
          
          <div className="relative bg-white rounded-lg border border-gray-300 shadow-sm hover:border-gray-400 transition-all duration-200">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={isLoadingData ? "Loading data..." : "Ask me anything about your orders..."}
              disabled={isLoadingData}
              className="w-full px-4 py-3 bg-white text-gray-900 placeholder-gray-500 focus:outline-none rounded-lg text-base disabled:cursor-not-allowed disabled:bg-gray-50"
            />
            <button
              type="submit"
              disabled={!input.trim() || isLoadingData}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200"
            >
              {isLoadingData ? (
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
              ) : (
                <Send className="h-5 w-5" />
              )}
            </button>
          </div>
        </div>
        
        {/* Suggestion Prompts - Show when minimal messages */}
        {messages.length <= 1 && (
          <div className="mt-4 max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setInput('Show me delayed orders for Sendoso for Oct 2025')}
              className="text-left px-4 py-3 bg-red-50 hover:bg-red-100 rounded-lg text-sm text-red-700 hover:text-red-800 transition-all duration-200 border border-red-200 hover:border-red-300 shadow-sm"
            >
              Show me delayed orders for Sendoso for Oct 2025
            </button>
            <button
              type="button"
              onClick={() => setInput('Sales by state for Oct 2025')}
              className="text-left px-4 py-3 bg-green-50 hover:bg-green-100 rounded-lg text-sm text-green-700 hover:text-green-800 transition-all duration-200 border border-green-200 hover:border-green-300 shadow-sm"
            >
              Sales by state for Oct 2025
            </button>
            <button
              type="button"
              onClick={() => setInput('Show me pending orders')}
              className="text-left px-4 py-3 bg-amber-50 hover:bg-amber-100 rounded-lg text-sm text-amber-700 hover:text-amber-800 transition-all duration-200 border border-amber-200 hover:border-amber-300 shadow-sm"
            >
              Show me pending orders
            </button>
            <button
              type="button"
              onClick={() => setInput('How many orders were delivered this week?')}
              className="text-left px-4 py-3 bg-blue-50 hover:bg-blue-100 rounded-lg text-sm text-blue-700 hover:text-blue-800 transition-all duration-200 border border-blue-200 hover:border-blue-300 shadow-sm"
            >
              How many orders were delivered this week?
            </button>
            <button
              type="button"
              onClick={() => setInput('Show me the revenue for Sendoso for Oct 2025')}
              className="text-left px-4 py-3 bg-indigo-50 hover:bg-indigo-100 rounded-lg text-sm text-indigo-700 hover:text-indigo-800 transition-all duration-200 border border-indigo-200 hover:border-indigo-300 shadow-sm"
            >
              Show me the revenue for Sendoso for Oct 2025
            </button>
            <button
              type="button"
              onClick={() => setInput('Tax by state for Oct 2025')}
              className="text-left px-4 py-3 bg-orange-50 hover:bg-orange-100 rounded-lg text-sm text-orange-700 hover:text-orange-800 transition-all duration-200 border border-orange-200 hover:border-orange-300 shadow-sm"
            >
              Tax by state for Oct 2025
            </button>
            <button
              type="button"
              onClick={() => setInput('Revenue by month for 2025')}
              className="text-left px-4 py-3 bg-cyan-50 hover:bg-cyan-100 rounded-lg text-sm text-cyan-700 hover:text-cyan-800 transition-all duration-200 border border-cyan-200 hover:border-cyan-300 shadow-sm"
            >
              Revenue by month for 2025
            </button>
            <button
              type="button"
              onClick={() => setInput('What\'s the total revenue for November 2025?')}
              className="text-left px-4 py-3 bg-purple-50 hover:bg-purple-100 rounded-lg text-sm text-purple-700 hover:text-purple-800 transition-all duration-200 border border-purple-200 hover:border-purple-300 shadow-sm"
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

