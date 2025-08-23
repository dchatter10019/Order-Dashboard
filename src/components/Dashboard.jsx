import React, { useState, useEffect } from 'react'
import { LogOut, Calendar, Filter, Search, Package, TrendingUp, Clock, CheckCircle, XCircle, AlertCircle, DollarSign, RefreshCw } from 'lucide-react'
import OrderModal from './OrderModal'
import DateRangePicker from './DateRangePicker'
import StatusFilter from './StatusFilter'
import DeliveryFilter from './DeliveryFilter'

const Dashboard = ({ onLogout }) => {
  const [orders, setOrders] = useState([])
  const [filteredOrders, setFilteredOrders] = useState([])
  const [isLoading, setIsLoading] = useState(false)
  const [selectedOrder, setSelectedOrder] = useState(null)
  const [showOrderModal, setShowOrderModal] = useState(false)
  const [dateRange, setDateRange] = useState({
    startDate: new Date().toISOString().split('T')[0],
    endDate: new Date().toISOString().split('T')[0]
  })
  const [statusFilter, setStatusFilter] = useState(['delivered', 'in_transit', 'accepted', 'processing', 'pending', 'canceled'])
  const [deliveryFilter, setDeliveryFilter] = useState(['all_dates'])
  const [searchTerm, setSearchTerm] = useState('')
  const [apiError, setApiError] = useState(null)

  const [lastManualRefresh, setLastManualRefresh] = useState(null)
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' })

  // Mock data for demonstration - replace with actual API call
  const mockOrders = [
    {
      id: 'ORD001',
      customerName: 'John Smith',
      orderDate: '2025-08-14',
      deliveryDate: '2025-08-15',
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
      orderDate: '2025-08-14',
      deliveryDate: '2025-08-16',
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
      orderDate: '2025-08-14',
      deliveryDate: '2025-08-17',
      status: 'pending',
      total: 89.99,
      items: [
        { name: 'Bevvi Premium Package', quantity: 1, price: 89.99 }
      ],
      address: '789 Pine Rd, City, State 12345',
      phone: '+1-555-0789'
    },
    {
      id: 'ORD004',
      customerName: 'Lisa Brown',
      orderDate: '2025-08-14',
      deliveryDate: '2025-08-15',
      status: 'delivered',
      total: 34.99,
      items: [
        { name: 'Bevvi Water Bottle', quantity: 1, price: 22.99 },
        { name: 'Bevvi Accessories', quantity: 1, price: 12.00 }
      ],
      address: '321 Elm St, City, State 12345',
      phone: '+1-555-0321'
    },
    {
      id: 'ORD005',
      customerName: 'David Lee',
      orderDate: '2025-08-14',
      deliveryDate: '2025-08-18',
      status: 'cancelled',
      total: 56.99,
      items: [
        { name: 'Bevvi Starter Kit', quantity: 1, price: 56.99 }
      ],
      address: '654 Maple Dr, City, State 12345',
      phone: '+1-555-0654'
    }
  ]

  useEffect(() => {
    fetchOrders()
  }, [dateRange])

  useEffect(() => {
    applyFilters()
  }, [orders, statusFilter, deliveryFilter, searchTerm])



  const fetchOrders = async () => {
    setIsLoading(true)
    setApiError(null) // Clear any previous errors immediately
    setOrders([]) // Clear previous orders to show fresh state
    
    try {
      console.log(`🔄 Fetching orders for date range: ${dateRange.startDate} to ${dateRange.endDate}`)
      
      // Call the backend API which will then call the Bevvi API
      const response = await fetch(`/api/orders?startDate=${dateRange.startDate}&endDate=${dateRange.endDate}`)
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }
      
      const result = await response.json()
      
      if (result.success) {
        setOrders(result.data)
        setLastManualRefresh(new Date())
        console.log(`✅ Successfully fetched ${result.data.length} orders`)
      } else {
        // API call failed - show error state
        setOrders([])
        setApiError({
          message: result.error || 'API call failed',
          note: result.note || 'Unknown error occurred',
          status: result.apiStatus || 'Unknown',
          apiUrl: result.apiUrl || 'Unknown'
        })
        console.error('❌ API Error:', result.error, result.note)
        console.error('🌐 API URL Called:', result.apiUrl)
        console.error('📊 API Status:', result.apiStatus)
      }
    } catch (error) {
      console.error('❌ Network/System Error:', error)
      // Network or other error - show empty state
      setOrders([])
      setApiError({
        message: 'Network or system error',
        note: error.message || 'Failed to connect to the server',
        status: 'Network Error'
      })
    } finally {
      setIsLoading(false)
    }
  }



  const applyFilters = () => {
    let filtered = [...orders]

    // Status filter
    if (statusFilter.length > 0) {
      filtered = filtered.filter(order => statusFilter.includes(order.status))
    } else {
      // If no status filters are selected, show no orders
      filtered = []
    }

    // Delivery date filter
    if (deliveryFilter.length > 0) {
      // Use the selected date range instead of current real-world date
      const selectedStartDate = new Date(dateRange.startDate)
      const selectedEndDate = new Date(dateRange.endDate)
      
      filtered = filtered.filter(order => {
        // Skip orders with N/A delivery dates for date-based filtering
        if (order.deliveryDate === 'N/A') {
          return false
        }
        
        const deliveryDate = new Date(order.deliveryDate)
        
        // Check if any of the selected filters match
        return deliveryFilter.some(filter => {
          switch (filter) {
            case 'all_dates':
              // Show all orders regardless of delivery date
              return true
            case 'today':
              // Check if delivery date matches the selected start date
              return deliveryDate.toDateString() === selectedStartDate.toDateString()
            case 'tomorrow':
              // Check if delivery date is the day after the selected start date
              const nextDay = new Date(selectedStartDate)
              nextDay.setDate(selectedStartDate.getDate() + 1)
              return deliveryDate.toDateString() === nextDay.toDateString()
            case 'this_week':
              // Check if delivery date is within the selected date range
              return deliveryDate >= selectedStartDate && deliveryDate <= selectedEndDate
            default:
              return false
          }
        })
      })
    }

    // Search filter
    if (searchTerm) {
      filtered = filtered.filter(order =>
        order.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
        order.customerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        order.status.toLowerCase().includes(searchTerm.toLowerCase())
      )
    }

    setFilteredOrders(filtered)
  }

  const handleOrderClick = (order) => {
    setSelectedOrder(order)
    setShowOrderModal(true)
  }

  const getStatusIcon = (status) => {
    switch (status) {
      case 'delivered':
        return <CheckCircle className="h-5 w-5 text-green-500" />
      case 'in_transit':
        return <Clock className="h-5 w-5 text-blue-500" />
      case 'pending':
        return <AlertCircle className="h-5 w-5 text-yellow-500" />
      case 'cancelled':
        return <XCircle className="h-5 w-5 text-red-500" />
      default:
        return <Package className="h-5 w-5 text-gray-500" />
    }
  }

  const getStatusColor = (status) => {
    switch (status) {
      case 'delivered':
        return 'bg-green-100 text-green-800'
      case 'in_transit':
        return 'bg-blue-100 text-blue-800'
      case 'pending':
        return 'bg-yellow-100 text-yellow-800'
      case 'cancelled':
        return 'bg-red-100 text-red-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  const getStatusCount = (status) => {
    return filteredOrders.filter(order => order.status === status).length
  }

  const getTotalRevenueWithFees = () => {
    return filteredOrders
      .filter(order => order.status === 'accepted' || order.status === 'delivered' || order.status === 'in_transit')
      .reduce((sum, order) => sum + order.total, 0)
      .toFixed(2)
  }

  const getTotalRevenueField = () => {
    return filteredOrders
      .filter(order => order.status === 'accepted' || order.status === 'delivered' || order.status === 'in_transit')
      .reduce((sum, order) => sum + (order.revenue || 0), 0)
      .toFixed(2)
      }

  const getCalculatedBaseRevenue = () => {
    return filteredOrders
      .filter(order => order.status === 'accepted' || order.status === 'delivered' || order.status === 'in_transit')
      .reduce((sum, order) => {
        // Calculate base revenue by subtracting fees from total
        const total = order.total || 0
        const giftNote = order.giftNoteCharge || 0
        const promoDisc = order.promoDiscAmt || 0
        const tax = order.tax || 0
        const tip = order.tip || 0
        const shipping = order.shippingFee || 0
        const delivery = order.deliveryFee || 0
        const serviceCharge = order.serviceCharge || 0
        const serviceTax = order.serviceChargeTax || 0
        
        // Base revenue = total - all fees
        const baseRevenue = total - giftNote - tax - tip - shipping - delivery - serviceCharge - serviceTax + promoDisc
        return sum + Math.max(0, baseRevenue) // Ensure non-negative
      }, 0)
      .toFixed(2)
  }

  const getOrderBaseRevenue = (order) => {
    // Calculate base revenue for a single order
    const total = order.total || 0
    const giftNote = order.giftNoteCharge || 0
    const promoDisc = order.promoDiscAmt || 0
    const tax = order.tax || 0
    const tip = order.tip || 0
    const shipping = order.shippingFee || 0
    const delivery = order.deliveryFee || 0
    const serviceCharge = order.serviceCharge || 0
    const serviceTax = order.serviceChargeTax || 0
    
    // Base revenue = total - all fees + promo discount
    const baseRevenue = total - giftNote - tax - tip - shipping - delivery - serviceCharge - serviceTax + promoDisc
    return Math.max(0, baseRevenue) // Ensure non-negative
  }



  const getAcceptedOrdersCount = () => {
    return filteredOrders.filter(order => order.status === 'delivered' || order.status === 'in_transit' || order.status === 'accepted').length
  }

  const getTotalOrders = () => filteredOrders.length

  const handleSort = (key) => {
    let direction = 'asc'
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc'
    }
    setSortConfig({ key, direction })
  }

  const getSortedOrders = () => {
    if (!sortConfig.key) return filteredOrders

    return [...filteredOrders].sort((a, b) => {
      let aValue = a[sortConfig.key]
      let bValue = b[sortConfig.key]

      // Handle special cases
      if (sortConfig.key === 'orderDate' || sortConfig.key === 'deliveryDate') {
        aValue = aValue === 'N/A' ? '1900-01-01' : aValue
        bValue = bValue === 'N/A' ? '1900-01-01' : bValue
      } else if (sortConfig.key === 'revenue') {
        aValue = getOrderBaseRevenue(a)
        bValue = getOrderBaseRevenue(b)
      }

      // Convert to numbers if possible
      if (!isNaN(aValue) && !isNaN(bValue)) {
        aValue = parseFloat(aValue)
        bValue = parseFloat(bValue)
      }

      // Handle string comparison
      if (typeof aValue === 'string' && typeof bValue === 'string') {
        aValue = aValue.toLowerCase()
        bValue = bValue.toLowerCase()
      }

      if (aValue < bValue) {
        return sortConfig.direction === 'asc' ? -1 : 1
      }
      if (aValue > bValue) {
        return sortConfig.direction === 'asc' ? 1 : -1
      }
      return 0
    })
  }

  const getSortIcon = (key) => {
    if (sortConfig.key !== key) {
      return <span className="text-gray-400 text-sm">↕</span>
    }
    return (
      <span className={`text-sm font-bold ${sortConfig.direction === 'asc' ? 'text-green-600' : 'text-blue-600'}`}>
        {sortConfig.direction === 'asc' ? '↑' : '↓'}
      </span>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-gradient-to-r from-blue-600 to-cyan-600 shadow-lg border-b border-blue-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-20">
            <div className="flex items-center">
              <div className="h-12 w-12 bg-white rounded-xl flex items-center justify-center mr-4 shadow-lg">
                <Package className="h-7 w-7 text-blue-600" />
              </div>
              <h1 className="text-2xl font-bold text-white">
                Bevvi Order Tracking System
              </h1>
            </div>
            <div className="flex items-center space-x-4">
              <span className="text-sm text-white/90 font-medium">
                Welcome, Bevvi_User
              </span>
              <button
                onClick={onLogout}
                className="bg-white/20 hover:bg-white/30 text-white font-medium py-2 px-4 rounded-xl transition-all duration-200 flex items-center backdrop-blur-sm"
              >
                <LogOut className="h-4 w-4 mr-2" />
                Logout
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-gradient-to-br from-blue-50 to-cyan-50 rounded-3xl p-8 mb-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Welcome to Bevvi Order Management</h2>
          <p className="text-gray-600">Track, monitor, and manage your orders with real-time updates</p>
        </div>
        {/* Date Range and Filters */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-8">
          <div className="lg:col-span-2">
            <DateRangePicker
              dateRange={dateRange}
              onDateRangeChange={setDateRange}
              onFetchOrders={fetchOrders}
            />
          </div>
          <div>
            <StatusFilter
              statusFilter={statusFilter}
              onStatusFilterChange={setStatusFilter}
            />
          </div>
          <div>
            <DeliveryFilter
              deliveryFilter={deliveryFilter}
              onDeliveryFilterChange={setDeliveryFilter}
            />
          </div>
        </div>

        {/* Refresh Timing Information */}
        <div className="mb-4 p-4 bg-gradient-to-r from-blue-50 to-cyan-50 border border-blue-200 rounded-xl">
          <div className="flex items-center mb-3">
            <RefreshCw className="h-5 w-5 text-blue-600 mr-2" />
            <span className="text-sm font-medium text-blue-800">Refresh Status</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div>
              <span className="text-blue-700 font-medium">Last Refresh:</span>
              <div className="text-blue-600">
                {lastManualRefresh ? (
                  <>
                    <div>{lastManualRefresh.toLocaleString()}</div>
                    <div className="text-blue-500">
                      Range: {dateRange.startDate} to {dateRange.endDate}
                    </div>
                  </>
                ) : (
                  <span className="text-blue-500">No refresh yet</span>
                )}
              </div>
            </div>
            <div>
              <span className="text-blue-700 font-medium">Next Refresh:</span>
              <div className="text-blue-600">
                {lastManualRefresh ? (
                  <>
                    <div>
                      {new Date(lastManualRefresh.getTime() + 20 * 60 * 1000).toLocaleString()}
                    </div>
                    <div className="text-blue-500">(20 min interval)</div>
                  </>
                ) : (
                  <span className="text-blue-500">Not scheduled</span>
                )}
              </div>
            </div>
            <div>
              <span className="text-blue-700 font-medium">Current Status:</span>
              <div className="text-blue-600">
                <div className="text-green-600 font-medium">✅ Manual Refresh Active</div>
                <div className="text-blue-500">Click "Fetch Orders" to refresh</div>
              </div>
            </div>
          </div>
        </div>



        {/* Search */}
        <div className="mb-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search orders by ID, customer name, or status..."
              className="input-field pl-10"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>


        
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="bg-white rounded-2xl shadow-lg border border-blue-200 p-8">
            <div className="flex items-center">
              <div className="p-3 bg-blue-500 rounded-xl shadow-lg">
                <Package className="h-7 w-7 text-white" />
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-blue-700">Total Orders</p>
                <p className="text-3xl font-bold text-blue-900">{getTotalOrders()}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-lg border border-green-200 p-8">
            <div className="flex items-center">
              <div className="p-3 bg-green-500 rounded-xl shadow-lg">
                <CheckCircle className="h-7 w-7 text-white" />
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-green-700">Accepted</p>
                <p className="text-3xl font-bold text-green-900">{getStatusCount('accepted')}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-lg border border-blue-200 p-8">
            <div className="flex items-center">
              <div className="p-3 bg-blue-500 rounded-xl shadow-lg">
                <Clock className="h-7 w-7 text-white" />
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-blue-700">Pending</p>
                <p className="text-3xl font-bold text-blue-900">{getStatusCount('pending')}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-lg border border-emerald-200 p-8">
            <div className="flex items-center">
              <div className="p-3 bg-emerald-500 rounded-xl shadow-lg">
                <TrendingUp className="h-7 w-7 text-white" />
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-emerald-700">Revenue</p>
                <p className="text-3xl font-bold text-emerald-900">${getCalculatedBaseRevenue()}</p>
                <p className="text-xs text-emerald-600">Base revenue from accepted orders</p>
              </div>
            </div>
          </div>
        </div>

        {/* API Error Display */}
        {apiError && (
          <div className="bg-white rounded-2xl shadow-lg border border-red-200 p-8 mb-6">
            <div className="flex items-start">
              <div className="flex-shrink-0">
                <div className="p-2 bg-red-500 rounded-xl">
                  <svg className="h-6 w-6 text-white" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                </div>
              </div>
              <div className="ml-4">
                <h3 className="text-lg font-semibold text-red-800">
                  API Error: {apiError.message}
                </h3>
                <div className="mt-3 text-sm text-red-700 space-y-2">
                  <p><strong>Status:</strong> {apiError.status}</p>
                  <p><strong>Details:</strong> {apiError.note}</p>
                  <p><strong>Date Range:</strong> {dateRange.startDate} to {dateRange.endDate}</p>
                  <p><strong>API Called:</strong> 
                    <code className="bg-red-200 px-3 py-2 rounded-lg text-xs break-all font-mono block mt-2">
                      {apiError.apiUrl}
                    </code>
                  </p>
                </div>
                <div className="mt-6">
                  <button
                    onClick={fetchOrders}
                    className="bg-red-500 hover:bg-red-600 text-white font-medium px-6 py-3 rounded-xl transition-all duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
                  >
                    🔄 Retry with Current Dates
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Current Fetch Status */}
        {isLoading && (
          <div className="bg-white rounded-2xl shadow-lg border border-blue-200 p-8 mb-6">
            <div className="flex items-center">
              <div className="p-2 bg-blue-500 rounded-xl mr-4">
                <div className="animate-spin rounded-full h-6 w-6 border-2 border-white border-t-transparent"></div>
              </div>
              <div>
                <p className="text-lg font-semibold text-blue-800">
                  Fetching orders for {dateRange.startDate} to {dateRange.endDate}
                </p>
                <p className="text-sm text-blue-600">Calling Bevvi API...</p>
              </div>
            </div>
          </div>
        )}

        {/* Orders Table */}
        <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-8">
          <div className="flex justify-between items-center mb-8">
            <div>
              <h2 className="text-2xl font-bold text-gray-900">
                Orders ({filteredOrders.length})
              </h2>
              <p className="text-sm text-gray-600 mt-1">
                Click any column header to sort. Click again to reverse sort order.
              </p>
            </div>
            <div className="flex items-center space-x-4">
              {isLoading && (
                <div className="flex items-center text-sm text-blue-600">
                  <div className="animate-spin rounded-full h-4 w-4 border-2 border-blue-500 border-t-transparent mr-2"></div>
                  Loading...
                </div>
              )}
            </div>
          </div>

          {filteredOrders.length === 0 ? (
            <div className="text-center py-12">
              <Package className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              {apiError ? (
                <div>
                  <p className="text-red-600 font-medium mb-2">Unable to fetch orders</p>
                  <p className="text-gray-500">The Bevvi API is currently unavailable. Please try again later.</p>
                </div>
              ) : statusFilter.length === 0 ? (
                <div>
                  <p className="text-blue-600 font-medium mb-2">No Status Filters Selected</p>
                  <p className="text-gray-500">Please select at least one status filter to view orders.</p>
                </div>
              ) : (
                <p className="text-gray-500">No orders found matching your criteria.</p>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gradient-to-r from-blue-50 to-green-50">
                  <tr>
                    <th 
                      className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider cursor-pointer hover:bg-blue-100 transition-colors duration-200"
                      onClick={() => handleSort('id')}
                    >
                      <div className="flex items-center justify-between">
                        Order ID
                        <span className="ml-2 text-blue-600">{getSortIcon('id')}</span>
                      </div>
                    </th>
                    <th 
                      className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider cursor-pointer hover:bg-blue-100 transition-colors duration-200"
                      onClick={() => handleSort('customerName')}
                    >
                      <div className="flex items-center justify-between">
                        Customer
                        <span className="ml-2 text-blue-600">{getSortIcon('customerName')}</span>
                      </div>
                    </th>
                    <th 
                      className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider cursor-pointer hover:bg-blue-100 transition-colors duration-200"
                      onClick={() => handleSort('orderDate')}
                    >
                      <div className="flex items-center justify-between">
                        Order Date
                        <span className="ml-2 text-blue-600">{getSortIcon('orderDate')}</span>
                      </div>
                    </th>
                    <th 
                      className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider cursor-pointer hover:bg-blue-100 transition-colors duration-200"
                      onClick={() => handleSort('deliveryDate')}
                    >
                      <div className="flex items-center justify-between">
                        Delivery Date
                        <span className="ml-2 text-blue-600">{getSortIcon('deliveryDate')}</span>
                      </div>
                    </th>
                    <th 
                      className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider cursor-pointer hover:bg-blue-100 transition-colors duration-200"
                      onClick={() => handleSort('status')}
                    >
                      <div className="flex items-center justify-between">
                        Status
                        <span className="ml-2 text-blue-600">{getSortIcon('status')}</span>
                      </div>
                    </th>
                    <th 
                      className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider cursor-pointer hover:bg-blue-100 transition-colors duration-200"
                      onClick={() => handleSort('revenue')}
                    >
                      <div className="flex items-center justify-between">
                        Base Revenue
                        <span className="ml-2 text-blue-600">{getSortIcon('revenue')}</span>
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {getSortedOrders().map((order) => (
                    <tr
                      key={order.id}
                      onClick={() => handleOrderClick(order)}
                      className="hover:bg-blue-50 cursor-pointer transition-all duration-200 hover:shadow-sm"
                    >
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-blue-600">
                        {order.id}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {order.customerName}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {order.orderDate ? new Date(order.orderDate + 'T00:00:00').toLocaleDateString() : 'N/A'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {order.deliveryDate === 'N/A' ? 'N/A' : new Date(order.deliveryDate + 'T00:00:00').toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex items-center px-3 py-1.5 rounded-full text-xs font-semibold ${getStatusColor(order.status)}`}>
                          {getStatusIcon(order.status)}
                          <span className="ml-2 capitalize">{order.status.replace('_', ' ')}</span>
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-gray-900">
                        ${getOrderBaseRevenue(order).toFixed(2)} {/* CACHE-BUST: Base Revenue Display */}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Order Details Modal */}
      {showOrderModal && selectedOrder && (
        <OrderModal
          order={selectedOrder}
          isOpen={showOrderModal}
          onClose={() => setShowOrderModal(false)}
        />
      )}
    </div>
  )
}

export default Dashboard
