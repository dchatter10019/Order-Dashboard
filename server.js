const express = require('express')
const cors = require('cors')
const axios = require('axios')
const path = require('path')
const OpenAI = require('openai')
require('dotenv').config()

const app = express()
const PORT = process.env.PORT || 3001

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
})

// Middleware
app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:3001', 'http://127.0.0.1:3001'],
  credentials: true
}))
app.use(express.json())

// Add some debugging
app.use((req, res, next) => {
  console.log(`${req.method} ${req.path}`)
  next()
})

// Serve static files from the dist directory with no-cache headers for HTML
app.use((req, res, next) => {
  if (req.url.endsWith('.html') || req.url === '/' || req.url === '/dashboard' || req.url === '/products') {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
    res.setHeader('Pragma', 'no-cache')
    res.setHeader('Expires', '0')
  }
  next()
})
app.use(express.static(path.join(__dirname, 'dist')))

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
      console.log('CSV has insufficient data (less than 2 lines)')
      return []
    }
    
    // Check if the CSV actually contains meaningful data (not just headers)
    if (lines.length === 2 && lines[1].trim().length < 10) {
      console.log('CSV contains only headers and minimal data')
      return []
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
      console.log('No orders parsed for this date range')
    }
    return orders // Return empty array instead of mock data
    
  } catch (error) {
    console.error('CSV parsing error:', error)
    return [] // Return empty array instead of mock data
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

// Check delivery status based on order type and timing
function checkOrderDeliveryStatus(order, currentStatus) {
  const now = new Date()
  const orderDate = new Date(order.orderDate)
  
  // For shipping orders: check if not in_transit within 3 business days
  if ((parseFloat(order.shippingFee) || 0) > 0) {
    if (currentStatus === 'delivered') {
      return 'On Time' // Delivered orders are considered on time
    } else if (currentStatus === 'in_transit') {
      return 'On Time' // In transit orders are on time
    } else {
      const businessDays = calculateBusinessDays(orderDate, now)
      if (businessDays > 3) {
        return 'Delayed'
      } else {
        return 'On Time'
      }
    }
  }
  
  // For delivery orders: check delivery timing
  if ((parseFloat(order.shippingFee) || 0) === 0 && order.deliveryDate !== 'N/A') {
    try {
      const deliveryDateTime = new Date(order.deliveryDate)
      const timeDiff = deliveryDateTime.getTime() - now.getTime()
      const minutesUntilDelivery = timeDiff / (1000 * 60)
      
      // Scenario 1: Orders not delivered after delivery window
      if (currentStatus !== 'delivered' && minutesUntilDelivery < -30) {
        return 'Delayed'
      }
      
      // Scenario 2: Orders delivered but after delivery window
      if (currentStatus === 'delivered' && minutesUntilDelivery < -30) {
        return 'Delayed'
      }
      
      // In transit orders are considered on time
      if (currentStatus === 'in_transit') {
        return 'On Time'
      }
      
      // Orders within delivery window or not significantly past
      if (minutesUntilDelivery >= -30) {
        return 'On Time'
      }
      
      return 'On Time' // Default case
    } catch (e) {
      // If delivery date parsing fails, return N/A
      console.log(`Delivery date parsing error for delivery status check: ${e.message}`)
      return 'N/A'
    }
  }
  
  // For orders without clear shipping/delivery classification
  return 'N/A'
}

// Extract state from text (establishment name, address, etc.)
function extractStateFromText(text) {
  if (!text) return null
  
  // Airport code to state mapping (major US airports)
  const airportToState = {
    'LGB': 'CA', 'LAX': 'CA', 'SFO': 'CA', 'SAN': 'CA', 'SMF': 'CA', 'SJC': 'CA',
    'TEB': 'NJ', 'EWR': 'NJ',
    'DAL': 'TX', 'DFW': 'TX', 'IAH': 'TX', 'AUS': 'TX',
    'SDL': 'AZ', 'PHX': 'AZ',
    'PBI': 'FL', 'MIA': 'FL', 'FLL': 'FL', 'TPA': 'FL', 'MCO': 'FL', 'JAX': 'FL',
    'BOS': 'MA', 'ORH': 'MA',
    'JFK': 'NY', 'LGA': 'NY', 'EWR': 'NJ', 'BUF': 'NY',
    'ORD': 'IL', 'CHI': 'IL', 'MDW': 'IL',
    'ATL': 'GA',
    'DEN': 'CO',
    'SEA': 'WA',
    'PDX': 'OR',
    'LAS': 'NV',
    'PHX': 'AZ',
    'MSP': 'MN',
    'DTW': 'MI',
    'PHL': 'PA',
    'CLT': 'NC',
    'BWI': 'MD',
    'DCA': 'DC', 'IAD': 'VA',
    'SLC': 'UT',
    'HNL': 'HI'
  }
  
  // Try to find airport code (3 capital letters, like "LGB", "TEB", "DAL")
  const airportMatch = text.match(/\b([A-Z]{3})\b/)
  if (airportMatch && airportToState[airportMatch[1]]) {
    return airportToState[airportMatch[1]]
  }
  
  // Common US state abbreviations
  const stateMap = {
    'AL': 'Alabama', 'AK': 'Alaska', 'AZ': 'Arizona', 'AR': 'Arkansas',
    'CA': 'California', 'CO': 'Colorado', 'CT': 'Connecticut', 'DE': 'Delaware',
    'FL': 'Florida', 'GA': 'Georgia', 'HI': 'Hawaii', 'ID': 'Idaho',
    'IL': 'Illinois', 'IN': 'Indiana', 'IA': 'Iowa', 'KS': 'Kansas',
    'KY': 'Kentucky', 'LA': 'Louisiana', 'ME': 'Maine', 'MD': 'Maryland',
    'MA': 'Massachusetts', 'MI': 'Michigan', 'MN': 'Minnesota', 'MS': 'Mississippi',
    'MO': 'Missouri', 'MT': 'Montana', 'NE': 'Nebraska', 'NV': 'Nevada',
    'NH': 'New Hampshire', 'NJ': 'New Jersey', 'NM': 'New Mexico', 'NY': 'New York',
    'NC': 'North Carolina', 'ND': 'North Dakota', 'OH': 'Ohio', 'OK': 'Oklahoma',
    'OR': 'Oregon', 'PA': 'Pennsylvania', 'RI': 'Rhode Island', 'SC': 'South Carolina',
    'SD': 'South Dakota', 'TN': 'Tennessee', 'TX': 'Texas', 'UT': 'Utah',
    'VT': 'Vermont', 'VA': 'Virginia', 'WA': 'Washington', 'WV': 'West Virginia',
    'WI': 'Wisconsin', 'WY': 'Wyoming', 'DC': 'District of Columbia'
  }
  
  // Try to find state abbreviation (2 capital letters)
  const abbrMatch = text.match(/\b([A-Z]{2})\b/)
  if (abbrMatch && stateMap[abbrMatch[1]]) {
    return abbrMatch[1]
  }
  
  // Try to find full state name
  const lowerText = text.toLowerCase()
  for (const [abbr, fullName] of Object.entries(stateMap)) {
    if (lowerText.includes(fullName.toLowerCase())) {
      return abbr
    }
  }
  
  return null
}

// Calculate business days between two dates (excluding weekends)
function calculateBusinessDays(startDate, endDate) {
  let businessDays = 0
  const current = new Date(startDate)
  
  while (current <= endDate) {
    const dayOfWeek = current.getDay()
    if (dayOfWeek !== 0 && dayOfWeek !== 6) { // 0 = Sunday, 6 = Saturday
      businessDays++
    }
    current.setDate(current.getDate() + 1)
  }
  
  return businessDays
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
      stripePaymentId: '',
      // State fields
      shippingState: '',
      billingState: '',
      shippingCity: '',
      shippingZip: ''
    }
    
    // Map fields based on Bevvi CSV structure
    headers.forEach((header, index) => {
      const value = values[index] || ''
      const lowerHeader = header.toLowerCase().trim()
      
      switch (lowerHeader) {
        case 'ordernum':
          order.id = value || `ORD${Date.now()}-${index}`
          order.ordernum = value || order.id  // Also set ordernum for state lookup
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
          } else if (normalizedStatus.includes('rejected') || normalizedStatus === 'rejected') {
            statusValue = 'rejected'
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
          
          // Add delivery status based on timing requirements
          order.deliveryStatus = checkOrderDeliveryStatus(order, statusValue)
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
                  // Use local date instead of UTC to avoid timezone issues
                  order.orderDate = parsedDate.getFullYear() + '-' + 
                                   String(parsedDate.getMonth() + 1).padStart(2, '0') + '-' + 
                                   String(parsedDate.getDate()).padStart(2, '0')
                  console.log(`Parsed date "${value}" to "${order.orderDate}" for order ${order.id}`)
                }
              } else {
                // Fallback to original parsing for other formats
                const parsedDate = new Date(value)
                if (!isNaN(parsedDate.getTime())) {
                  // Use local date instead of UTC to avoid timezone issues
                  order.orderDate = parsedDate.getFullYear() + '-' + 
                                   String(parsedDate.getMonth() + 1).padStart(2, '0') + '-' + 
                                   String(parsedDate.getDate()).padStart(2, '0')
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
                // Keep the UTC date as-is, frontend will handle timezone conversion for filtering
                order.deliveryDate = parsedDeliveryDate.getUTCFullYear() + '-' + 
                                   String(parsedDeliveryDate.getUTCMonth() + 1).padStart(2, '0') + '-' + 
                                   String(parsedDeliveryDate.getUTCDate()).padStart(2, '0')
                // Also preserve the full deliveryDateTime for frontend display
                order.deliveryDateTime = value
                console.log(`Set deliveryDate to: ${order.deliveryDate} and deliveryDateTime to: ${order.deliveryDateTime}`)
              } else {
                order.deliveryDate = 'N/A'
                order.deliveryDateTime = null
                console.log(`Invalid date, set deliveryDate to: N/A`)
              }
            } catch (e) {
              console.log(`Delivery date parsing error for value "${value}":`, e.message)
              order.deliveryDate = 'N/A'
              order.deliveryDateTime = null
            }
          } else {
            order.deliveryDate = 'N/A'
            order.deliveryDateTime = null
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
        case 'shippingstate':
        case 'shipping_state':
        case 'state':
          order.shippingState = value || ''
          break
        case 'billingstate':
        case 'billing_state':
          order.billingState = value || ''
          break
        case 'shippingcity':
        case 'shipping_city':
        case 'city':
          order.shippingCity = value || ''
          break
        case 'shippingzip':
        case 'shipping_zip':
        case 'zip':
        case 'zipcode':
          order.shippingZip = value || ''
          break
      }
    })
    
    // Set default values if not found
    if (!order.id) order.id = `ORD${Date.now()}-${Math.random().toString(36).substr(2, 5)}`
    if (!order.customerName) order.customerName = 'Unknown Customer'
    if (!order.establishment) order.establishment = 'Unknown Establishment'
    
    // Extract state from establishment name if shippingState is empty
    if (!order.shippingState && order.establishment) {
      console.log(`🔍 Trying to extract state from establishment: "${order.establishment}"`)
      const stateFromEstablishment = extractStateFromText(order.establishment)
      if (stateFromEstablishment) {
        order.shippingState = stateFromEstablishment
        console.log(`✅ Extracted state: ${stateFromEstablishment}`)
      } else {
        console.log(`❌ No state found in establishment name`)
      }
    }
    
    // Log sample order data (removed orders.length check as it's not in scope)
    // Logging moved to parseCSVToOrders function instead
    
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

