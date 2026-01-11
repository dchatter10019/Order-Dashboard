import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { Calendar, Filter, Clock, RefreshCw, ChevronUp, ChevronDown } from 'lucide-react'
import DateRangePicker from './DateRangePicker'
import StatusFilter from './StatusFilter'
import DeliveryFilter from './DeliveryFilter'
import OrderModal from './OrderModal'
import { formatDollarAmount, formatNumber } from '../utils/formatCurrency'
import { apiFetch, getApiUrl } from '../utils/api'

const Dashboard = ({ onSwitchToAI }) => {
  const [orders, setOrders] = useState([])
  const [isLoading, setIsLoading] = useState(false)
  const [apiError, setApiError] = useState(null)
  const [dateRange, setDateRange] = useState(() => {
    const today = new Date()
    // Use local date instead of UTC to avoid timezone issues
    const todayString = today.getFullYear() + '-' + 
                       String(today.getMonth() + 1).padStart(2, '0') + '-' + 
                       String(today.getDate()).padStart(2, '0')
    return {
      startDate: todayString,
      endDate: todayString
    }
  })
  const [statusFilter, setStatusFilter] = useState(['delivered', 'in_transit', 'accepted', 'pending', 'canceled', 'rejected'])
  const [deliveryFilter, setDeliveryFilter] = useState([])
  
  const [selectedOrder, setSelectedOrder] = useState(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [orderDetails, setOrderDetails] = useState(null)
  const [isLoadingDetails, setIsLoadingDetails] = useState(false)
  const [detailsError, setDetailsError] = useState(null)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [autoRefreshInterval, setAutoRefreshInterval] = useState(null)
  const [sortConfig, setSortConfig] = useState({
    key: 'id',
    direction: 'asc'
  })
  const [lastRefreshTime, setLastRefreshTime] = useState(null)
  const [nextRefreshTime, setNextRefreshTime] = useState(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [collapsedTiles, setCollapsedTiles] = useState({
    totalOrders: false,
    totalRevenue: false,
    averageOrderValue: false,
    bevviRevenue: false
  })
  const [collapsedFilters, setCollapsedFilters] = useState({
    dateRange: false,
    statusFilter: false,
    deliveryFilter: false
  })

  // Helper function to check if date is this week
  const isThisWeek = (dateString) => {
    const date = new Date(dateString)
    const now = new Date()
    const startOfWeek = new Date(now.setDate(now.getDate() - now.getDay()))
    const endOfWeek = new Date(now.setDate(now.getDate() - now.getDay() + 6))
    return date >= startOfWeek && date <= endOfWeek
  }

  // Helper function to check if date is next week
  const isNextWeek = (dateString) => {
    const date = new Date(dateString)
    const now = new Date()
    const startOfNextWeek = new Date(now.setDate(now.getDate() - now.getDay() + 7))
    const endOfNextWeek = new Date(now.setDate(now.getDate() - now.getDay() + 13))
    return date >= startOfNextWeek && date <= endOfNextWeek
  }

  // Sorting function
  const sortOrders = (orders, key, direction) => {
    return [...orders].sort((a, b) => {
      let aVal = a[key]
      let bVal = b[key]

      // Handle numeric values
      if (key === 'total' || key === 'id') {
        aVal = parseFloat(aVal) || 0
        bVal = parseFloat(bVal) || 0
      }

      // Handle date values
      if (key === 'orderDate' || key === 'deliveryDate') {
        aVal = new Date(aVal || 0)
        bVal = new Date(bVal || 0)
      }

      // Handle string values
      if (typeof aVal === 'string') {
        aVal = aVal.toLowerCase()
        bVal = bVal.toLowerCase()
      }

      if (aVal < bVal) {
        return direction === 'asc' ? -1 : 1
      }
      if (aVal > bVal) {
        return direction === 'asc' ? 1 : -1
      }
      return 0
    })
  }

  // Handle sort header click
  const handleSort = (key) => {
    setSortConfig(prevConfig => ({
      key,
      direction: prevConfig.key === key && prevConfig.direction === 'asc' ? 'desc' : 'asc'
    }))
  }

  // Get sort icon for header
  const getSortIcon = (key) => {
    if (sortConfig.key !== key) {
      return <ChevronUp className="h-4 w-4 text-gray-400" />
    }
    return sortConfig.direction === 'asc' 
      ? <ChevronUp className="h-4 w-4 text-blue-600" />
      : <ChevronDown className="h-4 w-4 text-blue-600" />
  }

  // Calculate summary statistics
  const totalOrders = orders.length
  const revenueOrders = orders.filter(order => 
    !['pending', 'cancelled', 'canceled', 'rejected'].includes(order.status?.toLowerCase())
  )
  const totalRevenue = revenueOrders
    .reduce((sum, order) => sum + (parseFloat(order.revenue) || 0), 0)
  const averageOrderValue = revenueOrders.length > 0 ? totalRevenue / revenueOrders.length : 0

  // Filter orders based on search term
  const filteredOrders = useMemo(() => {
    if (!searchTerm.trim()) return orders
    
    const searchLower = searchTerm.toLowerCase()
    const results = orders.filter(order => 
      order.id?.toLowerCase().includes(searchLower) ||
      order.customerName?.toLowerCase().includes(searchLower) ||
      order.ordernum?.toLowerCase().includes(searchLower) ||
      // Add search for "Delayed" keyword to show delayed orders
      (searchLower === 'delayed' && order.deliveryStatus?.toLowerCase() === 'delayed')
    )
    
    return results
  }, [orders, searchTerm])

  // Filter orders based on status and delivery filters
  const filteredOrdersByStatusAndDelivery = useMemo(() => {
    let filtered = filteredOrders
    
    // Apply status filter - if none selected, show all (default to "Select All")
    if (statusFilter.length > 0) {
      filtered = filtered.filter(order => statusFilter.includes(order.status))
    }
    // If no status filters selected, show all orders (default behavior - equivalent to "Select All")
    
    // Apply delivery filter - if none selected, show all (default to "All Dates")
    if (deliveryFilter.length > 0) {
      
      filtered = filtered.filter(order => {
        // Handle "All Dates" filter first - show all orders regardless of delivery date
        if (deliveryFilter.includes('all_dates')) {
          return true
        }
        
        // For specific date filters, check if order has valid delivery information
        // If no delivery date and specific filters are applied, exclude the order
        if (!order.deliveryDate || order.deliveryDate === 'N/A' || order.deliveryDate === 'null' || order.deliveryDate === 'undefined') {
          return false
        }
        
        // Check ALL selected filters and return true if ANY match (OR logic)
        let shouldShow = false
        
        // Today filter
        if (deliveryFilter.includes('today')) {
          const today = new Date()
          const todayString = today.getFullYear() + '-' + 
                             String(today.getMonth() + 1).padStart(2, '0') + '-' + 
                             String(today.getDate()).padStart(2, '0')
          
          // Convert UTC delivery date to local date for comparison
          let localDeliveryDate = order.deliveryDate
          if (order.deliveryDateTime) {
            const utcDeliveryDate = new Date(order.deliveryDateTime)
            localDeliveryDate = utcDeliveryDate.getFullYear() + '-' + 
                               String(utcDeliveryDate.getMonth() + 1).padStart(2, '0') + '-' + 
                               String(utcDeliveryDate.getDate()).padStart(2, '0')
          }
          
          const isToday = localDeliveryDate === todayString
          if (isToday) shouldShow = true
        }
        
        // Tomorrow filter
        if (deliveryFilter.includes('tomorrow')) {
          const tomorrow = new Date(Date.now() + 86400000)
          const tomorrowString = tomorrow.getFullYear() + '-' + 
                                String(tomorrow.getMonth() + 1).padStart(2, '0') + '-' + 
                                String(tomorrow.getDate()).padStart(2, '0')
          
          // Convert UTC delivery date to local date for comparison
          let localDeliveryDate = order.deliveryDate
          if (order.deliveryDateTime) {
            const utcDeliveryDate = new Date(order.deliveryDateTime)
            localDeliveryDate = utcDeliveryDate.getFullYear() + '-' + 
                               String(utcDeliveryDate.getMonth() + 1).padStart(2, '0') + '-' + 
                               String(utcDeliveryDate.getDate()).padStart(2, '0')
          }
          
          const isTomorrow = localDeliveryDate === tomorrowString
          if (isTomorrow) shouldShow = true
        }
        
        // This Week filter
        if (deliveryFilter.includes('this_week')) {
          const today = new Date()
          const startOfWeek = new Date(today)
          startOfWeek.setDate(today.getDate() - today.getDay()) // Start of week (Sunday)
          const endOfWeek = new Date(startOfWeek)
          endOfWeek.setDate(startOfWeek.getDate() + 6) // End of week (Saturday)
          
          // Convert UTC delivery date to local date for comparison
          let deliveryDate = new Date(order.deliveryDate)
          if (order.deliveryDateTime) {
            deliveryDate = new Date(order.deliveryDateTime)
          }
          
          const isThisWeek = deliveryDate >= startOfWeek && deliveryDate <= endOfWeek
          
          if (isThisWeek) shouldShow = true
        }
        
        // Next Week filter
        if (deliveryFilter.includes('next_week')) {
          const today = new Date()
          const startOfNextWeek = new Date(today)
          startOfNextWeek.setDate(today.getDate() - today.getDay() + 7) // Start of next week
          const endOfNextWeek = new Date(startOfNextWeek)
          endOfNextWeek.setDate(startOfNextWeek.getDate() + 6) // End of next week
          
          // Convert UTC delivery date to local date for comparison
          let deliveryDate = new Date(order.deliveryDate)
          if (order.deliveryDateTime) {
            deliveryDate = new Date(order.deliveryDateTime)
          }
          
          const isNextWeek = deliveryDate >= startOfNextWeek && deliveryDate <= endOfNextWeek
          
          if (isNextWeek) shouldShow = true
        }
        
        return shouldShow
      })
    }
    // If no delivery filters selected, show all orders (default behavior)
    
    return filtered
  }, [filteredOrders, statusFilter, deliveryFilter])

  // Get sorted orders
  const sortedOrders = useMemo(() => {
    let sortableItems = [...filteredOrdersByStatusAndDelivery]
    if (sortConfig.key) {
      sortableItems.sort((a, b) => {
        if (sortConfig.key === 'orderDate' || sortConfig.key === 'deliveryDate') {
          const dateA = new Date(a[sortConfig.key])
          const dateB = new Date(b[sortConfig.key])
          if (sortConfig.direction === 'asc') {
            return dateA - dateB
          } else {
            return dateB - dateA
          }
        } else if (sortConfig.key === 'deliveryTime') {
          const timeA = a.deliveryDateTime ? new Date(a.deliveryDateTime).getTime() : 0
          const timeB = b.deliveryDateTime ? new Date(b.deliveryDateTime).getTime() : 0
          if (sortConfig.direction === 'asc') {
            return timeA - timeB
          } else {
            return timeB - timeA
          }
        } else if (sortConfig.key === 'total') {
          const totalA = parseFloat(a[sortConfig.key]) || 0
          const totalB = parseFloat(b[sortConfig.key]) || 0
          if (sortConfig.direction === 'asc') {
            return totalA - totalB
          } else {
            return totalB - totalA
          }
        } else if (sortConfig.key === 'orderType') {
          // Order Type is derived from shippingFee - 0 = Delivery, >0 = Shipping
          const aValue = (parseFloat(a.shippingFee) || 0) > 0 ? 'Shipping' : 'Delivery'
          const bValue = (parseFloat(b.shippingFee) || 0) > 0 ? 'Shipping' : 'Delivery'
          if (sortConfig.direction === 'asc') {
            return aValue.localeCompare(bValue)
          } else {
            return bValue.localeCompare(aValue)
          }
        } else {
          const aValue = a[sortConfig.key] || ''
          const bValue = b[sortConfig.key] || ''
          if (sortConfig.direction === 'asc') {
            return aValue.localeCompare(bValue)
          } else {
            return bValue.localeCompare(aValue)
          }
        }
      })
    }
    return sortableItems
  }, [filteredOrdersByStatusAndDelivery, sortConfig])

  // Calculate filtered summary statistics
  const filteredTotalOrders = filteredOrdersByStatusAndDelivery.length
  const filteredAcceptedOrders = filteredOrdersByStatusAndDelivery.filter(order => 
    !['pending', 'cancelled', 'canceled', 'rejected'].includes(order.status?.toLowerCase())
  )
  const filteredTotalRevenue = filteredAcceptedOrders
    .reduce((sum, order) => sum + (parseFloat(order.revenue) || 0), 0)
  const filteredTotalRevenueBasedOnTotal = filteredAcceptedOrders
    .reduce((sum, order) => sum + (parseFloat(order.total) || 0), 0)
  
  // Verification: Calculate what the total should be (all components)
  // order.total should = revenue + tax + tip + shippingFee + deliveryFee + serviceCharge + serviceChargeTax + giftNoteCharge - promoDiscAmt
  const calculatedTotalFromComponents = filteredAcceptedOrders.reduce((sum, order) => {
    const revenue = parseFloat(order.revenue) || 0
    const tax = parseFloat(order.tax) || 0
    const tip = parseFloat(order.tip) || 0
    const shippingFee = parseFloat(order.shippingFee) || 0
    const deliveryFee = parseFloat(order.deliveryFee) || 0
    const serviceCharge = parseFloat(order.serviceCharge) || 0
    const serviceChargeTax = parseFloat(order.serviceChargeTax) || 0
    const giftNoteCharge = parseFloat(order.giftNoteCharge) || 0
    const promoDiscAmt = parseFloat(order.promoDiscAmt) || 0 // This is a discount, so subtract it
    
    return sum + revenue + tax + tip + shippingFee + deliveryFee + serviceCharge + serviceChargeTax + giftNoteCharge - promoDiscAmt
  }, 0)
  
  // Log verification for debugging (only if there's a significant difference)
  if (Math.abs(filteredTotalRevenueBasedOnTotal - calculatedTotalFromComponents) > 0.01) {
    console.log('⚠️ Total verification:', {
      fromTotalField: filteredTotalRevenueBasedOnTotal,
      calculatedFromComponents: calculatedTotalFromComponents,
      difference: filteredTotalRevenueBasedOnTotal - calculatedTotalFromComponents,
      orderCount: filteredAcceptedOrders.length
    })
  }
  
  const filteredAverageOrderValue = filteredAcceptedOrders.length > 0 ? filteredTotalRevenue / filteredAcceptedOrders.length : 0
  
  // Fee calculation function based on Bevvi transaction fee rules
  const calculateFeeRate = (retailer, customer) => {
    // Normalize inputs for comparison (trim and lowercase for case-insensitive matching)
    const normalizedCustomer = (customer || '').trim().toLowerCase()
    const normalizedRetailer = (retailer || '').trim()
    
    // Priority 1: VistaJet Customer Rule (8%)
    if (normalizedCustomer === 'vistajet') {
      return 0.08
    }
    
    // Priority 2: 10% Retailer List Rule
    const tenPercentRetailers = [
      'Wine & Spirits Market',
      'Freshco',
      'National Liquor and Package',
      'Mavy Clippership Wine & Spirits',
      'LIQUOR MASTER',
      "Sam's Liquor & Market",
      'Dallas Fine Wine',
      'Super Duper Liquor',
      'Fountain Liquor & Spirits',
      'Aficionados',
      'Wine & Spirits Discount Warehouse',
      'Youbooze',
      'Garfields Beverage',
      'ROYAL WINES & SPIRITS',
      'Sundance Liquor & Gifts'
    ]
    if (tenPercentRetailers.includes(normalizedRetailer)) {
      return 0.10
    }
    
    // Priority 3: Sendoso Customer Rule (12%)
    if (normalizedCustomer === 'sendoso') {
      return 0.12
    }
    
    // Priority 4: In Good Taste Wines Rule (25%)
    if (normalizedRetailer === 'In Good Taste Wines') {
      return 0.25
    }
    
    // Priority 5: Default Rule (20%)
    return 0.20
  }

  // Calculate fees for an order
  const calculateOrderFees = (order) => {
    const retailer = (order.establishment || '').trim()
    const customer = (order.customerName || '').trim()
    const revenue = parseFloat(order.revenue) || 0
    
    if (revenue === 0) {
      return { serviceFee: 0, retailerFee: 0 }
    }
    
    // Determine fee rate based on retailer and customer rules
    const feeRate = calculateFeeRate(retailer, customer)
    
    // Debug logging for Sendoso orders
    if (customer === 'Sendoso' || customer.toLowerCase().includes('sendoso')) {
      console.log(`🔍 Sendoso order detected:`, {
        orderId: order.id,
        customer: customer,
        retailer: retailer,
        revenue: revenue,
        feeRate: feeRate,
        calculatedRetailerFee: Math.round(revenue * feeRate * 100) / 100
      })
    }
    
    // Retailer fee = revenue × fee_rate
    // This is the percentage of revenue that goes to the retailer based on the fee rate
    const retailerFee = Math.round(revenue * feeRate * 100) / 100
    
    return { serviceFee: 0, retailerFee }
  }

  // Calculate total service fee and retailer fee from API data and fee rules
  const totalFees = useMemo(() => {
    const fees = filteredAcceptedOrders.reduce((acc, order) => {
      // Get service fee from API
      const apiServiceFee = parseFloat(order.serviceCharge) || 0
      
      // Calculate retailer fee based on fee rules
      const { retailerFee } = calculateOrderFees(order)
      
      return {
        serviceFee: acc.serviceFee + apiServiceFee,
        retailerFee: acc.retailerFee + retailerFee
      }
    }, { serviceFee: 0, retailerFee: 0 })
    
    return {
      serviceFee: Math.round(fees.serviceFee * 100) / 100,
      retailerFee: Math.round(fees.retailerFee * 100) / 100,
      total: Math.round((fees.serviceFee + fees.retailerFee) * 100) / 100
    }
  }, [filteredAcceptedOrders])

  // Fetch orders function (wrapped in useCallback to avoid dependency issues)
  const fetchOrders = useCallback(async () => {
    try {
      // Validate date range before making API call
      if (dateRange.startDate && dateRange.endDate) {
        const start = new Date(dateRange.startDate)
        const end = new Date(dateRange.endDate)
        
        if (start > end) {
          setApiError({
            message: 'Invalid date range',
            status: 'Validation Error',
            details: 'Start date must be less than or equal to end date'
          })
          return
        }
      }
      
      setIsLoading(true)
      setApiError(null)
      // Clear old orders to prevent showing stale data while loading
      setOrders([])
      
      const timestamp = Date.now()
      const randomId = Math.random().toString(36).substring(7)
      const apiUrl = `/api/orders?startDate=${dateRange.startDate}&endDate=${dateRange.endDate}&t=${timestamp}&r=${randomId}`
      console.log(`📅 Fetching orders: ${dateRange.startDate} to ${dateRange.endDate}`)
      
      const response = await apiFetch(apiUrl, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        }
      })
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }
      
      // Check if response is JSON before parsing
      const contentType = response.headers.get('content-type')
      if (!contentType || !contentType.includes('application/json')) {
        const text = await response.text()
        console.error('❌ Expected JSON but got:', text.substring(0, 200))
        throw new Error(`Server returned non-JSON response (status ${response.status}). Check if API endpoint exists.`)
      }
      
      const data = await response.json()
      console.log(`✅ Received ${data.data?.length || 0} orders ${data.cached ? '(cached)' : ''}${data.chunked ? ` (${data.chunks} chunks)` : ''}`)
      
      // Only update orders after ALL data is retrieved (not during chunking)
      if (data.data && Array.isArray(data.data)) {
        setOrders(data.data)
      } else {
        setOrders([])
      }
      
      // Clear loading state AFTER orders are set to prevent number jumping
      setIsLoading(false)
      
      // Update last refresh time
      const now = new Date()
      setLastRefreshTime(now)
      
      // Calculate next refresh time (2 minutes from now)
      const nextRefresh = new Date(now.getTime() + 2 * 60 * 1000)
      setNextRefreshTime(nextRefresh)
    } catch (error) {
      console.error('❌ Error fetching orders:', error)
      setApiError({
        message: 'Network or system error',
        status: 'Network Error',
        details: error.message
      })
      setIsLoading(false)
    }
  }, [dateRange])

  // Auto-refresh functionality
  const toggleAutoRefresh = async () => {
    if (autoRefresh) {
      // Stop auto-refresh
      try {
        await apiFetch('/api/auto-refresh/stop', { method: 'POST' })
        if (autoRefreshInterval) {
          clearInterval(autoRefreshInterval)
          setAutoRefreshInterval(null)
        }
        setAutoRefresh(false)
        setNextRefreshTime(null)
      } catch (error) {
        console.error('Failed to stop auto-refresh:', error)
      }
    } else {
      // Start auto-refresh with current date range
      try {
        // Validate date range before starting auto-refresh
        if (dateRange.startDate && dateRange.endDate) {
          const start = new Date(dateRange.startDate)
          const end = new Date(dateRange.endDate)
          
          if (start > end) {
            console.error('Cannot start auto-refresh: Invalid date range')
            return
          }
        }
        
        const response = await apiFetch('/api/auto-refresh/start', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            startDate: dateRange.startDate,
            endDate: dateRange.endDate
          })
        })
        
        if (response.ok) {
          const data = await response.json()
          setAutoRefresh(true)
          
          // Set initial next refresh time (20 minutes from now)
          const now = new Date()
          const nextRefresh = new Date(now.getTime() + 20 * 60 * 1000)
          setNextRefreshTime(nextRefresh)
          
          // Fetch orders immediately
          fetchOrders()
        } else {
          console.error('Failed to start auto-refresh')
        }
      } catch (error) {
        console.error('Failed to start auto-refresh:', error)
      }
    }
  }



  // Fetch detailed order information from Bevvi API
  const fetchOrderDetails = async (orderNumber) => {
    try {
      setIsLoadingDetails(true)
      setDetailsError(null)
      
      const response = await fetch(`/api/order-details/${orderNumber}`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        }
      })
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }
      
      const data = await response.json()
      setOrderDetails(data)
    } catch (error) {
      console.error('❌ Error fetching order details:', error.message)
      setDetailsError({
        message: 'Failed to fetch order details',
        details: error.message
      })
    } finally {
      setIsLoadingDetails(false)
    }
  }

  const closeModal = () => {
    setIsModalOpen(false)
    setSelectedOrder(null)
    setOrderDetails(null)
    setDetailsError(null)
  }

  useEffect(() => {
    // Debounce fetchOrders to prevent rapid API calls when date changes
    const debounceTimer = setTimeout(() => {
      fetchOrders()
    }, 500) // Wait 500ms after last date change before fetching
    
    // Update backend auto-refresh with new date range if auto-refresh is active
    if (autoRefresh) {
      const updateBackendAutoRefresh = async () => {
        try {
          // Validate date range before updating backend auto-refresh
          if (dateRange.startDate && dateRange.endDate) {
            const start = new Date(dateRange.startDate)
            const end = new Date(dateRange.endDate)
            
            if (start > end) {
              console.error('Cannot update backend auto-refresh: Invalid date range')
              return
            }
          }
          
          await apiFetch('/api/auto-refresh/start', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              startDate: dateRange.startDate,
              endDate: dateRange.endDate
            })
          })
        } catch (error) {
          console.error('Failed to update backend auto-refresh:', error)
        }
      }
      
      updateBackendAutoRefresh()
    }
    
    // Cleanup: cancel the timer if dateRange changes again before it fires
    return () => clearTimeout(debounceTimer)
  }, [dateRange, autoRefresh])

  // Fetch data on page visibility change (mobile app switching, tab switching, page refresh)
  useEffect(() => {
    let visibilityTimeout = null
    let focusTimeout = null

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log('📱 Page became visible - fetching fresh data')
        // Clear any pending timeout
        if (visibilityTimeout) {
          clearTimeout(visibilityTimeout)
        }
        // Add small delay to ensure page is fully loaded and debounce rapid changes
        visibilityTimeout = setTimeout(() => {
          fetchOrders()
        }, 300)
      }
    }

    const handleFocus = () => {
      console.log('📱 Window focused - fetching fresh data')
      // Clear any pending timeout
      if (focusTimeout) {
        clearTimeout(focusTimeout)
      }
      // Debounce focus events
      focusTimeout = setTimeout(() => {
        fetchOrders()
      }, 300)
    }

    // Listen for visibility changes (works on mobile)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    
    // Listen for window focus (backup for mobile)
    window.addEventListener('focus', handleFocus)

    return () => {
      // Cleanup timeouts
      if (visibilityTimeout) clearTimeout(visibilityTimeout)
      if (focusTimeout) clearTimeout(focusTimeout)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', handleFocus)
    }
  }, [fetchOrders]) // Re-fetch when fetchOrders changes (which happens when dateRange changes)

  // Real-time updates using Server-Sent Events
  useEffect(() => {
    let eventSource = null
    
    const connectToRealTimeUpdates = () => {
      try {
        eventSource = new EventSource(getApiUrl('/api/events'))
        
        eventSource.onopen = () => {
          console.log('🔗 Connected to real-time updates')
        }
        
        eventSource.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data)
            
            if (data.type === 'data_refresh') {
              console.log('🔄 Received real-time update:', data.message)
              
              // Update the last refresh time
              setLastRefreshTime(new Date(data.refreshTime))
              
              // Automatically fetch fresh data
              fetchOrders()
              
              // Show notification to user
              if (data.ordersCount > 0) {
                // You can add a toast notification here if you want
                console.log(`📊 Auto-refreshed: ${data.ordersCount} orders updated`)
              }
            } else if (data.type === 'connected') {
              console.log('✅ Real-time connection established')
            } else if (data.type === 'heartbeat') {
              // Keep connection alive
              console.log('💓 Heartbeat received')
            }
          } catch (error) {
            console.error('Error parsing real-time update:', error)
          }
        }
        
        eventSource.onerror = (error) => {
          console.error('❌ Real-time connection error:', error)
          eventSource.close()
          
          // Attempt to reconnect after 5 seconds
          setTimeout(() => {
            console.log('🔄 Attempting to reconnect to real-time updates...')
            connectToRealTimeUpdates()
          }, 5000)
        }
      } catch (error) {
        console.error('Failed to connect to real-time updates:', error)
      }
    }
    
    // Connect to real-time updates
    connectToRealTimeUpdates()
    
    // Cleanup on unmount
    return () => {
      if (eventSource) {
        console.log('🔌 Disconnecting from real-time updates')
        eventSource.close()
      }
    }
  }, []) // Only run once on mount

  // Auto-start auto-refresh when component mounts
  useEffect(() => {
    if (autoRefresh) {
      // Start backend auto-refresh with current date range
      const startBackendAutoRefresh = async () => {
        try {
          const response = await apiFetch('/api/auto-refresh/start', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              startDate: dateRange.startDate,
              endDate: dateRange.endDate
            })
          })
          
          if (response.ok) {
            // Set initial next refresh time (20 minutes from now)
            const now = new Date()
            const nextRefresh = new Date(now.getTime() + 20 * 60 * 1000)
            setNextRefreshTime(nextRefresh)
            
            // Don't fetch orders here - the useEffect at line 633 already handles fetching
            // when dateRange/autoRefresh changes, preventing double refresh
          }
        } catch (error) {
          console.error('Failed to start backend auto-refresh:', error)
        }
      }
      
      startBackendAutoRefresh()
    }
  }, [autoRefresh, dateRange]) // Include dateRange in dependencies

  // Check auto-refresh status and update frontend state
  useEffect(() => {
    const checkAutoRefreshStatus = async () => {
      try {
        const response = await apiFetch('/api/auto-refresh/status')
        if (response.ok) {
          const status = await response.json()
          setAutoRefresh(status.active)
          
          if (status.active && status.lastRefresh) {
            setLastRefreshTime(new Date(status.lastRefresh))
            
            // Calculate next refresh time
            if (status.nextRefresh) {
              setNextRefreshTime(new Date(status.nextRefresh))
            } else {
              const now = new Date()
              const nextRefresh = new Date(now.getTime() + 20 * 60 * 1000)
              setNextRefreshTime(nextRefresh)
            }
          }
        }
      } catch (error) {
        console.error('Failed to check auto-refresh status:', error)
      }
    }
    
    checkAutoRefreshStatus()
  }, [])

  // Cleanup auto-refresh on unmount
  useEffect(() => {
    return () => {
      if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval)
      }
    }
  }, [autoRefreshInterval])

  // Toggle tile collapse state
  const toggleTile = (tileKey) => {
    setCollapsedTiles(prev => ({
      ...prev,
      [tileKey]: !prev[tileKey]
    }))
  }

  // Toggle filter collapse state
  const toggleFilter = (filterKey) => {
    setCollapsedFilters(prev => ({
      ...prev,
      [filterKey]: !prev[filterKey]
    }))
  }

  return (
    <div className="bg-gray-50 pb-20 sm:pb-16">
      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-8 py-4 sm:py-6 lg:py-8">
        {/* Auto-Refresh Control */}
        <div className="mb-4 sm:mb-6 flex justify-end">
          <button
            onClick={toggleAutoRefresh}
            className={`flex items-center px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg transition-colors text-xs sm:text-sm ${
              autoRefresh 
                ? 'bg-green-600 text-white hover:bg-green-700' 
                : 'bg-gray-600 text-white hover:bg-gray-700'
            }`}
          >
            <RefreshCw className={`h-3 w-3 sm:h-4 sm:w-4 sm:mr-2 ${autoRefresh ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">{autoRefresh ? 'Auto-Refresh ON' : 'Auto-Refresh OFF'}</span>
            <span className="sm:hidden">{autoRefresh ? 'ON' : 'OFF'}</span>
          </button>
        </div>

        {/* AI Assistant Promotion Banner */}
        {onSwitchToAI && (
          <div className="mb-4 sm:mb-6 bg-gradient-to-r from-purple-600 to-blue-600 rounded-lg shadow-lg overflow-hidden hover:shadow-xl transition-all duration-300 transform hover:-translate-y-0.5">
            <button
              onClick={onSwitchToAI}
              className="w-full px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between text-left group"
            >
              <div className="flex items-center min-w-0 flex-1">
                <div className="bg-white bg-opacity-20 rounded-full p-2 sm:p-3 mr-2 sm:mr-4 group-hover:bg-opacity-30 transition-all flex-shrink-0">
                  <svg className="w-5 h-5 sm:w-6 sm:h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-white font-bold text-sm sm:text-lg">✨ Try Our AI Assistant!</h3>
                  <p className="text-purple-100 text-xs sm:text-sm mt-1 hidden sm:block">Ask questions like "What's the revenue for October?" or "Find all delayed orders"</p>
                </div>
              </div>
              <div className="flex items-center flex-shrink-0 ml-2">
                <span className="text-white font-semibold text-xs sm:text-sm mr-1 sm:mr-2 hidden sm:inline">Try It Now</span>
                <svg className="w-4 h-4 sm:w-5 sm:h-5 text-white group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </button>
          </div>
        )}
        
        {/* Date Range and Filters */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 mb-4 sm:mb-6">
          {/* Date Range Filter */}
          <div className={`bg-white rounded-lg shadow transition-all duration-300 ${collapsedFilters.dateRange ? 'p-3 sm:p-4' : 'p-4 sm:p-6'}`}>
            <div className="flex items-center justify-between mb-3 sm:mb-4">
              <div className="flex items-center">
                <Calendar className="h-4 w-4 sm:h-5 sm:w-5 text-blue-600 mr-1.5 sm:mr-2" />
                <h3 className="text-sm sm:text-lg font-medium text-gray-900">Date Range</h3>
              </div>
              <button
                onClick={() => toggleFilter('dateRange')}
                className="p-1 hover:bg-gray-100 rounded transition-colors"
                title={collapsedFilters.dateRange ? 'Expand' : 'Collapse'}
              >
                {collapsedFilters.dateRange ? (
                  <ChevronDown className="h-5 w-5 text-gray-500" />
                ) : (
                  <ChevronUp className="h-5 w-5 text-gray-500" />
                )}
              </button>
            </div>
            {!collapsedFilters.dateRange && (
              <DateRangePicker
                dateRange={dateRange}
                onDateRangeChange={setDateRange}
                onFetchOrders={fetchOrders}
              />
            )}
          </div>

          {/* Status Filter */}
          <div className={`bg-white rounded-lg shadow transition-all duration-300 ${collapsedFilters.statusFilter ? 'p-3 sm:p-4' : 'p-4 sm:p-6'}`}>
            <div className="flex items-center justify-between mb-3 sm:mb-4">
              <div className="flex items-center">
                <Filter className="h-4 w-4 sm:h-5 sm:w-5 text-green-600 mr-1.5 sm:mr-2" />
                <h3 className="text-sm sm:text-lg font-medium text-gray-900">Status Filter</h3>
              </div>
              <button
                onClick={() => toggleFilter('statusFilter')}
                className="p-1 hover:bg-gray-100 rounded transition-colors"
                title={collapsedFilters.statusFilter ? 'Expand' : 'Collapse'}
              >
                {collapsedFilters.statusFilter ? (
                  <ChevronDown className="h-5 w-5 text-gray-500" />
                ) : (
                  <ChevronUp className="h-5 w-5 text-gray-500" />
                )}
              </button>
            </div>
            {!collapsedFilters.statusFilter && (
              <StatusFilter
                statusFilter={statusFilter}
                onStatusFilterChange={setStatusFilter}
              />
            )}
          </div>

          {/* Delivery Filter */}
          <div className={`bg-white rounded-lg shadow transition-all duration-300 ${collapsedFilters.deliveryFilter ? 'p-3 sm:p-4' : 'p-4 sm:p-6'}`}>
            <div className="flex items-center justify-between mb-3 sm:mb-4">
              <div className="flex items-center">
                <Clock className="h-4 w-4 sm:h-5 sm:w-5 text-purple-600 mr-1.5 sm:mr-2" />
                <h3 className="text-sm sm:text-lg font-medium text-gray-900">Delivery Filter</h3>
              </div>
              <button
                onClick={() => toggleFilter('deliveryFilter')}
                className="p-1 hover:bg-gray-100 rounded transition-colors"
                title={collapsedFilters.deliveryFilter ? 'Expand' : 'Collapse'}
              >
                {collapsedFilters.deliveryFilter ? (
                  <ChevronDown className="h-5 w-5 text-gray-500" />
                ) : (
                  <ChevronUp className="h-5 w-5 text-gray-500" />
                )}
              </button>
            </div>
            {!collapsedFilters.deliveryFilter && (
              <DeliveryFilter
                deliveryFilter={deliveryFilter}
                onDeliveryFilterChange={setDeliveryFilter}
              />
            )}
          </div>
        </div>

        {/* Loading Overlay - Covers entire screen */}
        {isLoading && (
          <div className="fixed inset-0 bg-gradient-to-br from-blue-900 to-blue-800 bg-opacity-95 flex items-center justify-center z-50 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-2xl p-12 max-w-lg mx-4 border-4 border-blue-500">
              <div className="flex flex-col items-center">
                {/* Large Spinner */}
                <div className="relative mb-6">
                  <div className="animate-spin rounded-full h-24 w-24 border-8 border-gray-200"></div>
                  <div className="animate-spin rounded-full h-24 w-24 border-8 border-blue-600 border-t-transparent absolute top-0"></div>
                </div>
                
                {/* Loading Text */}
                <h3 className="text-2xl font-bold text-gray-900 mb-3 animate-pulse">
                  🔄 Fetching Orders...
                </h3>
                
                <p className="text-gray-600 text-center text-lg mb-4">
                  {(() => {
                    const start = new Date(dateRange.startDate)
                    const end = new Date(dateRange.endDate)
                    const diffDays = Math.ceil(Math.abs(end - start) / (1000 * 60 * 60 * 24))
                    if (diffDays > 90) {
                      return `Processing large date range (${diffDays} days)`
                    }
                    return 'Please wait while we retrieve your data'
                  })()}
                </p>
                
                {(() => {
                  const start = new Date(dateRange.startDate)
                  const end = new Date(dateRange.endDate)
                  const diffDays = Math.ceil(Math.abs(end - start) / (1000 * 60 * 60 * 24))
                  if (diffDays > 90) {
                    const chunks = Math.ceil(diffDays / 30)
                    return (
                      <div className="bg-blue-50 border-2 border-blue-200 rounded-lg p-4 mt-2">
                        <p className="text-sm text-blue-800 font-medium text-center">
                          📦 Processing {chunks} chunks for optimal performance
                        </p>
                        <p className="text-xs text-blue-600 mt-2 text-center">
                          This may take a moment for large datasets
                        </p>
                      </div>
                    )
                  }
                  return (
                    <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 mt-2">
                      <p className="text-xs text-gray-600 text-center">
                        Data will appear once completely loaded
                      </p>
                    </div>
                  )
                })()}
              </div>
            </div>
          </div>
        )}

        {/* Summary Tiles - Hidden during loading */}
        {!isLoading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 mb-4 sm:mb-6">
          {/* Total Orders Tile */}
          <div className={`bg-white rounded-lg shadow transition-all duration-300 ${collapsedTiles.totalOrders ? 'p-3 sm:p-4' : 'p-4 sm:p-6'}`}>
            <div className="flex items-center justify-between">
            <div className="flex items-center min-w-0 flex-1">
                <div className="p-1.5 sm:p-2 bg-blue-100 rounded-lg flex-shrink-0">
                  <Calendar className="h-4 w-4 sm:h-6 sm:w-6 text-blue-600" />
              </div>
              <div className="ml-2 sm:ml-4 min-w-0 flex-1">
                  <p className="text-xs sm:text-sm font-medium text-gray-600">Total Orders</p>
                  <p className="text-xl sm:text-2xl font-bold text-gray-900">{formatNumber(filteredTotalOrders)}</p>
                </div>
              </div>
              <button
                onClick={() => toggleTile('totalOrders')}
                className="p-1 hover:bg-gray-100 rounded transition-colors"
                title={collapsedTiles.totalOrders ? 'Expand' : 'Collapse'}
              >
                {collapsedTiles.totalOrders ? (
                  <ChevronDown className="h-5 w-5 text-gray-500" />
                ) : (
                  <ChevronUp className="h-5 w-5 text-gray-500" />
                )}
              </button>
            </div>
            
            {!collapsedTiles.totalOrders && (
              <div className="mt-4 pt-4 border-t border-gray-200">
                <div className="space-y-2 text-sm text-gray-600">
                  <div className="flex justify-between">
                    <span>All Orders:</span>
                    <span className="font-medium">{formatNumber(filteredTotalOrders)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Accepted Orders:</span>
                    <span className="font-medium">{formatNumber(filteredAcceptedOrders.length)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Pending/Cancelled/Rejected:</span>
                    <span className="font-medium">{formatNumber(filteredTotalOrders - filteredAcceptedOrders.length)}</span>
          </div>
              </div>
              </div>
            )}
        </div>

          {/* Total Revenue Tile */}
          <div className={`bg-white rounded-lg shadow transition-all duration-300 ${collapsedTiles.totalRevenue ? 'p-3 sm:p-4' : 'p-4 sm:p-6'}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center min-w-0 flex-1">
              <div className="flex-shrink-0">
                  <div className="w-6 h-6 sm:w-8 sm:h-8 bg-green-100 rounded-md flex items-center justify-center">
                    <svg className="w-4 h-4 sm:w-5 sm:h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
                  </svg>
                </div>
              </div>
              <div className="ml-2 sm:ml-4 min-w-0 flex-1">
                  <p className="text-xs sm:text-sm font-medium text-gray-500">GMV (Excluding Pending/Cancelled/Rejected)</p>
                  <dd className="text-lg sm:text-xl font-medium text-gray-900">{formatDollarAmount(filteredTotalRevenue)}</dd>
                </div>
              </div>
                  <button
                onClick={() => toggleTile('totalRevenue')}
                className="p-1 hover:bg-gray-100 rounded transition-colors"
                title={collapsedTiles.totalRevenue ? 'Expand' : 'Collapse'}
              >
                {collapsedTiles.totalRevenue ? (
                  <ChevronDown className="h-5 w-5 text-gray-500" />
                ) : (
                  <ChevronUp className="h-5 w-5 text-gray-500" />
                )}
                  </button>
            </div>
            
            {!collapsedTiles.totalRevenue && (
              <div className="mt-4 pt-4 border-t border-gray-200">
                <div className="space-y-2 text-sm text-gray-600">
                  <div className="flex justify-between">
                    <span>GMV:</span>
                    <span className="font-medium">{formatDollarAmount(filteredTotalRevenue)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>GMV + Tax + Shipping/Delivery + Service:</span>
                    <span className="font-medium">{formatDollarAmount(filteredTotalRevenueBasedOnTotal)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Accepted Orders Count:</span>
                    <span className="font-medium">{formatNumber(filteredAcceptedOrders.length)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>AOV (On Base Total):</span>
                    <span className="font-medium">{formatDollarAmount(filteredAcceptedOrders.length > 0 ? (filteredTotalRevenue / filteredAcceptedOrders.length) : 0)}</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Average Order Value Tile */}
          <div className={`bg-white rounded-lg shadow transition-all duration-300 ${collapsedTiles.averageOrderValue ? 'p-3 sm:p-4' : 'p-4 sm:p-6'}`}>
            <div className="flex items-center justify-between">
            <div className="flex items-center min-w-0 flex-1">
                <div className="flex-shrink-0">
                  <div className="w-6 h-6 sm:w-8 sm:h-8 bg-purple-100 rounded-md flex items-center justify-center">
                    <svg className="w-4 h-4 sm:w-5 sm:h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                    </svg>
                  </div>
                </div>
                <div className="ml-2 sm:ml-4 min-w-0 flex-1">
                  <p className="text-xs sm:text-sm font-medium text-gray-500">Average Order Value (Excluding Pending/Cancelled/Rejected)</p>
                  <dd className="text-lg sm:text-xl font-medium text-gray-900">{formatDollarAmount(filteredAverageOrderValue)}</dd>
                </div>
              </div>
              <button
                onClick={() => toggleTile('averageOrderValue')}
                className="p-1 hover:bg-gray-100 rounded transition-colors"
                title={collapsedTiles.averageOrderValue ? 'Expand' : 'Collapse'}
                >
                {collapsedTiles.averageOrderValue ? (
                  <ChevronDown className="h-5 w-5 text-gray-500" />
                ) : (
                  <ChevronUp className="h-5 w-5 text-gray-500" />
                )}
              </button>
            </div>
            
            {!collapsedTiles.averageOrderValue && (
              <div className="mt-4 pt-4 border-t border-gray-200">
                <div className="space-y-2 text-sm text-gray-600">
                  <div className="flex justify-between">
                    <span>Total Revenue:</span>
                    <span className="font-medium">{formatDollarAmount(filteredTotalRevenue)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Revenue Orders:</span>
                    <span className="font-medium">{formatNumber(filteredAcceptedOrders.length)}</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Revenue Tile */}
          <div className={`bg-white rounded-lg shadow transition-all duration-300 ${collapsedTiles.bevviRevenue ? 'p-3 sm:p-4' : 'p-4 sm:p-6'}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center min-w-0 flex-1">
                <div className="flex-shrink-0">
                  <div className="w-6 h-6 sm:w-8 sm:h-8 bg-orange-100 rounded-md flex items-center justify-center">
                    <svg className="w-4 h-4 sm:w-5 sm:h-5 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                  </div>
                </div>
                <div className="ml-2 sm:ml-4 min-w-0 flex-1">
                  <p className="text-xs sm:text-sm font-medium text-gray-500">Revenue (Excluding Pending/Cancelled/Rejected)</p>
                  <dd className="text-lg sm:text-xl font-medium text-gray-900">{formatDollarAmount(totalFees.total)}</dd>
                  {collapsedTiles.bevviRevenue && (
                    <p className="text-xs text-gray-500 mt-1">
                      {filteredTotalRevenue > 0 
                        ? `${((totalFees.total / filteredTotalRevenue) * 100).toFixed(2)}% of GMV`
                        : '0.00% of GMV'}
                    </p>
                  )}
                </div>
              </div>
              <button
                onClick={() => toggleTile('bevviRevenue')}
                className="p-1 hover:bg-gray-100 rounded transition-colors"
                title={collapsedTiles.bevviRevenue ? 'Expand' : 'Collapse'}
              >
                {collapsedTiles.bevviRevenue ? (
                  <ChevronDown className="h-5 w-5 text-gray-500" />
                ) : (
                  <ChevronUp className="h-5 w-5 text-gray-500" />
                )}
              </button>
            </div>
            
            {!collapsedTiles.bevviRevenue && (
              <div className="mt-4 pt-4 border-t border-gray-200">
                <div className="space-y-2 text-sm text-gray-600">
                  <div className="flex justify-between">
                    <span>Service Fee:</span>
                    <span className="font-medium">{formatDollarAmount(totalFees.serviceFee)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Retailer Fee:</span>
                    <span className="font-medium">{formatDollarAmount(totalFees.retailerFee)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Total Revenue:</span>
                    <span className="font-medium">{formatDollarAmount(totalFees.total)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Total Revenue as % of GMV:</span>
                    <span className="font-medium">
                      {filteredTotalRevenue > 0 
                        ? `${((totalFees.total / filteredTotalRevenue) * 100).toFixed(2)}%`
                        : '0.00%'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Accepted Orders:</span>
                    <span className="font-medium">{formatNumber(filteredAcceptedOrders.length)}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
        )}

        {/* Order Types Tile */}


        {/* Search Bar - Hidden during loading */}
        {!isLoading && (
        <div className="mb-4 sm:mb-6">
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <svg className="h-4 w-4 sm:h-5 sm:w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <input
              type="text"
              placeholder="Search orders..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="block w-full pl-9 sm:pl-10 pr-3 py-2 text-sm border border-gray-300 rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:ring-bevvi-500 focus:border-bevvi-500"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute inset-y-0 right-0 pr-3 flex items-center"
              >
                <svg className="h-5 w-5 text-gray-400 hover:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
          {searchTerm && (
            <p className="mt-2 text-sm text-gray-600">
              Found {formatNumber(filteredOrders.length)} orders matching "{searchTerm}"
            </p>
          )}
        </div>
        )}

        {!isLoading && (
        <div className="bg-white rounded-lg shadow p-3 sm:p-4 lg:p-6">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center mb-3 sm:mb-4 gap-2">
            <h2 className="text-lg sm:text-xl font-semibold text-gray-900">Orders Dashboard</h2>
            <div className="text-xs sm:text-sm text-gray-600">
              Showing {formatNumber(filteredOrdersByStatusAndDelivery.length)} of {formatNumber(totalOrders)} orders
            </div>
          </div>

          {/* Error Display */}
          {apiError && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
              <h3 className="text-lg font-medium text-red-800 mb-2">API Error: {apiError.message}</h3>
              <p className="text-red-700">Status: {apiError.status}</p>
              <p className="text-red-700">Details: {apiError.details}</p>
                </div>
          )}

          {/* Orders Display */}
          {!isLoading && !apiError && (
            <div>
              {filteredOrdersByStatusAndDelivery.length > 0 ? (
                <>
                  {/* Desktop Table View - Hidden on mobile */}
                  <div className="hidden md:block overflow-auto shadow ring-1 ring-black ring-opacity-5 rounded-lg max-w-full max-h-96">
                    <table className="w-full table-auto divide-y divide-gray-200 min-w-0">
                    <thead className="bg-gray-50">
                  <tr>
                    <th 
                          className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 w-48"
                      onClick={() => handleSort('ordernum')}
                    >
                          <div className="flex items-center space-x-1">
                            <span>Order Number</span>
                            {sortConfig.key === 'ordernum' && (
                              sortConfig.direction === 'asc' ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />
                            )}
                      </div>
                    </th>
                    <th 
                          className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 w-40"
                      onClick={() => handleSort('customerName')}
                    >
                          <div className="flex items-center space-x-1">
                            <span>Customer</span>
                            {sortConfig.key === 'customerName' && (
                              sortConfig.direction === 'asc' ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />
                            )}
                      </div>
                    </th>
                    <th 
                          className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 w-28"
                      onClick={() => handleSort('orderDate')}
                    >
                          <div className="flex items-center space-x-1">
                            <span>Order Date</span>
                            {sortConfig.key === 'orderDate' && (
                              sortConfig.direction === 'asc' ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />
                            )}
                      </div>
                    </th>
                                        <th 
                          className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 w-28"
                          onClick={() => handleSort('deliveryDate')}
                        >
                          <div className="flex items-center space-x-1">
                            <span>Delivery Date</span>
                            {sortConfig.key === 'deliveryDate' && (
                              sortConfig.direction === 'asc' ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />
                            )}
                          </div>
                        </th>
                        <th 
                          className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 w-24"
                          onClick={() => handleSort('deliveryTime')}
                        >
                          <div className="flex items-center space-x-1">
                            <span>Delivery Time</span>
                            {sortConfig.key === 'deliveryTime' && (
                              sortConfig.direction === 'asc' ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />
                            )}
                          </div>
                        </th>
                    <th 
                          className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 w-24"
                      onClick={() => handleSort('status')}
                    >
                          <div className="flex items-center space-x-1">
                            <span>Status</span>
                            {sortConfig.key === 'status' && (
                              sortConfig.direction === 'asc' ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />
                            )}
                      </div>
                    </th>
                    <th 
                          className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 w-24"
                      onClick={() => handleSort('orderType')}
                    >
                          <div className="flex items-center space-x-1">
                            <span>Order Type</span>
                            {sortConfig.key === 'orderType' && (
                              sortConfig.direction === 'asc' ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />
                            )}
                      </div>
                    </th>
                    <th 
                          className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 w-28"
                      onClick={() => handleSort('deliveryStatus')}
                    >
                          <div className="flex items-center space-x-1">
                            <span>Delivery Status</span>
                            {sortConfig.key === 'deliveryStatus' && (
                              sortConfig.direction === 'asc' ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />
                            )}
                      </div>
                    </th>
                    <th 
                          className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-24"
                    >
                          <span>Service Fee</span>
                    </th>
                    <th 
                          className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-24"
                    >
                          <span>Retailer Fee</span>
                    </th>
                    <th 
                          className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 w-20"
                          onClick={() => handleSort('total')}
                        >
                          <div className="flex items-center space-x-1">
                            <span>Total</span>
                            {sortConfig.key === 'total' && (
                              sortConfig.direction === 'asc' ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />
                            )}
                      </div>
                    </th>

                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                      {sortedOrders.map((order) => (
                        <tr key={order.id} className="hover:bg-gray-50">
                          <td className="px-3 py-4 text-sm font-medium text-gray-900">
                            <button
                              onClick={() => {
                                setSelectedOrder(order)
                                setIsModalOpen(true)
                                // Fetch detailed order information
                                const orderNumber = order.ordernum || order.id
                                if (orderNumber) {
                                  fetchOrderDetails(orderNumber)
                                }
                              }}
                              className="text-blue-600 hover:text-blue-800 hover:underline font-medium cursor-pointer truncate block w-full text-left"
                              title={order.ordernum || order.id}
                            >
                              {order.ordernum || order.id}
                            </button>
                          </td>
                          <td className="px-3 py-4 text-sm text-gray-900">
                            <div className="truncate" title={order.customerName}>
                              {order.customerName}
                            </div>
                          </td>
                          <td className="px-3 py-4 text-sm text-gray-900">
                            <div className="truncate" title={`Raw: orderDate="${order.orderDate}", orderDateTime="${order.orderDateTime || 'null'}"`}>
                              {order.orderDate ? (() => {
                                // If we have orderDateTime, use it to get local date
                                if (order.orderDateTime) {
                                  try {
                                    const date = new Date(order.orderDateTime)
                                    // Convert to local date string
                                    return date.getFullYear() + '-' + 
                                           String(date.getMonth() + 1).padStart(2, '0') + '-' + 
                                           String(date.getDate()).padStart(2, '0')
                                  } catch (e) {
                                    return order.orderDate
                                  }
                                }
                                return order.orderDate
                              })() : 'N/A'}
                            </div>
                          </td>
                          <td className="px-3 py-4 text-sm text-gray-900">
                            <div className="truncate" title={`Raw: deliveryDate="${order.deliveryDate}", deliveryDateTime="${order.deliveryDateTime || 'null'}"`}>
                              {(() => {
                                // Convert UTC delivery date to local date for display
                                if (order.deliveryDate === 'N/A') return 'N/A'
                                if (order.deliveryDateTime) {
                                  const utcDate = new Date(order.deliveryDateTime)
                                  const localDate = utcDate.getFullYear() + '-' + 
                                                   String(utcDate.getMonth() + 1).padStart(2, '0') + '-' + 
                                                   String(utcDate.getDate()).padStart(2, '0')
                                  return localDate
                                }
                                return order.deliveryDate
                              })()}
                            </div>
                          </td>
                          <td className="px-3 py-4 text-sm text-gray-900">
                            <div className="truncate" title={`Raw deliveryDateTime: "${order.deliveryDateTime || 'null'}"`}>
                              {order.deliveryDateTime ? 
                                new Date(order.deliveryDateTime).toLocaleTimeString('en-US', { 
                                  hour: 'numeric', 
                                  minute: '2-digit',
                                  hour12: true 
                                }) : 
                                'N/A'}
                            </div>
                          </td>
                          <td className="px-3 py-4 text-sm text-gray-900">
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                              order.status === 'delivered' ? 'bg-green-100 text-green-800' :
                              order.status === 'in_transit' ? 'bg-blue-100 text-blue-800' :
                              order.status === 'accepted' ? 'bg-yellow-100 text-yellow-800' :
                              order.status === 'pending' ? 'bg-orange-100 text-orange-800' :
                              order.status === 'canceled' ? 'bg-red-100 text-red-800' :
                              order.status === 'rejected' ? 'bg-red-100 text-red-800' :
                              'bg-gray-100 text-gray-800'
                            }`}>
                              {order.status.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase())}
                        </span>
                      </td>
                          <td className="px-3 py-4 text-sm text-gray-900">
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                              (parseFloat(order.shippingFee) || 0) > 0 ? 'bg-purple-100 text-purple-800' : 'bg-blue-100 text-blue-800'
                            }`}>
                              {(parseFloat(order.shippingFee) || 0) > 0 ? '🚢 Shipping' : '🚚 Delivery'}
                            </span>
                          </td>
                          <td className="px-3 py-4 text-sm text-gray-900">
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                              order.deliveryStatus === 'Delayed' ? 'bg-red-100 text-red-800' :
                              order.deliveryStatus === 'On Time' ? 'bg-green-100 text-green-800' :
                              'bg-gray-100 text-gray-800'
                            }`}>
                              {order.deliveryStatus || 'N/A'}
                            </span>
                          </td>
                          <td className="px-3 py-4 text-sm text-gray-900">
                            <div className="truncate" title={formatDollarAmount(parseFloat(order.serviceCharge) || 0)}>
                              {formatDollarAmount(parseFloat(order.serviceCharge) || 0)}
                            </div>
                          </td>
                          <td className="px-3 py-4 text-sm text-gray-900">
                            <div className="truncate" title={formatDollarAmount(calculateOrderFees(order).retailerFee)}>
                              {formatDollarAmount(calculateOrderFees(order).retailerFee)}
                            </div>
                          </td>
                          <td className="px-3 py-4 text-sm text-gray-900">
                            <div className="truncate" title={formatDollarAmount(order.revenue)}>
                              {formatDollarAmount(order.revenue)}
                            </div>
                          </td>

                    </tr>
                  ))}
                </tbody>
              </table>
                    </div>

                  {/* Mobile Card View - Hidden on desktop */}
                  <div className="md:hidden space-y-3">
                    {sortedOrders.map((order) => {
                      const deliveryDateDisplay = (() => {
                        if (order.deliveryDate === 'N/A') return 'N/A'
                        if (order.deliveryDateTime) {
                          const utcDate = new Date(order.deliveryDateTime)
                          return utcDate.getFullYear() + '-' + 
                                 String(utcDate.getMonth() + 1).padStart(2, '0') + '-' + 
                                 String(utcDate.getDate()).padStart(2, '0')
                        }
                        return order.deliveryDate
                      })()
                      
                      const deliveryTimeDisplay = order.deliveryDateTime ? 
                        new Date(order.deliveryDateTime).toLocaleTimeString('en-US', { 
                          hour: 'numeric', 
                          minute: '2-digit',
                          hour12: true 
                        }) : 'N/A'

                      return (
                        <div 
                          key={order.id} 
                          className="bg-white border border-gray-200 rounded-lg shadow-sm p-4 hover:shadow-md transition-shadow"
                          onClick={() => {
                            setSelectedOrder(order)
                            setIsModalOpen(true)
                            const orderNumber = order.ordernum || order.id
                            if (orderNumber) {
                              fetchOrderDetails(orderNumber)
                            }
                          }}
                        >
                          {/* Header Row */}
                          <div className="flex items-start justify-between mb-3 pb-3 border-b border-gray-100">
                            <div className="flex-1 min-w-0">
                              <button
                                className="text-blue-600 hover:text-blue-800 font-semibold text-base mb-1 block truncate w-full text-left"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setSelectedOrder(order)
                                  setIsModalOpen(true)
                                  const orderNumber = order.ordernum || order.id
                                  if (orderNumber) {
                                    fetchOrderDetails(orderNumber)
                                  }
                                }}
                              >
                                {order.ordernum || order.id}
                              </button>
                              <p className="text-sm text-gray-600 truncate">{order.customerName}</p>
                            </div>
                            <div className="ml-2 flex-shrink-0">
                              <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                                order.status === 'delivered' ? 'bg-green-100 text-green-800' :
                                order.status === 'in_transit' ? 'bg-blue-100 text-blue-800' :
                                order.status === 'accepted' ? 'bg-yellow-100 text-yellow-800' :
                                order.status === 'pending' ? 'bg-orange-100 text-orange-800' :
                                order.status === 'canceled' ? 'bg-red-100 text-red-800' :
                                order.status === 'rejected' ? 'bg-red-100 text-red-800' :
                                'bg-gray-100 text-gray-800'
                              }`}>
                                {order.status.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase())}
                              </span>
                            </div>
                          </div>

                          {/* Info Grid */}
                          <div className="grid grid-cols-2 gap-3 mb-3">
                            <div>
                              <p className="text-xs text-gray-500 mb-0.5">Order Date</p>
                              <p className="text-sm font-medium text-gray-900">
                                {order.orderDate ? (() => {
                                  // If we have orderDateTime, use it to get local date
                                  if (order.orderDateTime) {
                                    try {
                                      const date = new Date(order.orderDateTime)
                                      // Convert to local date string
                                      return date.getFullYear() + '-' + 
                                             String(date.getMonth() + 1).padStart(2, '0') + '-' + 
                                             String(date.getDate()).padStart(2, '0')
                                    } catch (e) {
                                      return order.orderDate
                                    }
                                  }
                                  return order.orderDate
                                })() : 'N/A'}
                              </p>
                            </div>
                            <div>
                              <p className="text-xs text-gray-500 mb-0.5">Delivery Date</p>
                              <p className="text-sm font-medium text-gray-900">{deliveryDateDisplay}</p>
                            </div>
                            <div>
                              <p className="text-xs text-gray-500 mb-0.5">Delivery Time</p>
                              <p className="text-sm font-medium text-gray-900">{deliveryTimeDisplay}</p>
                            </div>
                            <div>
                              <p className="text-xs text-gray-500 mb-0.5">Service Fee</p>
                              <p className="text-sm font-medium text-gray-900">{formatDollarAmount(parseFloat(order.serviceCharge) || 0)}</p>
                            </div>
                            <div>
                              <p className="text-xs text-gray-500 mb-0.5">Retailer Fee</p>
                              <p className="text-sm font-medium text-gray-900">{formatDollarAmount(calculateOrderFees(order).retailerFee)}</p>
                            </div>
                            <div>
                              <p className="text-xs text-gray-500 mb-0.5">Total</p>
                              <p className="text-sm font-semibold text-gray-900">{formatDollarAmount(order.revenue)}</p>
                            </div>
                          </div>

                          {/* Badges Row */}
                          <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-100">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                              (parseFloat(order.shippingFee) || 0) > 0 ? 'bg-purple-100 text-purple-800' : 'bg-blue-100 text-blue-800'
                            }`}>
                              {(parseFloat(order.shippingFee) || 0) > 0 ? '🚢 Shipping' : '🚚 Delivery'}
                            </span>
                            {order.deliveryStatus && (
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                                order.deliveryStatus === 'Delayed' ? 'bg-red-100 text-red-800' :
                                order.deliveryStatus === 'On Time' ? 'bg-green-100 text-green-800' :
                                'bg-gray-100 text-gray-800'
                              }`}>
                                {order.deliveryStatus}
                              </span>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </>
              ) : (
                <p className="text-gray-500 text-center py-8">
                  {totalOrders > 0 ? 'No orders match the current filters.' : 'No orders found for the selected date range.'}
                </p>
              )}
            </div>
          )}

          {/* Refresh Button */}
          <div className="mt-4 sm:mt-6">
            <button
              onClick={() => {
                console.log('🔄 Manual refresh triggered')
                fetchOrders()
              }}
              disabled={isLoading}
              className="w-full sm:w-auto px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
            >
              {isLoading ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Refreshing...
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Refresh Orders
                </>
              )}
            </button>
          </div>
        </div>
        )}
      </div>

      {/* Status Band */}
      <div className="fixed bottom-0 left-0 right-0 bg-gray-800 text-white py-2 sm:py-3 px-2 sm:px-4 border-t border-gray-700 z-40">
        <div className="max-w-7xl mx-auto">
          {/* Mobile Layout */}
          <div className="md:hidden text-xs">
            <div className="flex items-center justify-between flex-wrap gap-1.5">
              <div className="flex items-center space-x-2">
                <div className={`w-1.5 h-1.5 rounded-full ${autoRefresh ? 'bg-green-400 animate-pulse' : 'bg-gray-400'}`}></div>
                <span className="text-gray-300">
                  {autoRefresh ? 'Auto-refresh: Active (20 min)' : 'Auto-refresh: Inactive'}
                </span>
              </div>
              {lastRefreshTime && !isLoading && (
                <div className="text-gray-300">
                  Last refresh: {lastRefreshTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
                </div>
              )}
              {isLoading && (
                <div className="flex items-center text-yellow-300">
                  <div className="animate-spin rounded-full h-2 w-2 border-b-2 border-yellow-300 mr-1.5"></div>
                  Fetching data...
                </div>
              )}
            </div>
            <div className="flex items-center justify-between flex-wrap gap-1.5 mt-1">
              {nextRefreshTime && autoRefresh && !isLoading && (
                <div className="text-gray-300">
                  Next refresh: {nextRefreshTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
                </div>
              )}
              <div className="text-gray-300">
                {isLoading ? (
                  'Loading...'
                ) : (
                  <>
                    Orders: {formatNumber(orders.length)} | 
                    Total: {formatDollarAmount(orders.reduce((sum, order) => sum + (parseFloat(order.total) || 0), 0))} |
                    v2.2.1
                  </>
                )}
              </div>
            </div>
          </div>
          
          {/* Desktop Layout */}
          <div className="hidden md:flex justify-between items-center text-sm">
            <div className="flex items-center space-x-6">
              <div className="flex items-center space-x-2">
                <div className={`w-2 h-2 rounded-full ${autoRefresh ? 'bg-green-400 animate-pulse' : 'bg-gray-400'}`}></div>
                <span className="text-gray-300">
                  Auto-refresh: {autoRefresh ? 'Active (20 min)' : 'Inactive'}
                </span>
              </div>
              {lastRefreshTime && !isLoading && (
                <div className="text-gray-300">
                  Last refresh: {lastRefreshTime.toLocaleTimeString()}
                </div>
              )}
              {isLoading && (
                <div className="flex items-center text-yellow-300">
                  <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-yellow-300 mr-2"></div>
                  Fetching data...
                </div>
              )}
            </div>
            <div className="flex items-center space-x-6">
              {nextRefreshTime && autoRefresh && !isLoading && (
                <div className="text-gray-300">
                  Next refresh: {nextRefreshTime.toLocaleTimeString()}
                </div>
              )}
              <div className="text-gray-300">
                {isLoading ? (
                  'Loading...'
                ) : (
                  <>
                    Orders: {formatNumber(orders.length)} | 
                    Total: {formatDollarAmount(orders.reduce((sum, order) => sum + (parseFloat(order.total) || 0), 0))} |
                    v2.2.1
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Order Modal */}
      {isModalOpen && selectedOrder && (
        <OrderModal
          order={selectedOrder}
          orderDetails={orderDetails}
          isOpen={isModalOpen}
          onClose={closeModal}
          isLoadingDetails={isLoadingDetails}
          detailsError={detailsError}
          setOrderDetails={setOrderDetails}
        />
      )}
    </div>
  )
}

export default Dashboard
