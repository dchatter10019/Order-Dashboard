const express = require('express')
const cors = require('cors')
const axios = require('axios')
const path = require('path')
const crypto = require('crypto')
const OpenAI = require('openai')
require('dotenv').config({ path: path.join(__dirname, '.env'), override: true })

const app = express()
const PORT = process.env.PORT || 3001
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL
const AFTERSHIP_API_KEY = process.env.AFTERSHIP_API_KEY
const AFTERSHIP_WEBHOOK_SECRET = process.env.AFTERSHIP_WEBHOOK_SECRET
const AFTERSHIP_API_BASE = process.env.AFTERSHIP_API_BASE || 'https://api.aftership.com/tracking/2026-01'

// Initialize OpenAI client only when configured
let openai = null
if (process.env.OPENAI_API_KEY) {
  openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  })
} else {
  console.warn('⚠️ OPENAI_API_KEY not set; AI parsing endpoint will be disabled.')
}

// Initialize AfterShip client only when configured
const aftershipClient = AFTERSHIP_API_KEY
  ? axios.create({
      baseURL: AFTERSHIP_API_BASE,
      headers: {
        'Content-Type': 'application/json',
        'as-api-key': AFTERSHIP_API_KEY
      },
      timeout: 10000
    })
  : null

// Slack notifications state (in-memory)
const slackNotificationState = new Map()

function getSlackNotificationState(orderId) {
  if (!slackNotificationState.has(orderId)) {
    slackNotificationState.set(orderId, {
      pending15Sent: false,
      accepted30Sent: false
    })
  }
  return slackNotificationState.get(orderId)
}

function pruneSlackNotificationState(currentOrderIds) {
  for (const orderId of slackNotificationState.keys()) {
    if (!currentOrderIds.has(orderId)) {
      slackNotificationState.delete(orderId)
    }
  }
}

function formatSlackDateTime(dateTimeValue) {
  if (!dateTimeValue) return 'N/A'
  const parsed = new Date(dateTimeValue)
  if (isNaN(parsed.getTime())) return 'N/A'
  return parsed.toLocaleString()
}

async function sendSlackMessage(text) {
  if (!SLACK_WEBHOOK_URL) {
    return false
  }
  try {
    await axios.post(SLACK_WEBHOOK_URL, { text })
    return true
  } catch (error) {
    console.error('❌ Slack notification failed:', error.message)
    return false
  }
}

async function evaluateSlackNotifications(orders) {
  if (!SLACK_WEBHOOK_URL || !Array.isArray(orders) || orders.length === 0) {
    return
  }

  const now = new Date()
  const currentOrderIds = new Set()

  for (const order of orders) {
    if (!order || !order.id) continue
    currentOrderIds.add(order.id)

    const state = getSlackNotificationState(order.id)
    const normalizedStatus = (order.status || '').toLowerCase()

    if (normalizedStatus === 'pending' && !state.pending15Sent && order.orderDateTime) {
      const orderDateTime = new Date(order.orderDateTime)
      if (!isNaN(orderDateTime.getTime())) {
        const minutesSinceReceipt = (now.getTime() - orderDateTime.getTime()) / (1000 * 60)
        if (minutesSinceReceipt >= 15) {
          const message = [
            '⚠️ Order Pending > 15 mins',
            `Order ID: ${order.id}`,
            `Customer: ${order.customerName || 'N/A'}`,
            `Status: ${order.status || 'N/A'}`,
            `Order Time: ${formatSlackDateTime(order.orderDateTime)}`,
            `Delivery Time: ${formatSlackDateTime(order.deliveryDateTime)}`,
            `Total: $${(order.total || 0).toFixed(2)}`
          ].join('\n')
          const sent = await sendSlackMessage(message)
          if (sent) {
            state.pending15Sent = true
          }
        }
      }
    }

    if (normalizedStatus === 'accepted' && !state.accepted30Sent && order.deliveryDateTime) {
      const deliveryDateTime = new Date(order.deliveryDateTime)
      if (!isNaN(deliveryDateTime.getTime())) {
        const minutesUntilDelivery = (deliveryDateTime.getTime() - now.getTime()) / (1000 * 60)
        if (minutesUntilDelivery <= 30 && minutesUntilDelivery >= 0) {
          const message = [
            '⚠️ Order Still Accepted 30 mins Before Delivery',
            `Order ID: ${order.id}`,
            `Customer: ${order.customerName || 'N/A'}`,
            `Status: ${order.status || 'N/A'}`,
            `Order Time: ${formatSlackDateTime(order.orderDateTime)}`,
            `Delivery Time: ${formatSlackDateTime(order.deliveryDateTime)}`,
            `Total: $${(order.total || 0).toFixed(2)}`
          ].join('\n')
          const sent = await sendSlackMessage(message)
          if (sent) {
            state.accepted30Sent = true
          }
        }
      }
    }

  }

  pruneSlackNotificationState(currentOrderIds)
}

// CRITICAL: Set API route headers FIRST, before any other middleware
// This ensures API routes always return JSON, never HTML
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    // Immediately set JSON content type for all API routes
    res.setHeader('Content-Type', 'application/json')
    console.log(`🔵 API route detected early: ${req.method} ${req.path}`)
  }
  next()
})

// Middleware
app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:3001', 'http://127.0.0.1:3001'],
  credentials: true
}))
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf
  }
}))

// Add some debugging
app.use((req, res, next) => {
  console.log(`${req.method} ${req.path}`)
  next()
})

// Serve static files from the dist directory with no-cache headers for HTML
// IMPORTANT: Static files are served AFTER API routes to prevent API requests from being intercepted
// See line ~2840 where static files are actually served

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
    // Log first data row to see actual values
    if (lines.length > 1) {
      const firstDataRow = parseCSVLine(lines[1])
      console.log('First data row sample:', firstDataRow.slice(0, 10))
      // Create a map of header to value for easier debugging
      const headerValueMap = {}
      headers.forEach((header, index) => {
        if (index < firstDataRow.length) {
          headerValueMap[header] = firstDataRow[index]
        }
      })
      console.log('Header to value map (first order):', JSON.stringify(headerValueMap, null, 2))
    }
    
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

