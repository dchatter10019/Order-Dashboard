const express = require('express')
const cors = require('cors')
const axios = require('axios')
const path = require('path')
require('dotenv').config()

const app = express()
const PORT = process.env.PORT || 3001

// Middleware
app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:3001', 'http://127.0.0.1:3001'],
  credentials: true
}))
app.use(express.json())

// Serve static files from the dist directory
app.use(express.static(path.join(__dirname, 'dist')))

// Add some debugging
app.use((req, res, next) => {
  console.log(`${req.method} ${req.path}`)
  next()
})

// CSV parsing function
function parseCSVToOrders(csvData, orderDate) {
  try {
    console.log('Starting CSV parsing...')
    console.log('Raw CSV data type:', typeof csvData)
    console.log('Raw CSV data length:', csvData.length)
    
    // Split CSV into lines
    const lines = csvData.split('\n').filter(line => line.trim())
    console.log('Number of lines after splitting:', lines.length)
    console.log('First few lines:', lines.slice(0, 3))
    
    if (lines.length < 2) {
      console.log('CSV has insufficient data (less than 2 lines), using mock data')
      return getMockOrders(orderDate)
    }
    
    // Check if the CSV actually contains meaningful data (not just headers)
    if (lines.length === 2 && lines[1].trim().length < 10) {
      console.log('CSV contains only headers and minimal data, using mock data')
      return getMockOrders(orderDate)
    }
    
    // Parse header row
    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''))
    console.log('CSV Headers:', headers)
    console.log('Number of headers:', headers.length)
    
    // Parse data rows
    const orders = []
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]
      if (!line.trim()) continue
      
      // Simple CSV parsing (handles quoted fields)
      const values = parseCSVLine(line)
      console.log(`Line ${i}: values count = ${values.length}, headers count = ${headers.length}`)
      
      if (values.length >= headers.length) {
        const order = createOrderFromCSV(headers, values, orderDate)
        if (order) {
          orders.push(order)
        }
      } else {
        console.log(`Line ${i} skipped: insufficient values (${values.length} < ${headers.length})`)
      }
    }
    
    console.log(`Parsed ${orders.length} orders from CSV`)
    if (orders.length === 0) {
      console.log('No orders parsed, falling back to mock data')
    }
    return orders.length > 0 ? orders : getMockOrders(orderDate)
    
  } catch (error) {
    console.error('CSV parsing error:', error)
    return getMockOrders(orderDate)
  }
}