// Helper function to fetch state data from Tableau API
async function fetchStateData(startDate, endDate) {
  try {
    const tableauUrl = `https://api.getbevvi.com/api/bevviutils/exportTableauDataCsv?startDate=${startDate}&endDate=${endDate}`
    
    const response = await axios.get(tableauUrl, {
      timeout: 30000, // Reduced timeout to 30 seconds to avoid hanging
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Bevvi-Order-Tracking-System/2.0'
      }
    })
    
    if (response.status === 200 && response.data && Array.isArray(response.data)) {
      // Log ALL available fields and sample data for debugging
      if (response.data.length > 0) {
        const allFields = Object.keys(response.data[0])
        console.log('=' .repeat(70))
        console.log('📋 TABLEAU API - ALL AVAILABLE FIELDS')
        console.log('=' .repeat(70))
        console.log(`Total records: ${response.data.length}`)
        console.log(`Total fields: ${allFields.length}`)
        console.log('')
        console.log('Complete Field List:')
        allFields.forEach((field, index) => {
          console.log(`  ${String(index + 1).padStart(2)}. ${field}`)
        })
        console.log('')
        console.log('Sample Record (first record):')
        console.log(JSON.stringify(response.data[0], null, 2))
        console.log('=' .repeat(70))
      }
      
      // Build state lookup map: { orderNumber: shipToState }
      const stateLookup = {}
      response.data.forEach(item => {
        if (item.orderNumber && item.shipToState) {
          stateLookup[item.orderNumber] = item.shipToState
        }
      })
      
      console.log(`✅ State data: ${Object.keys(stateLookup).length} orders`)
      return stateLookup
    }
    
    console.log('⚠️ Tableau API unexpected format')
    return {}
  } catch (error) {
    console.error(`❌ Tableau API error: ${error.message}`)
    return {} // Return empty map on error, don't block the main request
  }
}