// Parse CSV line with proper quote handling and JSON field support
function parseCSVLine(line) {
  const values = []
  let current = ''
  let inQuotes = false
  let braceDepth = 0
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    const nextChar = i + 1 < line.length ? line[i + 1] : ''
    
    if (char === '"' && inQuotes && nextChar === '"') {
      current += '"'
      i += 1
      continue
    }
    
    if (char === '"') {
      inQuotes = !inQuotes
      continue
    }
    
    if (!inQuotes && char === '{') {
      braceDepth += 1
    } else if (!inQuotes && char === '}' && braceDepth > 0) {
      braceDepth -= 1
    }
    
    if (char === ',' && !inQuotes && braceDepth === 0) {
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
      shippingZip: '',
      trackingNumber: '',
      trackingSlug: '',
      trackingUrl: ''
    }
    
    // First pass: Look for ORDER datetime fields in ALL headers (before switch statement)
    // IMPORTANT: Skip delivery-related fields - they'll be handled separately
    headers.forEach((header, index) => {
      const value = values[index] || ''
      const lowerHeader = header.toLowerCase().trim()
      
      // Skip delivery-related fields - they should not be used for orderDateTime
      const isDeliveryField = lowerHeader.includes('delivery') && !lowerHeader.includes('order')
      
      // Check if this field contains datetime information (even if not in our switch cases)
      // Only process if it's NOT a delivery field and we don't already have orderDateTime
      if (value && value.trim() && value !== 'null' && value !== 'undefined' && !order.orderDateTime && !isDeliveryField) {
        // Check if value looks like a datetime
        const looksLikeDateTime = value.includes('T') || 
                                 (value.includes(' ') && value.match(/\d{1,2}:\d{2}/)) ||
                                 value.match(/\d{1,2}\/\d{1,2}\/\d{4} \d{1,2}:\d{2}/) ||
                                 value.match(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/) ||
                                 value.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)
        
        if (looksLikeDateTime) {
          try {
            const parsedDateTime = new Date(value)
            if (!isNaN(parsedDateTime.getTime())) {
              // Check if it has actual time (not just midnight)
              const hasTime = parsedDateTime.getHours() !== 0 || parsedDateTime.getMinutes() !== 0 || parsedDateTime.getSeconds() !== 0
              if (hasTime) {
                // Ensure datetime is stored with UTC timezone indicator
                let datetimeValue = value
                if (!datetimeValue.includes('Z') && !datetimeValue.match(/[+-]\d{2}:\d{2}$/)) {
                  if (datetimeValue.includes('T')) {
                    datetimeValue = datetimeValue.replace(/\.\d{3}$/, '') + 'Z'
                  } else if (datetimeValue.match(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/)) {
                    datetimeValue = datetimeValue.replace(' ', 'T') + 'Z'
                  }
                }
                
                order.orderDateTime = datetimeValue
                order.orderDate = parsedDateTime.getFullYear() + '-' + 
                                 String(parsedDateTime.getMonth() + 1).padStart(2, '0') + '-' + 
                                 String(parsedDateTime.getDate()).padStart(2, '0')
                console.log(`✅ Found ORDER datetime in field "${header}"="${value}" -> "${datetimeValue}" for order ${order.id}`)
              }
            }
          } catch (e) {
            // Ignore parsing errors, continue to switch statement
          }
        }
      }
    })
    
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
        case 'trackingnumber':
        case 'tracking_number':
        case 'trackingno':
        case 'tracking_no':
        case 'tracking id':
        case 'trackingid':
        case 'awb':
        case 'waybill':
        case 'waybillnumber':
          order.trackingNumber = value || order.trackingNumber
          break
        case 'trackingurl':
        case 'tracking_url':
        case 'carriertrackingurl':
        case 'carrier_tracking_url':
          order.trackingUrl = value || order.trackingUrl
          break
        case 'carrierslug':
        case 'carrier_slug':
        case 'courierslug':
        case 'courier_slug':
        case 'carrier':
        case 'courier':
          order.trackingSlug = value || order.trackingSlug
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
        case 'orderdate':
        case 'order_date':
          // Use the date from CSV if available - this is the ORDER date, not delivery date
          if (value) {
            try {
              // Check if value contains time information (datetime format)
              const hasTime = value.includes('T') || value.includes(' ') || value.match(/\d{1,2}:\d{2}/)
              
              if (hasTime) {
                // Parse as datetime and store both date and datetime
                const parsedDateTime = new Date(value)
                if (!isNaN(parsedDateTime.getTime())) {
                  // Ensure datetime is stored with UTC timezone indicator
                  let datetimeValue = value
                  // If value doesn't have timezone, assume it's UTC and add Z
                  if (!datetimeValue.includes('Z') && !datetimeValue.match(/[+-]\d{2}:\d{2}$/)) {
                    if (datetimeValue.includes('T')) {
                      datetimeValue = datetimeValue.replace(/\.\d{3}$/, '') + 'Z'
                    } else if (datetimeValue.match(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/)) {
                      datetimeValue = datetimeValue.replace(' ', 'T') + 'Z'
                    }
                  }
                  
                  // Store full datetime with UTC indicator
                  order.orderDateTime = datetimeValue
                  // Extract local date part (using UTC date)
                  order.orderDate = parsedDateTime.getFullYear() + '-' + 
                                   String(parsedDateTime.getMonth() + 1).padStart(2, '0') + '-' + 
                                   String(parsedDateTime.getDate()).padStart(2, '0')
                  console.log(`✅ Parsed datetime "${value}" -> "${datetimeValue}" to date "${order.orderDate}" for order ${order.id}`)
                }
              } else {
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
                      // Don't set orderDateTime here - wait to see if there's a time field
                      console.log(`Parsed date-only "${value}" to "${order.orderDate}" for order ${order.id} (will check for time field)`)
                    }
                  } else {
                    // Fallback to original parsing for other formats
                    const parsedDate = new Date(value)
                    if (!isNaN(parsedDate.getTime())) {
                      // Check if the parsed date actually has time component (not just midnight)
                      const hasTimeComponent = parsedDate.getHours() !== 0 || parsedDate.getMinutes() !== 0 || parsedDate.getSeconds() !== 0
                      
                      // Use local date instead of UTC to avoid timezone issues
                      order.orderDate = parsedDate.getFullYear() + '-' + 
                                       String(parsedDate.getMonth() + 1).padStart(2, '0') + '-' + 
                                       String(parsedDate.getDate()).padStart(2, '0')
                      
                      if (hasTimeComponent) {
                        // Has time, store as datetime
                        order.orderDateTime = value
                        console.log(`Parsed datetime "${value}" to date "${order.orderDate}" and datetime "${order.orderDateTime}" for order ${order.id}`)
                      } else {
                        // No time component, don't set orderDateTime yet
                        console.log(`Parsed date-only "${value}" to "${order.orderDate}" for order ${order.id} (will check for time field)`)
                      }
                    }
                  }
                }
            } catch (e) {
              console.log(`Date parsing error for value "${value}":`, e.message)
            }
          }
          break
        case 'time':
        case 'ordertime':
        case 'order_time':
        case 'createdtime':
        case 'created_time':
          // Handle time field - combine with orderDate to create orderDateTime
          if (value && order.orderDate) {
            try {
              // Parse time value (could be HH:MM, HH:MM:SS, etc.)
              let timeStr = value.trim()
              // Remove any timezone indicators
              timeStr = timeStr.replace(/[+-]\d{2}:\d{2}$/, '').replace(/Z$/, '')
              
              // Parse time components
              const timeMatch = timeStr.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/)
              if (timeMatch) {
                const hours = parseInt(timeMatch[1])
                const minutes = parseInt(timeMatch[2])
                const seconds = timeMatch[3] ? parseInt(timeMatch[3]) : 0
                
                // Combine with orderDate to create full datetime
                const dateStr = order.orderDate // Format: YYYY-MM-DD
                const [year, month, day] = dateStr.split('-').map(Number)
                const combinedDateTime = new Date(year, month - 1, day, hours, minutes, seconds)
                
                if (!isNaN(combinedDateTime.getTime())) {
                  order.orderDateTime = combinedDateTime.toISOString()
                  console.log(`Combined date "${order.orderDate}" and time "${value}" to datetime "${order.orderDateTime}" for order ${order.id}`)
                }
              }
            } catch (e) {
              console.log(`Time parsing error for value "${value}":`, e.message)
            }
          }
          break
        case 'datetime':
        case 'orderdatetime':
        case 'order_datetime':
        case 'timestamp':
        case 'created_at':
        case 'createdat':
        case 'createddate':
        case 'created_date':
        case 'transactiondatetime':
        case 'transaction_datetime':
        case 'ordercreated':
        case 'order_created':
        case 'ordercreatedat':
        case 'order_created_at':
          // Handle datetime fields - store both date and datetime
          if (value && value.trim() && value !== 'null' && value !== 'undefined') {
            try {
              const parsedDateTime = new Date(value)
              if (!isNaN(parsedDateTime.getTime())) {
                // Ensure datetime is stored with UTC timezone indicator
                let datetimeValue = value
                // If value doesn't have timezone, assume it's UTC and add Z
                if (!datetimeValue.includes('Z') && !datetimeValue.match(/[+-]\d{2}:\d{2}$/)) {
                  if (datetimeValue.includes('T')) {
                    datetimeValue = datetimeValue.replace(/\.\d{3}$/, '') + 'Z'
                  } else if (datetimeValue.match(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/)) {
                    datetimeValue = datetimeValue.replace(' ', 'T') + 'Z'
                  }
                }
                
                // Store full datetime with UTC indicator
                order.orderDateTime = datetimeValue
                // Extract local date part (using UTC date)
                order.orderDate = parsedDateTime.getFullYear() + '-' + 
                                 String(parsedDateTime.getMonth() + 1).padStart(2, '0') + '-' + 
                                 String(parsedDateTime.getDate()).padStart(2, '0')
                console.log(`✅ Parsed datetime field "${lowerHeader}"="${value}" -> "${datetimeValue}" to date "${order.orderDate}" for order ${order.id}`)
              } else {
                order.orderDateTime = null
                console.log(`⚠️ Failed to parse datetime field "${lowerHeader}"="${value}" for order ${order.id}`)
              }
            } catch (e) {
              console.log(`Datetime parsing error for field "${lowerHeader}" value "${value}":`, e.message)
              order.orderDateTime = null
            }
          } else {
            order.orderDateTime = null
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
                // Ensure UTC timezone indicator
                let deliveryDateTimeValue = value
                if (!deliveryDateTimeValue.includes('Z') && !deliveryDateTimeValue.match(/[+-]\d{2}:\d{2}$/)) {
                  if (deliveryDateTimeValue.includes('T')) {
                    deliveryDateTimeValue = deliveryDateTimeValue.replace(/\.\d{3}$/, '') + 'Z'
                  } else if (deliveryDateTimeValue.match(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/)) {
                    deliveryDateTimeValue = deliveryDateTimeValue.replace(' ', 'T') + 'Z'
                  }
                }
                order.deliveryDateTime = deliveryDateTimeValue
                console.log(`✅ Set deliveryDate to: ${order.deliveryDate} and deliveryDateTime to: ${order.deliveryDateTime} for order ${order.id}`)
                
                // IMPORTANT: Don't set orderDateTime from deliveryDateTime - they should be separate
                if (!order.orderDateTime) {
                  console.log(`ℹ️  Order ${order.id}: deliveryDateTime set but orderDateTime not yet set - will look for order-specific datetime field`)
                }
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
        default:
          break
      }

      if (!order.trackingNumber && lowerHeader.includes('tracking') && value) {
        order.trackingNumber = value
      }
      if (!order.trackingUrl && lowerHeader.includes('tracking') && lowerHeader.includes('url') && value) {
        order.trackingUrl = value
      }
    })
    
    // Set default values if not found
    if (!order.id) order.id = `ORD${Date.now()}-${Math.random().toString(36).substr(2, 5)}`
    if (!order.customerName) order.customerName = 'Unknown Customer'
    if (!order.establishment) order.establishment = 'Unknown Establishment'
    
    // Final pass: If we still don't have orderDateTime, check ALL fields for datetime patterns
    // IMPORTANT: Exclude deliveryDateTime to avoid using delivery time as order time
    if (order.orderDate && !order.orderDateTime) {
      console.log(`⚠️ Order ${order.id} has orderDate "${order.orderDate}" but no orderDateTime. Checking all fields (excluding delivery fields)...`)
      
      // Check all order properties for datetime patterns
      for (const [key, value] of Object.entries(order)) {
        // Skip delivery-related fields
        if (key.includes('delivery') && !key.includes('order')) {
          continue
        }
        
        if (value && typeof value === 'string' && value.trim() && value !== 'null' && value !== 'undefined') {
          // Check if this value looks like a datetime
          const looksLikeDateTime = value.includes('T') || 
                                   (value.includes(' ') && value.match(/\d{1,2}:\d{2}/)) ||
                                   value.match(/\d{1,2}\/\d{1,2}\/\d{4} \d{1,2}:\d{2}/) ||
                                   value.match(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/) ||
                                   value.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)
          
          if (looksLikeDateTime) {
            try {
              const parsedDateTime = new Date(value)
              if (!isNaN(parsedDateTime.getTime())) {
                // Check if it has actual time (not just midnight)
                const hasTime = parsedDateTime.getHours() !== 0 || parsedDateTime.getMinutes() !== 0 || parsedDateTime.getSeconds() !== 0
                if (hasTime) {
                  // Verify the date matches our orderDate
                  const parsedDate = parsedDateTime.getFullYear() + '-' + 
                                   String(parsedDateTime.getMonth() + 1).padStart(2, '0') + '-' + 
                                   String(parsedDateTime.getDate()).padStart(2, '0')
                  
                  if (parsedDate === order.orderDate) {
                    // Ensure UTC timezone indicator
                    let datetimeValue = value
                    if (!datetimeValue.includes('Z') && !datetimeValue.match(/[+-]\d{2}:\d{2}$/)) {
                      if (datetimeValue.includes('T')) {
                        datetimeValue = datetimeValue.replace(/\.\d{3}$/, '') + 'Z'
                      } else if (datetimeValue.match(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/)) {
                        datetimeValue = datetimeValue.replace(' ', 'T') + 'Z'
                      }
                    }
                    order.orderDateTime = datetimeValue
                    console.log(`✅ Found orderDateTime in field "${key}"="${value}" -> "${datetimeValue}" for order ${order.id}`)
                    break
                  }
                }
              }
            } catch (e) {
              // Continue checking other fields
            }
          }
        }
      }
      
      if (!order.orderDateTime) {
        console.log(`❌ Could not find orderDateTime for order ${order.id}. Available date/time fields:`, 
          Object.keys(order).filter(k => {
            const val = order[k]
            return val && typeof val === 'string' && (k.includes('time') || k.includes('date') || k.includes('created')) && !k.includes('delivery')
          }).map(k => `${k}="${order[k]}"`))
      }
    }
    
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