// Parse CSV line with proper quote handling
function parseCSVLine(line) {
  const values = []
  let current = ''
  let inQuotes = false
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    
    if (char === '"') {
      inQuotes = !inQuotes
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  
  values.push(current.trim())
  return values
}

// Create order object from CSV data
function createOrderFromCSV(headers, values, orderDate) {
  try {
    // Map Bevvi CSV fields to our order structure
    const order = {
      id: '',
      customerName: '',
      orderDate: orderDate,
      deliveryDate: '', // Will be set separately if available
      status: 'pending',
      total: 0,
      items: [],
      address: '',
      phone: '',
      establishment: '',
      revenue: 0,
      tax: 0,
      tip: 0,
      shippingFee: 0,
      deliveryFee: 0,
      serviceCharge: 0,
      // Additional Bevvi API fields
      monthYear: '',
      giftNoteCharge: 0,
      promoDiscAmt: 0,
      serviceChargeTax: 0,
      stripePaymentId: ''
    }
    
    // Map fields based on Bevvi CSV structure
    headers.forEach((header, index) => {
      const value = values[index] || ''
      const lowerHeader = header.toLowerCase().trim()
      
      switch (lowerHeader) {
        case 'ordernum':
          order.id = value || `ORD${Date.now()}-${index}`
          break
        case 'customername':
          order.customerName = value || 'Unknown Customer'
          break
        case 'totalamount':
          order.total = parseFloat(value) || 0
          order.totalAmount = parseFloat(value) || 0  // Also preserve the original API value
          break
        case 'revenue':
          order.revenue = parseFloat(value) || 0
          break
        case 'tax':
          order.tax = parseFloat(value) || 0
          break
        case 'tip':
          order.tip = parseFloat(value) || 0
          break
        case 'shippingfee':
          order.shippingFee = parseFloat(value) || 0
          break
        case 'deliveryfee':
          order.deliveryFee = parseFloat(value) || 0
          break
        case 'servicecharge':
          order.serviceCharge = parseFloat(value) || 0
          break
        case 'status':
          // Map status strings from the new store transactions API
          // The new API returns actual status strings like "Delivered", "In Transit", etc.
          let statusValue = 'pending'
          
          // Convert the status string to lowercase and normalize it
          const normalizedStatus = value ? value.toLowerCase().trim() : ''
          
          // Debug: Log the actual status value from CSV
          console.log(`Raw status from CSV for order ${order.id}: "${value}" -> normalized: "${normalizedStatus}"`)
          
          if (normalizedStatus.includes('delivered') || normalizedStatus === 'delivered') {
            statusValue = 'delivered'
          } else if (normalizedStatus.includes('transit') || normalizedStatus === 'in transit') {
            statusValue = 'in_transit'
          } else if (normalizedStatus.includes('accepted') || normalizedStatus === 'accepted') {
            statusValue = 'accepted'
          } else if (normalizedStatus.includes('canceled') || normalizedStatus === 'canceled') {
            statusValue = 'canceled'
          } else if (normalizedStatus.includes('pending') || normalizedStatus === 'pending') {
            statusValue = 'pending'
          }
          
          // Special case: If you know certain orders should be delivered, we can override here
          // For example, if all AIRC orders should be delivered:
          // Note: Commented out to use actual API status instead of overriding
          // if (order.id && order.id.includes('AIRC')) {
          //   statusValue = 'delivered'
          // }
          
          order.status = statusValue
          break
        case 'estname':
          order.establishment = value || 'Unknown Establishment'
          break
        case 'date':
          // Use the date from CSV if available - this is the ORDER date, not delivery date
          if (value) {
            try {
              // Handle date format like "8/23/2025" by parsing it manually
              const dateParts = value.split('/')
              if (dateParts.length === 3) {
                const month = parseInt(dateParts[0]) - 1 // Month is 0-indexed
                const day = parseInt(dateParts[1])
                const year = parseInt(dateParts[2])
                const parsedDate = new Date(year, month, day)
                if (!isNaN(parsedDate.getTime())) {
                  order.orderDate = parsedDate.toISOString().split('T')[0]
                  console.log(`Parsed date "${value}" to "${order.orderDate}" for order ${order.id}`)
                }
              } else {
                // Fallback to original parsing for other formats
                const parsedDate = new Date(value)
                if (!isNaN(parsedDate.getTime())) {
                  order.orderDate = parsedDate.toISOString().split('T')[0]
                  console.log(`Fallback parsed date "${value}" to "${order.orderDate}" for order ${order.id}`)
                }
              }
            } catch (e) {
              console.log(`Date parsing error for value "${value}":`, e.message)
            }
          }
          break
        case 'monthyear':
          order.monthYear = value || ''
          break
        case 'giftnotecharge':
          order.giftNoteCharge = parseFloat(value) || 0
          break
        case 'promodiscamt':
          order.promoDiscAmt = parseFloat(value) || 0
          break
        case 'servicechargetax':
          order.serviceChargeTax = parseFloat(value) || 0
          break
        case 'stripepaymentid':
          order.stripePaymentId = value || ''
          break
        case 'deliverydatetime':
          // Use actual delivery date/time from API if available
          console.log(`Processing deliveryDateTime for order ${order.id}: value="${value}", type=${typeof value}, length=${value ? value.length : 0}`)
          if (value && value.trim() && value !== 'null' && value !== 'undefined') {
            try {
              const parsedDeliveryDate = new Date(value)
              if (!isNaN(parsedDeliveryDate.getTime())) {
                // Convert UTC to local date to handle timezone correctly
                // This ensures midnight UTC dates are interpreted as the correct local date
                const year = parsedDeliveryDate.getFullYear()
                const month = parsedDeliveryDate.getMonth()
                const day = parsedDeliveryDate.getDate()
                const localDate = new Date(year, month, day)
                order.deliveryDate = localDate.toISOString().split('T')[0]
                console.log(`Set deliveryDate to: ${order.deliveryDate}`)
              } else {
                order.deliveryDate = 'N/A'
                console.log(`Invalid date, set deliveryDate to: N/A`)
              }
            } catch (e) {
              console.log(`Delivery date parsing error for value "${value}":`, e.message)
              order.deliveryDate = 'N/A'
            }
          } else {
            order.deliveryDate = 'N/A'
            console.log(`Empty/null value, set deliveryDate to: N/A`)
          }
          break
        case 'doordashdeliverywindow':
          // Handle malformed JSON in DoorDash fields
          try {
            if (value && value.trim()) {
              // Try to parse as JSON, if it fails, store as string
              order.doorDashDeliveryWindow = value
            } else {
              order.doorDashDeliveryWindow = ''
            }
          } catch (e) {
            order.doorDashDeliveryWindow = value || ''
          }
          break
        case 'doordashpickupwindow':
          // Handle malformed JSON in DoorDash fields
          try {
            if (value && value.trim()) {
              // Try to parse as JSON, if it fails, store as string
              order.doorDashPickupWindow = value
            } else {
              order.doorDashPickupWindow = ''
            }
          } catch (e) {
            order.doorDashPickupWindow = value || ''
          }
          break
        case 'senttodoordash':
          order.sentToDoordash = value === 'true' || value === true
          break
        case 'doordashstatus':
          order.doorDashStatus = value || ''
          break
      }
    })
    
    // Set default values if not found
    if (!order.id) order.id = `ORD${Date.now()}-${Math.random().toString(36).substr(2, 5)}`
    if (!order.customerName) order.customerName = 'Unknown Customer'
    if (!order.establishment) order.establishment = 'Unknown Establishment'
    
    // Use actual delivery date from API if available, otherwise set to N/A
    if (!order.deliveryDate) {
      order.deliveryDate = 'N/A'
    }
    
    // Special case: Goody orders should always show N/A for delivery dates
    if (order.id && order.id.startsWith('GD-BEVVI-')) {
      order.deliveryDate = 'N/A'
    }
    
    // Add a default item if none specified
    if (order.items.length === 0) {
      order.items = [{
        name: `Order from ${order.establishment}`,
        quantity: 1,
        price: order.total
      }]
    }
    
    return order
  } catch (error) {
    console.error('Error creating order from CSV:', error)
    return null
  }
}

// Get mock orders for fallback
function getMockOrders(orderDate) {
  return [
    {
      id: 'ORD001',
      customerName: 'John Smith',
      orderDate: orderDate,
      deliveryDate: 'N/A',
      status: 'delivered',
      total: 45.99,
      items: [
        { name: 'Bevvi Water Bottle', quantity: 2, price: 22.99 },
        { name: 'Bevvi Filter', quantity: 1, price: 0.01 }
      ],
      address: '123 Main St, City, State 12345',
      phone: '+1-555-0123'
    },
    {
      id: 'ORD002',
      customerName: 'Sarah Johnson',
      orderDate: orderDate,
      deliveryDate: 'N/A',
      status: 'in_transit',
      total: 67.50,
      items: [
        { name: 'Bevvi Water Bottle', quantity: 3, price: 22.50 }
      ],
      address: '456 Oak Ave, City, State 12345',
      phone: '+1-555-0456'
    },
    {
      id: 'ORD003',
      customerName: 'Mike Wilson',
      orderDate: orderDate,
      deliveryDate: '2025-08-17',
      status: 'pending',
      total: 89.99,
      items: [
        { name: 'Bevvi Premium Package', quantity: 1, price: 89.99 }
      ],
      address: '789 Pine Rd, City, State 12345',
      phone: '+1-555-0789'
    }
  ]
}

// API Routes
app.get('/api/orders', async (req, res) => {
  try {
    const { startDate, endDate } = req.query
    
    if (!startDate || !endDate) {
      return res.status(400).json({ 
        error: 'Start date and end date are required' 
      })
    }
    
    // Validate that dates are not in the future
    const today = new Date()
    today.setHours(23, 59, 59, 999) // End of today
    
    const start = new Date(startDate)
    const end = new Date(endDate)
    
    if (start > today || end > today) {
      return res.status(400).json({
        success: false,
        error: 'Invalid date range',
        message: 'Cannot fetch orders for future dates. Please select dates up to today.',
        dateRange: { startDate, endDate },
        today: today.toISOString().split('T')[0],
        data: [],
        totalOrders: 0
      })
    }

    // Update auto-refresh range when new dates are requested
    updateAutoRefreshRange(startDate, endDate)
    
    // Call the Bevvi API
            const apiUrl = `https://api.getbevvi.com/api/bevviutils/getAllStoreTransactionsReportCsv?startDate=${startDate}&endDate=${endDate}`
    
    console.log('Calling Bevvi API:', apiUrl)
    
    try {
      // Make actual API call to Bevvi with retry logic
      let response
      let retryCount = 0
      const maxRetries = 3
      
      while (retryCount < maxRetries) {
        try {
          response = await axios.get(apiUrl, {
            timeout: 60000, // Increased from 30s to 60s for larger date ranges
            headers: {
              'Accept': 'application/json',
              'User-Agent': 'Bevvi-Order-Tracking-System/1.0'
            }
          })
          break // Success, exit retry loop
        } catch (retryError) {
          retryCount++
          console.log(`Attempt ${retryCount} failed: ${retryError.message}`)
          
          if (retryCount >= maxRetries) {
            throw retryError // Re-throw if all retries exhausted
          }
          
          // Wait before retrying (exponential backoff)
          const waitTime = Math.min(1000 * Math.pow(2, retryCount - 1), 5000)
          console.log(`Waiting ${waitTime}ms before retry...`)
          await new Promise(resolve => setTimeout(resolve, waitTime))
        }
      }
      
      console.log('Bevvi API Response Status:', response.status)
      console.log('Bevvi API Response Headers:', response.headers)
      
      if (response.status === 200 && response.data) {
        // The API returns JSON with a 'results' field containing CSV data
        const jsonResponse = response.data
        console.log('JSON Response received:', typeof jsonResponse)
        
        if (jsonResponse.results) {
          const csvData = jsonResponse.results
          console.log('CSV Data extracted from results field, length:', csvData.length)
          console.log('CSV Data preview (first 200 chars):', csvData.substring(0, 200))
          
          // Parse the CSV data from the results field
          const orders = parseCSVToOrders(csvData, startDate)
          
          // Check if we got real orders or fell back to mock data
          if (orders.length > 0 && orders[0].id && !orders[0].id.startsWith('ORD')) {
            // Real orders from API
            return res.json({
              success: true,
              data: orders,
              dateRange: { startDate, endDate },
              totalOrders: orders.length,
              message: `Orders fetched for ${startDate} to ${endDate}`,
              source: 'Bevvi API',
              rawData: csvData.substring(0, 500) + '...' // First 500 chars for debugging
            })
          } else {
            // Mock data was used
            return res.json({
              success: true,
              data: orders,
              dateRange: { startDate, endDate },
              totalOrders: orders.length,
              message: `No orders found for ${startDate} to ${endDate}. Showing sample data.`,
              source: 'Mock Data (No API data available)',
              note: 'The selected date range may not have any orders, or the API returned insufficient data.'
            })
          }
        } else {
          throw new Error('No results field found in API response')
        }
      } else {
        throw new Error(`Bevvi API returned status ${response.status}`)
      }
    } catch (apiError) {
      console.error('Bevvi API Error:', apiError.message)
      
      // Return the actual error instead of mock data
      const errorStatus = apiError.response?.status || 'Unknown'
      const errorMessage = apiError.message || 'Unknown error occurred'
      
      console.log(`Bevvi API failed with status ${errorStatus}: ${errorMessage}`)
      
      res.json({
        success: false,
        error: 'Bevvi API call failed',
        message: `Failed to fetch orders from Bevvi API`,
        apiStatus: errorStatus,
        apiError: errorMessage,
        apiUrl: apiUrl, // Include the exact API URL that was called
        dateRange: { startDate, endDate },
        data: [],
        totalOrders: 0,
        note: `API Status: ${errorStatus} - ${errorMessage}. Please try again later or contact support if the issue persists.`
      })
    }
  } catch (error) {
    console.error('Error fetching orders:', error)
    res.status(500).json({ 
      error: 'Failed to fetch orders',
      message: error.message 
    })
  }
})

// Helper function to split large date ranges into smaller chunks
function splitDateRange(startDate, endDate, maxDays = 3) {
  const start = new Date(startDate)
  const end = new Date(endDate)
  const diffTime = Math.abs(end - start)
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
  
  if (diffDays <= maxDays) {
    return [{ startDate, endDate }]
  }
  
  const chunks = []
  let currentDate = new Date(start)
  
  while (currentDate <= end) {
    const chunkEnd = new Date(currentDate)
    chunkEnd.setDate(chunkEnd.getDate() + maxDays - 1)
    
    if (chunkEnd > end) {
      chunkEnd.setTime(end.getTime())
    }
    
    chunks.push({
      startDate: currentDate.toISOString().split('T')[0],
      endDate: chunkEnd.toISOString().split('T')[0]
    })
    
    currentDate.setDate(currentDate.getDate() + maxDays)
  }
  
  return chunks
}

// Auto-refresh configuration
const AUTO_REFRESH_INTERVAL = 20 * 60 * 1000 // 20 minutes in milliseconds
let autoRefreshTimer = null
let lastAutoRefreshDate = null
let lastAutoRefreshRange = null

// Function to start auto-refresh
function startAutoRefresh() {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer)
  }
  
  autoRefreshTimer = setInterval(async () => {
    if (lastAutoRefreshRange) {
      console.log(`🔄 Auto-refreshing orders for ${lastAutoRefreshRange.startDate} to ${lastAutoRefreshRange.endDate}`)
      try {
        // Call the Bevvi API to get fresh data
        const apiUrl = `https://api.getbevvi.com/api/bevviutils/getAllStoreTransactionsReportCsv?startDate=${lastAutoRefreshRange.startDate}&endDate=${lastAutoRefreshRange.endDate}`
        
        let response
        let retryCount = 0
        const maxRetries = 2 // Fewer retries for auto-refresh
        
        while (retryCount < maxRetries) {
          try {
            response = await axios.get(apiUrl, {
              timeout: 30000, // Shorter timeout for auto-refresh
              headers: {
                'Accept': 'application/json',
                'User-Agent': 'Bevvi-Order-Tracking-System/1.0'
              }
            })
            break
          } catch (retryError) {
            retryCount++
            if (retryCount >= maxRetries) {
              console.log(`❌ Auto-refresh failed after ${maxRetries} attempts: ${retryError.message}`)
              return
            }
            await new Promise(resolve => setTimeout(resolve, 2000))
          }
        }
        
        if (response && response.status === 200 && response.data && response.data.results) {
          const csvData = response.data.results
          const orders = parseCSVToOrders(csvData, lastAutoRefreshRange.startDate)
          
          console.log(`✅ Auto-refresh successful: ${orders.length} orders updated`)
          lastAutoRefreshDate = new Date()
          
          // Store the refreshed data in memory for quick access
          global.lastRefreshedOrders = {
            orders: orders,
            timestamp: lastAutoRefreshDate,
            dateRange: lastAutoRefreshRange
          }
        }
      } catch (error) {
        console.log(`❌ Auto-refresh error: ${error.message}`)
      }
    }
  }, AUTO_REFRESH_INTERVAL)
  
  console.log(`🔄 Auto-refresh started - will refresh every ${AUTO_REFRESH_INTERVAL / 60000} minutes`)
}