// Helper function to fetch brand/product data from Tableau API
async function fetchBrandData(startDate, endDate) {
  try {
    const tableauUrl = `https://api.getbevvi.com/api/bevviutils/exportTableauDataCsv?startDate=${startDate}&endDate=${endDate}`
    
    const response = await axios.get(tableauUrl, {
      timeout: 30000,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Bevvi-Order-Tracking-System/2.0'
      }
    })
    
    if (response.status === 200 && response.data && Array.isArray(response.data)) {
      console.log(`✅ Brand data: ${response.data.length} line items from Tableau API`)
      
      // Debug: Show sample items
      if (response.data.length > 0) {
        console.log('📦 Sample line items:')
        response.data.slice(0, 3).forEach((item, idx) => {
          console.log(`  ${idx + 1}. Brand: "${item.brandInfo || 'EMPTY'}", Parent: "${item.parentBrand || 'EMPTY'}", Product: "${item.productName}", Price: ${item.price}, Qty: ${item.quantity}`)
        })
      }
      
      // Aggregate revenue by brand
      const brandRevenue = {}
      let unknownCount = 0
      
      response.data.forEach(item => {
        const brand = item.brandInfo || item.parentBrand || 'Unknown'
        if (brand === 'Unknown') unknownCount++
        
        const revenue = parseFloat(item.alcPrice) || parseFloat(item.price) || 0
        const quantity = parseInt(item.quantity) || 1
        const totalRevenue = revenue * quantity
        
        if (!brandRevenue[brand]) {
          brandRevenue[brand] = { revenue: 0, itemCount: 0, orderNumbers: new Set() }
        }
        
        brandRevenue[brand].revenue += totalRevenue
        brandRevenue[brand].itemCount += quantity
        if (item.orderNumber) {
          brandRevenue[brand].orderNumbers.add(item.orderNumber)
        }
      })
      
      console.log(`📊 Brand extraction: ${unknownCount} items without brand info out of ${response.data.length} total`)
      
      // Convert Sets to counts
      const brandData = {}
      Object.entries(brandRevenue).forEach(([brand, data]) => {
        brandData[brand] = {
          revenue: data.revenue,
          itemCount: data.itemCount,
          orderCount: data.orderNumbers.size
        }
      })
      
      console.log(`✅ Aggregated ${Object.keys(brandData).length} unique brands`)
      console.log(`💰 Top 3 brands by revenue:`)
      Object.entries(brandData)
        .sort((a, b) => b[1].revenue - a[1].revenue)
        .slice(0, 3)
        .forEach(([brand, data], idx) => {
          console.log(`  ${idx + 1}. ${brand}: $${data.revenue.toFixed(2)}`)
        })
      
      return brandData
    }
    
    console.log('⚠️ Tableau API unexpected format')
    return {}
  } catch (error) {
    console.error(`❌ Tableau API error: ${error.message}`)
    return {}
  }
}

// Helper function to enrich orders with state data (called on-demand)
async function enrichOrdersWithState(orders, startDate, endDate) {
  console.log(`🗺️  Enriching ${orders.length} orders with state data...`)
  
  // Fetch state data from Tableau API
  const stateLookup = await fetchStateData(startDate, endDate)
  
  // Enrich orders with state information
  const enrichedOrders = orders.map(order => {
    const orderNum = order.ordernum || order.id
    
    // First try: Get state from Tableau API
    if (stateLookup[orderNum]) {
      order.shipToState = stateLookup[orderNum]
    }
    // Second try: Extract from establishment name (for Air Culinaire orders)
    else if (!order.shipToState && order.establishment) {
      const extractedState = extractStateFromText(order.establishment)
      if (extractedState) {
        order.shipToState = extractedState
      }
    }
    
    return order
  })
  
  const enrichedCount = enrichedOrders.filter(o => o.shipToState).length
  console.log(`✅ State enrichment complete: ${enrichedCount}/${enrichedOrders.length} orders`)
  
  return enrichedOrders
}

// Helper function to fetch orders for a specific date range
async function fetchOrdersForDateRange(startDate, endDate) {
  // Convert local dates to UTC
  const localStartDate = new Date(startDate + 'T00:00:00')
  const localEndDate = new Date(endDate + 'T23:59:59')
  
  const utcStartDate = new Date(localStartDate.getTime() - (localStartDate.getTimezoneOffset() * 60000))
  const utcEndDate = new Date(localEndDate.getTime() - (localEndDate.getTimezoneOffset() * 60000))
  
  const utcStartString = utcStartDate.toISOString().split('T')[0]
  const utcEndString = utcEndDate.toISOString().split('T')[0]
  
  const apiUrl = `https://api.getbevvi.com/api/bevviutils/getAllStoreTransactionsReportCsv?startDate=${utcStartString}&endDate=${utcEndString}`
  
  let response
  let retryCount = 0
  const maxRetries = 2
  
  while (retryCount < maxRetries) {
    try {
      response = await axios.get(apiUrl, {
        timeout: 180000, // Increased to 3 minutes for large datasets
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Bevvi-Order-Tracking-System/1.0'
        }
      })
      break
    } catch (retryError) {
      retryCount++
      if (retryCount >= maxRetries) {
        throw retryError
      }
      await new Promise(resolve => setTimeout(resolve, 2000))
    }
  }
  
  if (response.status === 200 && response.data && response.data.results) {
    const csvData = response.data.results
    
    const allOrders = parseCSVToOrders(csvData, startDate)
    
    // Filter orders by date range
    const filteredOrders = allOrders.filter(order => {
      if (!order.deliveryDate || order.deliveryDate === 'N/A') {
        return order.orderDate >= startDate && order.orderDate <= endDate
      }
      
      const deliveryInRange = order.deliveryDate >= startDate && order.deliveryDate <= endDate
      const orderInRange = order.orderDate >= startDate && order.orderDate <= endDate
      
      return deliveryInRange || orderInRange
    })
    
    return filteredOrders
  }
  
  return []
}