// Helper function to get local date from an order (converts UTC to local time)
function getOrderLocalDate(order) {
  // If we have orderDateTime, use it to get the local date
  if (order.orderDateTime) {
    try {
      const date = new Date(order.orderDateTime)
      // Convert to local date string (YYYY-MM-DD)
      return date.getFullYear() + '-' + 
             String(date.getMonth() + 1).padStart(2, '0') + '-' + 
             String(date.getDate()).padStart(2, '0')
    } catch (e) {
      // Fallback to orderDate if parsing fails
      return order.orderDate
    }
  }
  // If no orderDateTime, use orderDate as-is (assumed to already be in correct format)
  return order.orderDate
}

// Helper function to get delivery local date from an order
function getDeliveryLocalDate(order) {
  if (!order.deliveryDate || order.deliveryDate === 'N/A') {
    return null
  }
  
  // If we have deliveryDateTime, use it to get the local date
  if (order.deliveryDateTime) {
    try {
      const date = new Date(order.deliveryDateTime)
      // Convert to local date string (YYYY-MM-DD)
      return date.getFullYear() + '-' + 
             String(date.getMonth() + 1).padStart(2, '0') + '-' + 
             String(date.getDate()).padStart(2, '0')
    } catch (e) {
      // Fallback to deliveryDate if parsing fails
      return order.deliveryDate
    }
  }
  // If no deliveryDateTime, use deliveryDate as-is
  return order.deliveryDate
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
    
    // Filter orders by date range - convert to local time before comparing
    const filteredOrders = allOrders.filter(order => {
      const orderLocalDate = getOrderLocalDate(order)
      const deliveryLocalDate = getDeliveryLocalDate(order)
      
      if (!deliveryLocalDate) {
        // If no delivery date, include based on order date (in local time)
        return orderLocalDate >= startDate && orderLocalDate <= endDate
      }
      
      // Filter by delivery date (primary) and order date (fallback) - both in local time
      const deliveryInRange = deliveryLocalDate >= startDate && deliveryLocalDate <= endDate
      const orderInRange = orderLocalDate >= startDate && orderLocalDate <= endDate
      
      return deliveryInRange || orderInRange
    })
    
    return filteredOrders
  }
  
  return []
}

