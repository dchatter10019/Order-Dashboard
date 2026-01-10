import React, { useState, useRef, useEffect } from 'react'
import { Send, Sparkles, TrendingUp, Calendar, DollarSign, Package, Trash2, Download } from 'lucide-react'
import { formatDollarAmount, formatNumber } from '../utils/formatCurrency'

const CommandInterface = ({ 
  orders, 
  onFilterChange, 
  onDateRangeChange, 
  onFetchOrders, 
  isLoadingData,
  messages: providedMessages,
  setMessages: providedSetMessages,
  dateRange: currentDateRange // Add current dateRange from parent
}) => {
  const [input, setInput] = useState('')
  const [expandedOrders, setExpandedOrders] = useState({}) // Track which message's orders are expanded
  const messagesEndRef = useRef(null)
  const pendingCommandRef = useRef(null)
  const pendingGPTDataRef = useRef(null) // Store GPT-parsed data for pending command
  const loadingTimeoutRef = useRef(null)
  const originalQueryRef = useRef(null) // Store original query when clarification is requested
  
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

  // Calculate timeout duration based on date range size
  const calculateTimeoutDuration = (startDate, endDate) => {
    const start = new Date(startDate)
    const end = new Date(endDate)
    const diffDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24))
    
    // Base timeout: 15 seconds
    // Add 10 seconds per chunk (30 days) to account for retries and slow network
    const chunks = Math.ceil(diffDays / 30)
    const timeout = 15000 + (chunks * 10000) // 10 seconds per chunk
    
    console.log(`⏱️  Timeout calculation: ${diffDays} days = ${chunks} chunks → ${timeout}ms timeout`)
    
    // Cap at 3 minutes for very large ranges
    return Math.min(timeout, 180000)
  }

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
        let year = yearMatch ? parseInt(yearMatch[1]) : null
        
        // If no year specified, use smart default:
        // - If month is in the past relative to current month, use current year
        // - If month is current or future month, use current year
        // - But if that would make it far in the future (more than 2 months ahead), use previous year
        if (!year) {
          const currentMonth = now.getMonth()
          const currentYear = now.getFullYear()
          
          // If the requested month is more than 2 months in the future, use previous year
          // (e.g., if it's January and they say "Oct", they mean last October)
          if (monthNum > currentMonth + 2) {
            year = currentYear - 1
            console.log(`📅 Month "${monthName}" is far in future, using previous year: ${year}`)
          } else {
            year = currentYear
          }
        }
        
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
    
    // Last week (Sunday through Saturday)
    if (lower.includes('last week')) {
      // Calculate last week's Sunday (7 days ago, then go back to Sunday)
      const today = new Date(now)
      const currentDayOfWeek = today.getDay() // 0 = Sunday, 6 = Saturday
      
      // Go back to last Sunday: subtract current day + 7 days
      const lastSunday = new Date(today)
      lastSunday.setDate(today.getDate() - currentDayOfWeek - 7)
      lastSunday.setHours(0, 0, 0, 0)
      
      // Last Saturday is 6 days after last Sunday
      const lastSaturday = new Date(lastSunday)
      lastSaturday.setDate(lastSunday.getDate() + 6)
      lastSaturday.setHours(23, 59, 59, 999)
      
      return {
        startDate: lastSunday.toISOString().split('T')[0],
        endDate: lastSaturday.toISOString().split('T')[0]
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
  const processCommand = (command, gptParsedData = null, enrichedOrdersOverride = null) => {
    // Use enriched orders if provided, otherwise use state orders
    const ordersToUse = enrichedOrdersOverride || orders
    
    console.log('🔄 Processing command:', command, 'with', ordersToUse.length, 'orders')
    console.log('🤖 GPT parsed data:', gptParsedData)
    console.log('🗺️  Using enriched orders:', !!enrichedOrdersOverride)
    const lower = command.toLowerCase()
    
    // Check if GPT identified this as an unknown/unrelated query
    if (gptParsedData?.intent === 'unknown') {
      console.log('❌ GPT identified query as unrelated to orders')
      return {
        type: 'assistant',
        content: "Sorry, I don't know how to handle this request.\n\nI'm designed to help with order data queries like:\n• Revenue, tax, tips, service charges, delivery charges\n• Delayed, pending, or delivered orders\n• Orders by customer (Sendoso, OnGoody, Air Culinaire)\n• Date-based queries (MTD, YTD, specific months)\n\nPlease ask a question about your orders.",
        data: null
      }
    }
    
    // Use GPT-parsed date range if available, otherwise fall back to rule-based
    const dateRange = gptParsedData?.dateRange || parseDate(command)
    console.log('📅 Date range from command:', dateRange)
    
    // Filter orders by date range if specified
    let relevantOrders = ordersToUse
    if (dateRange) {
      console.log('🔍 Filtering orders with date range:', {
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
        totalOrders: ordersToUse.length
      })
      
      relevantOrders = ordersToUse.filter(order => {
        const inRange = order.orderDate >= dateRange.startDate && order.orderDate <= dateRange.endDate
        if (!inRange && ordersToUse.length < 100) { // Only log for small sets
          console.log(`  ❌ Order ${order.id} excluded: date ${order.orderDate} not in range`)
        }
        return inRange
      })
      console.log('📊 Filtered to', relevantOrders.length, 'orders for date range', dateRange.startDate, 'to', dateRange.endDate)
      
      // Log sample of included orders
      if (relevantOrders.length > 0 && relevantOrders.length < 20) {
        console.log('✅ Included orders:', relevantOrders.map(o => o.orderDate).slice(0, 10))
      }
    } else {
      console.log('📊 Using all', ordersToUse.length, 'orders (no date filter in command)')
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
      
      // Check if we need to fetch data for a date range first
      const dateRangeForQuery = gptParsedData?.dateRange || parseDate(command)
      console.log('🔍 Revenue by customer - checking date range:', {
        hasDateRangeForQuery: !!dateRangeForQuery,
        dateRangeForQuery: dateRangeForQuery,
        currentDateRange: currentDateRange,
        hasOnDateRangeChange: !!onDateRangeChange,
        hasOnFetchOrders: !!onFetchOrders
      })
      
      if (dateRangeForQuery && onDateRangeChange && onFetchOrders) {
        // Check if current dateRange matches the query dateRange
        const needsFetch = !currentDateRange || 
          currentDateRange.startDate !== dateRangeForQuery.startDate || 
          currentDateRange.endDate !== dateRangeForQuery.endDate
        
        console.log('🔍 Revenue by customer - needsFetch check:', {
          needsFetch,
          currentDateRangeExists: !!currentDateRange,
          datesMatch: currentDateRange && 
            currentDateRange.startDate === dateRangeForQuery.startDate && 
            currentDateRange.endDate === dateRangeForQuery.endDate
        })
        
        if (needsFetch) {
          console.log('⏸️ Revenue query needs date range fetch, DEFERRING processing')
          console.log(`   Current dateRange: ${currentDateRange?.startDate} to ${currentDateRange?.endDate}`)
          console.log(`   Query dateRange: ${dateRangeForQuery.startDate} to ${dateRangeForQuery.endDate}`)
          
          // Save command to process after fetch
          pendingCommandRef.current = command
          pendingGPTDataRef.current = gptParsedData || {
            customer: gptParsedData?.customer,
            intent: 'revenue_by_customer',
            dateRange: dateRangeForQuery
          }
          
          console.log('💾 Saved pending command:', {
            command: pendingCommandRef.current,
            gptData: pendingGPTDataRef.current
          })
          
          // Show loading message
          const loadingMessage = {
            type: 'assistant',
            content: dateRangeForQuery.isMTD 
              ? `📊 Fetching orders for ${dateRangeForQuery.startDate} to ${dateRangeForQuery.endDate} (Month-to-Date)...`
              : `📊 Fetching orders for ${dateRangeForQuery.startDate} to ${dateRangeForQuery.endDate}...`,
            loading: true
          }
          setMessages(prev => [...prev, loadingMessage])
          
          // Trigger fetch (same logic as below)
          console.log('🚀 Calling onDateRangeChange to trigger fetch...')
          onDateRangeChange(dateRangeForQuery)
          
          // Return the loading message (it's already added to messages above, but return it so handleSubmit knows)
          return loadingMessage
        } else {
          console.log('✅ Date range matches, processing immediately with current orders')
        }
      } else {
        console.log('⚠️ Cannot defer - missing dateRangeForQuery, onDateRangeChange, or onFetchOrders')
      }
      
      // Use GPT-parsed customer name if available, otherwise extract with regex
      let customerName = gptParsedData?.customer || ''
      
      if (!customerName) {
        // Fallback to regex extraction (handles for/from/of)
        // Try multiple patterns to handle different phrasings
        // Pattern 1: "revenue for Oct for Air Culinaire" - extract after the last "for"
        // Pattern 2: "revenue for Air Culinaire for Oct" - extract before the date
        // Pattern 3: "revenue for Air Culinaire" - simple case
        
        const patterns = [
          // Handle "revenue for [month] for [customer]" - take the last "for" part
          /(?:revenue|sales)\s+(?:for|from|of)\s+(?:oct|jan|feb|mar|apr|may|jun|jul|aug|sep|nov|dec|january|february|march|april|may|june|july|august|september|october|november|december)\s+(?:for|from|of)\s+([a-zA-Z0-9\s]+?)(?:\s+for\s+|\s+from\s+|\s+in\s+|$)/i,
          // Handle "revenue for [customer] for [month]" - take before the date
          /(?:revenue|sales)\s+(?:for|from|of)\s+([a-zA-Z0-9\s]+?)\s+(?:for|from|of)\s+(?:oct|jan|feb|mar|apr|may|jun|jul|aug|sep|nov|dec|january|february|march|april|may|june|july|august|september|october|november|december)/i,
          // Standard pattern: "revenue for [customer]"
          /(?:revenue|sales)\s+(?:for|from|of)\s+([a-zA-Z0-9\s]+?)(?:\s+for\s+|\s+from\s+|\s+in\s+|$)/i
        ]
        
        for (const pattern of patterns) {
          const forMatch = command.match(pattern)
          if (forMatch && forMatch[1]) {
            customerName = forMatch[1].trim()
            // Remove common date-related words that might have been captured
            customerName = customerName.replace(/\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|may|june|july|august|september|october|november|december|in|during|on|20\d{2})\s*$/i, '').trim()
            // Also remove date patterns like "Oct 2025" if they appear at the end
            customerName = customerName.replace(/\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+20\d{2}\s*$/i, '').trim()
            if (customerName.length >= 3 && !/^(oct|jan|feb|mar|apr|may|jun|jul|aug|sep|nov|dec|january|february|march|april|may|june|july|august|september|october|november|december)$/i.test(customerName)) {
              break
            }
          }
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
        
        // Normalize customer name: trim, normalize spaces, handle common variations
        const normalizedSearchName = customerName.toLowerCase().trim().replace(/\s+/g, ' ')
        
        // Helper function to match customer names with multiple strategies
        const matchesCustomer = (orderCustomerName) => {
          if (!orderCustomerName) return false
          
          const normalizedOrderName = orderCustomerName.toLowerCase().trim().replace(/\s+/g, ' ')
          
          // Strategy 1: Exact match (normalized)
          if (normalizedOrderName === normalizedSearchName) return true
          
          // Strategy 2: Order name contains search name
          if (normalizedOrderName.includes(normalizedSearchName)) return true
          
          // Strategy 3: Search name contains order name (for partial searches)
          if (normalizedSearchName.includes(normalizedOrderName)) return true
          
          // Strategy 4: Word-based matching (handle "Air Culinaire" vs "Air Culinaire Worldwide")
          const searchWords = normalizedSearchName.split(/\s+/).filter(w => w.length > 2)
          const orderWords = normalizedOrderName.split(/\s+/).filter(w => w.length > 2)
          
          if (searchWords.length > 0) {
            // Check if all significant words from search are in order name
            const allWordsMatch = searchWords.every(word => 
              orderWords.some(orderWord => orderWord.includes(word) || word.includes(orderWord))
            )
            if (allWordsMatch) return true
          }
          
          // Strategy 5: Handle variations like "AirCulinaire" vs "Air Culinaire"
          const searchNoSpaces = normalizedSearchName.replace(/\s+/g, '')
          const orderNoSpaces = normalizedOrderName.replace(/\s+/g, '')
          if (searchNoSpaces === orderNoSpaces) return true
          if (orderNoSpaces.includes(searchNoSpaces)) return true
          
          return false
        }
        
        // Filter orders by customer name using improved matching
        const customerOrders = relevantOrders.filter(order => matchesCustomer(order.customerName))
        
        // Log matching details for debugging
        console.log('🔍 Customer matching debug:', {
          searchName: customerName,
          normalizedSearchName: normalizedSearchName,
          totalOrdersInRange: relevantOrders.length,
          matchedOrders: customerOrders.length,
          sampleOrderDates: relevantOrders.slice(0, 5).map(o => ({ date: o.orderDate, customer: o.customerName }))
        })
        
        if (customerOrders.length === 0 && relevantOrders.length > 0) {
          const allCustomerNames = [...new Set(relevantOrders.map(o => o.customerName).filter(Boolean))]
          const sampleCustomerNames = allCustomerNames.slice(0, 10)
          console.log('🔍 No matches found. All customer names in data:', allCustomerNames)
          console.log('🔍 Sample customer names:', sampleCustomerNames)
          console.log('🔍 Searching for:', normalizedSearchName)
          
          // Try fuzzy matching to suggest similar names
          const fuzzyMatches = allCustomerNames.filter(name => {
            const normalized = name.toLowerCase().trim()
            return normalized.includes(normalizedSearchName) || 
                   normalizedSearchName.includes(normalized) ||
                   normalized.replace(/\s+/g, '').includes(normalizedSearchName.replace(/\s+/g, ''))
          })
          
          if (fuzzyMatches.length > 0) {
            console.log('🔍 Fuzzy matches found:', fuzzyMatches)
          }
        } else {
          console.log(`✅ Found ${customerOrders.length} orders matching "${customerName}"`)
          if (customerOrders.length > 0) {
            const matchedNames = [...new Set(customerOrders.map(o => o.customerName))].slice(0, 5)
            console.log('🔍 Matched customer names:', matchedNames)
          }
        }
        
        const acceptedOrders = customerOrders.filter(order => 
          !['pending', 'cancelled', 'canceled', 'rejected'].includes(order.status?.toLowerCase())
        )
        
        const totalRevenue = acceptedOrders.reduce((sum, order) => 
          sum + (parseFloat(order.revenue) || 0), 0
        )
        
        if (customerOrders.length === 0) {
          // Provide more helpful error message
          if (relevantOrders.length === 0) {
            // No orders at all for this date range
            response.content = `No orders found for customer "${customerName}"`
            if (dateRange) {
              response.content += ` from ${dateRange.startDate} to ${dateRange.endDate}.\n\nThis could mean:\n• No orders exist for this date range\n• The date range may be invalid (too far in the future)\n• Orders haven't been loaded yet`
            }
          } else {
            // Orders exist but customer name doesn't match
            const allCustomerNames = [...new Set(relevantOrders.map(o => o.customerName).filter(Boolean))]
            const sampleCustomers = allCustomerNames.slice(0, 10)
            
            // Try fuzzy matching to suggest similar names
            const fuzzyMatches = allCustomerNames.filter(name => {
              const normalized = name.toLowerCase().trim()
              const searchNormalized = normalizedSearchName
              return normalized.includes(searchNormalized) || 
                     searchNormalized.includes(normalized) ||
                     normalized.replace(/\s+/g, '').includes(searchNormalized.replace(/\s+/g, '')) ||
                     searchNormalized.replace(/\s+/g, '').includes(normalized.replace(/\s+/g, ''))
            })
            
            response.content = `No orders found for customer "${customerName}"`
            if (dateRange) {
              response.content += ` from ${dateRange.startDate} to ${dateRange.endDate}`
            }
            response.content += `.\n\nFound ${relevantOrders.length} orders in this date range, but none match "${customerName}".`
            
            if (fuzzyMatches.length > 0) {
              response.content += `\n\nDid you mean one of these?\n${fuzzyMatches.map((name, idx) => `  ${idx + 1}. ${name}`).join('\n')}`
            } else if (sampleCustomers.length > 0) {
              response.content += `\n\nCustomer names found in this period:\n${sampleCustomers.map((name, idx) => `  ${idx + 1}. ${name}`).join('\n')}`
              if (allCustomerNames.length > 10) {
                response.content += `\n\n... and ${allCustomerNames.length - 10} more`
              }
            }
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
          !['pending', 'cancelled', 'canceled', 'rejected'].includes(order.status?.toLowerCase())
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
    // Revenue by store/retailer breakdown
    else if ((gptParsedData?.intent === 'revenue_by_store') || (!gptParsedData && (lower.includes('revenue') || lower.includes('sales')) && (lower.includes('by store') || lower.includes('by retailer') || lower.includes('by establishment') || lower.includes('top store') || lower.includes('top retailer')))) {
      const acceptedOrders = relevantOrders.filter(order => 
        !['pending', 'cancelled', 'canceled', 'rejected'].includes(order.status?.toLowerCase())
      )
      
      // Extract limit from query (e.g., "top 50 stores" -> 50)
      const limitMatch = lower.match(/top\s+(\d+)/i)
      const limit = limitMatch ? parseInt(limitMatch[1]) : 10
      
      // Group revenue by store/establishment
      const revenueByStore = {}
      acceptedOrders.forEach(order => {
        const store = order.establishment || 'Unknown'
        if (!revenueByStore[store]) {
          revenueByStore[store] = { revenue: 0, count: 0 }
        }
        revenueByStore[store].revenue += parseFloat(order.revenue) || 0
        revenueByStore[store].count += 1
      })
      
      // Sort by revenue amount descending
      const sortedStores = Object.entries(revenueByStore)
        .sort((a, b) => b[1].revenue - a[1].revenue)
        .slice(0, limit) // Use dynamic limit
      
      const totalRevenue = acceptedOrders.reduce((sum, order) => sum + (parseFloat(order.revenue) || 0), 0)
      
      if (sortedStores.length === 0) {
        response.content = 'No store revenue data available for the selected period'
      } else {
        response.content = '' // Only show the visual card
      }
      
      response.data = sortedStores.length > 0 ? {
        type: 'brandBreakdown',
        brands: sortedStores.map(([store, data]) => ({
          brand: store,
          revenue: data.revenue,
          count: data.count,
          orderCount: data.count // For stores, orderCount = count
        })),
        total: totalRevenue,
        orderCount: acceptedOrders.length,
        totalBrands: null, // Not a brand query, so null
        totalStores: Object.keys(revenueByStore).length // Total number of stores
      } : null
    }
    // Revenue by month breakdown
    else if ((gptParsedData?.intent === 'revenue_by_month') || (!gptParsedData && (lower.includes('revenue') || lower.includes('sales')) && lower.includes('by month'))) {
      const acceptedOrders = relevantOrders.filter(order => 
        !['pending', 'cancelled', 'canceled', 'rejected'].includes(order.status?.toLowerCase())
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
        !['pending', 'cancelled', 'canceled', 'rejected'].includes(order.status?.toLowerCase())
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
        !['pending', 'cancelled', 'canceled', 'rejected'].includes(order.status?.toLowerCase())
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
    // Tip query
    else if ((gptParsedData?.intent === 'tip') || (!gptParsedData && (lower.includes('tip') || lower.includes('gratuity')))) {
      const acceptedOrders = relevantOrders.filter(order => 
        !['pending', 'cancelled', 'canceled', 'rejected'].includes(order.status?.toLowerCase())
      )
      const totalTip = acceptedOrders.reduce((sum, order) => 
        sum + (parseFloat(order.tip) || 0), 0
      )
      
      if (relevantOrders.length === 0) {
        response.content = dateRange
          ? `No orders found for ${dateRange.startDate} to ${dateRange.endDate}. The date range might not have any orders, or they haven't been loaded yet.`
          : 'No orders currently loaded. Try specifying a date range.'
      } else {
        const mtdSuffix = dateRange?.isMTD ? ' (Month-to-Date)' : ''
        response.content = dateRange
          ? `Total tips for ${dateRange.startDate} to ${dateRange.endDate}${mtdSuffix}: ${formatDollarAmount(totalTip)} from ${formatNumber(acceptedOrders.length)} accepted orders (out of ${formatNumber(relevantOrders.length)} total orders)`
          : `Total tips: ${formatDollarAmount(totalTip)} from ${formatNumber(acceptedOrders.length)} accepted orders`
      }
      
      response.data = acceptedOrders.length > 0 ? {
        type: 'tip',
        totalTip: totalTip,
        orderCount: acceptedOrders.length,
        averageTipPerOrder: acceptedOrders.length > 0 ? totalTip / acceptedOrders.length : 0
      } : null
    }
    // Delivery charge query
    else if ((gptParsedData?.intent === 'delivery_charge') || (!gptParsedData && (lower.includes('delivery') && (lower.includes('charge') || lower.includes('fee'))))) {
      const acceptedOrders = relevantOrders.filter(order => 
        !['pending', 'cancelled', 'canceled', 'rejected'].includes(order.status?.toLowerCase())
      )
      const totalDeliveryCharge = acceptedOrders.reduce((sum, order) => 
        sum + (parseFloat(order.shippingFee) || 0) + (parseFloat(order.deliveryFee) || 0), 0
      )
      
      if (relevantOrders.length === 0) {
        response.content = dateRange
          ? `No orders found for ${dateRange.startDate} to ${dateRange.endDate}. The date range might not have any orders, or they haven't been loaded yet.`
          : 'No orders currently loaded. Try specifying a date range.'
      } else {
        const mtdSuffix = dateRange?.isMTD ? ' (Month-to-Date)' : ''
        response.content = dateRange
          ? `Total delivery charges (shipping + delivery fees) for ${dateRange.startDate} to ${dateRange.endDate}${mtdSuffix}: ${formatDollarAmount(totalDeliveryCharge)} from ${formatNumber(acceptedOrders.length)} accepted orders (out of ${formatNumber(relevantOrders.length)} total orders)`
          : `Total delivery charges: ${formatDollarAmount(totalDeliveryCharge)} from ${formatNumber(acceptedOrders.length)} accepted orders`
      }
      
      response.data = acceptedOrders.length > 0 ? {
        type: 'delivery_charge',
        totalDeliveryCharge: totalDeliveryCharge,
        orderCount: acceptedOrders.length,
        averageDeliveryChargePerOrder: acceptedOrders.length > 0 ? totalDeliveryCharge / acceptedOrders.length : 0
      } : null
    }
    // Tax by state query
    else if ((gptParsedData?.intent === 'tax_by_state') || (!gptParsedData && lower.includes('tax') && lower.includes('by state'))) {
      // Check if orders have state data
      const hasStateData = relevantOrders.some(o => o.shipToState)
      console.log(`🗺️  Tax by state query - orders have state data: ${hasStateData}`)
      
      const acceptedOrders = relevantOrders.filter(order => 
        !['pending', 'cancelled', 'canceled', 'rejected'].includes(order.status?.toLowerCase())
      )
      
      // Group tax by state (including service charge tax)
      const taxByState = {}
      acceptedOrders.forEach(order => {
        const state = order.shipToState || 'Unknown'
        if (!taxByState[state]) {
          taxByState[state] = { tax: 0, count: 0 }
        }
        const orderTax = (parseFloat(order.tax) || 0) + (parseFloat(order.serviceChargeTax) || 0)
        taxByState[state].tax += orderTax
        taxByState[state].count += 1
      })
      
      // Sort by tax amount descending
      const sortedStates = Object.entries(taxByState)
        .sort((a, b) => b[1].tax - a[1].tax)
        .slice(0, 10) // Top 10 states
      
      const totalTax = acceptedOrders.reduce((sum, order) => 
        sum + (parseFloat(order.tax) || 0) + (parseFloat(order.serviceChargeTax) || 0), 0)
      
      if (sortedStates.length === 0) {
        response.content = 'No tax data available for the selected period'
      } else {
        response.content = '' // Only show the visual card, no text
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
    // Sales/Revenue by state query
    else if ((gptParsedData?.intent === 'sales_by_state') || (!gptParsedData && (lower.includes('sales') || lower.includes('revenue')) && lower.includes('by state'))) {
      const acceptedOrders = relevantOrders.filter(order => 
        !['pending', 'cancelled', 'canceled', 'rejected'].includes(order.status?.toLowerCase())
      )
      
      // Group revenue by state
      const revenueByState = {}
      acceptedOrders.forEach(order => {
        const state = order.shipToState || 'Unknown'
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
        response.content = '' // Only show the visual card, no text
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
    // General tax query
    else if ((gptParsedData?.intent === 'tax') || (!gptParsedData && lower.includes('tax'))) {
      const acceptedOrders = relevantOrders.filter(order => 
        !['pending', 'cancelled', 'canceled', 'rejected'].includes(order.status?.toLowerCase())
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
    // Not delivered orders (accepted or pending status)
    else if ((gptParsedData?.intent === 'not_delivered_orders') || 
             (!gptParsedData && (
               (lower.includes('not') && lower.includes('delivered')) ||
               (lower.includes('haven\'t') && lower.includes('delivered')) ||
               (lower.includes('have not') && lower.includes('delivered')) ||
               lower.includes('undelivered')
             ))) {
      // Filter for orders with status "accepted" or "pending" (not delivered)
      const notDeliveredOrders = relevantOrders.filter(order => {
        const status = order.status?.toLowerCase()
        return status === 'accepted' || status === 'pending'
      })
      
      const mtdSuffix = dateRange?.isMTD ? ' (Month-to-Date)' : ''
      response.content = dateRange
        ? `Found ${formatNumber(notDeliveredOrders.length)} orders that have not been delivered (Accepted or Pending status) from ${dateRange.startDate} to ${dateRange.endDate}${mtdSuffix}`
        : `Found ${formatNumber(notDeliveredOrders.length)} orders that have not been delivered (Accepted or Pending status)`
      
      response.data = {
        type: 'orders',
        orders: notDeliveredOrders,
        total: notDeliveredOrders.length,
        orderType: 'Not Delivered'
      }
    }
    // Delivered orders
    else if ((gptParsedData?.intent === 'delivered_orders') || (!gptParsedData && lower.includes('delivered') && !lower.includes('not') && !lower.includes('haven\'t') && !lower.includes('have not'))) {
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
    // Order status check/validation
    else if ((gptParsedData?.intent === 'order_status_check') || 
             (!gptParsedData && (
               lower.includes('are all orders') || 
               lower.includes('are any orders') ||
               lower.includes('how many orders are') ||
               lower.includes('check order status') ||
               lower.includes('order status summary') ||
               lower.includes('status breakdown')
             ))) {
      
      // Count orders by status
      const statusCounts = {}
      relevantOrders.forEach(order => {
        const status = order.status?.toLowerCase() || 'unknown'
        statusCounts[status] = (statusCounts[status] || 0) + 1
      })
      
      const acceptedCount = statusCounts['accepted'] || 0
      const pendingCount = statusCounts['pending'] || 0
      const rejectedCount = (statusCounts['rejected'] || 0) + (statusCounts['cancelled'] || 0) + (statusCounts['canceled'] || 0)
      const deliveredCount = statusCounts['delivered'] || 0
      const otherCount = relevantOrders.length - acceptedCount - pendingCount - rejectedCount - deliveredCount
      
      // Build response based on what was asked
      const mtdSuffix = dateRange?.isMTD ? ' (Month-to-Date)' : ''
      const dateInfo = dateRange ? ` from ${dateRange.startDate} to ${dateRange.endDate}${mtdSuffix}` : ''
      
      // Check if asking about "all orders accepted"
      if (lower.includes('are all orders accepted')) {
        if (relevantOrders.length === 0) {
          response.content = `No orders found${dateInfo}`
        } else if (acceptedCount === relevantOrders.length) {
          response.content = `✅ Yes, all ${formatNumber(relevantOrders.length)} orders are accepted${dateInfo}`
        } else {
          const issues = []
          if (pendingCount > 0) issues.push(`${formatNumber(pendingCount)} pending`)
          if (rejectedCount > 0) issues.push(`${formatNumber(rejectedCount)} rejected/cancelled`)
          if (deliveredCount > 0) issues.push(`${formatNumber(deliveredCount)} delivered`)
          if (otherCount > 0) issues.push(`${formatNumber(otherCount)} other`)
          
          response.content = `❌ No, ${formatNumber(acceptedCount)} of ${formatNumber(relevantOrders.length)} orders are accepted${dateInfo}\n\nOther statuses:\n${issues.map(i => `  • ${i}`).join('\n')}`
        }
      }
      // Check if asking about pending orders
      else if (lower.includes('are any orders pending') || lower.includes('any pending')) {
        if (pendingCount > 0) {
          response.content = `⚠️ Yes, ${formatNumber(pendingCount)} orders are pending${dateInfo}`
        } else {
          response.content = `✅ No, there are no pending orders${dateInfo}`
        }
      }
      // General status breakdown
      else {
        const breakdown = []
        if (acceptedCount > 0) breakdown.push(`  ✅ Accepted: ${formatNumber(acceptedCount)}`)
        if (pendingCount > 0) breakdown.push(`  ⏳ Pending: ${formatNumber(pendingCount)}`)
        if (rejectedCount > 0) breakdown.push(`  ❌ Rejected/Cancelled: ${formatNumber(rejectedCount)}`)
        if (deliveredCount > 0) breakdown.push(`  📦 Delivered: ${formatNumber(deliveredCount)}`)
        if (otherCount > 0) breakdown.push(`  ❓ Other: ${formatNumber(otherCount)}`)
        
        response.content = `Order Status Summary${dateInfo}:\n\nTotal Orders: ${formatNumber(relevantOrders.length)}\n\n${breakdown.join('\n')}`
      }
      
      response.data = {
        type: 'statusBreakdown',
        total: relevantOrders.length,
        accepted: acceptedCount,
        pending: pendingCount,
        rejected: rejectedCount,
        delivered: deliveredCount,
        other: otherCount
      }
    }
    // Accepted orders (specific query for accepted status)
    else if (gptParsedData?.intent === 'accepted_orders' || 
             (lower.includes('accepted') && (lower.includes('order') || lower.includes('orders')) && 
              (lower.includes('show') || lower.includes('list') || lower.includes('display') || lower.includes('see') || lower.includes('all') || lower.includes('get')))) {
      console.log('✅ Matched accepted_orders handler')
      const acceptedOrders = relevantOrders.filter(order => 
        order.status?.toLowerCase() === 'accepted'
      )
      
      const mtdSuffix = dateRange?.isMTD ? ' (Month-to-Date)' : ''
      response.content = dateRange
        ? `Found ${formatNumber(acceptedOrders.length)} accepted orders from ${dateRange.startDate} to ${dateRange.endDate}${mtdSuffix}`
        : `Found ${formatNumber(acceptedOrders.length)} accepted orders`
      
      response.data = {
        type: 'orders',
        orders: acceptedOrders,
        total: acceptedOrders.length,
        orderType: 'Accepted'
      }
    }
    // Total orders
    else if ((gptParsedData?.intent === 'total_orders') || (!gptParsedData && (lower.includes('how many orders') || lower.includes('total orders') || (lower.includes('show') && lower.includes('orders'))))) {
      const mtdSuffix = dateRange?.isMTD ? ' (Month-to-Date)' : ''
      
      // Extract customer name if present (from GPT or regex fallback)
      let customerName = gptParsedData?.customer || ''
      
      if (!customerName) {
        // Fallback regex extraction for "orders from [customer]" or "orders for [customer]"
        // Try multiple patterns to catch different phrasings
        // Pattern 1: "show me all the orders from Vistajet for Oct 2025"
        // Pattern 2: "orders from Vistajet for Oct 2025"
        // Pattern 3: "orders for Vistajet"
        const patterns = [
          /(?:show\s+me\s+all\s+)?(?:the\s+)?orders?\s+(?:from|for|by|of)\s+([a-zA-Z0-9\s]+?)(?:\s+(?:for|in|during)\s+(?:oct|jan|feb|mar|apr|may|jun|jul|aug|sep|nov|dec|january|february|march|april|may|june|july|august|september|october|november|december)\s+|\s+(?:from|in|during)\s+|$)/i,
          /orders?\s+(?:from|for|by|of)\s+([a-zA-Z0-9\s]+?)(?:\s+(?:for|in|during)\s+(?:oct|jan|feb|mar|apr|may|jun|jul|aug|sep|nov|dec|january|february|march|april|may|june|july|august|september|october|november|december)\s+|\s+(?:from|in|during)\s+|$)/i,
          /(?:show\s+me\s+all\s+)?orders?\s+of\s+([a-zA-Z0-9\s]+?)(?:\s+in\s+(?:oct|jan|feb|mar|apr|may|jun|jul|aug|sep|nov|dec|january|february|march|april|may|june|july|august|september|october|november|december)\s+|$)/i
        ]
        
        for (const pattern of patterns) {
          const match = command.match(pattern)
          if (match && match[1]) {
            customerName = match[1].trim()
            // Remove common date-related words and phrases that might have been captured
            customerName = customerName.replace(/\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|may|june|july|august|september|october|november|december|in|during|on|this|month|2025|2024|2023|2026)\s*$/i, '').trim()
            // Also remove date patterns like "Oct 2025" if they appear at the end
            customerName = customerName.replace(/\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+20\d{2}\s*$/i, '').trim()
            if (customerName.length >= 3) {
              break
            }
          }
        }
      }
      
      console.log('💼 Customer name for orders query:', customerName, '| Source:', gptParsedData?.customer ? 'GPT' : 'Regex')
      console.log('📊 Relevant orders before customer filter:', relevantOrders.length)
      console.log('📅 Date range:', dateRange)
      
      // Filter by customer if specified - use sophisticated matching
      let ordersToShow = relevantOrders
      if (customerName && customerName.length >= 3) {
        // Normalize customer name: trim, normalize spaces, handle common variations
        const normalizedSearchName = customerName.toLowerCase().trim().replace(/\s+/g, ' ')
        console.log('🔍 Normalized search name:', normalizedSearchName)
        
        // Helper function to match customer names with multiple strategies
        const matchesCustomer = (orderCustomerName) => {
          if (!orderCustomerName) return false
          
          const normalizedOrderName = orderCustomerName.toLowerCase().trim().replace(/\s+/g, ' ')
          
          // Strategy 1: Exact match (normalized)
          if (normalizedOrderName === normalizedSearchName) return true
          
          // Strategy 2: Order name contains search name
          if (normalizedOrderName.includes(normalizedSearchName)) return true
          
          // Strategy 3: Search name contains order name (for partial searches)
          if (normalizedSearchName.includes(normalizedOrderName)) return true
          
          // Strategy 4: Word-based matching (handle "Air Culinaire" vs "Air Culinaire Worldwide")
          const searchWords = normalizedSearchName.split(/\s+/).filter(w => w.length > 2)
          const orderWords = normalizedOrderName.split(/\s+/).filter(w => w.length > 2)
          
          if (searchWords.length > 0) {
            // Check if all significant words from search are in order name
            const allWordsMatch = searchWords.every(word => 
              orderWords.some(orderWord => orderWord.includes(word) || word.includes(orderWord))
            )
            if (allWordsMatch) return true
          }
          
          // Strategy 5: Handle variations like "AirCulinaire" vs "Air Culinaire" or "Vistajet" vs "VistaJet"
          const searchNoSpaces = normalizedSearchName.replace(/\s+/g, '')
          const orderNoSpaces = normalizedOrderName.replace(/\s+/g, '')
          if (searchNoSpaces === orderNoSpaces) return true
          if (orderNoSpaces.includes(searchNoSpaces)) return true
          
          return false
        }
        
        // Show sample customer names from relevant orders for debugging
        const sampleCustomerNames = [...new Set(relevantOrders.slice(0, 20).map(o => o.customerName).filter(Boolean))]
        console.log('🔍 Sample customer names in date range:', sampleCustomerNames)
        
        ordersToShow = relevantOrders.filter(order => matchesCustomer(order.customerName))
        
        console.log(`🔍 Filtered to ${ordersToShow.length} orders for customer "${customerName}"`)
        
        // Debug logging for customer matching
        if (ordersToShow.length === 0 && relevantOrders.length > 0) {
          const allCustomerNames = [...new Set(relevantOrders.map(o => o.customerName).filter(Boolean))]
          console.log('❌ No matches found. All unique customer names in date range:', allCustomerNames)
          console.log('🔍 Searching for normalized:', normalizedSearchName)
          
          // Try fuzzy matching to suggest similar names
          const fuzzyMatches = allCustomerNames.filter(name => {
            const normalized = name.toLowerCase().trim()
            return normalized.includes(normalizedSearchName) || 
                   normalizedSearchName.includes(normalized) ||
                   normalized.replace(/\s+/g, '').includes(normalizedSearchName.replace(/\s+/g, ''))
          })
          
          if (fuzzyMatches.length > 0) {
            console.log('💡 Fuzzy matches found:', fuzzyMatches)
          } else {
            console.log('⚠️ No fuzzy matches found. Customer name might be spelled differently in data.')
          }
        } else if (ordersToShow.length > 0) {
          const matchedNames = [...new Set(ordersToShow.map(o => o.customerName))].slice(0, 5)
          console.log('✅ Matched customer names:', matchedNames)
        }
      } else {
        console.log('⚠️ No customer name provided or customer name too short')
      }
      
      // Check if user wants to SEE the orders (show, list, display) or just get a count
      const wantsToSeeOrders = lower.includes('show') || lower.includes('list') || lower.includes('display') || lower.includes('see')
      
      if (wantsToSeeOrders && ordersToShow.length > 0) {
        // Show the actual orders
        const dateInfo = dateRange ? ` from ${dateRange.startDate} to ${dateRange.endDate}${mtdSuffix}` : ''
        const customerInfo = customerName ? ` for ${customerName}` : ''
        response.content = `Found ${formatNumber(ordersToShow.length)} orders${customerInfo}${dateInfo}`
        
        response.data = {
          type: 'orders',
          orders: ordersToShow,
          total: ordersToShow.length,
          orderType: customerName ? `Orders for ${customerName}` : 'All Orders',
          customerName: customerName || undefined
        }
      } else if (ordersToShow.length === 0) {
        // No orders found
        const dateInfo = dateRange ? ` from ${dateRange.startDate} to ${dateRange.endDate}` : ''
        const customerInfo = customerName ? ` for customer "${customerName}"` : ''
        response.content = `No orders found${customerInfo}${dateInfo}`
        response.data = null
      } else {
        // Just show count
        const dateInfo = dateRange ? ` from ${dateRange.startDate} to ${dateRange.endDate}${mtdSuffix}` : ''
        const customerInfo = customerName ? ` for ${customerName}` : ''
        response.content = `There are ${formatNumber(ordersToShow.length)} orders${customerInfo}${dateInfo}`
        
        response.data = {
          type: 'count',
          count: ordersToShow.length
        }
      }
    }
    // Average order value
    else if ((gptParsedData?.intent === 'average_order_value') || (!gptParsedData && (lower.includes('average') || lower.includes('aov')))) {
      const acceptedOrders = relevantOrders.filter(order => 
        !['pending', 'cancelled', 'canceled', 'rejected'].includes(order.status?.toLowerCase())
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
      console.log('⚠️ No matching intent handler found')
      console.log('⚠️ GPT intent:', gptParsedData?.intent)
      response.content = "Sorry, I don't know how to handle this request.\n\nI can help you with:\n• Revenue, tax, tips, service charges, delivery charges\n• Delayed, pending, or delivered orders\n• Orders by customer (Sendoso, OnGoody, Air Culinaire)\n• Date-based queries (MTD, YTD, specific months)\n\nTry rephrasing your question or use one of the examples above."
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
    const pendingDateRange = pendingGPTDataRef.current?.dateRange
    console.log('🔍 Orders or loading status changed:', {
      hasPendingCommand: !!pendingCommandRef.current,
      isLoadingData,
      ordersCount: orders.length,
      pendingCommand: pendingCommandRef.current,
      pendingDateRange: pendingDateRange,
      currentDateRange: currentDateRange // Add current date range from props
    })
    
    if (pendingCommandRef.current && !isLoadingData) {
      // Check if we're waiting for a specific date range
      if (pendingDateRange) {
        // CRITICAL: Verify that the current dateRange matches the pending dateRange
        // This ensures we're processing with orders from the correct date range
        const dateRangeMatches = currentDateRange && 
          currentDateRange.startDate === pendingDateRange.startDate && 
          currentDateRange.endDate === pendingDateRange.endDate
        
        if (!dateRangeMatches) {
          console.log(`⏳ Date range mismatch - waiting for date range to update:`)
          console.log(`   Current: ${currentDateRange?.startDate} to ${currentDateRange?.endDate}`)
          console.log(`   Pending: ${pendingDateRange.startDate} to ${pendingDateRange.endDate}`)
          return // Don't process yet, wait for date range to match
        }
        
        // Verify that we have orders for the requested date range
        const ordersInRange = orders.filter(order => {
          const orderDate = order.orderDate
          return orderDate >= pendingDateRange.startDate && orderDate <= pendingDateRange.endDate
        })
        console.log(`📅 Date range matches! Checking orders:`)
        console.log(`   Requested: ${pendingDateRange.startDate} to ${pendingDateRange.endDate}`)
        console.log(`   Found ${ordersInRange.length} orders in requested date range out of ${orders.length} total orders`)
        
        // CRITICAL: Only process if we have orders in the requested range
        // Don't process if we only have orders from a different date range
        if (ordersInRange.length === 0) {
          console.log('⏳ Waiting for orders in date range to load... (not processing yet)')
          return // Don't process yet, wait for orders in the correct date range
        }
        
        console.log(`✅ Found ${ordersInRange.length} orders in requested date range, processing command`)
      } else if (orders.length === 0) {
        // No date range specified, but no orders loaded - wait
        console.log('⏳ Waiting for orders to load...')
        return
      }
      
      console.log('🤖 Processing pending command with loaded data:', orders.length, 'orders')
      console.log('🎯 Pending GPT data:', pendingGPTDataRef.current)
      
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
  }, [orders, isLoadingData, currentDateRange]) // Add currentDateRange to dependencies
  
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
    
    // Save input before clearing
    const userInput = input
    
    // Clear input immediately (like GPT)
    setInput('')
    
    // Add user message
    const userMessage = {
      type: 'user',
      content: userInput
    }
    setMessages(prev => [...prev, userMessage])
    
    // Try to parse using GPT-4o-mini first, fallback to rule-based parsing
    let dateRange = null
    let parsedIntent = null
    let parsedCustomer = null
    let parsedBrand = null
    
    try {
      console.log('🤖 Attempting GPT-4o-mini parsing...')
      const parseResponse = await fetch('/api/parse-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: userInput })
      })
      
      if (parseResponse.ok) {
        const parseData = await parseResponse.json()
        console.log('✅ GPT parsing successful:', parseData.parsed)
        
        if (parseData.parsed.startDate && parseData.parsed.endDate) {
          // Validate and correct date range if needed
          let correctedStartDate = parseData.parsed.startDate
          let correctedEndDate = parseData.parsed.endDate
          
          const today = new Date()
          today.setHours(23, 59, 59, 999)
          const maxFutureDate = new Date()
          maxFutureDate.setDate(maxFutureDate.getDate() + 7) // Allow up to 7 days in the future
          
          const start = new Date(correctedStartDate)
          const end = new Date(correctedEndDate)
          
          // If dates are too far in the future and no explicit year was mentioned in the query,
          // try to correct to previous year (smart default for months without year)
          const hasExplicitYear = /\b(20\d{2})\b/.test(userInput)
          if (!hasExplicitYear && (start > maxFutureDate || end > maxFutureDate)) {
            // Extract month from the date
            const startMonth = start.getMonth()
            const startYear = start.getFullYear()
            const currentMonth = today.getMonth()
            const currentYear = today.getFullYear()
            
            // If the month is more than 2 months in the future, use previous year
            if (startMonth > currentMonth + 2) {
              const correctedYear = startYear - 1
              const correctedStart = new Date(correctedYear, startMonth, 1)
              const correctedEnd = new Date(correctedYear, startMonth + 1, 0) // Last day of month
              
              // Only apply correction if the corrected date is not in the future
              if (correctedEnd <= today) {
                correctedStartDate = correctedStart.toISOString().split('T')[0]
                correctedEndDate = correctedEnd.toISOString().split('T')[0]
                console.log(`📅 Corrected future date from ${parseData.parsed.startDate} to ${correctedStartDate} (using previous year)`)
              }
            }
          }
          
          dateRange = {
            startDate: correctedStartDate,
            endDate: correctedEndDate,
            isMTD: parseData.parsed.isMTD || false
          }
        }
        
        parsedIntent = parseData.parsed.intent
        parsedCustomer = parseData.parsed.customer
        parsedBrand = parseData.parsed.brand
        
        // Check if clarification is needed
        if (parseData.parsed.needsClarification) {
          console.log('🤔 Clarification needed:', parseData.parsed.clarificationNeeded)
          
          // Store the original query for later use
          originalQueryRef.current = userInput
          
          let clarificationMessage = ''
          let suggestions = []
          
          if (parseData.parsed.clarificationNeeded === 'date_range') {
            clarificationMessage = "I'd be happy to help! Could you please specify a date range or time period?\n\nFor example, you can ask for:"
            suggestions = [
              'Today',
              'This month',
              'Last month',
              'October 2025',
              'This year (YTD)'
            ]
          } else if (parseData.parsed.clarificationNeeded === 'customer_name') {
            clarificationMessage = "I'd be happy to help! Which customer would you like to see information for?\n\nAvailable customers:"
            suggestions = [
              'Sendoso',
              'OnGoody',
              'Air Culinaire'
            ]
          } else if (parseData.parsed.clarificationNeeded === 'brand_name') {
            clarificationMessage = "I'd be happy to help! Which brand would you like to see information for?\n\nFor example:"
            suggestions = [
              'Schrader',
              'Dom Perignon',
              "Tito's",
              'Grey Goose'
            ]
          }
          
          const clarificationResponse = {
            type: 'assistant',
            content: clarificationMessage,
            data: {
              type: 'clarification',
              clarificationNeeded: parseData.parsed.clarificationNeeded,
              suggestions: suggestions,
              originalQuery: userInput // Store original query in the message data
            }
          }
          
          setMessages(prev => [...prev, clarificationResponse])
          return // Exit early - don't process further
        }
        
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
      dateRange = parseDate(userInput)
    }
    
    // CRITICAL: If a date range is specified, ALWAYS fetch orders for that date range FIRST
    // before processing any command (including customer filters). This ensures we have the
    // correct data before filtering by customer.
    if (dateRange && onDateRangeChange && onFetchOrders) {
      console.log('📅 Date range detected in query - will fetch orders FIRST, then process command')
      console.log(`   Requested date range: ${dateRange.startDate} to ${dateRange.endDate}`)
      console.log(`   Current date range: ${currentDateRange?.startDate} to ${currentDateRange?.endDate}`)
      
      // Check if we need to fetch (date range doesn't match current)
      const needsFetch = !currentDateRange || 
        currentDateRange.startDate !== dateRange.startDate || 
        currentDateRange.endDate !== dateRange.endDate
      
      if (needsFetch) {
        console.log('⏸️ Date range mismatch - DEFERRING command processing until orders are loaded')
        console.log('   Step 1: Fetching orders for date range...')
        console.log('   Step 2: Will filter by customer after orders are loaded')
        
        // Save command and GPT data to process after fetch completes
        pendingCommandRef.current = userInput
        pendingGPTDataRef.current = {
          customer: parsedCustomer,
          intent: parsedIntent,
          brand: parsedBrand,
          dateRange: dateRange
        }
        
        // Show loading message
        const loadingMessage = {
          type: 'assistant',
          content: dateRange.isMTD 
            ? `📊 Fetching orders for ${dateRange.startDate} to ${dateRange.endDate} (Month-to-Date)...`
            : `📊 Fetching orders for ${dateRange.startDate} to ${dateRange.endDate}...`,
          loading: true
        }
        setMessages(prev => [...prev, loadingMessage])
        
        // Trigger fetch - useEffect will process command after orders load
        console.log('🚀 Triggering fetch for date range...')
        onDateRangeChange(dateRange)
        
        // Exit early - don't process command yet
        return
      } else {
        console.log('✅ Date range matches current - orders already loaded, processing immediately')
      }
    }
    
    // Check if this is a query with specific filters (customer, specific state) that should use existing data
    const lower = userInput.toLowerCase()
    
    // Check if this query needs state data or brand data
    const needsStateData = parsedIntent === 'tax_by_state' || parsedIntent === 'sales_by_state'
    const needsBrandData = parsedIntent === 'revenue_by_brand' || 
                           (lower.includes('brand') && (lower.includes('revenue') || lower.includes('sales') || lower.includes('top')))
    const needsCustomersByBrand = parsedIntent === 'customers_by_brand' || 
                                  (lower.includes('customer') && (lower.includes('bought') || lower.includes('ordered') || lower.includes('purchased'))) ||
                                  (lower.includes('who') && (lower.includes('bought') || lower.includes('ordered') || lower.includes('purchased') || lower.includes('buy')))
    
    // Only skip fetch for customer-specific queries or brand-customer queries (NOT for breakdown queries)
    // NOTE: This check is now AFTER the date range fetch check above, so date range always takes priority
    const hasSpecificFilter = 
      parsedCustomer || // GPT found a customer
      needsCustomersByBrand || // Customers by brand query
      (lower.includes('for ') && (lower.includes('sendoso') || lower.includes('airculinaire') || lower.includes('ongoody'))) ||
      (lower.includes('from ') && (lower.includes('sendoso') || lower.includes('airculinaire') || lower.includes('ongoody')))
    
    // Handle customers-by-brand queries (they make their own API call)
    if (needsCustomersByBrand) {
      console.log('👥 Processing customers-by-brand query...')
      
      // Extract brand name from query
      let brandName = parsedBrand || ''
      if (!brandName) {
        // Try to extract brand name from query - multiple patterns
        const patterns = [
          /(?:bought|purchased|buy|ordering|ordered)\s+([A-Z][a-zA-Z\s]+?)(?:\s+for|\s+in|\s+during|$)/i,
          /(?:which|who)\s+(?:customers?|clients?)\s+(?:bought|purchased|ordered)\s+([A-Z][a-zA-Z\s]+?)(?:\s+for|\s+in|\s+during|$)/i,
          /customers?\s+(?:for|of)\s+([A-Z][a-zA-Z\s]+?)(?:\s+for|\s+in|\s+during|$)/i
        ]
        
        for (const pattern of patterns) {
          const match = userInput.match(pattern)
          if (match && match[1]) {
            brandName = match[1].trim()
            // Clean up - remove trailing date/month words
            brandName = brandName.replace(/\s+(in|for|during|on)\s*$/i, '').trim()
            break
          }
        }
      }
      
      console.log(`👥 Extracted brand name: "${brandName}"`)
      
      if (brandName) {
        // Use provided date range or default to current month
        const effectiveDateRange = dateRange || {
          startDate: new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0') + '-01',
          endDate: new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0') + '-' + String(new Date().getDate()).padStart(2, '0')
        }
        
        // Show loading message
        const loadingMessage = {
          type: 'assistant',
          content: `🔍 Finding customers who ordered ${brandName}...`,
          loading: true
        }
        setMessages(prev => [...prev, loadingMessage])
        
        const timestamp = Date.now()
        fetch(`/api/brands/customers?startDate=${effectiveDateRange.startDate}&endDate=${effectiveDateRange.endDate}&brand=${encodeURIComponent(brandName)}&t=${timestamp}`)
          .then(res => res.json())
          .then(data => {
            if (data.success && data.customers) {
              console.log(`✅ Received ${data.customers.length} customers for brand "${data.brand}"`)
              // Create response with customer data
              const customerResponse = {
                type: 'assistant',
                content: '',
                data: {
                  type: 'customersByBrand',
                  brand: data.brand,
                  customers: data.customers,
                  totalCustomers: data.totalCustomers,
                  totalRevenue: data.totalRevenue,
                  totalBottles: data.totalBottles
                }
              }
              setMessages(prev => {
                const filtered = prev.filter(m => !m.loading)
                return [...filtered, customerResponse]
              })
            } else {
              setMessages(prev => {
                const filtered = prev.filter(m => !m.loading)
                return [...filtered, {
                  type: 'assistant',
                  content: `No customers found who purchased "${brandName}". The brand might not exist in the database or has no sales in this period.`
                }]
              })
            }
          })
          .catch(err => {
            console.error('Error fetching customers by brand:', err)
            setMessages(prev => {
              const filtered = prev.filter(m => !m.loading)
              return [...filtered, {
                type: 'assistant',
                content: 'Error fetching customer data. Please try again.'
              }]
            })
          })
        return // Exit early for customers-by-brand queries
      } else {
        setMessages(prev => [...prev, {
          type: 'assistant',
          content: 'Please specify a brand name (e.g., "which customers bought Schrader?")'
        }])
        return
      }
    }
    
    // Only fetch new data if:
    // 1. A date range is detected
    // 2. AND it's NOT a query with specific filters (those use existing data)
    if (dateRange && onDateRangeChange && onFetchOrders && !hasSpecificFilter) {
      console.log('🔍 Date range detected, fetching data:', dateRange)
      
      // Validate date range - check if dates are too far in the future
      // IMPORTANT: Allow ALL past dates - only restrict future dates
      const today = new Date()
      today.setHours(23, 59, 59, 999)
      const maxFutureDate = new Date()
      maxFutureDate.setDate(maxFutureDate.getDate() + 7) // Allow up to 7 days in the future
      
      const start = new Date(dateRange.startDate + 'T00:00:00') // Parse as local midnight
      const end = new Date(dateRange.endDate + 'T23:59:59') // Parse as end of day
      
      // Only block if dates are in the FUTURE and more than 7 days ahead
      // Past dates should always be allowed
      if ((start > today && start > maxFutureDate) || (end > today && end > maxFutureDate)) {
        const todayStr = today.toISOString().split('T')[0]
        const maxFutureStr = maxFutureDate.toISOString().split('T')[0]
        const errorMessage = {
          type: 'assistant',
          content: `❌ Invalid date range: Cannot fetch orders for dates more than 7 days in the future.\n\nRequested: ${dateRange.startDate} to ${dateRange.endDate}\nToday: ${todayStr}\nMaximum allowed future date: ${maxFutureStr}\n\nPlease select dates within the next week.`
        }
        setMessages(prev => [...prev, errorMessage])
        return // Exit early - don't fetch
      }
      
      // Check if we need state-enriched data
      if (needsStateData) {
        console.log('🗺️  Query needs state data, will fetch from /api/orders-with-state')
      }
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
      pendingCommandRef.current = userInput
      pendingGPTDataRef.current = {
        customer: parsedCustomer,
        intent: parsedIntent,
        dateRange: dateRange
      }
      
      // If this is a brand-based query, fetch brand data directly (ONE API CALL ONLY)
      if (needsBrandData) {
        console.log('🏷️  Fetching brand revenue data (single API call)...')
        
        // Extract limit from query (e.g., "top 50 brands" -> 50)
        const limitMatch = lower.match(/top\s+(\d+)/i)
        const limit = limitMatch ? parseInt(limitMatch[1]) : 10
        console.log(`📊 Requesting top ${limit} brands`)
        
        const timestamp = Date.now()
        fetch(`/api/brands/revenue?startDate=${dateRange.startDate}&endDate=${dateRange.endDate}&limit=${limit}&t=${timestamp}`)
          .then(res => res.json())
          .then(data => {
            if (data.success && data.brands) {
              console.log(`✅ Received ${data.brands.length} brands (${data.totalBrands} total)`)
              // Create response with brand data
              const brandResponse = {
                type: 'assistant',
                content: '',
                data: {
                  type: 'brandBreakdown',
                  brands: data.brands,
                  total: data.totalRevenue,
                  totalBrands: data.totalBrands,
                  unknownRevenue: data.unknownRevenue
                }
              }
              setMessages(prev => {
                const filtered = prev.filter(m => !m.loading)
                return [...filtered, brandResponse]
              })
              pendingCommandRef.current = null
              pendingGPTDataRef.current = null
            }
          })
          .catch(err => {
            console.error('Error fetching brand data:', err)
            setMessages(prev => {
              const filtered = prev.filter(m => !m.loading)
              return [...filtered, {
                type: 'assistant',
                content: 'Error fetching brand data. Please try again.'
              }]
            })
          })
        return // Exit early for brand-based queries
      }
      
      // If this is a state-based query, fetch state-enriched data directly (ONE API CALL ONLY)
      if (needsStateData) {
        console.log('🗺️  Fetching state-enriched data for state-based query (single API call)...')
        // Fetch directly from state-enriched endpoint
        const timestamp = Date.now()
        fetch(`/api/orders-with-state?startDate=${dateRange.startDate}&endDate=${dateRange.endDate}&t=${timestamp}`)
          .then(res => res.json())
          .then(data => {
            if (data.data && Array.isArray(data.data)) {
              console.log(`✅ Received ${data.stateEnriched}/${data.totalOrders} state-enriched orders`)
              // Process with enriched data (use saved pending command)
              const savedCommand = pendingCommandRef.current
              const gptData = {
                customer: parsedCustomer,
                intent: parsedIntent,
                dateRange: dateRange
              }
              // Create a custom response using enriched data
              const enrichedResponse = processCommand(savedCommand, gptData, data.data)
              setMessages(prev => {
                const filtered = prev.filter(m => !m.loading)
                return [...filtered, enrichedResponse]
              })
              pendingCommandRef.current = null
              pendingGPTDataRef.current = null
            }
          })
          .catch(err => {
            console.error('Error fetching state-enriched data:', err)
            setMessages(prev => {
              const filtered = prev.filter(m => !m.loading)
              return [...filtered, {
                type: 'assistant',
                content: 'Error fetching state data. Please try again.'
              }]
            })
          })
        return // Exit early for state-based queries - don't make regular API call
      }
      
      // For non-state queries, update date range (this will trigger regular fetchOrders via useEffect)
      onDateRangeChange(dateRange)
      
      // Set a timeout in case data never loads (longer for large date ranges)
      const timeoutDuration = dateRange ? calculateTimeoutDuration(dateRange.startDate, dateRange.endDate) : 10000
      console.log(`⏰ Setting timeout: ${timeoutDuration}ms for date range`)
      
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
      }, timeoutDuration)
      
      // IMPORTANT: Don't process command here - wait for fetch to complete
      // The useEffect will process the pending command after orders are loaded
      return // Exit early - don't process command yet
    } else {
      // Process command immediately with current data (no date range change needed)
      console.log('🤖 Processing command with current data (no fetch needed):', orders.length, 'orders')
      const gptParsedData = {
        customer: parsedCustomer,
        intent: parsedIntent,
        dateRange: dateRange
      }
      const response = processCommand(userInput, gptParsedData)
      setMessages(prev => [...prev, response])
    }
    
    // Input already cleared at the start
  }

  const handleSuggestionClick = (suggestion, originalQuery) => {
    if (originalQuery) {
      // Combine original query with suggestion
      const combinedQuery = `${originalQuery} for ${suggestion.toLowerCase()}`
      console.log('🔗 Combined query:', combinedQuery)
      setInput(combinedQuery)
      // Auto-submit after a tiny delay to let the input update
      setTimeout(() => {
        document.getElementById('chat-form')?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }))
      }, 100)
    } else {
      setInput(suggestion)
    }
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
    
    // Trigger a data refresh to get fresh orders with latest state enrichment
    if (onFetchOrders) {
      console.log('🔄 Triggering data refresh after clear chat...')
      setTimeout(() => {
        onFetchOrders()
      }, 500)
    }
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
                  {message.loading ? (
                    <div className="flex items-center space-x-2">
                      <p className="text-sm leading-relaxed">{message.content}</p>
                      <div className="flex space-x-1">
                        <div className="w-2 h-2 bg-blue-600 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                        <div className="w-2 h-2 bg-blue-600 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                        <div className="w-2 h-2 bg-blue-600 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm whitespace-pre-line leading-relaxed">{message.content}</p>
                  )}
              
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
              
              {message.data && message.data.type === 'tip' && (
                <div className="mt-3 bg-teal-50 rounded-lg p-3 border border-teal-200">
                  <div className="flex items-center mb-2">
                    <DollarSign className="h-4 w-4 text-teal-600 mr-1" />
                    <span className="text-xs font-medium text-teal-800">Tip Breakdown</span>
                  </div>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Total Tips:</span>
                      <span className="font-bold text-teal-900">{formatDollarAmount(message.data.totalTip)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Orders:</span>
                      <span className="font-semibold text-gray-900">{formatNumber(message.data.orderCount)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Avg. Tip Per Order:</span>
                      <span className="font-semibold text-gray-900">{formatDollarAmount(message.data.averageTipPerOrder)}</span>
                    </div>
                  </div>
                </div>
              )}
              
              {message.data && message.data.type === 'delivery_charge' && (
                <div className="mt-3 bg-cyan-50 rounded-lg p-3 border border-cyan-200">
                  <div className="flex items-center mb-2">
                    <DollarSign className="h-4 w-4 text-cyan-600 mr-1" />
                    <span className="text-xs font-medium text-cyan-800">Delivery Charge Breakdown</span>
                  </div>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Total Delivery Charges:</span>
                      <span className="font-bold text-cyan-900">{formatDollarAmount(message.data.totalDeliveryCharge)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Orders:</span>
                      <span className="font-semibold text-gray-900">{formatNumber(message.data.orderCount)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Avg. Delivery Charge Per Order:</span>
                      <span className="font-semibold text-gray-900">{formatDollarAmount(message.data.averageDeliveryChargePerOrder)}</span>
                    </div>
                  </div>
                </div>
              )}
              
              {message.data && message.data.type === 'statusBreakdown' && (
                <div className="mt-3 bg-gradient-to-br from-purple-50 to-pink-50 rounded-lg p-3 border border-purple-200">
                  <div className="flex items-center mb-2">
                    <Package className="h-4 w-4 text-purple-600 mr-1" />
                    <span className="text-xs font-medium text-purple-800">Order Status Breakdown</span>
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between items-center text-sm py-1 px-2 bg-white rounded border border-purple-100">
                      <span className="text-gray-700 font-semibold">Total Orders:</span>
                      <span className="font-bold text-purple-900">{formatNumber(message.data.total)}</span>
                    </div>
                    {message.data.accepted > 0 && (
                      <div className="flex justify-between items-center text-sm py-1 px-2 bg-green-50 rounded border border-green-200">
                        <span className="text-gray-700">✅ Accepted:</span>
                        <span className="font-semibold text-green-900">{formatNumber(message.data.accepted)}</span>
                      </div>
                    )}
                    {message.data.pending > 0 && (
                      <div className="flex justify-between items-center text-sm py-1 px-2 bg-yellow-50 rounded border border-yellow-200">
                        <span className="text-gray-700">⏳ Pending:</span>
                        <span className="font-semibold text-yellow-900">{formatNumber(message.data.pending)}</span>
                      </div>
                    )}
                    {message.data.rejected > 0 && (
                      <div className="flex justify-between items-center text-sm py-1 px-2 bg-red-50 rounded border border-red-200">
                        <span className="text-gray-700">❌ Rejected/Cancelled:</span>
                        <span className="font-semibold text-red-900">{formatNumber(message.data.rejected)}</span>
                      </div>
                    )}
                    {message.data.delivered > 0 && (
                      <div className="flex justify-between items-center text-sm py-1 px-2 bg-blue-50 rounded border border-blue-200">
                        <span className="text-gray-700">📦 Delivered:</span>
                        <span className="font-semibold text-blue-900">{formatNumber(message.data.delivered)}</span>
                      </div>
                    )}
                    {message.data.other > 0 && (
                      <div className="flex justify-between items-center text-sm py-1 px-2 bg-gray-50 rounded border border-gray-200">
                        <span className="text-gray-700">❓ Other:</span>
                        <span className="font-semibold text-gray-900">{formatNumber(message.data.other)}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
              
              {message.data && message.data.type === 'clarification' && (
                <div className="mt-3 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-lg p-4 border border-blue-200">
                  <div className="flex items-center mb-3">
                    <Sparkles className="h-5 w-5 text-blue-600 mr-2" />
                    <span className="text-sm font-medium text-blue-800">Quick Suggestions</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {message.data.suggestions.map((suggestion, idx) => (
                      <button
                        key={idx}
                        onClick={() => handleSuggestionClick(suggestion, message.data.originalQuery)}
                        className="px-3 py-1.5 text-sm font-medium text-blue-700 bg-white hover:bg-blue-100 border border-blue-300 rounded-lg transition-colors duration-150 ease-in-out hover:border-blue-400 hover:shadow-sm"
                      >
                        {suggestion}
                      </button>
                    ))}
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
              
              {/* Data Display - Customers by Brand */}
              {message.data && message.data.type === 'customersByBrand' && (
                <div className="mt-3 rounded-lg p-3 border bg-gradient-to-br from-purple-50 to-pink-50 border-purple-200">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center">
                      <Package className="h-4 w-4 mr-1 text-purple-600" />
                      <span className="text-xs font-medium text-purple-800">
                        Customers Who Bought "{message.data.brand}"
                      </span>
                    </div>
                    <span className="text-xs text-gray-600">
                      {message.data.totalCustomers} {message.data.totalCustomers === 1 ? 'customer' : 'customers'}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {message.data.customers.map((customer, idx) => (
                      <div key={idx} className="flex justify-between items-center text-sm py-1.5 px-2 bg-white rounded border border-purple-100">
                        <div className="flex items-center">
                          <span className="text-gray-700 font-medium mr-2">{idx + 1}.</span>
                          <span className="text-gray-900 font-semibold">{customer.customerName}</span>
                          <span className="text-gray-500 text-xs ml-2">
                            ({formatNumber(customer.orderCount)} {customer.orderCount === 1 ? 'order' : 'orders'}, {formatNumber(customer.bottles)} bottles)
                          </span>
                        </div>
                        <span className="font-bold text-purple-900">{formatDollarAmount(customer.revenue)}</span>
                      </div>
                    ))}
                    <div className="flex justify-between items-center text-sm pt-2 mt-2 border-t border-purple-200">
                      <span className="text-gray-700 font-bold">
                        Total ({formatNumber(message.data.totalBottles)} bottles):
                      </span>
                      <span className="font-bold text-base text-purple-900">{formatDollarAmount(message.data.totalRevenue)}</span>
                    </div>
                  </div>
                </div>
              )}
              
              {/* Data Display - Brand/Store Breakdown */}
              {message.data && message.data.type === 'brandBreakdown' && (
                <div className="mt-3 rounded-lg p-3 border bg-gradient-to-br from-blue-50 to-indigo-50 border-blue-200">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center">
                      <TrendingUp className="h-4 w-4 mr-1 text-blue-600" />
                      <span className="text-xs font-medium text-blue-800">
                        {message.data.totalBrands ? 'Revenue by Brand' : 'Revenue by Store/Retailer'}
                      </span>
                    </div>
                    {(message.data.totalBrands || message.data.totalStores) && (
                      <span className="text-xs text-gray-600">
                        Showing {message.data.brands.length} of {formatNumber(message.data.totalBrands || message.data.totalStores)}
                      </span>
                    )}
                  </div>
                  <div className="space-y-2">
                    {message.data.brands.map((brandData, idx) => (
                      <div key={idx} className="flex justify-between items-center text-sm py-1.5 px-2 bg-white rounded border border-blue-100">
                        <div className="flex items-center">
                          <span className="text-gray-700 font-medium mr-2">{idx + 1}.</span>
                          <span className="text-gray-900 font-semibold">{brandData.brand}</span>
                          <span className="text-gray-500 text-xs ml-2">
                            ({formatNumber(brandData.orderCount || brandData.count)} {message.data.totalBrands ? 'customers' : 'orders'}
                            {brandData.itemCount && `, ${formatNumber(brandData.itemCount)} bottles`})
                          </span>
                        </div>
                        <span className="font-bold text-blue-900">{formatDollarAmount(brandData.revenue)}</span>
                      </div>
                    ))}
                    <div className="flex justify-between items-center text-sm pt-2 mt-2 border-t border-blue-200">
                      <span className="text-gray-700 font-bold">
                        Total:
                      </span>
                      <span className="font-bold text-base text-blue-900">{formatDollarAmount(message.data.total)}</span>
                    </div>
                    {message.data.unknownRevenue > 0 && (
                      <div className="text-xs text-gray-600 mt-2 pt-2 border-t border-blue-100">
                        <span className="italic">
                          Note: {formatDollarAmount(message.data.unknownRevenue)} from products without brand information (excluded from breakdown)
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}
              
              {message.data && message.data.type === 'orders' && message.data.orders.length > 0 && (
                <div className="mt-3 -mx-4 bg-blue-50 rounded-lg p-3 border border-blue-200">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center">
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
                    <button
                      onClick={() => {
                        // Convert orders to CSV
                        const ordersToExport = message.data.orders
                        const headers = ['Order ID', 'Customer', 'Amount', 'Date', 'Status']
                        const csvRows = [
                          headers.join(','),
                          ...ordersToExport.map(order => {
                            const orderId = (order.ordernum || order.id || '').replace(/,/g, '')
                            const customer = (order.customerName || '').replace(/,/g, '')
                            const amount = (order.total || 0).toString().replace(/,/g, '')
                            const date = (order.orderDate || '').replace(/,/g, '')
                            const status = (order.status || '').replace(/,/g, '')
                            return [orderId, customer, amount, date, status].map(field => `"${field}"`).join(',')
                          })
                        ]
                        
                        const csvContent = csvRows.join('\n')
                        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
                        const link = document.createElement('a')
                        const url = URL.createObjectURL(blob)
                        
                        // Generate filename
                        const customerPart = message.data.customerName ? `_${message.data.customerName.replace(/[^a-z0-9]/gi, '_')}` : ''
                        const orderTypePart = message.data.orderType ? `_${message.data.orderType.replace(/[^a-z0-9]/gi, '_')}` : ''
                        const filename = `orders${customerPart}${orderTypePart}_${new Date().toISOString().split('T')[0]}.csv`
                        
                        link.setAttribute('href', url)
                        link.setAttribute('download', filename)
                        link.style.visibility = 'hidden'
                        document.body.appendChild(link)
                        link.click()
                        document.body.removeChild(link)
                      }}
                      className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-blue-700 hover:text-blue-900 bg-blue-100 hover:bg-blue-200 rounded transition-colors"
                      title="Download as CSV"
                    >
                      <Download className="h-3 w-3" />
                      <span className="hidden sm:inline">CSV</span>
                    </button>
                  </div>
                  <div className="space-y-1">
                    {/* Header Row */}
                    <div className="text-xs bg-gray-50 rounded px-2 py-1.5 border border-blue-200 font-mono font-semibold">
                      <div className="grid grid-cols-[2fr_2fr_1.5fr_1fr_1.2fr] gap-2 items-center">
                        <div className="text-gray-600">Order ID</div>
                        <div className="text-gray-600">Customer</div>
                        <div className="text-gray-600 text-right">Amount</div>
                        <div className="text-gray-600 text-center">Date</div>
                        <div className="text-gray-600 text-right">Status</div>
                      </div>
                    </div>
                    {/* Order Rows */}
                    {(expandedOrders[index] ? message.data.orders : message.data.orders.slice(0, 10)).map((order, idx) => (
                      <div key={idx} className="text-xs bg-white rounded px-2 py-1.5 border border-blue-100 font-mono">
                        <div className="grid grid-cols-[2fr_2fr_1.5fr_1fr_1.2fr] gap-2 items-center">
                          <div className="font-semibold text-gray-900 truncate" title={order.ordernum || order.id}>
                            {order.ordernum || order.id}
                          </div>
                          <div className="text-gray-700 truncate" title={order.customerName}>
                            {order.customerName}
                          </div>
                          <div className="text-blue-700 font-semibold text-right">
                            {formatDollarAmount(order.total)}
                          </div>
                          <div className="text-gray-600 text-center">
                            {order.orderDate}
                          </div>
                          <div className={`font-medium text-right ${
                            order.status?.toLowerCase() === 'delivered' ? 'text-green-600' :
                            order.status?.toLowerCase() === 'pending' ? 'text-amber-600' :
                            order.status?.toLowerCase() === 'canceled' ? 'text-red-600' :
                            order.status?.toLowerCase() === 'in_transit' ? 'text-blue-600' :
                            'text-gray-600'
                          }`}>
                            {order.status}
                          </div>
                        </div>
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
      <form id="chat-form" onSubmit={handleSubmit} className="p-2 bg-white border-t border-gray-200">
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