// API Routes
app.get('/api/orders', async (req, res) => {
  try {
    const { startDate, endDate } = req.query
    console.log('📥 /api/orders REQUEST received:', { startDate, endDate })
    
    if (!startDate || !endDate) {
      console.log('❌ Missing dates in request')
      return res.status(400).json({ 
        error: 'Start date and end date are required' 
      })
    }
    
    // Validate that dates are not too far in the future (allow up to 7 days ahead for delivery scheduling)
    const today = new Date()
    today.setHours(23, 59, 59, 999) // End of today
    
    const maxFutureDate = new Date()
    maxFutureDate.setDate(maxFutureDate.getDate() + 7) // Allow up to 7 days in the future
    
    const start = new Date(startDate)
    const end = new Date(endDate)
    
    if (start > maxFutureDate || end > maxFutureDate) {
      return res.status(400).json({
        success: false,
        error: 'Invalid date range',
        message: 'Cannot fetch orders for dates more than 7 days in the future. Please select dates within the next week.',
        dateRange: { startDate, endDate },
        today: (() => {
          const today = new Date()
          return today.getFullYear() + '-' + 
                 String(today.getMonth() + 1).padStart(2, '0') + '-' + 
                 String(today.getDate()).padStart(2, '0')
        })(),
        maxFuture: (() => {
          const maxFuture = new Date()
          maxFuture.setDate(maxFuture.getDate() + 7)
          return maxFuture.getFullYear() + '-' + 
                 String(maxFuture.getMonth() + 1).padStart(2, '0') + '-' + 
                 String(maxFuture.getDate()).padStart(2, '0')
        })(),
        data: [],
        totalOrders: 0
      })
    }

    // Update auto-refresh range when new dates are requested
    updateAutoRefreshRange(startDate, endDate)
    
    // Check cache first
    const cacheKey = `${startDate}-${endDate}`
    const cached = ordersCache.get(cacheKey)
    console.log(`🔍 Cache check for ${cacheKey}:`, cached ? 'HIT' : 'MISS')
    if (cached && (Date.now() - cached.timestamp) < CACHE_DURATION) {
      console.log('✅ Returning cached data for:', cacheKey, '- Orders:', cached.data.length)
      return res.json({
        success: true,
        data: cached.data,
        dateRange: { startDate, endDate },
        totalOrders: cached.data.length,
        message: `Orders fetched for ${startDate} to ${endDate}`,
        source: 'Cache',
        cached: true
      })
    }
    
    console.log('🌐 Cache miss or expired - fetching from Bevvi API...')
    
    // Calculate date range in days
    const diffTime = Math.abs(new Date(endDate) - new Date(startDate))
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
    
    console.log(`📅 Date range: ${startDate} to ${endDate} (${diffDays} days)`)
    
    // For large date ranges (>90 days), use chunking
    if (diffDays > 90) {
      console.log('🔄 Large date range detected, using chunked requests...')
      const chunks = splitDateRange(startDate, endDate, 30) // Split into 30-day chunks
      console.log(`📦 Split into ${chunks.length} chunks`)
      
      let allOrders = []
      let successfulChunks = 0
      
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]
        console.log(`🔄 Processing chunk ${i + 1}/${chunks.length}: ${chunk.startDate} to ${chunk.endDate}`)
        
        try {
          const chunkOrders = await fetchOrdersForDateRange(chunk.startDate, chunk.endDate)
          allOrders = allOrders.concat(chunkOrders)
          successfulChunks++
          console.log(`✅ Chunk ${i + 1} complete: ${chunkOrders.length} orders`)
        } catch (error) {
          console.log(`❌ Chunk ${i + 1} failed: ${error.message}`)
          // Continue with other chunks even if one fails
        }
      }
      
      // Cache the combined results
      ordersCache.set(cacheKey, { data: allOrders, timestamp: Date.now() })
      
      console.log(`✅ All chunks processed: ${allOrders.length} total orders from ${successfulChunks}/${chunks.length} successful chunks`)
      
      // Warn if some chunks failed
      const incompleteData = successfulChunks < chunks.length
      if (incompleteData) {
        console.warn(`⚠️ WARNING: Only ${successfulChunks}/${chunks.length} chunks succeeded - data may be incomplete!`)
      }
      
      return res.json({
        success: true,
        data: allOrders,
        dateRange: { startDate, endDate },
        totalOrders: allOrders.length,
        message: incompleteData 
          ? `⚠️ Partial data: ${allOrders.length} orders from ${successfulChunks}/${chunks.length} successful chunks. Some data may be missing.`
          : `Orders fetched for ${startDate} to ${endDate} (${chunks.length} chunks)`,
        source: 'Bevvi API (Chunked)',
        chunked: true,
        chunks: chunks.length,
        successfulChunks: successfulChunks,
        incompleteData: incompleteData
      })
    }
    
    // For smaller date ranges, use single request
    // Convert local dates to UTC before calling the Bevvi API
    // This ensures we get orders that are scheduled for delivery on the requested local dates
    const localStartDate = new Date(startDate + 'T00:00:00') // Start of day in local time
    const localEndDate = new Date(endDate + 'T23:59:59') // End of day in local time
    
    // Convert to UTC for API call
    const utcStartDate = new Date(localStartDate.getTime() - (localStartDate.getTimezoneOffset() * 60000))
    const utcEndDate = new Date(localEndDate.getTime() - (localEndDate.getTimezoneOffset() * 60000))
    
    // Format as YYYY-MM-DD for API
    const utcStartString = utcStartDate.toISOString().split('T')[0]
    const utcEndString = utcEndDate.toISOString().split('T')[0]
    
    // Call the Bevvi API with UTC dates
    const apiUrl = `https://api.getbevvi.com/api/bevviutils/getAllStoreTransactionsReportCsv?startDate=${utcStartString}&endDate=${utcEndString}`
    
    console.log('🕐 Converting local dates to UTC for API call:')
    console.log('  Local requested range:', startDate, 'to', endDate)
    console.log('  UTC API range:', utcStartString, 'to', utcEndString)
    console.log('Calling Bevvi API:', apiUrl)
    
    try {
      // Make actual API call to Bevvi with retry logic
      let response
      let retryCount = 0
      const maxRetries = 3
      
      while (retryCount < maxRetries) {
        try {
          response = await axios.get(apiUrl, {
            timeout: 180000, // Increased to 180s (3 minutes) for large date ranges
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
          const allOrders = parseCSVToOrders(csvData, startDate)
          
          // Filter orders to show only those delivered within the requested local date range
          const filteredOrders = allOrders.filter(order => {
            if (!order.deliveryDate || order.deliveryDate === 'N/A') {
              // If no delivery date, include based on order date
              return order.orderDate >= startDate && order.orderDate <= endDate
            }
            
            // Filter by delivery date (primary) and order date (fallback)
            const deliveryInRange = order.deliveryDate >= startDate && order.deliveryDate <= endDate
            const orderInRange = order.orderDate >= startDate && order.orderDate <= endDate
            
            return deliveryInRange || orderInRange
          })
          
          console.log(`📊 Filtered orders: ${filteredOrders.length} out of ${allOrders.length} total orders`)
          console.log(`📅 Requested range: ${startDate} to ${endDate}`)
          
          if (filteredOrders.length === 0 && allOrders.length > 0) {
            console.log('⚠️  WARNING: CSV returned orders but none match date range!')
            console.log('First order date:', allOrders[0]?.orderDate)
            console.log('Last order date:', allOrders[allOrders.length - 1]?.orderDate)
          }
          
          if (allOrders.length === 0) {
            console.log('⚠️  WARNING: CSV parsing returned 0 orders - API may have no data for this range')
          }
          
          console.log(`🔍 Orders with delivery dates in range: ${filteredOrders.filter(o => o.deliveryDate && o.deliveryDate !== 'N/A' && o.deliveryDate >= startDate && o.deliveryDate <= endDate).length}`)
          console.log(`📋 Orders with order dates in range: ${filteredOrders.filter(o => o.orderDate >= startDate && o.orderDate <= endDate).length}`)
          
          // Cache the results (WITHOUT state enrichment for faster performance)
          ordersCache.set(cacheKey, { data: filteredOrders, timestamp: Date.now() })
          
          // Check if we got real orders from API
          if (filteredOrders.length > 0 && filteredOrders[0].id && !filteredOrders[0].id.startsWith('ORD')) {
            // Real orders from API
            return res.json({
              success: true,
              data: filteredOrders,
              dateRange: { startDate, endDate },
              totalOrders: filteredOrders.length,
              message: `Orders fetched for ${startDate} to ${endDate}`,
              source: 'Bevvi API',
              cached: false
            })
          } else {
            // No real orders found - return empty array instead of mock data
            return res.json({
              success: true,
              data: [],
              dateRange: { startDate, endDate },
              totalOrders: 0,
              message: `No orders found for ${startDate} to ${endDate}`,
              source: 'Bevvi API',
              note: 'The selected date range has no orders.',
              cached: false
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
      startDate: (() => {
        const date = new Date(currentDate)
        return date.getFullYear() + '-' + 
               String(date.getMonth() + 1).padStart(2, '0') + '-' + 
               String(date.getDate()).padStart(2, '0')
      })(),
      endDate: (() => {
        const date = new Date(chunkEnd)
        return date.getFullYear() + '-' + 
               String(date.getMonth() + 1).padStart(2, '0') + '-' + 
               String(date.getDate()).padStart(2, '0')
      })()
    })
    
    currentDate.setDate(currentDate.getDate() + maxDays)
  }
  
  return chunks
}

// New endpoint: Get orders WITH state enrichment (for state-based queries only)
app.get('/api/orders-with-state', async (req, res) => {
  try {
    const { startDate, endDate } = req.query
    
    console.log('🗺️  /api/orders-with-state REQUEST:', { startDate, endDate })
    
    // First, get regular orders (fast, from cache if available)
    const ordersResponse = await axios.get(`http://localhost:${PORT}/api/orders?startDate=${startDate}&endDate=${endDate}`)
    
    if (ordersResponse.data && ordersResponse.data.data) {
      const orders = ordersResponse.data.data
      
      // Enrich with state data from Tableau API
      const enrichedOrders = await enrichOrdersWithState(orders, startDate, endDate)
      
      return res.json({
        success: true,
        data: enrichedOrders,
        dateRange: { startDate, endDate },
        totalOrders: enrichedOrders.length,
        stateEnriched: enrichedOrders.filter(o => o.shipToState).length,
        message: `Orders fetched and enriched with state data for ${startDate} to ${endDate}`,
        source: 'Bevvi API + Tableau API'
      })
    } else {
      return res.json({
        success: true,
        data: [],
        totalOrders: 0,
        message: 'No orders found'
      })
    }
  } catch (error) {
    console.error('Error in /api/orders-with-state:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to fetch orders with state data',
      message: error.message
    })
  }
})

// New endpoint: Get customers who bought a specific brand
app.get('/api/brands/customers', async (req, res) => {
  try {
    const { startDate, endDate, brand } = req.query
    
    if (!brand) {
      return res.status(400).json({
        success: false,
        error: 'Brand name is required',
        message: 'Please specify a brand name'
      })
    }
    
    console.log('🏷️  /api/brands/customers REQUEST:', { startDate, endDate, brand })
    
    // Fetch all Tableau data
    const tableauUrl = `https://api.getbevvi.com/api/bevviutils/exportTableauDataCsv?startDate=${startDate}&endDate=${endDate}`
    
    const response = await axios.get(tableauUrl, {
      timeout: 30000,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Bevvi-Order-Tracking-System/2.0'
      }
    })
    
    if (response.status === 200 && response.data && Array.isArray(response.data)) {
      // Filter items by brand (case-insensitive partial match)
      const brandLower = brand.toLowerCase()
      const matchingItems = response.data.filter(item => {
        const itemBrand = (item.brandInfo || item.parentBrand || '').toLowerCase()
        return itemBrand.includes(brandLower)
      })
      
      console.log(`✅ Found ${matchingItems.length} line items for brand "${brand}"`)
      
      // Group by customer (companyName)
      const customerData = {}
      matchingItems.forEach(item => {
        const customer = item.companyName || item.customerName || 'Unknown Customer'
        const revenue = (parseFloat(item.alcPrice) || parseFloat(item.price) || 0) * (parseInt(item.quantity) || 1)
        
        if (!customerData[customer]) {
          customerData[customer] = {
            revenue: 0,
            bottles: 0,
            orders: new Set()
          }
        }
        
        customerData[customer].revenue += revenue
        customerData[customer].bottles += parseInt(item.quantity) || 1
        if (item.orderNumber) {
          customerData[customer].orders.add(item.orderNumber)
        }
      })
      
      // Convert to array and sort by revenue
      const customers = Object.entries(customerData).map(([name, data]) => ({
        customerName: name,
        revenue: data.revenue,
        bottles: data.bottles,
        orderCount: data.orders.size
      })).sort((a, b) => b.revenue - a.revenue)
      
      const totalRevenue = customers.reduce((sum, c) => sum + c.revenue, 0)
      const totalBottles = customers.reduce((sum, c) => sum + c.bottles, 0)
      
      return res.json({
        success: true,
        brand,
        customers,
        totalCustomers: customers.length,
        totalRevenue,
        totalBottles,
        dateRange: { startDate, endDate },
        message: `Customers who bought ${brand}`,
        source: 'Tableau API'
      })
    }
    
    return res.json({
      success: false,
      error: 'No data available',
      message: 'Tableau API returned unexpected format'
    })
  } catch (error) {
    console.error('Error in /api/brands/customers:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to fetch customer data for brand',
      message: error.message
    })
  }
})

// New endpoint: Get brand revenue breakdown (for brand-based queries only)
app.get('/api/brands/revenue', async (req, res) => {
  try {
    const { startDate, endDate, limit } = req.query
    const requestedLimit = parseInt(limit) || 10 // Default to 10 if not specified
    
    console.log('🏷️  /api/brands/revenue REQUEST:', { startDate, endDate, limit: requestedLimit })
    
    // Fetch brand data from Tableau API
    const brandData = await fetchBrandData(startDate, endDate)
    
    // Filter out "Unknown" and sort by revenue descending
    const sortedBrands = Object.entries(brandData)
      .filter(([brand]) => brand !== 'Unknown')  // Exclude Unknown
      .sort((a, b) => b[1].revenue - a[1].revenue)
      .slice(0, requestedLimit) // Use dynamic limit
      .map(([brand, data]) => ({
        brand,
        revenue: data.revenue,
        orderCount: data.orderCount,
        itemCount: data.itemCount
      }))
    
    const totalRevenue = Object.values(brandData).reduce((sum, data) => sum + data.revenue, 0)
    const totalOrders = new Set(Object.values(brandData).flatMap(data => Array(data.orderCount).fill(null))).size
    
    // Calculate known vs unknown brands
    const knownBrandsRevenue = Object.entries(brandData)
      .filter(([brand]) => brand !== 'Unknown')
      .reduce((sum, [, data]) => sum + data.revenue, 0)
    const unknownRevenue = brandData['Unknown']?.revenue || 0
    
    console.log(`💡 Revenue breakdown: Known brands: $${knownBrandsRevenue.toFixed(2)}, Unknown: $${unknownRevenue.toFixed(2)}`)
    
    return res.json({
      success: true,
      brands: sortedBrands,
      totalBrands: Object.keys(brandData).length - 1, // Exclude "Unknown" from count
      knownBrandsCount: Object.keys(brandData).filter(b => b !== 'Unknown').length,
      totalRevenue: knownBrandsRevenue, // Only show revenue from known brands
      unknownRevenue,
      dateRange: { startDate, endDate },
      message: `Brand revenue data for ${startDate} to ${endDate}`,
      source: 'Tableau API'
    })
  } catch (error) {
    console.error('Error in /api/brands/revenue:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to fetch brand revenue data',
      message: error.message
    })
  }
})

// Auto-refresh configuration
const AUTO_REFRESH_INTERVAL = 20 * 60 * 1000 // 20 minutes in milliseconds
let autoRefreshTimer = null
let lastAutoRefreshDate = null
let lastAutoRefreshRange = null

// Store connected clients for real-time updates
let connectedClients = []

// Cache configuration
const CACHE_DURATION = 5 * 60 * 1000 // 5 minutes cache
const ordersCache = new Map() // key: "startDate-endDate", value: { data, timestamp }

// Products cache - loaded on server startup
let productsCache = []
let productsCacheTimestamp = null
const PRODUCTS_CACHE_DURATION = 60 * 60 * 1000 // 1 hour cache for products

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
          
          // Notify all connected clients about the data refresh
          notifyClientsOfRefresh(orders.length, lastAutoRefreshDate)
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

// Function to notify all connected clients about data refresh
function notifyClientsOfRefresh(ordersCount, refreshTime) {
  const message = JSON.stringify({
    type: 'data_refresh',
    ordersCount: ordersCount,
    refreshTime: refreshTime.toISOString(),
    refreshTimeFormatted: refreshTime.toLocaleString(),
    message: `Data refreshed: ${ordersCount} orders updated at ${refreshTime.toLocaleString()}`
  })
  
  // Send message to all connected clients
  connectedClients.forEach(client => {
    if (client.res && !client.res.destroyed) {
      client.res.write(`data: ${message}\n\n`)
    }
  })
  
  console.log(`📡 Notified ${connectedClients.length} connected clients about data refresh`)
}

// Function to add a new client connection
function addClient(client) {
  connectedClients.push(client)
  console.log(`📱 New client connected. Total clients: ${connectedClients.length}`)
}

// Function to remove a disconnected client
function removeClient(client) {
  const index = connectedClients.findIndex(c => c.id === client.id)
  if (index > -1) {
    connectedClients.splice(index, 1)
    console.log(`📱 Client disconnected. Total clients: ${connectedClients.length}`)
  }
}

// Function to load all Bevvi products
async function loadAllProducts() {
  try {
    console.log('📦 Loading all Bevvi products from API...')
    const response = await axios.get('https://api.getbevvi.com/api/corputil/getBevviProductsAsJSON', {
      timeout: 120000, // 2 minutes for large dataset
      headers: {
        'Accept': 'application/json'
      }
    })
    
    if (response.status === 200 && response.data && response.data.results) {
      productsCache = response.data.results
      productsCacheTimestamp = Date.now()
      console.log(`✅ Loaded ${productsCache.length} products into cache`)
      return productsCache.length
    } else {
      console.error('❌ Failed to load products: Invalid response format')
      return 0
    }
  } catch (error) {
    console.error('❌ Error loading products:', error.message)
    return 0
  }
}

// Function to search cached products
function searchProducts(searchTerm) {
  if (!searchTerm || searchTerm.length < 3) {
    return []
  }
  
  const searchLower = searchTerm.toLowerCase()
  const results = productsCache.filter(product => {
    const name = (product.name || '').toLowerCase()
    const upc = (product.upc || '').toLowerCase()
    return name.includes(searchLower) || upc.includes(searchLower)
  })
  
  // Deduplicate by UPC
  const seen = new Set()
  const deduped = results.filter(p => {
    const upc = p.upc
    if (!upc || seen.has(upc)) return false
    seen.add(upc)
    return true
  })
  
  // Limit to 100 results for performance
  return deduped.slice(0, 100)
}

// Product search endpoint - searches cached products
app.get('/api/products/search', (req, res) => {
  try {
    const { q } = req.query
    
    if (!q || q.length < 3) {
      return res.json({
        success: true,
        results: [],
        message: 'Search term must be at least 3 characters'
      })
    }
    
    // Check if cache needs refresh (older than 1 hour)
    const cacheAge = productsCacheTimestamp ? Date.now() - productsCacheTimestamp : null
    const cacheExpired = !productsCacheTimestamp || cacheAge > PRODUCTS_CACHE_DURATION
    
    if (cacheExpired) {
      console.log('⚠️ Products cache expired or empty, may need refresh')
    }
    
    const results = searchProducts(q)
    
    res.json({
      success: true,
      results: results,
      totalProducts: productsCache.length,
      searchTerm: q,
      cacheAge: cacheAge ? Math.floor(cacheAge / 1000) : null,
      cacheExpired: cacheExpired
    })
  } catch (error) {
    console.error('Error searching products:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to search products',
      message: error.message
    })
  }
})

