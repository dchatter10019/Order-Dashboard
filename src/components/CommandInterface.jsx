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
  const pendingGPTDataRef = useRef(null) // Store GPT-parsed data for pending command
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
  const processCommand = (command, gptParsedData = null) => {
    console.log('🔄 Processing command:', command, 'with', orders.length, 'orders')
    console.log('🤖 GPT parsed data:', gptParsedData)
    const lower = command.toLowerCase()
    
    // Use GPT-parsed date range if available, otherwise fall back to rule-based
    const dateRange = gptParsedData?.dateRange || parseDate(command)
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
    if ((gptParsedData?.intent === 'delayed_orders' || gptParsedData?.intent === 'delayed_orders_by_customer') || 
        (!gptParsedData && lower.includes('delayed') && (lower.includes(' for ') || lower.includes(' from ') || lower.includes(' by ') || lower.includes(' of ')))) {
      // Use GPT-parsed customer name if available, otherwise extract with regex
      let customerName = gptParsedData?.customer || ''
      
      if (!customerName) {
        // Fallback to regex extraction (handles for/from/by/of)
        const forMatch = command.match(/(?:delayed|delay)\s+(?:orders?\s+)?(?:for|from|by|of)\s+([a-zA-Z0-9\s]+?)(?:\s+for\s+|\s+from\s+|\s+in\s+|$)/i)
        
        if (forMatch && forMatch[1]) {
          customerName = forMatch[1].trim()
          // Remove common date-related words
          customerName = customerName.replace(/\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|may|june|july|august|september|october|november|december|in|during|on|this|month)\s*$/i, '').trim()
        }
      }
      
      console.log('💼 Customer name (GPT or regex):', customerName, '| Source:', gptParsedData?.customer ? 'GPT' : 'Regex')
      
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
          customerName: customerName,
          orderType: 'Delayed'
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
          total: delayedOrders.length,
          orderType: 'Delayed'
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
    else if ((gptParsedData?.intent === 'delayed_orders') || (!gptParsedData && lower.includes('delayed'))) {
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
        total: delayedOrders.length,
        orderType: 'Delayed'
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
    // Revenue by customer query - Check if GPT intent is revenue with customer OR if query text matches pattern
    else if ((gptParsedData?.intent === 'revenue' && gptParsedData?.customer) || 
             (gptParsedData?.intent === 'revenue_by_customer') ||
             (!gptParsedData && lower.includes('revenue') && (lower.includes(' for ') || lower.includes(' from ') || lower.includes(' of ')))) {
      console.log('🔍 Entering revenue by customer block')
      // Use GPT-parsed customer name if available, otherwise extract with regex
      let customerName = gptParsedData?.customer || ''
      
      if (!customerName) {
        // Fallback to regex extraction (handles for/from/of)
        const forMatch = command.match(/(?:revenue|sales)\s+(?:for|from|of)\s+([a-zA-Z0-9\s]+?)(?:\s+for\s+|\s+from\s+|\s+in\s+|$)/i)
        
        if (forMatch && forMatch[1]) {
          customerName = forMatch[1].trim()
          // Remove common date-related words that might have been captured
          customerName = customerName.replace(/\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|may|june|july|august|september|october|november|december|in|during|on|20\d{2})\s*$/i, '').trim()
        }
      }
      
      console.log('💼 Customer name (GPT or regex):', customerName, '| Source:', gptParsedData?.customer ? 'GPT' : 'Regex')
      console.log('💼 Customer name length:', customerName?.length)
      console.log('💼 GPT parsed data full:', gptParsedData)
      
      // Check if extracted name is a month name (should not be treated as customer)
      const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec', 
                         'january', 'february', 'march', 'april', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
      const isMonthName = monthNames.includes(customerName.toLowerCase())
      
      if (isMonthName) {
        console.log('📅 Rejected customer name - is a month name:', customerName)
      }
      
      console.log('💼 Validation check:', {
        hasCustomerName: !!customerName,
        length: customerName?.length,
        minLength: customerName && customerName.length >= 3,
        notDigit: !/^\d/.test(customerName),
        notMonth: !isMonthName,
        willProcess: customerName && customerName.length >= 3 && !/^\d/.test(customerName) && !isMonthName
      })
      
      if (customerName && customerName.length >= 3 && !/^\d/.test(customerName) && !isMonthName) {
        console.log('✅ Processing revenue by customer query for:', customerName)
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
        console.log('⚠️ Customer name validation failed, falling back to general revenue')
        console.log('⚠️ Customer name was:', customerName)
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
    else if ((gptParsedData?.intent === 'revenue_by_month') || (!gptParsedData && (lower.includes('revenue') || lower.includes('sales')) && lower.includes('by month'))) {
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
    // General revenue query (but not if it's a tax query)
    else if ((gptParsedData?.intent === 'revenue') || (!gptParsedData && (lower.includes('revenue') || lower.includes('sales')) && !lower.includes('tax'))) {
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
    // Service charge query
    else if ((gptParsedData?.intent === 'service_charge') || (!gptParsedData && lower.includes('service charge'))) {
      const acceptedOrders = relevantOrders.filter(order => 
        !['pending', 'cancelled', 'rejected'].includes(order.status?.toLowerCase())
      )
      const totalServiceCharge = acceptedOrders.reduce((sum, order) => 
        sum + (parseFloat(order.serviceCharge) || 0), 0
      )
      
      if (relevantOrders.length === 0) {
        response.content = dateRange
          ? `No orders found for ${dateRange.startDate} to ${dateRange.endDate}. The date range might not have any orders, or they haven't been loaded yet.`
          : 'No orders currently loaded. Try specifying a date range.'
      } else {
        const mtdSuffix = dateRange?.isMTD ? ' (Month-to-Date)' : ''
        response.content = dateRange
          ? `Total service charge for ${dateRange.startDate} to ${dateRange.endDate}${mtdSuffix}: ${formatDollarAmount(totalServiceCharge)} from ${formatNumber(acceptedOrders.length)} accepted orders (out of ${formatNumber(relevantOrders.length)} total orders)`
          : `Total service charge: ${formatDollarAmount(totalServiceCharge)} from ${formatNumber(acceptedOrders.length)} accepted orders`
      }
      
      response.data = acceptedOrders.length > 0 ? {
        type: 'service_charge',
        totalServiceCharge: totalServiceCharge,
        orderCount: acceptedOrders.length,
        averageServiceChargePerOrder: acceptedOrders.length > 0 ? totalServiceCharge / acceptedOrders.length : 0
      } : null
    }
    // General tax query
    else if ((gptParsedData?.intent === 'tax') || (!gptParsedData && lower.includes('tax'))) {
      const acceptedOrders = relevantOrders.filter(order => 
        !['pending', 'cancelled', 'rejected'].includes(order.status?.toLowerCase())
      )
      const totalTax = acceptedOrders.reduce((sum, order) => 
        sum + (parseFloat(order.tax) || 0) + (parseFloat(order.serviceChargeTax) || 0), 0
      )
      
      if (relevantOrders.length === 0) {
        response.content = dateRange
          ? `No orders found for ${dateRange.startDate} to ${dateRange.endDate}. The date range might not have any orders, or they haven't been loaded yet.`
          : 'No orders currently loaded. Try specifying a date range.'
      } else {
        const mtdSuffix = dateRange?.isMTD ? ' (Month-to-Date)' : ''
        response.content = dateRange
          ? `Total tax (including service charge tax) for ${dateRange.startDate} to ${dateRange.endDate}${mtdSuffix}: ${formatDollarAmount(totalTax)} from ${formatNumber(acceptedOrders.length)} accepted orders (out of ${formatNumber(relevantOrders.length)} total orders)`
          : `Total tax (including service charge tax): ${formatDollarAmount(totalTax)} from ${formatNumber(acceptedOrders.length)} accepted orders`
      }
      
      response.data = acceptedOrders.length > 0 ? {
        type: 'tax',
        totalTax: totalTax,
        orderCount: acceptedOrders.length,
        averageTaxPerOrder: acceptedOrders.length > 0 ? totalTax / acceptedOrders.length : 0
      } : null
    }
    // Pending orders
    else if ((gptParsedData?.intent === 'pending_orders') || (!gptParsedData && lower.includes('pending'))) {
      const pendingOrders = relevantOrders.filter(order => 
        order.status?.toLowerCase() === 'pending'
      )
      
      response.content = `Found ${formatNumber(pendingOrders.length)} pending orders`
      response.data = {
        type: 'orders',
        orders: pendingOrders, // Store all orders
        total: pendingOrders.length,
        orderType: 'Pending'
      }
    }
    // Delivered orders
    else if ((gptParsedData?.intent === 'delivered_orders') || (!gptParsedData && lower.includes('delivered'))) {
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
        total: deliveredOrders.length,
        orderType: 'Delivered'
      }
    }
    // Total orders
    else if ((gptParsedData?.intent === 'total_orders') || (!gptParsedData && (lower.includes('how many orders') || lower.includes('total orders')))) {
      const mtdSuffix = dateRange?.isMTD ? ' (Month-to-Date)' : ''
      
      // Check if user wants to SEE the orders (show, list, display) or just get a count
      const wantsToSeeOrders = lower.includes('show') || lower.includes('list') || lower.includes('display') || lower.includes('see')
      
      if (wantsToSeeOrders && relevantOrders.length > 0) {
        // Show the actual orders
        response.content = dateRange
          ? `Found ${formatNumber(relevantOrders.length)} orders from ${dateRange.startDate} to ${dateRange.endDate}${mtdSuffix}`
          : `Found ${formatNumber(relevantOrders.length)} orders`
        
        response.data = {
          type: 'orders',
          orders: relevantOrders,
          total: relevantOrders.length,
          orderType: 'All Orders'
        }
      } else {
        // Just show count
        response.content = dateRange
          ? `There are ${formatNumber(relevantOrders.length)} orders from ${dateRange.startDate} to ${dateRange.endDate}${mtdSuffix}`
          : `There are ${formatNumber(relevantOrders.length)} total orders`
        
        response.data = {
          type: 'count',
          count: relevantOrders.length
        }
      }
    }
    // Average order value
    else if ((gptParsedData?.intent === 'average_order_value') || (!gptParsedData && (lower.includes('average') || lower.includes('aov')))) {
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
          const response = processCommand(pendingCommandRef.current, pendingGPTDataRef.current)
          console.log('📊 Generated response:', response)
          setMessages(prev => {
            // Remove any loading messages first
            const filtered = prev.filter(m => !m.loading)
            return [...filtered, response]
          })
          pendingCommandRef.current = null
          pendingGPTDataRef.current = null
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
    
    // Try to parse using GPT-4o-mini first, fallback to rule-based parsing
    let dateRange = null
    let parsedIntent = null
    let parsedCustomer = null
    
    try {
      console.log('🤖 Attempting GPT-4o-mini parsing...')
      const parseResponse = await fetch('/api/parse-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: input })
      })
      
      if (parseResponse.ok) {
        const parseData = await parseResponse.json()
        console.log('✅ GPT parsing successful:', parseData.parsed)
        
        if (parseData.parsed.startDate && parseData.parsed.endDate) {
          dateRange = {
            startDate: parseData.parsed.startDate,
            endDate: parseData.parsed.endDate,
            isMTD: parseData.parsed.isMTD || false
          }
        }
        
        parsedIntent = parseData.parsed.intent
        parsedCustomer = parseData.parsed.customer
        
        console.log('📊 Token usage:', parseData.usage)
        console.log(`💰 Estimated cost: $${((parseData.usage.promptTokens * 0.15 + parseData.usage.completionTokens * 0.60) / 1000000).toFixed(6)}`)
      } else {
        console.log('⚠️ GPT parsing failed, using fallback')
      }
    } catch (error) {
      console.log('⚠️ GPT parsing error, using fallback:', error.message)
    }
    
    // Fallback to rule-based parsing if GPT didn't work
    if (!dateRange) {
      console.log('📝 Using rule-based date parsing as fallback')
      dateRange = parseDate(input)
    }
    
    // Check if this is a query with specific filters (customer, specific state) that should use existing data
    const lower = input.toLowerCase()
    
    // Only skip fetch for customer-specific queries (NOT for breakdown queries)
    const hasSpecificFilter = 
      parsedCustomer || // GPT found a customer
      (lower.includes('for ') && (lower.includes('sendoso') || lower.includes('airculinaire') || lower.includes('ongoody'))) ||
      (lower.includes('from ') && (lower.includes('sendoso') || lower.includes('airculinaire') || lower.includes('ongoody')))
    
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
      
      // Save the command and GPT-parsed data to process after data loads
      pendingCommandRef.current = input
      pendingGPTDataRef.current = {
        customer: parsedCustomer,
        intent: parsedIntent,
        dateRange: dateRange
      }
      
      // Update date range (this will trigger fetchOrders via useEffect)
      onDateRangeChange(dateRange)
      
      // Set a timeout in case data never loads
      loadingTimeoutRef.current = setTimeout(() => {
        if (pendingCommandRef.current) {
          console.log('⏰ Loading timeout reached, processing with available data')
          const response = processCommand(pendingCommandRef.current, pendingGPTDataRef.current)
          setMessages(prev => {
            const filtered = prev.filter(m => !m.loading)
            return [...filtered, response]
          })
          pendingCommandRef.current = null
          pendingGPTDataRef.current = null
        }
      }, 10000) // 10 second timeout
    } else {
      // Process command immediately with current data
      console.log('🤖 Processing command with current data:', orders.length, 'orders')
      const gptParsedData = {
        customer: parsedCustomer,
        intent: parsedIntent,
        dateRange: dateRange
      }
      const response = processCommand(input, gptParsedData)
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
      <div className="flex-1 overflow-y-auto p-3 space-y-3 bg-gray-50">
        {/* Greeting for Empty State */}
        {messages.length <= 1 && (
          <div className="pt-2">
            <div className="text-center">
              <h2 className="text-xl font-medium text-gray-900 mb-1">
                Hey there. Ready to dive in?
              </h2>
              <p className="text-gray-600 text-sm">Ask me anything about your orders</p>
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
                      <span className="text-gray-600">Total Tax (incl. service charge):</span>
                      <span className="font-bold text-orange-900">{formatDollarAmount(message.data.totalTax)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Orders:</span>
                      <span className="font-semibold text-gray-900">{formatNumber(message.data.orderCount)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Avg. Tax Per Order:</span>
                      <span className="font-semibold text-gray-900">{formatDollarAmount(message.data.averageTaxPerOrder)}</span>
                    </div>
                  </div>
                </div>
              )}
              
              {message.data && message.data.type === 'service_charge' && (
                <div className="mt-3 bg-indigo-50 rounded-lg p-3 border border-indigo-200">
                  <div className="flex items-center mb-2">
                    <DollarSign className="h-4 w-4 text-indigo-600 mr-1" />
                    <span className="text-xs font-medium text-indigo-800">Service Charge Breakdown</span>
                  </div>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Total Service Charge:</span>
                      <span className="font-bold text-indigo-900">{formatDollarAmount(message.data.totalServiceCharge)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Orders:</span>
                      <span className="font-semibold text-gray-900">{formatNumber(message.data.orderCount)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Avg. Service Charge Per Order:</span>
                      <span className="font-semibold text-gray-900">{formatDollarAmount(message.data.averageServiceChargePerOrder)}</span>
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
                <div className="mt-3 -mx-4 bg-blue-50 rounded-lg p-3 border border-blue-200">
                  <div className="flex items-center mb-2">
                    <Package className="h-4 w-4 text-blue-600 mr-1" />
                    <span className="text-xs font-medium text-blue-800">
                      {message.data.customerName 
                        ? (expandedOrders[index] 
                            ? `All ${message.data.orderType || 'Orders'} for ${message.data.customerName} (${message.data.total})`
                            : `${message.data.orderType || 'Orders'} for ${message.data.customerName} (showing ${Math.min(10, message.data.total)} of ${message.data.total})`)
                        : (expandedOrders[index] 
                            ? `All ${message.data.orderType || 'Orders'} (${message.data.total})`
                            : `${message.data.orderType || 'Orders'} (showing ${Math.min(10, message.data.total)} of ${message.data.total})`)
                      }
                    </span>
                  </div>
                  <div className="space-y-1">
                    {(expandedOrders[index] ? message.data.orders : message.data.orders.slice(0, 10)).map((order, idx) => (
                      <div key={idx} className="text-xs bg-white rounded px-2 py-1.5 border border-blue-100 font-mono">
                        <span className="font-semibold text-gray-900">{order.ordernum || order.id}</span>
                        <span className="text-gray-400 mx-2">|</span>
                        <span className="text-gray-700">{order.customerName}</span>
                        <span className="text-gray-400 mx-2">|</span>
                        <span className="text-blue-700 font-semibold">{formatDollarAmount(order.total)}</span>
                        <span className="text-gray-400 mx-2">|</span>
                        <span className="text-gray-600">{order.orderDate}</span>
                        <span className="text-gray-400 mx-2">|</span>
                        <span className={`font-medium ${
                          order.status?.toLowerCase() === 'delivered' ? 'text-green-600' :
                          order.status?.toLowerCase() === 'pending' ? 'text-amber-600' :
                          order.status?.toLowerCase() === 'canceled' ? 'text-red-600' :
                          'text-gray-600'
                        }`}>{order.status}</span>
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
      <form onSubmit={handleSubmit} className="p-2 bg-white border-t border-gray-200">
        <div className="max-w-4xl mx-auto">
          {/* Clear Chat Button - Show when there are messages */}
          {messages.length > 1 && (
            <div className="flex justify-end mb-1.5">
              <button
                type="button"
                onClick={handleClearChat}
                className="flex items-center px-2 py-0.5 text-xs text-gray-600 hover:text-red-600 bg-gray-100 hover:bg-red-50 rounded transition-all duration-200 border border-gray-300 hover:border-red-300"
              >
                <Trash2 className="h-3 w-3 mr-1" />
                Clear Chat
              </button>
            </div>
          )}
          
          <div className="relative bg-white rounded-lg border-2 border-blue-400 shadow-md hover:border-blue-500 hover:shadow-lg transition-all duration-200">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={isLoadingData ? "Loading data..." : "Ask me anything about your orders..."}
              disabled={isLoadingData}
              className="w-full pl-3 pr-12 py-2.5 bg-white text-gray-900 placeholder-gray-600 focus:outline-none rounded-lg text-sm disabled:cursor-not-allowed disabled:bg-gray-50"
            />
            <button
              type="submit"
              disabled={!input.trim() || isLoadingData}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 p-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 shadow-md flex items-center justify-center"
            >
              {isLoadingData ? (
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
              ) : (
                <Send className="h-5 w-5" />
              )}
            </button>
          </div>
        </div>
        
        {/* Shortcut Buttons - Only show when no messages */}
        {messages.length <= 1 && (
          <div className="mt-2 max-w-4xl mx-auto grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setInput('What is the revenue for this month so far?')}
              className="text-left px-3 py-2 bg-blue-50 hover:bg-blue-100 rounded-lg text-xs text-blue-700 hover:text-blue-800 transition-all duration-200 border border-blue-200 hover:border-blue-300"
            >
              Month To Date Revenue
            </button>
            <button
              type="button"
              onClick={() => setInput('What is the sales tax for this month so far?')}
              className="text-left px-3 py-2 bg-green-50 hover:bg-green-100 rounded-lg text-xs text-green-700 hover:text-green-800 transition-all duration-200 border border-green-200 hover:border-green-300"
            >
              Month To Date Sales Tax
            </button>
            <button
              type="button"
              onClick={() => setInput('What was the revenue for last month?')}
              className="text-left px-3 py-2 bg-purple-50 hover:bg-purple-100 rounded-lg text-xs text-purple-700 hover:text-purple-800 transition-all duration-200 border border-purple-200 hover:border-purple-300"
            >
              Revenue for Last Month
            </button>
            <button
              type="button"
              onClick={() => setInput('What is the year to date revenue?')}
              className="text-left px-3 py-2 bg-orange-50 hover:bg-orange-100 rounded-lg text-xs text-orange-700 hover:text-orange-800 transition-all duration-200 border border-orange-200 hover:border-orange-300"
            >
              YTD Revenue
            </button>
          </div>
        )}
      </form>
    </div>
  )
}

export default CommandInterface