// Function to stop auto-refresh
function stopAutoRefresh() {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer)
    autoRefreshTimer = null
    console.log('🛑 Auto-refresh stopped')
  }
}

// Function to update auto-refresh with new date range
function updateAutoRefreshRange(startDate, endDate) {
  lastAutoRefreshRange = { startDate, endDate }
  console.log(`📅 Auto-refresh range updated to ${startDate} to ${endDate}`)
}

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Bevvi Order Tracking System API is running',
    timestamp: new Date().toISOString(),
    autoRefresh: {
      active: !!autoRefreshTimer,
      interval: `${AUTO_REFRESH_INTERVAL / 60000} minutes`,
      lastRefresh: lastAutoRefreshDate,
      currentRange: lastAutoRefreshRange
    }
  })
})

// Auto-refresh control endpoints
app.post('/api/auto-refresh/start', (req, res) => {
  const { startDate, endDate } = req.body
  
  if (!startDate || !endDate) {
    return res.status(400).json({
      error: 'Start date and end date are required'
    })
  }
  
  updateAutoRefreshRange(startDate, endDate)
  startAutoRefresh()
  
  res.json({
    success: true,
    message: 'Auto-refresh started',
    interval: `${AUTO_REFRESH_INTERVAL / 60000} minutes`,
    dateRange: { startDate, endDate }
  })
})