function attachTrackingStatusToOrders(orders) {
  if (!aftershipClient || !Array.isArray(orders)) return orders
  orders.forEach(order => {
    const orderNumber = order.ordernum || order.id
    if (order.trackingNumber) {
      orderToTrackingMap.set(orderNumber, {
        trackingNumber: order.trackingNumber,
        slug: order.trackingSlug || null
      })
      trackingToOrderMap.set(order.trackingNumber, orderNumber)
    } else if (orderNumber && orderToTrackingMap.has(orderNumber)) {
      const mapped = orderToTrackingMap.get(orderNumber)
      order.trackingNumber = mapped.trackingNumber
      order.trackingSlug = mapped.slug
    }

    if (!order.trackingNumber) return

    const cacheKey = buildTrackingCacheKey(order.trackingNumber, order.trackingSlug)
    const cached = trackingStatusCache.get(cacheKey)
    if (cached) {
      order.shipmentStatus = normalizeAfterShipTag(cached.tag) || 'unknown'
      order.shipmentSubstatus = cached.subtag || null
      order.shipmentStatusUpdatedAt = cached.lastUpdated || null
      order.trackingUrl = order.trackingUrl || cached.trackingUrl || null
      const isShippingOrder = (parseFloat(order.shippingFee) || 0) > 0
      if (isShippingOrder && cached.deliveryDateTime) {
        order.deliveryDateTime = cached.deliveryDateTime
        order.deliveryDate = cached.deliveryDate || order.deliveryDate
      }
    }

    if (!cached || !isTrackingCacheFresh(cached)) {
      ensureTrackingStatus(orderNumber, order.trackingNumber, order.trackingSlug, orderNumber).catch(() => {})
    }
  })

  return orders
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
    // IMPORTANT: Allow ALL past dates - only restrict future dates
    const today = new Date()
    today.setHours(23, 59, 59, 999) // End of today
    
    const maxFutureDate = new Date()
    maxFutureDate.setDate(maxFutureDate.getDate() + 7) // Allow up to 7 days in the future
    
    const start = new Date(startDate + 'T00:00:00') // Parse as local midnight to avoid timezone issues
    const end = new Date(endDate + 'T23:59:59') // Parse as end of day
    
    // Only block if dates are in the FUTURE and more than 7 days ahead
    // Past dates should always be allowed
    if ((start > today && start > maxFutureDate) || (end > today && end > maxFutureDate)) {
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
    
    // Automatically start auto-refresh if not already running
    if (!autoRefreshTimer) {
      startAutoRefresh()
      console.log('🔄 Auto-refresh automatically started for date range:', startDate, 'to', endDate)
    }
    
    console.log('🌐 Fetching orders from Bevvi API...')
    
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
      
      console.log(`✅ All chunks processed: ${allOrders.length} total orders from ${successfulChunks}/${chunks.length} successful chunks`)
      
      // Warn if some chunks failed
      const incompleteData = successfulChunks < chunks.length
      if (incompleteData) {
        console.warn(`⚠️ WARNING: Only ${successfulChunks}/${chunks.length} chunks succeeded - data may be incomplete!`)
      }
      
      allOrders = attachTrackingStatusToOrders(allOrders)
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
          // Convert order dates to local time before comparing
          const filteredOrders = allOrders.filter(order => {
            const orderLocalDate = getOrderLocalDate(order)
            const deliveryLocalDate = getDeliveryLocalDate(order)
            
            if (!deliveryLocalDate) {
              // If no delivery date, include based on order date (in local time)
              return orderLocalDate >= startDate && orderLocalDate <= endDate
            }
            
            // Filter by delivery date (primary) and order date (fallback) - both in local time
            const deliveryInRange = deliveryLocalDate >= startDate && deliveryLocalDate <= endDate
            const orderInRange = orderLocalDate >= startDate && orderLocalDate <= endDate
            
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
          
          // Check if we got real orders from API
          if (filteredOrders.length > 0 && filteredOrders[0].id && !filteredOrders[0].id.startsWith('ORD')) {
            attachTrackingStatusToOrders(filteredOrders)
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
const SLACK_CHECK_INTERVAL = 5 * 60 * 1000 // 5 minutes for Slack status checks
let autoRefreshTimer = null
let lastAutoRefreshDate = null
let lastAutoRefreshRange = null
let slackCheckTimer = null

// Store connected clients for real-time updates
let connectedClients = []

// AfterShip tracking cache (in-memory)
const TRACKING_CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes
const trackingStatusCache = new Map() // key: `${slug || 'auto'}:${trackingNumber}`
const orderToTrackingMap = new Map() // key: orderNumber -> { trackingNumber, slug }
const trackingToOrderMap = new Map() // key: trackingNumber -> orderNumber

// Orders cache removed - always fetch fresh from API

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

          // Send Slack alerts for time-sensitive status checks
          await evaluateSlackNotifications(orders)
          
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

// Function to start Slack check timer (independent of auto-refresh)
function startSlackChecks() {
  if (!SLACK_WEBHOOK_URL) {
    console.log('ℹ️  Slack webhook not configured; Slack checks disabled')
    return
  }
  if (slackCheckTimer) {
    clearInterval(slackCheckTimer)
  }

  slackCheckTimer = setInterval(async () => {
    try {
      const lastOrders = global.lastRefreshedOrders?.orders || []
      if (lastOrders.length > 0) {
        await evaluateSlackNotifications(lastOrders)
      }
    } catch (error) {
      console.error('❌ Slack check error:', error.message)
    }
  }, SLACK_CHECK_INTERVAL)

  console.log(`🔔 Slack checks started - every ${SLACK_CHECK_INTERVAL / 60000} minutes`)
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

function notifyClientsOfTrackingUpdate(payload) {
  const message = JSON.stringify({
    type: 'tracking_update',
    ...payload
  })
  connectedClients.forEach(client => {
    if (client.res && !client.res.destroyed) {
      client.res.write(`data: ${message}\n\n`)
    }
  })
}

function normalizeIsoDateTime(value) {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString()
}

function normalizeAfterShipTag(tag) {
  if (!tag) return null
  const normalized = tag
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/\s+/g, '_')
    .toLowerCase()
  return normalized
}

function buildTrackingCacheKey(trackingNumber, slug) {
  return `${slug || 'auto'}:${trackingNumber}`
}

function isTrackingCacheFresh(entry) {
  if (!entry) return false
  return Date.now() - entry.updatedAt <= TRACKING_CACHE_TTL_MS
}

function extractTrackingInfoFromPayload(payload) {
  if (!payload) return {}
  const tracking = payload.tracking || payload.data?.tracking || payload.msg?.tracking || payload.msg || payload
  const trackingNumber = tracking.tracking_number || tracking.trackingNumber || tracking.tracking_no || tracking.trackingNo || tracking.number
  const slug = tracking.slug || tracking.courier_slug || tracking.courier || tracking.courier_code
  return { tracking, trackingNumber, slug }
}

function updateTrackingCache(tracking, trackingNumber, slug, orderNumber = null) {
  if (!trackingNumber) return null
  const deliveryDateValue = tracking?.shipment_delivery_date || tracking?.delivered_at || tracking?.delivery_date || tracking?.shipmentDeliveryDate
  const deliveryDateTime = normalizeIsoDateTime(deliveryDateValue)
  const deliveryDate = deliveryDateTime ? deliveryDateTime.split('T')[0] : null
  const tag = tracking?.tag || tracking?.status || tracking?.delivery_status
  const cacheEntry = {
    trackingNumber,
    slug: slug || tracking?.slug || null,
    tag: tag || null,
    subtag: tracking?.subtag || null,
    subtagMessage: tracking?.subtag_message || tracking?.subtagMessage || null,
    trackingUrl: tracking?.aftership_tracking_url || tracking?.courier_tracking_link || tracking?.tracking_url || null,
    deliveryDateTime,
    deliveryDate,
    lastUpdated: tracking?.updated_at || tracking?.updatedAt || null,
    updatedAt: Date.now()
  }
  const key = buildTrackingCacheKey(trackingNumber, cacheEntry.slug)
  trackingStatusCache.set(key, cacheEntry)
  if (orderNumber) {
    orderToTrackingMap.set(orderNumber, {
      trackingNumber,
      slug: cacheEntry.slug
    })
    trackingToOrderMap.set(trackingNumber, orderNumber)
  }
  return cacheEntry
}

async function createOrUpdateAfterShipTracking({ trackingNumber, slug, orderNumber, title }) {
  if (!aftershipClient || !trackingNumber) return null
  try {
    const response = await aftershipClient.post('/trackings', {
      tracking: {
        tracking_number: trackingNumber,
        slug: slug || undefined,
        title: title || trackingNumber,
        order_number: orderNumber || undefined
      }
    })
    return response?.data?.data?.tracking || null
  } catch (error) {
    console.error('❌ AfterShip create tracking failed:', error.response?.data || error.message)
    return null
  }
}

async function fetchAfterShipTracking(trackingNumber, slug) {
  if (!aftershipClient || !trackingNumber || !slug) return null
  try {
    const response = await aftershipClient.get(`/trackings/${encodeURIComponent(slug)}/${encodeURIComponent(trackingNumber)}`)
    return response?.data?.data?.tracking || null
  } catch (error) {
    return null
  }
}

async function ensureTrackingStatus(orderNumber, trackingNumber, slug, title) {
  if (!aftershipClient || !trackingNumber) return null
  const key = buildTrackingCacheKey(trackingNumber, slug)
  const cached = trackingStatusCache.get(key)
  if (isTrackingCacheFresh(cached)) {
    return cached
  }
  let tracking = null
  if (slug) {
    tracking = await fetchAfterShipTracking(trackingNumber, slug)
  }
  if (!tracking) {
    tracking = await createOrUpdateAfterShipTracking({ trackingNumber, slug, orderNumber, title })
  }
  if (!tracking) {
    return null
  }
  const updated = updateTrackingCache(tracking, trackingNumber, tracking.slug || slug, orderNumber)
  if (updated && orderNumber) {
    notifyClientsOfTrackingUpdate({
      orderNumber,
      trackingNumber: updated.trackingNumber,
      shipmentStatus: normalizeAfterShipTag(updated.tag) || 'unknown',
      shipmentSubstatus: updated.subtag || null,
      trackingUrl: updated.trackingUrl || null,
      deliveryDateTime: updated.deliveryDateTime || null,
      deliveryDate: updated.deliveryDate || null,
      updatedAt: updated.lastUpdated || null
    })
  }
  return updated
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

// Clear cache endpoint (orders cache removed - endpoint kept for compatibility)
app.post('/api/cache/clear', (req, res) => {
  try {
    console.log(`🧹 Cache clear requested (orders cache disabled - always fetches fresh)`)
    
    res.json({
      success: true,
      message: `Orders cache is disabled - orders are always fetched fresh from the API.`,
      previousSize: 0
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

    const { tracking, trackingNumber, slug } = extractTrackingInfoFromPayload(response.data || {})
    let aftership = null
    if (trackingNumber) {
      const orderNumberKey = orderNumber
      const cached = await ensureTrackingStatus(orderNumberKey, trackingNumber, slug, orderNumberKey)
      aftership = {
        trackingNumber,
        slug: slug || cached?.slug || null,
        shipmentStatus: normalizeAfterShipTag(cached?.tag || tracking?.tag) || 'unknown',
        shipmentSubstatus: cached?.subtag || tracking?.subtag || null,
        trackingUrl: cached?.trackingUrl || tracking?.aftership_tracking_url || tracking?.courier_tracking_link || null,
        updatedAt: cached?.lastUpdated || tracking?.updated_at || null
      }
    }
    
    res.json({
      ...response.data,
      aftership
    })
  } catch (error) {
    console.error('❌ Error proxying order details:', error.message)
    res.status(500).json({
      error: 'Failed to fetch order details',
      message: error.message
    })
  }
})

// Proxy endpoint for GoPuff order status (timeline)
app.get('/api/gopuff/order-status/:orderNumber', async (req, res) => {
  try {
    const { orderNumber } = req.params
    const url = `https://api.getbevvi.com/api/gopuff/getCorpGopuffOrderStatus?corpOrderNum=${encodeURIComponent(orderNumber)}`
    const response = await axios.get(url, {
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      timeout: 10000
    })
    res.json(response.data)
  } catch (error) {
    console.error('❌ Error fetching GoPuff order status:', error.message)
    res.status(500).json({
      error: 'Failed to fetch GoPuff order status',
      message: error.message
    })
  }
})

// AfterShip webhook for real-time tracking updates
app.post('/api/aftership/webhook', async (req, res) => {
  try {
    const signature = req.header('aftership-hmac-sha256')
    if (AFTERSHIP_WEBHOOK_SECRET && signature) {
      const computed = crypto
        .createHmac('sha256', AFTERSHIP_WEBHOOK_SECRET)
        .update(req.rawBody || '')
        .digest('base64')
      const sigBuffer = Buffer.from(signature)
      const computedBuffer = Buffer.from(computed)
      const isValid = sigBuffer.length === computedBuffer.length && crypto.timingSafeEqual(sigBuffer, computedBuffer)
      if (!isValid) {
        console.warn('⚠️ Invalid AfterShip webhook signature')
        return res.status(401).json({ error: 'Invalid signature' })
      }
    } else if (AFTERSHIP_WEBHOOK_SECRET && !signature) {
      console.warn('⚠️ AfterShip webhook signature missing')
    }

    const payload = req.body || {}
    const { tracking, trackingNumber, slug } = extractTrackingInfoFromPayload(payload)
    const orderNumber = tracking?.order_number || tracking?.orderNumber || trackingToOrderMap.get(trackingNumber) || null

    const updated = updateTrackingCache(tracking || payload, trackingNumber, slug, orderNumber)
    if (updated) {
      notifyClientsOfTrackingUpdate({
        orderNumber,
        trackingNumber: updated.trackingNumber,
        shipmentStatus: normalizeAfterShipTag(updated.tag) || 'unknown',
        shipmentSubstatus: updated.subtag || null,
        trackingUrl: updated.trackingUrl || null,
        deliveryDateTime: updated.deliveryDateTime || null,
        deliveryDate: updated.deliveryDate || null,
        updatedAt: updated.lastUpdated || null
      })
    }

    res.json({ success: true })
  } catch (error) {
    console.error('❌ AfterShip webhook error:', error.message)
    res.status(500).json({ error: 'Webhook processing failed' })
  }
})

// Manual tracking registration endpoint (optional)
app.post('/api/aftership/trackings', async (req, res) => {
  try {
    const { orderNumber, trackingNumber, slug, title } = req.body || {}
    if (!trackingNumber) {
      return res.status(400).json({ error: 'trackingNumber is required' })
    }
    const result = await ensureTrackingStatus(orderNumber || null, trackingNumber, slug, title)
    res.json({
      success: true,
      trackingNumber,
      shipmentStatus: normalizeAfterShipTag(result?.tag) || 'unknown',
      shipmentSubstatus: result?.subtag || null,
      trackingUrl: result?.trackingUrl || null,
      updatedAt: result?.lastUpdated || null
    })
  } catch (error) {
    console.error('❌ AfterShip tracking registration failed:', error.message)
    res.status(500).json({ error: 'Failed to register tracking' })
  }
})

// Proxy endpoint for stores API
// CRITICAL: This route MUST be defined before any static middleware or catch-all routes
app.get('/api/stores', async (req, res) => {
  // Immediately set JSON content type to prevent any middleware from changing it
  res.setHeader('Content-Type', 'application/json')
  
  try {
    console.log('🔍 /api/stores route handler EXECUTED - Route handler hit!')
    console.log('🔍 Request path:', req.path)
    console.log('🔍 Request URL:', req.url)
    console.log('🔍 Request method:', req.method)
    
    const response = await axios.get('https://api.getbevvi.com/api/corputil/getStoresAsJSON', {
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      timeout: 10000
    })
    
    console.log('📊 Stores response status:', response.status)
    console.log('📊 Stores loaded:', response.data?.results?.length || 0, 'stores')
    
    // Send JSON response
    res.json(response.data)
  } catch (error) {
    console.error('❌ Error proxying stores:', error.message)
    console.error('❌ Error stack:', error.stack)
    res.status(500).json({
      error: 'Failed to fetch stores',
      message: error.message
    })
  }
})

// Asana API helper functions
// Helper to generate Asana task URL from task GID
function getAsanaTaskUrl(taskGid) {
  return `https://app.asana.com/0/0/${taskGid}`
}

// Helper to determine project GID based on customer name
function getProjectGidForCustomer(customerName) {
  if (!customerName) {
    // Default to Bevvi project if no customer name
    return process.env.ASANA_PROJECT_GID || null
  }
  
  const customerLower = customerName.toLowerCase().trim()
  
  // Map customer names to project GIDs
  // Reachdesk orders → Reachdesk - Issue Tracking
  if (customerLower.includes('reachdesk')) {
    return '1203929818315927' // Reachdesk - Issue Tracking
  }
  
  // OnGoody orders → Goody - Issue Tracking
  if (customerLower.includes('ongoody') || customerLower.includes('goody')) {
    return '1203911426248815' // Goody - Issue Tracking
  }
  
  // Sendoso orders → Corp Orders - Issue Tracking
  if (customerLower.includes('sendoso')) {
    return '1203948231536518' // Corp Orders - Issue Tracking
  }
  
  // Default to Bevvi project for all other customers
  return process.env.ASANA_PROJECT_GID || null
}

// Helper to build comprehensive order notes
function buildOrderNotes(orderNumber, orderData) {
  let notes = `Order: ${orderNumber}\n`
  notes += `Customer: ${orderData.customerName || 'N/A'}\n`
  notes += `Status: ${orderData.status || 'N/A'}\n`
  notes += `Total: $${orderData.total || 0}\n`
  
  if (orderData.orderDate) {
    notes += `Order Date: ${orderData.orderDate}\n`
  }
  if (orderData.deliveryDate && orderData.deliveryDate !== 'N/A') {
    notes += `Delivery Date: ${orderData.deliveryDate}\n`
  }
  if (orderData.establishment) {
    notes += `Establishment: ${orderData.establishment}\n`
  }
  if (orderData.address) {
    notes += `Address: ${orderData.address}\n`
  }
  
  notes += `\n---\n\n`
  return notes
}

// Improved task search with pagination support
async function searchAsanaTask(orderNumber, projectGid, workspaceGid, headers, asanaApiUrl) {
  // Search for tasks with just the order number (no "Order " prefix)
  // Also check for old format "Order <number>" for backward compatibility
  const taskName = orderNumber
  const oldTaskName = `Order ${orderNumber}`
  let allTasks = []
  let offset = null
  
  try {
    if (projectGid) {
      // Search in project with pagination
      do {
        let url = `${asanaApiUrl}/projects/${projectGid}/tasks?opt_fields=gid,name,notes&limit=100`
        if (offset) {
          url += `&offset=${offset}`
        }
        
        const response = await axios.get(url, { headers, timeout: 10000 })
        const tasks = response.data.data || []
        allTasks = allTasks.concat(tasks)
        
        // Check for pagination
        offset = response.data.next_page?.offset || null
      } while (offset)
    } else {
      // Search in workspace with pagination
      do {
        let url = `${asanaApiUrl}/tasks?workspace=${workspaceGid}&opt_fields=gid,name,notes&limit=100`
        if (offset) {
          url += `&offset=${offset}`
        }
        
        const response = await axios.get(url, { headers, timeout: 10000 })
        const tasks = response.data.data || []
        allTasks = allTasks.concat(tasks)
        
        // Check for pagination
        offset = response.data.next_page?.offset || null
      } while (offset)
    }
    
    // Find matching task (check both new format and old format for backward compatibility)
    const existingTask = allTasks.find(task => 
      task.name === taskName || task.name === oldTaskName || task.name.includes(orderNumber)
    )
    
    return existingTask ? existingTask.gid : null
  } catch (error) {
    console.log(`⚠️ Error searching for task: ${error.message}`)
    return null
  }
}

// Find Asana task (search only, don't create)
async function findAsanaTask(orderNumber, orderData = {}) {
  try {
    if (!process.env.ASANA_ACCESS_TOKEN || !process.env.ASANA_WORKSPACE_GID) {
      return null // Return null instead of throwing, so we can handle gracefully
    }

    const asanaApiUrl = 'https://app.asana.com/api/1.0'
    const headers = {
      'Authorization': `Bearer ${process.env.ASANA_ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    }

    // Determine project based on customer name
    const projectGid = getProjectGidForCustomer(orderData.customerName)
    const workspaceGid = process.env.ASANA_WORKSPACE_GID

    // Search for existing task only (no creation)
    // First try the customer-specific project, then fallback to workspace search
    let existingTaskGid = await searchAsanaTask(orderNumber, projectGid, workspaceGid, headers, asanaApiUrl)
    
    // If not found in customer-specific project, search entire workspace
    if (!existingTaskGid && projectGid) {
      console.log(`ℹ️  Task not found in customer project, searching entire workspace...`)
      existingTaskGid = await searchAsanaTask(orderNumber, null, workspaceGid, headers, asanaApiUrl)
    }
    
    if (existingTaskGid) {
      console.log(`✅ Found existing Asana task for order ${orderNumber}`)
      return existingTaskGid
    }

    // Task not found - return null (don't create)
    console.log(`ℹ️  No Asana task found for order ${orderNumber} (not creating)`)
    return null
  } catch (error) {
    console.error('❌ Error finding Asana task:', error.message)
    return null // Return null on error instead of throwing
  }
}

async function findOrCreateAsanaTask(orderNumber, orderData) {
  try {
    if (!process.env.ASANA_ACCESS_TOKEN || !process.env.ASANA_WORKSPACE_GID) {
      throw new Error('Asana configuration missing. Please set ASANA_ACCESS_TOKEN and ASANA_WORKSPACE_GID in your .env file.')
    }

    const asanaApiUrl = 'https://app.asana.com/api/1.0'
    const headers = {
      'Authorization': `Bearer ${process.env.ASANA_ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    }

    // Use just the order number as task name (no "Order " prefix)
    const taskName = orderNumber
    
    // Determine project based on customer name
    const projectGid = getProjectGidForCustomer(orderData?.customerName)
    const workspaceGid = process.env.ASANA_WORKSPACE_GID
    
    const customerName = orderData?.customerName || 'Unknown'
    const projectName = projectGid === '1203929818315927' ? 'Reachdesk - Issue Tracking' :
                       projectGid === '1203911426248815' ? 'Goody - Issue Tracking' :
                       projectGid === '1203948231536518' ? 'Corp Orders - Issue Tracking' :
                       projectGid ? 'Bevvi' : 'Workspace (no project)'
    
    console.log(`🔍 Searching for task: ${orderNumber}, Customer: ${customerName}, Project: ${projectName}`)

    // Search for existing task - first in customer-specific project, then entire workspace
    let existingTaskGid = await searchAsanaTask(orderNumber, projectGid, workspaceGid, headers, asanaApiUrl)
    
    // If not found in customer-specific project, search entire workspace
    if (!existingTaskGid && projectGid) {
      console.log(`ℹ️  Task not found in customer project, searching entire workspace...`)
      existingTaskGid = await searchAsanaTask(orderNumber, null, workspaceGid, headers, asanaApiUrl)
    }
    
    if (existingTaskGid) {
      console.log(`✅ Found existing Asana task for order ${orderNumber}`)
      return existingTaskGid
    }

    // Create new task if not found
    console.log(`📝 Creating new Asana task: ${orderNumber} in project: ${projectName}`)
    const orderNotes = buildOrderNotes(orderNumber, orderData || {})
    
    const taskData = {
      data: {
        name: taskName,
        notes: orderNotes,
        workspace: workspaceGid
      }
    }

    if (projectGid) {
      taskData.data.projects = [projectGid]
    }

    const createResponse = await axios.post(`${asanaApiUrl}/tasks`, taskData, { headers, timeout: 10000 })
    const newTaskGid = createResponse.data.data.gid
    console.log(`✅ Created new Asana task ${newTaskGid} for order ${orderNumber}`)
    return newTaskGid
  } catch (error) {
    console.error('❌ Error finding/creating Asana task:', error.message)
    if (error.response) {
      console.error('Asana API error details:', error.response.data)
    }
    throw error
  }
}

// Get comments from Asana for an order
app.get('/api/orders/:orderNumber/comments', async (req, res) => {
  try {
    const { orderNumber } = req.params
    const { customerName } = req.query
    
    if (!process.env.ASANA_ACCESS_TOKEN) {
      return res.status(500).json({
        success: false,
        error: 'Asana not configured',
        message: 'ASANA_ACCESS_TOKEN is not set in environment variables.'
      })
    }

    const orderData = customerName ? { customerName } : {}
    const taskGid = await findAsanaTask(orderNumber, orderData)
    
    if (!taskGid) {
      return res.json({
        success: true,
        comments: [],
        taskExists: false
      })
    }
    
    const asanaApiUrl = 'https://app.asana.com/api/1.0'
    const headers = {
      'Authorization': `Bearer ${process.env.ASANA_ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    }

    // Get stories (which includes comments)
    const storiesResponse = await axios.get(
      `${asanaApiUrl}/tasks/${taskGid}/stories?opt_fields=type,text,created_at,created_by`,
      { headers, timeout: 10000 }
    )

    const stories = storiesResponse.data.data || []
    
    // Filter for comments only (type === 'comment')
    const comments = stories
      .filter(story => story.type === 'comment')
      .map(story => ({
        id: story.gid,
        text: story.text || '',
        createdAt: story.created_at,
        createdBy: story.created_by?.name || 'Unknown',
        createdByEmail: story.created_by?.email || null
      }))
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)) // Sort by date, oldest first

    res.json({
      success: true,
      comments: comments,
      taskGid: taskGid,
      taskExists: true
    })
  } catch (error) {
    console.error('❌ Error fetching comments from Asana:', error.message)
    const errorMessage = error.response?.data?.errors?.[0]?.message || error.message
    res.status(500).json({
      success: false,
      error: 'Failed to fetch comments from Asana',
      message: errorMessage || 'An error occurred while fetching comments from Asana.'
    })
  }
})

// Get notes from Asana for an order (read-only, doesn't create tasks)
app.get('/api/orders/:orderNumber/notes', async (req, res) => {
  try {
    const { orderNumber } = req.params
    const { customerName } = req.query // Optional customer name from query params
    
    if (!process.env.ASANA_ACCESS_TOKEN) {
      return res.status(500).json({
        success: false,
        error: 'Asana not configured',
        message: 'ASANA_ACCESS_TOKEN is not set in environment variables. Please configure Asana in your .env file.'
      })
    }

    const orderNumberFromParam = orderNumber
    // Use customer name from query params if provided (for project-specific search)
    const orderData = customerName ? { customerName } : {}
    const taskGid = await findAsanaTask(orderNumberFromParam, orderData)
    
    // If no task exists, return empty notes (don't create task)
    if (!taskGid) {
      return res.json({
        success: true,
        notes: '',
        taskGid: null,
        taskUrl: null,
        lastModified: null,
        createdAt: null,
        completed: false,
        taskExists: false
      })
    }
    
    const asanaApiUrl = 'https://app.asana.com/api/1.0'
    const headers = {
      'Authorization': `Bearer ${process.env.ASANA_ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    }

    // Get task details including notes
    const taskResponse = await axios.get(
      `${asanaApiUrl}/tasks/${taskGid}?opt_fields=name,notes,created_at,modified_at,completed`,
      { headers, timeout: 10000 }
    )

    const task = taskResponse.data.data
    
    // Extract notes (remove the order info header if present)
    let notes = task.notes || ''
    // Remove order info header (everything before the --- separator)
    // The separator is '\n\n---\n\n' (two newlines before ---)
    const separatorPattern = '\n\n---\n\n'
    const separatorIndex = notes.indexOf(separatorPattern)
    if (separatorIndex !== -1) {
      // +7 is correct: '\n\n---\n\n' = 7 characters (\n\n---\n\n)
      notes = notes.substring(separatorIndex + separatorPattern.length).trim()
    } else {
      // Fallback: try single newline before ---
      const altSeparator = '\n---\n\n'
      const altIndex = notes.indexOf(altSeparator)
      if (altIndex !== -1) {
        notes = notes.substring(altIndex + 7).trim()
      } else {
        // Fallback: try to find where order info ends
        // Look for pattern: Order: ... \n\n (followed by user notes)
        const orderInfoMatch = notes.match(/Order:.*?\n\n(.*)/s)
        if (orderInfoMatch && orderInfoMatch[1]) {
          notes = orderInfoMatch[1].trim()
        } else if (notes.startsWith('Order:')) {
          // If it starts with Order: but no match, try to find first double newline
          const doubleNewlineIndex = notes.indexOf('\n\n')
          if (doubleNewlineIndex !== -1) {
            notes = notes.substring(doubleNewlineIndex + 2).trim()
          }
        }
      }
    }

    res.json({
      success: true,
      notes: notes,
      taskGid: taskGid,
      taskUrl: getAsanaTaskUrl(taskGid),
      lastModified: task.modified_at,
      createdAt: task.created_at,
      completed: task.completed || false,
      taskExists: true
    })
  } catch (error) {
    console.error('❌ Error fetching notes from Asana:', error.message)
    const errorMessage = error.response?.data?.errors?.[0]?.message || error.message
    res.status(500).json({
      success: false,
      error: 'Failed to fetch notes from Asana',
      message: errorMessage || 'An error occurred while fetching notes from Asana. Please check your Asana configuration.'
    })
  }
})

// Get Asana task details and URL for an order (read-only, doesn't create tasks)
app.get('/api/orders/:orderNumber/asana-task', async (req, res) => {
  try {
    const { orderNumber } = req.params
    const { customerName } = req.query // Optional customer name from query params
    
    if (!process.env.ASANA_ACCESS_TOKEN) {
      return res.status(500).json({
        success: false,
        error: 'Asana not configured',
        message: 'ASANA_ACCESS_TOKEN is not set in environment variables'
      })
    }

    // Use customer name from query params if provided (for project-specific search)
    const orderData = customerName ? { customerName } : {}
    const taskGid = await findAsanaTask(orderNumber, orderData)
    
    // If no task exists, return null values
    if (!taskGid) {
      return res.json({
        success: true,
        taskGid: null,
        taskUrl: null,
        taskName: null,
        completed: false,
        assignee: null,
        assigneeStatus: null,
        createdAt: null,
        lastModified: null,
        taskExists: false
      })
    }
    
    const taskUrl = getAsanaTaskUrl(taskGid)
    
    const asanaApiUrl = 'https://app.asana.com/api/1.0'
    const headers = {
      'Authorization': `Bearer ${process.env.ASANA_ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    }

    // Get task details
    const taskResponse = await axios.get(
      `${asanaApiUrl}/tasks/${taskGid}?opt_fields=name,notes,created_at,modified_at,completed,assignee,assignee_status`,
      { headers, timeout: 10000 }
    )

    const task = taskResponse.data.data

    res.json({
      success: true,
      taskGid: taskGid,
      taskUrl: taskUrl,
      taskName: task.name,
      completed: task.completed || false,
      assignee: task.assignee || null,
      assigneeStatus: task.assignee_status || null,
      createdAt: task.created_at,
      lastModified: task.modified_at,
      taskExists: true
    })
  } catch (error) {
    console.error('❌ Error fetching Asana task details:', error.message)
    res.status(500).json({
      success: false,
      error: 'Failed to fetch Asana task details',
      message: error.message
    })
  }
})

// Save notes to Asana for an order
app.post('/api/orders/:orderNumber/notes', async (req, res) => {
  try {
    const { orderNumber } = req.params
    const { notes, orderData } = req.body
    
    if (!process.env.ASANA_ACCESS_TOKEN) {
      return res.status(500).json({
        success: false,
        error: 'Asana not configured',
        message: 'ASANA_ACCESS_TOKEN is not set in environment variables. Please configure Asana in your .env file.'
      })
    }

    const orderNumberFromParam = orderNumber
    const taskGid = await findOrCreateAsanaTask(orderNumberFromParam, orderData || {})
    
    const asanaApiUrl = 'https://app.asana.com/api/1.0'
    const headers = {
      'Authorization': `Bearer ${process.env.ASANA_ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    }

    // Build notes content with order info header
    // Format: Order info followed by separator, then user notes
    const orderInfo = buildOrderNotes(orderNumber, orderData || {})
    
    // Combine order info with user notes (remove any existing order info to avoid duplication)
    let userNotes = notes || ''
    // Remove any existing order info header from user notes (everything before ---)
    const separatorIndex = userNotes.indexOf('\n---\n\n')
    if (separatorIndex !== -1) {
      userNotes = userNotes.substring(separatorIndex + 7).trim()
    } else {
      // Fallback: remove order info pattern
      userNotes = userNotes.replace(/^Order:.*?\n\n/s, '').trim()
    }
    
    const fullNotes = orderInfo + userNotes

    // Update task notes
    await axios.put(
      `${asanaApiUrl}/tasks/${taskGid}`,
      {
        data: {
          notes: fullNotes
        }
      },
      { headers, timeout: 10000 }
    )

    res.json({
      success: true,
      message: 'Notes saved to Asana successfully',
      taskGid: taskGid,
      taskUrl: getAsanaTaskUrl(taskGid)
    })
  } catch (error) {
    console.error('❌ Error saving notes to Asana:', error.message)
    const errorMessage = error.response?.data?.errors?.[0]?.message || error.message
    res.status(500).json({
      success: false,
      error: 'Failed to save notes to Asana',
      message: errorMessage || 'An error occurred while saving notes to Asana. Please check your Asana configuration.'
    })
  }
})

// AI Prompt Parsing endpoint using GPT-4o-mini
app.post('/api/parse-prompt', async (req, res) => {
  try {
    const { prompt, context } = req.body
    
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
    if (context) {
      console.log('💬 Conversation context:', context)
    }
    
    // Build context string for GPT
    let contextString = ''
    if (context) {
      const contextParts = []
      if (context.lastCustomer) contextParts.push(`Last customer mentioned: ${context.lastCustomer}`)
      if (context.lastDateRange) contextParts.push(`Last date range: ${context.lastDateRange.startDate} to ${context.lastDateRange.endDate}`)
      if (context.lastIntent) contextParts.push(`Last query type: ${context.lastIntent}`)
      if (context.lastRetailer) contextParts.push(`Last retailer mentioned: ${context.lastRetailer}`)
      if (context.lastBrand) contextParts.push(`Last brand mentioned: ${context.lastBrand}`)
      if (context.lastQuery) contextParts.push(`Last query: "${context.lastQuery}"`)
      
      if (contextParts.length > 0) {
        contextString = `\n\nCONVERSATION CONTEXT (for follow-up queries):\n${contextParts.join('\n')}\n\nIf the current query is a follow-up (e.g., "what about last month?", "show me more details", "what's the revenue?") and doesn't specify certain fields, use the context values:\n- If no customer is mentioned, use lastCustomer from context\n- If no date range is mentioned, use lastDateRange from context\n- If no retailer is mentioned but context has lastRetailer, use it\n- If no brand is mentioned but context has lastBrand, use it\n`
      }
    }
    
    const systemPrompt = `You are an AI assistant that parses natural language queries about order data into structured JSON.

Today's date is ${new Date().toISOString().split('T')[0]}.${contextString}

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
  * not_delivered_orders: asking for orders that have NOT been delivered (e.g., "show me all orders that have not been delivered", "orders that haven't been delivered", "undelivered orders"). This should include orders with status "accepted" or "pending", but NOT "delivered".
  * total_orders: asking for ALL orders, order count, transactions, or "orders placed today/this week" (general order queries). Also includes "show me all orders from [customer]", "orders from [customer]", "list orders for [customer]", "show me all transactions for [customer]", "transactions for [customer]"
  * order_status_check: asking to validate/check order statuses (e.g., "are all orders accepted", "are any orders pending", "how many rejected", "check order statuses", "order status summary", "what's the status breakdown")
  * average_order_value: asking for AOV or average
  * aov_by_retailer: asking for AOV filtered by a specific retailer/store (e.g., "AOV for Liquor Master", "average order value from retailer [name]", "show me the AOV for all orders in Dec from retailer Liquor Master")
  * total_transactions_by_retailer: asking for total transaction count filtered by a specific retailer/store (e.g., "total transactions from Liquor Master", "how many orders from retailer [name]", "show me the total transactions in Dec from retailer Liquor Master")
  * revenue_by_retailer: asking for total revenue or total value filtered by a specific retailer/store (e.g., "revenue from Liquor Master", "total revenue from retailer [name]", "total value of transactions for retailer [name]", "show me the Total Revenue for all orders in Dec from retailer Liquor Master")
  * revenue_by_month: ONLY use when explicitly asking for BREAKDOWN by month (e.g., "revenue by month", "breakdown by month")
  * revenue_by_customer: asking for revenue for a specific customer
  * revenue_by_brand: asking for revenue breakdown by PRODUCT BRAND (e.g., "revenue by brand", "top brands", "which brands sell the most", "top brands sold in Dec 2025", "brand performance") - actual liquor brands like Tito's, Grey Goose, etc.
  * revenue_by_store: asking for revenue breakdown by store/retailer/establishment (e.g., "revenue by store", "top stores", "which retailers make the most", "revenue by retailer")
  * customers_by_brand: asking which customers bought/ordered/purchased a specific brand (e.g., "which customers bought Schrader", "who ordered Dom Perignon", "which customers purchased Tito's", "who bought Macallan")
  * delayed_orders_by_customer: asking for delayed orders for a specific customer
  * tax_by_state: asking for tax breakdown by state (e.g., "tax by state for Oct")
  * sales_by_state: asking for sales/revenue breakdown by state (e.g., "sales by state for Nov")
  * unknown: if the query is NOT about orders, revenue, tax, tips, delivery, or customer data (e.g., weather, personal questions, unrelated topics)
  
- customer: Customer name if mentioned (Sendoso, OnGoody, Air Culinaire, Air Culinaire Worldwide, Vistajet, VistaJet, etc.). Always extract full company name, not partial words. Extract customer names from phrases like "orders from [customer]", "orders for [customer]", "orders of [customer]", "revenue from [customer]", "revenue for [month] for [customer]". For queries like "revenue for Oct for Air Culinaire" or "show me all orders of Vistajet in Dec 2025", extract the full customer name. Note: "Vistajet" and "VistaJet" refer to the same customer - extract as "Vistajet" or "VistaJet" based on what appears in the query.
- brand: Brand name if mentioned (Schrader, Dom Perignon, Tito's, Grey Goose, etc.). Extract the full brand name.
- retailer: Retailer/store/establishment name if mentioned (e.g., "Liquor Master", "Wine & Spirits Market", "Freshco", etc.). Extract from phrases like "from retailer [name]", "from store [name]", "from [retailer name]". Extract the full retailer name.
- startDate: Start date in YYYY-MM-DD format
- endDate: End date in YYYY-MM-DD format
- isMTD: Boolean, true if asking for "month to date" or "this month so far"
- needsClarification: Boolean, true if the query is too open-ended and needs more information
- clarificationNeeded: String indicating what's missing - "date_range" if no date/timeframe specified, "customer_name" if asking about a customer but not specifying which one, "brand_name" if asking about a brand but not specifying which one

Important: 
- Customer names should be exact - "Sendoso" not "sendoso in", "Air Culinaire" not "air", "Vistajet" not "vista", etc.
- "show me orders", "orders placed today", "how many orders" = total_orders intent (NOT pending_orders)
- "show me all orders from Vistajet", "orders from Sendoso", "list orders for Air Culinaire" = total_orders intent WITH customer extracted
- "show me pending orders", "pending status" = pending_orders intent
- If a query asks for orders, revenue, tax, etc. WITHOUT specifying any timeframe (no "today", "this month", specific month, etc.), set needsClarification to true and clarificationNeeded to "date_range"
- Queries like "show me all orders", "what's the revenue", "how much tax" without dates = needsClarification: true
- EXCEPTION: Status-specific queries (accepted_orders, pending_orders, delivered_orders, delayed_orders, not_delivered_orders) do NOT need clarification even without dates - they can use current loaded data
- "show me all accepted orders", "list pending orders", "show me orders that have not been delivered" = NO clarification needed, process immediately

FOLLOW-UP QUERIES:
- If the query is a follow-up (e.g., "what about last month?", "show me more details", "what's the revenue?", "how about Sendoso?") and doesn't specify certain fields, use the context values:
  * If no customer is mentioned but context has lastCustomer, use it
  * If no date range is mentioned but context has lastDateRange, use it (unless query explicitly asks for a different period like "last month")
  * If no retailer is mentioned but context has lastRetailer, use it
  * If no brand is mentioned but context has lastBrand, use it
- Examples of follow-up queries: "what about last month?", "show me more details", "what's the revenue?", "how about Sendoso?", "and what about Oct?", "also show me"
- When a follow-up query mentions a different period (e.g., "what about last month?"), use that period but keep other context (customer, retailer, brand) if not mentioned

Date parsing rules:
- "today", "for today" = today's date for both start and end date
- "this week" = current week Sunday through Saturday (from this week's Sunday to this week's Saturday)
- "last week" = previous week Sunday through Saturday. Calculate: Find this week's Sunday, then go back 7 days to get last week's Sunday. Last week's Saturday is 6 days after last week's Sunday. Example: If today is Saturday Jan 3, 2026, last week is Sunday Dec 21, 2025 to Saturday Dec 28, 2025.
- "this month", "this month so far", "MTD", "month to date" = first day of current month to today
- "last month" = full previous month (1st to last day)
- "YTD", "year to date", "this year" = January 1st of current year to today
- "October 2025", "Oct 2025" = 2025-10-01 to 2025-10-31 (explicit year)
- "October", "Oct" (no year) = Use smart default: if month is more than 2 months in the future relative to current month, use previous year; otherwise use current year. Then apply MTD logic if end date is in the future.
- "Aug - Dec 2025", "August to December 2025", "Aug-Dec 2025" = 2025-08-01 to 2025-12-31 (month range)
- "Aug - Dec" (no year) = Use current year (or previous year if range would be in future)
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
If retailer is not mentioned, omit the "retailer" field.
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

// Set no-cache headers for HTML files
app.use((req, res, next) => {
  if (req.url.endsWith('.html') || req.url === '/' || req.url === '/dashboard' || req.url === '/products') {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
    res.setHeader('Pragma', 'no-cache')
    res.setHeader('Expires', '0')
  }
  next()
})

// Serve static files from dist directory (for assets like JS, CSS, images)
// IMPORTANT: Explicitly exclude /api/* paths to prevent API routes from being served as static files
app.use((req, res, next) => {
  // Skip static file serving for API routes
  if (req.path.startsWith('/api/')) {
    return next()
  }
  // Serve static files for non-API routes
  express.static(path.join(__dirname, 'dist'), {
    index: false
  })(req, res, next)
})

// Serve React app for all non-API routes (must be last)
// CRITICAL: This catch-all must NEVER match API routes - they should be handled by specific routes above
app.get('*', (req, res, next) => {
  // CRITICAL CHECK: If this is an API route, something is wrong - API routes should be handled above
  if (req.path.startsWith('/api/')) {
    console.error(`❌ CRITICAL: Catch-all route intercepted API request: ${req.path}`)
    console.error(`❌ This should never happen - API routes should be matched before this catch-all`)
    // Return JSON error, not HTML
    return res.status(404).json({ 
      error: 'API endpoint not found',
      path: req.path,
      message: 'The API route was not matched by any specific route handler'
    })
  }
  
  console.log(`📄 Serving React app for route: ${req.path}`)
  const indexPath = path.resolve(__dirname, 'dist', 'index.html')
  const fs = require('fs')
  
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath, (err) => {
      if (err) {
        console.error('❌ Error sending index.html:', err)
        if (!res.headersSent) {
          res.status(500).json({ 
            error: 'Failed to serve frontend',
            message: err.message,
            path: req.path
          })
        }
      } else {
        console.log(`✅ Served index.html for route: ${req.path}`)
      }
    })
  } else {
    console.error('❌ index.html not found at:', indexPath)
    res.status(404).json({ 
      error: 'Frontend not built. Please run npm run build first.',
      path: indexPath,
      requestedPath: req.path
    })
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
  
  // Orders cache disabled - always fetch fresh from API
  console.log(`📦 Orders cache disabled - always fetching fresh data from API`)
  
  console.log(`📦 Loading all Bevvi products on startup...`)
  await loadAllProducts()
  console.log(`✅ Server ready with products cache loaded`)

  // Start periodic Slack checks independent of auto-refresh
  startSlackChecks()
})
