import React, { useState, useEffect, useMemo } from 'react'
import { LogOut, Calendar, Filter, Clock, Eye, RefreshCw, ChevronUp, ChevronDown } from 'lucide-react'
import DateRangePicker from './DateRangePicker'
import StatusFilter from './StatusFilter'
import DeliveryFilter from './DeliveryFilter'
import OrderModal from './OrderModal'

const Dashboard = ({ onLogout }) => {
  const [orders, setOrders] = useState([])
  const [isLoading, setIsLoading] = useState(false)
  const [apiError, setApiError] = useState(null)
  const [dateRange, setDateRange] = useState(() => {
    const today = new Date()
    const todayString = today.toISOString().split('T')[0]
    return {
      startDate: todayString,
      endDate: todayString
    }
  })
  const [statusFilter, setStatusFilter] = useState(['delivered', 'in_transit', 'accepted', 'processing', 'pending', 'canceled'])
  const [deliveryFilter, setDeliveryFilter] = useState(['today'])
  const [selectedOrder, setSelectedOrder] = useState(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
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
    averageOrderValue: false
  })
  const [collapsedFilters, setCollapsedFilters] = useState({
    dateRange: false,
    statusFilter: false,
    deliveryFilter: false
  })

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
  const totalRevenue = orders
    .filter(order => order.status === 'accepted')
    .reduce((sum, order) => sum + (parseFloat(order.revenue) || 0), 0)
  const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0

  // Filter orders based on search term
  const filteredOrders = useMemo(() => {
    if (!searchTerm.trim()) return orders
    
    const searchLower = searchTerm.toLowerCase()
    const results = orders.filter(order => 
      order.id?.toLowerCase().includes(searchLower) ||
      order.customerName?.toLowerCase().includes(searchLower) ||
      order.ordernum?.toLowerCase().includes(searchLower)
    )
    
    console.log('🔍 Search results:', {
      searchTerm,
      totalOrders: orders.length,
      filteredCount: results.length,
      results: results.map(order => ({
        id: order.id,
        customerName: order.customerName,
        status: order.status,
        revenue: order.revenue,
        ordernum: order.ordernum
      })),
      allStatuses: [...new Set(results.map(order => order.status))],
      revenueValues: results.map(order => ({
        id: order.id,
        revenue: order.revenue,
        revenueType: typeof order.revenue,
        parsedRevenue: parseFloat(order.revenue)
      }))
    })
    
    return results
  }, [orders, searchTerm])

  // Filter orders based on status and delivery filters
  const filteredOrdersByStatusAndDelivery = useMemo(() => {
    let filtered = filteredOrders
    if (statusFilter.length > 0) {
      filtered = filtered.filter(order => statusFilter.includes(order.status))
    }
    if (deliveryFilter.length > 0) {
      filtered = filtered.filter(order => {
        const orderDate = new Date(order.orderDate)
        const deliveryDate = new Date(order.deliveryDate)
        const now = new Date()

        if (deliveryFilter.includes('all_dates')) {
          return true
        }
        if (deliveryFilter.includes('today') && orderDate.toISOString().split('T')[0] === now.toISOString().split('T')[0]) {
          return true
        }
        if (deliveryFilter.includes('tomorrow') && orderDate.toISOString().split('T')[0] === new Date(now.getTime() + 86400000).toISOString().split('T')[0]) {
          return true
        }
        if (deliveryFilter.includes('this_week') && isThisWeek(orderDate.toISOString().split('T')[0])) {
          return true
        }
        if (deliveryFilter.includes('next_week') && isNextWeek(orderDate.toISOString().split('T')[0])) {
          return true
        }
        return false
      })
    }
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
        } else if (sortConfig.key === 'total') {
          const totalA = parseFloat(a[sortConfig.key]) || 0
          const totalB = parseFloat(b[sortConfig.key]) || 0
          if (sortConfig.direction === 'asc') {
            return totalA - totalB
          } else {
            return totalB - totalA
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
    !['pending', 'cancelled', 'rejected'].includes(order.status?.toLowerCase())
  )
  const filteredTotalRevenue = filteredAcceptedOrders
    .reduce((sum, order) => sum + (parseFloat(order.revenue) || 0), 0)
  const filteredAverageOrderValue = filteredTotalOrders > 0 ? filteredTotalRevenue / filteredTotalOrders : 0

  // Debug logging for status filtering
  console.log('🔍 Status Filtering Debug:', {
    totalFilteredOrders: filteredOrdersByStatusAndDelivery.length,
    acceptedOrdersCount: filteredAcceptedOrders.length,
    allStatuses: [...new Set(filteredOrdersByStatusAndDelivery.map(order => order.status))],
    acceptedOrders: filteredAcceptedOrders.map(order => ({
      id: order.id,
      status: order.status,
      revenue: order.revenue
    })),
    totalRevenue: filteredTotalRevenue,
    averageOrderValue: filteredAverageOrderValue
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

  // Fetch orders function
  const fetchOrders = async () => {
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
      
      const timestamp = Date.now()
      const randomId = Math.random().toString(36).substring(7)
      const apiUrl = `/api/orders?startDate=${dateRange.startDate}&endDate=${dateRange.endDate}&t=${timestamp}&r=${randomId}`
      console.log('🔍 Fetching orders from:', apiUrl)
      console.log('📅 Date range:', dateRange)
      console.log('⏰ Timestamp:', timestamp)
      console.log('🎲 Random ID:', randomId)
      
      const response = await fetch(apiUrl)
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }
      
      const data = await response.json()
      console.log('📊 API Response:', data)
      console.log('📋 Orders count:', data.data?.length || 0)
      console.log('🎯 Orders array:', data.data)
      console.log('🔍 Orders data type:', typeof data.data)
      console.log('🔍 Orders is array:', Array.isArray(data.data))
      
      if (data.data && Array.isArray(data.data)) {
        console.log('✅ Setting real orders from API')
        console.log('📊 Orders before setState:', orders)
        setOrders(data.data)
        console.log('🔄 setOrders called with:', data.data)
      } else {
        console.log('❌ No valid orders data, setting empty array')
        setOrders([])
      }
      
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
    } finally {
      setIsLoading(false)
    }
  }

  // Auto-refresh functionality
  const toggleAutoRefresh = async () => {
    if (autoRefresh) {
      // Stop auto-refresh
      try {
        await fetch('/api/auto-refresh/stop', { method: 'POST' })
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
        
        const response = await fetch('/api/auto-refresh/start', {
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

  const handleOrderClick = (order) => {
    setSelectedOrder(order)
    setIsModalOpen(true)
  }

  const closeModal = () => {
    setIsModalOpen(false)
    setSelectedOrder(null)
  }

  useEffect(() => {
    fetchOrders()
    
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
          
          await fetch('/api/auto-refresh/start', {
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
  }, [dateRange, autoRefresh])

  // Auto-start auto-refresh when component mounts
  useEffect(() => {
    if (autoRefresh) {
      // Start backend auto-refresh with current date range
      const startBackendAutoRefresh = async () => {
        try {
          const response = await fetch('/api/auto-refresh/start', {
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
            
            // Fetch orders immediately
            fetchOrders()
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
        const response = await fetch('/api/auto-refresh/status')
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
  
  // Debug effect to log orders changes
  useEffect(() => {
    console.log('🔄 Orders state changed:', orders)
    console.log('📊 Orders count:', orders.length)
    console.log('🎯 First order:', orders[0])
  }, [orders])

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
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <h1 className="text-2xl font-bold text-gray-900">Bevvi Order Tracking</h1>
            <div className="flex items-center space-x-4">
              <button
                onClick={toggleAutoRefresh}
                className={`flex items-center px-4 py-2 rounded-lg transition-colors ${
                  autoRefresh 
                    ? 'bg-green-600 text-white hover:bg-green-700' 
                    : 'bg-gray-600 text-white hover:bg-gray-700'
                }`}
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${autoRefresh ? 'animate-spin' : ''}`} />
                {autoRefresh ? 'Auto-Refresh ON' : 'Auto-Refresh OFF'}
              </button>
              <button
                onClick={onLogout}
                className="flex items-center px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
              >
                <LogOut className="h-4 w-4 mr-2" />
                Logout
              </button>
            </div>
          </div>
        </div>
        </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Date Range and Filters */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          {/* Date Range Filter */}
          <div className={`bg-white rounded-lg shadow transition-all duration-300 ${collapsedFilters.dateRange ? 'p-4' : 'p-6'}`}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center">
                <Calendar className="h-5 w-5 text-blue-600 mr-2" />
                <h3 className="text-lg font-medium text-gray-900">Date Range</h3>
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
          <div className={`bg-white rounded-lg shadow transition-all duration-300 ${collapsedFilters.statusFilter ? 'p-4' : 'p-6'}`}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center">
                <Filter className="h-5 w-5 text-green-600 mr-2" />
                <h3 className="text-lg font-medium text-gray-900">Status Filter</h3>
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
          <div className={`bg-white rounded-lg shadow transition-all duration-300 ${collapsedFilters.deliveryFilter ? 'p-4' : 'p-6'}`}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center">
                <Clock className="h-5 w-5 text-purple-600 mr-2" />
                <h3 className="text-lg font-medium text-gray-900">Delivery Filter</h3>
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



        {/* Summary Tiles */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
          {/* Total Orders Tile */}
          <div className={`bg-white rounded-lg shadow transition-all duration-300 ${collapsedTiles.totalOrders ? 'p-4' : 'p-6'}`}>
            <div className="flex items-center justify-between">
            <div className="flex items-center">
                <div className="p-2 bg-blue-100 rounded-lg">
                  <Calendar className="h-6 w-6 text-blue-600" />
              </div>
              <div className="ml-4">
                  <p className="text-sm font-medium text-gray-600">Total Orders</p>
                  <p className="text-2xl font-bold text-gray-900">{filteredTotalOrders}</p>
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
                    <span className="font-medium">{filteredTotalOrders}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Accepted Orders:</span>
                    <span className="font-medium">{filteredAcceptedOrders.length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Pending/Cancelled/Rejected:</span>
                    <span className="font-medium">{filteredTotalOrders - filteredAcceptedOrders.length}</span>
          </div>
              </div>
              </div>
            )}
        </div>

          {/* Total Revenue Tile */}
          <div className={`bg-white rounded-lg shadow transition-all duration-300 ${collapsedTiles.totalRevenue ? 'p-4' : 'p-6'}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center">
              <div className="flex-shrink-0">
                  <div className="w-8 h-8 bg-green-100 rounded-md flex items-center justify-center">
                    <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
                  </svg>
                </div>
              </div>
              <div className="ml-4">
                  <p className="text-sm font-medium text-gray-500">Total Revenue (Excluding Pending/Cancelled/Rejected)</p>
                  <dd className="text-lg font-medium text-gray-900">${filteredTotalRevenue.toFixed(2)}</dd>
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
                    <span>Base Revenue:</span>
                    <span className="font-medium">${filteredTotalRevenue.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Accepted Orders Count:</span>
                    <span className="font-medium">{filteredAcceptedOrders.length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Average per Order:</span>
                    <span className="font-medium">${filteredAcceptedOrders.length > 0 ? (filteredTotalRevenue / filteredAcceptedOrders.length).toFixed(2) : '0.00'}</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Average Order Value Tile */}
          <div className={`bg-white rounded-lg shadow transition-all duration-300 ${collapsedTiles.averageOrderValue ? 'p-4' : 'p-6'}`}>
            <div className="flex items-center justify-between">
            <div className="flex items-center">
                <div className="flex-shrink-0">
                  <div className="w-8 h-8 bg-purple-100 rounded-md flex items-center justify-center">
                    <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                    </svg>
                  </div>
                </div>
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-500">Average Order Value (Excluding Pending/Cancelled/Rejected)</p>
                  <dd className="text-lg font-medium text-gray-900">${filteredAverageOrderValue.toFixed(2)}</dd>
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
                    <span className="font-medium">${filteredTotalRevenue.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Total Orders:</span>
                    <span className="font-medium">{filteredTotalOrders}</span>
          </div>
                  <div className="flex justify-between">
                    <span>Calculation:</span>
                    <span className="font-medium">{filteredTotalOrders > 0 ? `${filteredTotalRevenue.toFixed(2)} ÷ ${filteredTotalOrders} = $${filteredAverageOrderValue.toFixed(2)}` : 'N/A'}</span>
            </div>
                </div>
                </div>
              )}
          </div>
        </div>

        {/* Search Bar */}
        <div className="mb-6">
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <svg className="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <input
              type="text"
              placeholder="Search by Order ID, Customer Name, or Order Number..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:ring-bevvi-500 focus:border-bevvi-500 sm:text-sm"
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
              Found {filteredOrders.length} orders matching "{searchTerm}"
            </p>
          )}
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold text-gray-900">Orders Dashboard</h2>
            <div className="text-sm text-gray-600">
              Showing {filteredOrdersByStatusAndDelivery.length} of {totalOrders} orders
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

          {/* Loading State */}
          {isLoading && (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
              <p className="text-gray-600">Loading orders...</p>
            </div>
          )}

          {/* Orders Display */}
          {!isLoading && !apiError && (
            <div>
              {filteredOrdersByStatusAndDelivery.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                  <tr>
                    <th 
                          className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                      onClick={() => handleSort('id')}
                    >
                          <div className="flex items-center space-x-1">
                            <span>Order ID</span>
                            {sortConfig.key === 'id' && (
                              sortConfig.direction === 'asc' ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />
                            )}
                      </div>
                    </th>
                    <th 
                          className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
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
                          className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
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
                          className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
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
                          className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
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
                          className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                          onClick={() => handleSort('total')}
                        >
                          <div className="flex items-center space-x-1">
                            <span>Total</span>
                            {sortConfig.key === 'total' && (
                              sortConfig.direction === 'asc' ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />
                            )}
                      </div>
                    </th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Actions
                        </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                      {sortedOrders.map((order) => (
                        <tr key={order.id} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{order.id}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{order.customerName}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{order.orderDate}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{order.deliveryDate}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                              order.status === 'delivered' ? 'bg-green-100 text-green-800' :
                              order.status === 'in_transit' ? 'bg-blue-100 text-blue-800' :
                              order.status === 'accepted' ? 'bg-yellow-100 text-yellow-800' :
                              order.status === 'processing' ? 'bg-purple-100 text-purple-800' :
                              order.status === 'pending' ? 'bg-orange-100 text-orange-800' :
                              order.status === 'canceled' ? 'bg-red-100 text-red-800' :
                              'bg-gray-100 text-gray-800'
                            }`}>
                              {order.status.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase())}
                        </span>
                      </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${(parseFloat(order.revenue) || 0).toFixed(2)}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                            <button
                              onClick={() => handleOrderClick(order)}
                              className="text-bevvi-600 hover:text-bevvi-900 inline-flex items-center"
                            >
                              <Eye className="h-4 w-4 mr-1" />
                              View
                            </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
                </div>
              ) : (
                <p className="text-gray-500 text-center py-8">
                  {totalOrders > 0 ? 'No orders match the current filters.' : 'No orders found for the selected date range.'}
                </p>
              )}
            </div>
          )}

          {/* Refresh Button */}
          <div className="mt-6">
            <button
              onClick={fetchOrders}
              disabled={isLoading}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? 'Refreshing...' : 'Refresh Orders'}
            </button>
          </div>
        </div>
      </div>

      {/* Status Band */}
      <div className="fixed bottom-0 left-0 right-0 bg-gray-800 text-white py-3 px-4 border-t border-gray-700">
        <div className="max-w-7xl mx-auto flex justify-between items-center text-sm">
          <div className="flex items-center space-x-6">
            <div className="flex items-center space-x-2">
              <div className={`w-2 h-2 rounded-full ${autoRefresh ? 'bg-green-400 animate-pulse' : 'bg-gray-400'}`}></div>
              <span className="text-gray-300">
                Auto-refresh: {autoRefresh ? 'Active (20 min)' : 'Inactive'}
              </span>
            </div>
            {lastRefreshTime && (
              <div className="text-gray-300">
                Last refresh: {lastRefreshTime.toLocaleTimeString()}
              </div>
            )}
          </div>
          <div className="flex items-center space-x-6">
            {nextRefreshTime && autoRefresh && (
              <div className="text-gray-300">
                Next refresh: {nextRefreshTime.toLocaleTimeString()}
              </div>
            )}
            <div className="text-gray-300">
              Orders: {orders.length} | 
              Total: ${orders.reduce((sum, order) => sum + (parseFloat(order.total) || 0), 0).toFixed(2)}
            </div>
          </div>
        </div>
      </div>

      {/* Order Modal */}
      {isModalOpen && selectedOrder && (
        <OrderModal
          order={selectedOrder}
          isOpen={isModalOpen}
          onClose={closeModal}
        />
      )}
    </div>
  )
}

export default Dashboard