// Refresh products cache endpoint
app.post('/api/products/refresh', async (req, res) => {
  try {
    console.log('🔄 Refreshing products cache...')
    const count = await loadAllProducts()
    
    res.json({
      success: true,
      message: 'Products cache refreshed',
      totalProducts: count,
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    console.error('Error refreshing products cache:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to refresh products cache',
      message: error.message
    })
  }
})

// Get products cache status
app.get('/api/products/status', (req, res) => {
  const cacheAge = productsCacheTimestamp ? Date.now() - productsCacheTimestamp : null
  
  res.json({
    totalProducts: productsCache.length,
    cacheTimestamp: productsCacheTimestamp,
    cacheAge: cacheAge ? Math.floor(cacheAge / 1000) : null,
    cacheExpired: !productsCacheTimestamp || cacheAge > PRODUCTS_CACHE_DURATION,
    lastUpdated: productsCacheTimestamp ? new Date(productsCacheTimestamp).toISOString() : null
  })
})

// Health check endpoint
app.get('/api/health', (req, res) => {
  const now = new Date()
  const nextRefresh = autoRefreshTimer ? new Date(Date.now() + AUTO_REFRESH_INTERVAL) : null
  const timeUntilNext = nextRefresh ? Math.max(0, nextRefresh.getTime() - now.getTime()) : null
  
  // Format time until next refresh
  let timeUntilNextFormatted = null
  if (timeUntilNext !== null) {
    const minutes = Math.floor(timeUntilNext / (1000 * 60))
    const seconds = Math.floor((timeUntilNext % (1000 * 60)) / 1000)
    timeUntilNextFormatted = `${minutes}m ${seconds}s`
  }
  
  res.json({ 
    status: 'OK', 
    message: 'Bevvi Order Tracking System API is running',
    timestamp: now.toISOString(),
    serverTime: now.toLocaleString(),
    autoRefresh: {
      active: !!autoRefreshTimer,
      interval: `${AUTO_REFRESH_INTERVAL / 60000} minutes`,
      lastRefresh: lastAutoRefreshDate,
      lastRefreshFormatted: lastAutoRefreshDate ? lastAutoRefreshDate.toLocaleString() : null,
      currentRange: lastAutoRefreshRange,
      nextRefresh: nextRefresh,
      nextRefreshFormatted: nextRefresh ? nextRefresh.toLocaleString() : null,
      timeUntilNext: timeUntilNextFormatted
    }
  })
})

// Clear cache endpoint
app.post('/api/cache/clear', (req, res) => {
  try {
    const cacheSize = ordersCache.size
    ordersCache.clear()
    console.log(`🧹 Cache cleared - ${cacheSize} entries removed`)
    
    res.json({
      success: true,
      message: `Cache cleared successfully. ${cacheSize} entries removed.`,
      previousSize: cacheSize
    })
  } catch (error) {
    console.error('❌ Error clearing cache:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to clear cache',
      message: error.message
    })
  }
})