app.post('/api/auto-refresh/stop', (req, res) => {
  stopAutoRefresh()
  res.json({
    success: true,
    message: 'Auto-refresh stopped'
  })
})

app.get('/api/auto-refresh/status', (req, res) => {
  res.json({
    active: !!autoRefreshTimer,
    interval: `${AUTO_REFRESH_INTERVAL / 60000} minutes`,
    lastRefresh: lastAutoRefreshDate,
    currentRange: lastAutoRefreshRange,
    nextRefresh: autoRefreshTimer ? new Date(Date.now() + AUTO_REFRESH_INTERVAL) : null
  })
})

// Serve React app for all other routes
app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, 'dist', 'index.html')
  if (require('fs').existsSync(indexPath)) {
    res.sendFile(indexPath)
  } else {
    res.status(404).json({ error: 'Frontend not built. Please run npm run build first.' })
  }
})

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error)
  res.status(500).json({ 
    error: 'Internal server error',
    message: error.message 
  })
})

app.listen(PORT, () => {
  console.log(`🚀 Bevvi Order Tracking System server running on port ${PORT}`)
  console.log(`📊 API available at http://localhost:${PORT}/api`)
  console.log(`🌐 Frontend available at http://localhost:${PORT}`)
  console.log(`🔄 Auto-refresh system ready (20-minute intervals)`)
  console.log(`📋 Auto-refresh endpoints:`)
  console.log(`   POST /api/auto-refresh/start - Start auto-refresh with date range`)
  console.log(`   POST /api/auto-refresh/stop - Stop auto-refresh`)
  console.log(`   GET  /api/auto-refresh/status - Check auto-refresh status`)
})