// Proxy endpoint for order details API
app.get('/api/order-details/:orderNumber', async (req, res) => {
  try {
    const { orderNumber } = req.params
    console.log('🔍 Proxying order details request for:', orderNumber)
    
    const response = await axios.get(`https://api.getbevvi.com/api/corputil/getOrderInfo?orderNumber=${orderNumber}`, {
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      timeout: 10000
    })
    
    console.log('📊 Order details response status:', response.status)
    console.log('📊 Order details response data:', response.data)
    
    res.json(response.data)
  } catch (error) {
    console.error('❌ Error proxying order details:', error.message)
    res.status(500).json({
      error: 'Failed to fetch order details',
      message: error.message
    })
  }
})

// AI Prompt Parsing endpoint using GPT-4o-mini
app.post('/api/parse-prompt', async (req, res) => {
  try {
    const { prompt } = req.body
    
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({
        error: 'Prompt is required and must be a string'
      })
    }
    
    // Check if OpenAI API key is configured
    if (!process.env.OPENAI_API_KEY) {
      console.error('⚠️ OPENAI_API_KEY not configured')
      return res.status(500).json({
        error: 'OpenAI API key not configured',
        fallback: true
      })
    }
    
    console.log('🤖 Parsing prompt with GPT-4o-mini:', prompt)
    
    const systemPrompt = `You are an AI assistant that parses natural language queries about order data into structured JSON.

Today's date is ${new Date().toISOString().split('T')[0]}.

Extract the following information from the user's query:
- intent: The type of query. Choose from:
  * revenue: asking about TOTAL revenue/sales amounts for a period (e.g., "revenue for Nov", "revenue for Oct 2025")
  * tax: asking about tax amounts
  * service_charge: asking about service charge amounts (NOT tips or delivery)
  * tip: asking about tip/gratuity amounts
  * delivery_charge: asking about delivery fee/charge amounts (shipping fee, delivery fee)
  * delayed_orders: specifically asking for DELAYED orders
  * pending_orders: specifically asking for PENDING STATUS orders (must mention "pending")
  * delivered_orders: specifically asking for DELIVERED STATUS orders (must mention "delivered")
  * accepted_orders: specifically asking for ACCEPTED STATUS orders (e.g., "show me all accepted orders", "list accepted orders", "see the accepted orders")
  * total_orders: asking for ALL orders, order count, or "orders placed today/this week" (general order queries)
  * order_status_check: asking to validate/check order statuses (e.g., "are all orders accepted", "are any orders pending", "how many rejected", "check order statuses", "order status summary", "what's the status breakdown")
  * average_order_value: asking for AOV or average
  * revenue_by_month: ONLY use when explicitly asking for BREAKDOWN by month (e.g., "revenue by month", "breakdown by month")
  * revenue_by_customer: asking for revenue for a specific customer
  * revenue_by_brand: asking for revenue breakdown by PRODUCT BRAND (e.g., "revenue by brand", "top brands", "which brands sell the most", "brand performance") - actual liquor brands like Tito's, Grey Goose, etc.
  * revenue_by_store: asking for revenue breakdown by store/retailer/establishment (e.g., "revenue by store", "top stores", "which retailers make the most", "revenue by retailer")
  * customers_by_brand: asking which customers bought/ordered/purchased a specific brand (e.g., "which customers bought Schrader", "who ordered Dom Perignon", "which customers purchased Tito's", "who bought Macallan")
  * delayed_orders_by_customer: asking for delayed orders for a specific customer
  * tax_by_state: asking for tax breakdown by state (e.g., "tax by state for Oct")
  * sales_by_state: asking for sales/revenue breakdown by state (e.g., "sales by state for Nov")
  * unknown: if the query is NOT about orders, revenue, tax, tips, delivery, or customer data (e.g., weather, personal questions, unrelated topics)
  
- customer: Customer name if mentioned (Sendoso, OnGoody, Air Culinaire). Always extract full company name, not partial words.
- brand: Brand name if mentioned (Schrader, Dom Perignon, Tito's, Grey Goose, etc.). Extract the full brand name.
- startDate: Start date in YYYY-MM-DD format
- endDate: End date in YYYY-MM-DD format
- isMTD: Boolean, true if asking for "month to date" or "this month so far"
- needsClarification: Boolean, true if the query is too open-ended and needs more information
- clarificationNeeded: String indicating what's missing - "date_range" if no date/timeframe specified, "customer_name" if asking about a customer but not specifying which one, "brand_name" if asking about a brand but not specifying which one

Important: 
- Customer names should be exact - "Sendoso" not "sendoso in", "Air Culinaire" not "air", etc.
- "show me orders", "orders placed today", "how many orders" = total_orders intent (NOT pending_orders)
- "show me pending orders", "pending status" = pending_orders intent
- If a query asks for orders, revenue, tax, etc. WITHOUT specifying any timeframe (no "today", "this month", specific month, etc.), set needsClarification to true and clarificationNeeded to "date_range"
- Queries like "show me all orders", "what's the revenue", "how much tax" without dates = needsClarification: true
- EXCEPTION: Status-specific queries (accepted_orders, pending_orders, delivered_orders, delayed_orders) do NOT need clarification even without dates - they can use current loaded data
- "show me all accepted orders", "list pending orders" = NO clarification needed, process immediately

Date parsing rules:
- "today", "for today" = today's date for both start and end date
- "this month", "this month so far", "MTD", "month to date" = first day of current month to today
- "last month" = full previous month (1st to last day)
- "YTD", "year to date", "this year" = January 1st of current year to today
- "October 2025", "Oct 2025" = 2025-10-01 to 2025-10-31
- If end date is in the future, set it to today (MTD logic)

Return ONLY valid JSON, no explanation. Format:
{
  "intent": "revenue",
  "customer": "Sendoso",
  "brand": "Schrader",
  "startDate": "2025-10-01",
  "endDate": "2025-10-31",
  "isMTD": false,
  "needsClarification": false,
  "clarificationNeeded": null
}

If customer is not mentioned, omit the "customer" field.
If brand is not mentioned, omit the "brand" field.
If no clarification needed, omit "clarificationNeeded" field or set to null.`

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
      ],
      temperature: 0.1, // Low temperature for consistent parsing
      max_tokens: 150, // Keep output small to reduce costs
      response_format: { type: 'json_object' }
    })
    
    const parsedData = JSON.parse(completion.choices[0].message.content)
    
    console.log('✅ Parsed result:', parsedData)
    console.log('📊 Tokens used:', {
      prompt: completion.usage.prompt_tokens,
      completion: completion.usage.completion_tokens,
      total: completion.usage.total_tokens,
      estimatedCost: `$${((completion.usage.prompt_tokens * 0.15 + completion.usage.completion_tokens * 0.60) / 1000000).toFixed(6)}`
    })
    
    res.json({
      success: true,
      parsed: parsedData,
      usage: {
        promptTokens: completion.usage.prompt_tokens,
        completionTokens: completion.usage.completion_tokens,
        totalTokens: completion.usage.total_tokens
      }
    })
    
  } catch (error) {
    console.error('❌ Error parsing prompt:', error)
    res.status(500).json({
      error: 'Failed to parse prompt',
      message: error.message,
      fallback: true
    })
  }
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
  const now = new Date()
  const nextRefresh = autoRefreshTimer ? new Date(Date.now() + AUTO_REFRESH_INTERVAL) : null
  const timeUntilNext = nextRefresh ? Math.max(0, nextRefresh.getTime() - now.getTime()) : null
  
  // Format time until next refresh
  let timeUntilNextFormatted = null
  if (timeUntilNext !== null) {
    const minutes = Math.floor(timeUntilNext / (1000 * 60))
    const seconds = Math.floor((timeUntilNext % (1000 * 60)) / 1000)
    timeUntilNextFormatted = `${minutes}m ${seconds}s`
  }
  
  res.json({
    active: !!autoRefreshTimer,
    interval: `${AUTO_REFRESH_INTERVAL / 60000} minutes`,
    lastRefresh: lastAutoRefreshDate,
    lastRefreshFormatted: lastAutoRefreshDate ? lastAutoRefreshDate.toLocaleString() : null,
    currentRange: lastAutoRefreshRange,
    nextRefresh: nextRefresh,
    nextRefreshFormatted: nextRefresh ? nextRefresh.toLocaleString() : null,
    timeUntilNext: timeUntilNextFormatted,
    serverTime: now.toLocaleString(),
    serverTimeISO: now.toISOString()
  })
})

// Server-Sent Events endpoint for real-time updates
app.get('/api/events', (req, res) => {
  // Set headers for SSE
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control'
  })
  
  // Send initial connection message
  res.write(`data: ${JSON.stringify({
    type: 'connected',
    message: 'Connected to real-time updates',
    timestamp: new Date().toISOString()
  })}\n\n`)
  
  // Create client object with unique ID
  const client = {
    id: Date.now() + Math.random(),
    res: res
  }
  
  // Add client to connected clients
  addClient(client)
  
  // Handle client disconnect
  req.on('close', () => {
    removeClient(client)
  })
  
  // Keep connection alive with heartbeat
  const heartbeat = setInterval(() => {
    if (res.destroyed) {
      clearInterval(heartbeat)
      return
    }
    res.write(`data: ${JSON.stringify({
      type: 'heartbeat',
      timestamp: new Date().toISOString()
    })}\n\n`)
  }, 30000) // Send heartbeat every 30 seconds
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

app.listen(PORT, async () => {
  console.log(`🚀 Bevvi Order Tracking System server running on port ${PORT}`)
  console.log(`📊 API available at http://localhost:${PORT}/api`)
  console.log(`🌐 Frontend available at http://localhost:${PORT}`)
  console.log(`🔄 Auto-refresh system ready (20-minute intervals)`)
  console.log(`📋 Auto-refresh endpoints:`)
  console.log(`   POST /api/auto-refresh/start - Start auto-refresh with date range`)
  console.log(`   POST /api/auto-refresh/stop - Stop auto-refresh`)
  console.log(`   GET  /api/auto-refresh/status - Check auto-refresh status`)
  console.log(`📦 Product endpoints:`)
  console.log(`   GET  /api/products/search?q=<term> - Search products`)
  console.log(`   POST /api/products/refresh - Refresh products cache`)
  console.log(`   GET  /api/products/status - Get cache status`)
  console.log(``)
  
  // Clear orders cache on startup to ensure fresh data
  ordersCache.clear()
  console.log(`🧹 Orders cache cleared on startup`)
  
  console.log(`📦 Loading all Bevvi products on startup...`)
  await loadAllProducts()
  console.log(`✅ Server ready with products cache loaded`)
})
