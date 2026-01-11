import React, { useState, useEffect, useMemo } from 'react'
import { Store, Calendar, RefreshCw, Download, ChevronUp, ChevronDown, FileSpreadsheet } from 'lucide-react'
import DateRangePicker from './DateRangePicker'
import { formatDollarAmount, formatNumber } from '../utils/formatCurrency'
import * as XLSX from 'xlsx'

const RetailerManagement = () => {
  const [orders, setOrders] = useState([])
  const [isLoading, setIsLoading] = useState(false)
  const [apiError, setApiError] = useState(null)
  const [dateRange, setDateRange] = useState(() => {
    const today = new Date()
    const todayString = today.getFullYear() + '-' + 
                       String(today.getMonth() + 1).padStart(2, '0') + '-' + 
                       String(today.getDate()).padStart(2, '0')
    return {
      startDate: todayString,
      endDate: todayString
    }
  })
  const [sortConfig, setSortConfig] = useState({
    key: 'gmv',
    direction: 'desc'
  })
  const [collapsedFilters, setCollapsedFilters] = useState({
    dateRange: false
  })

  // Fee calculation function based on Bevvi transaction fee rules (same as Dashboard)
  const calculateFeeRate = (retailer, customer) => {
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
    
    const feeRate = calculateFeeRate(retailer, customer)
    const retailerFee = Math.round(revenue * feeRate * 100) / 100
    const serviceFee = parseFloat(order.serviceCharge) || 0
    
    return { serviceFee, retailerFee }
  }

  // Filter orders by date range and exclude pending/cancelled/rejected
  const filteredOrders = useMemo(() => {
    return orders.filter(order => {
      // Filter by date range
      if (dateRange.startDate && dateRange.endDate) {
        const orderDate = order.orderDate
        if (!orderDate) return false
        
        // Handle date comparison (orderDate is YYYY-MM-DD string)
        if (orderDate < dateRange.startDate || orderDate > dateRange.endDate) {
          return false
        }
      }
      
      // Exclude pending, cancelled, rejected orders
      return !['pending', 'cancelled', 'canceled', 'rejected'].includes(order.status?.toLowerCase())
    })
  }, [orders, dateRange])

  // Group orders by retailer and calculate metrics
  const retailerData = useMemo(() => {
    const retailerMap = new Map()

    filteredOrders.forEach(order => {
      const retailerName = (order.establishment || 'Unknown Retailer').trim()
      
      if (!retailerMap.has(retailerName)) {
        retailerMap.set(retailerName, {
          retailerName,
          orders: [],
          gmv: 0,
          serviceFee: 0,
          retailerFee: 0,
          totalCharges: 0,
          orderCount: 0
        })
      }

      const retailer = retailerMap.get(retailerName)
      retailer.orders.push(order)
      
      const revenue = parseFloat(order.revenue) || 0
      const { serviceFee, retailerFee } = calculateOrderFees(order)
      
      retailer.gmv += revenue
      retailer.serviceFee += serviceFee
      retailer.retailerFee += retailerFee
      retailer.totalCharges += (serviceFee + retailerFee)
      retailer.orderCount += 1
    })

    // Convert map to array and round values
    return Array.from(retailerMap.values()).map(retailer => ({
      ...retailer,
      gmv: Math.round(retailer.gmv * 100) / 100,
      serviceFee: Math.round(retailer.serviceFee * 100) / 100,
      retailerFee: Math.round(retailer.retailerFee * 100) / 100,
      totalCharges: Math.round(retailer.totalCharges * 100) / 100
    }))
  }, [filteredOrders])

  // Sort retailer data
  const sortedRetailerData = useMemo(() => {
    return [...retailerData].sort((a, b) => {
      let aVal = a[sortConfig.key]
      let bVal = b[sortConfig.key]

      if (sortConfig.direction === 'asc') {
        return aVal > bVal ? 1 : -1
      } else {
        return aVal < bVal ? 1 : -1
      }
    })
  }, [retailerData, sortConfig])

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

  // Fetch orders function
  const fetchOrders = async () => {
    try {
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
      setOrders([])
      
      const timestamp = Date.now()
      const randomId = Math.random().toString(36).substring(7)
      const apiUrl = `/api/orders?startDate=${dateRange.startDate}&endDate=${dateRange.endDate}&t=${timestamp}&r=${randomId}`
      console.log(`📅 Fetching orders: ${dateRange.startDate} to ${dateRange.endDate}`)
      
      const response = await fetch(apiUrl)
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }
      
      const data = await response.json()
      console.log(`✅ Received ${data.data?.length || 0} orders`)
      
      if (data.data && Array.isArray(data.data)) {
        setOrders(data.data)
      } else {
        setOrders([])
      }
      
      setIsLoading(false)
    } catch (error) {
      console.error('❌ Error fetching orders:', error)
      setApiError({
        message: 'Network or system error',
        status: 'Network Error',
        details: error.message
      })
      setIsLoading(false)
    }
  }

  // Toggle filter collapse state
  const toggleFilter = (filterKey) => {
    setCollapsedFilters(prev => ({
      ...prev,
      [filterKey]: !prev[filterKey]
    }))
  }

  // Calculate totals
  const totals = useMemo(() => {
    return retailerData.reduce((acc, retailer) => ({
      gmv: acc.gmv + retailer.gmv,
      serviceFee: acc.serviceFee + retailer.serviceFee,
      retailerFee: acc.retailerFee + retailer.retailerFee,
      totalCharges: acc.totalCharges + retailer.totalCharges,
      orderCount: acc.orderCount + retailer.orderCount
    }), { gmv: 0, serviceFee: 0, retailerFee: 0, totalCharges: 0, orderCount: 0 })
  }, [retailerData])

  // Placeholder handler for Charge Fees button
  const handleChargeFees = (retailerName) => {
    // TODO: Implement charge fees functionality
    console.log('Charge Fees clicked for:', retailerName)
  }

  // Calculate optimal column width based on content
  const calculateColumnWidth = (sheet, columnIndex, minWidth = 10, maxWidth = 50) => {
    let maxLength = minWidth
    const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1')
    
    for (let row = 0; row <= range.e.r; row++) {
      const cellRef = XLSX.utils.encode_cell({ r: row, c: columnIndex })
      const cell = sheet[cellRef]
      if (cell) {
        let cellValue = ''
        if (cell.v !== null && cell.v !== undefined) {
          cellValue = String(cell.v)
        } else if (cell.w) {
          cellValue = cell.w
        }
        // Account for currency formatting (adds ~2 chars for $ and commas)
        if (cell.z && cell.z.includes('$')) {
          cellValue = cellValue + '$$'
        }
        maxLength = Math.max(maxLength, cellValue.length)
      }
    }
    
    // Add padding for better readability
    return Math.min(maxLength + 2, maxWidth)
  }

  // Sanitize sheet name for Excel
  const sanitizeSheetName = (name) => {
    if (!name) return 'Sheet1'
    let sanitized = name.trim()
    // Remove invalid characters
    const invalidChars = ['/', '\\', '?', '*', '[', ']', ':']
    invalidChars.forEach(char => {
      sanitized = sanitized.replace(new RegExp(`\\${char}`, 'g'), '-')
    })
    // Trim to 31 characters (Excel limit)
    sanitized = sanitized.substring(0, 31).trim()
    return sanitized || 'Sheet1'
  }

  // Determine fee rate based on retailer and customer
  const determineFeeRate = (retailer, customer) => {
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

  // Generate Excel report for a specific retailer
  const handleGenerateReport = (retailerName) => {
    try {
      // Filter orders for this specific retailer
      const retailerOrders = filteredOrders.filter(order => {
        const orderRetailer = (order.establishment || '').trim()
        return orderRetailer === retailerName
      })

      if (retailerOrders.length === 0) {
        alert(`No orders found for ${retailerName} in the selected date range.`)
        return
      }

      // Create workbook
      const wb = XLSX.utils.book_new()

      // Prepare transaction data for this retailer only
      const transactions = retailerOrders.map(order => {
        const subtotal = parseFloat(order.revenue) || 0
        const feeRate = determineFeeRate(order.establishment, order.customerName)
        const serviceFee = Math.round(subtotal * feeRate * 100) / 100
        const serviceFeeTax = Math.round(serviceFee * 0.0875 * 100) / 100
        const total = Math.round((subtotal + serviceFee + serviceFeeTax) * 100) / 100

        return {
          id: order.id || order.ordernum || `ORD-${Date.now()}`,
          date: order.orderDate || '',
          retailer: order.establishment || 'Unknown Retailer',
          customer: order.customerName || 'Unknown Customer',
          order_number: order.ordernum || order.id || 'N/A',
          subtotal: subtotal,
          serviceFee: serviceFee,
          serviceFeeTax: serviceFeeTax,
          total: total
        }
      })

      // Create Executive Summary sheet for this retailer only
      const summaryData = [['Retailer Name', 'Subtotal', 'Bevvi Marketing Fees', 'Total']]
      
      // Aggregate totals for this retailer
      const retailerSubtotal = transactions.reduce((sum, t) => sum + t.subtotal, 0)
      const retailerServiceFees = transactions.reduce((sum, t) => sum + t.serviceFee, 0)
      const retailerTotal = transactions.reduce((sum, t) => sum + t.total, 0)

      summaryData.push([
        retailerName,
        Math.round(retailerSubtotal * 100) / 100,
        Math.round(retailerServiceFees * 100) / 100,
        Math.round(retailerTotal * 100) / 100
      ])

      // GRAND TOTAL (same as retailer total since it's just one retailer)
      summaryData.push([
        'GRAND TOTAL',
        Math.round(retailerSubtotal * 100) / 100,
        Math.round(retailerServiceFees * 100) / 100,
        Math.round(retailerTotal * 100) / 100
      ])

      const summarySheet = XLSX.utils.aoa_to_sheet(summaryData)
      
      // Format header row
      summarySheet['A1'].s = { font: { bold: true }, alignment: { horizontal: 'left' } }
      summarySheet['B1'].s = { font: { bold: true }, alignment: { horizontal: 'right' } }
      summarySheet['C1'].s = { font: { bold: true }, alignment: { horizontal: 'right' } }
      summarySheet['D1'].s = { font: { bold: true }, alignment: { horizontal: 'right' } }
      
      // Format GRAND TOTAL row
      const totalRowIndex = summaryData.length
      summarySheet[`A${totalRowIndex}`].s = { font: { bold: true }, alignment: { horizontal: 'left' } }
      summarySheet[`B${totalRowIndex}`].s = { font: { bold: true }, alignment: { horizontal: 'right' } }
      summarySheet[`C${totalRowIndex}`].s = { font: { bold: true }, alignment: { horizontal: 'right' } }
      summarySheet[`D${totalRowIndex}`].s = { font: { bold: true }, alignment: { horizontal: 'right' } }

      // Set currency format for monetary columns
      const currencyFormat = '$#,##0.00'
      for (let row = 2; row <= totalRowIndex; row++) {
        summarySheet[`B${row}`].z = currencyFormat
        summarySheet[`C${row}`].z = currencyFormat
        summarySheet[`D${row}`].z = currencyFormat
      }

      // Calculate and set column widths based on content
      summarySheet['!cols'] = [
        { wch: calculateColumnWidth(summarySheet, 0, 15, 50) }, // Retailer Name
        { wch: calculateColumnWidth(summarySheet, 1, 12, 20) }, // Subtotal
        { wch: calculateColumnWidth(summarySheet, 2, 12, 25) }, // Bevvi Marketing Fees
        { wch: calculateColumnWidth(summarySheet, 3, 12, 20) }  // Total
      ]

      XLSX.utils.book_append_sheet(wb, summarySheet, 'Executive Summary')

      // Create retailer sheet for this specific retailer
      const retailerSheetData = []

        // Customer Summary Section
        retailerSheetData.push(['Customer Summary'])
        retailerSheetData.push(['Customer', 'Subtotal', 'Bevvi Marketing Fees', 'Total'])

        // Group by customer for this retailer
        const customerMap = new Map()
        transactions.forEach(txn => {
          const customer = txn.customer
          if (!customerMap.has(customer)) {
            customerMap.set(customer, { subtotal: 0, serviceFee: 0, total: 0 })
          }
          const customerData = customerMap.get(customer)
          customerData.subtotal += txn.subtotal
          customerData.serviceFee += txn.serviceFee
          customerData.total += txn.total
        })

        // Sort customers alphabetically
        const sortedCustomers = Array.from(customerMap.entries()).sort((a, b) => 
          a[0].localeCompare(b[0])
        )

        sortedCustomers.forEach(([customer, data]) => {
          retailerSheetData.push([
            customer,
            Math.round(data.subtotal * 100) / 100,
            Math.round(data.serviceFee * 100) / 100,
            Math.round(data.total * 100) / 100
          ])
        })

        // Customer Summary TOTAL
        const customerTotalSubtotal = sortedCustomers.reduce((sum, [, data]) => sum + data.subtotal, 0)
        const customerTotalServiceFee = sortedCustomers.reduce((sum, [, data]) => sum + data.serviceFee, 0)
        const customerTotalTotal = sortedCustomers.reduce((sum, [, data]) => sum + data.total, 0)
        retailerSheetData.push([
          'TOTAL',
          Math.round(customerTotalSubtotal * 100) / 100,
          Math.round(customerTotalServiceFee * 100) / 100,
          Math.round(customerTotalTotal * 100) / 100
        ])

        // Blank rows
        retailerSheetData.push([])
        retailerSheetData.push([])

        // Detailed Transactions Section
        retailerSheetData.push(['Detailed Transactions'])
        retailerSheetData.push(['Date', 'Customer', 'Order Number', 'Subtotal', 'Bevvi Marketing Fee', 'Service Fee Tax', 'Total'])

        // Sort transactions by date, then customer
        const sortedTransactions = [...transactions].sort((a, b) => {
          const dateCompare = (a.date || '').localeCompare(b.date || '')
          if (dateCompare !== 0) return dateCompare
          return (a.customer || '').localeCompare(b.customer || '')
        })

        sortedTransactions.forEach(txn => {
        // Format date as MM/DD/YYYY
        let formattedDate = txn.date
        if (txn.date && txn.date.match(/^\d{4}-\d{2}-\d{2}$/)) {
          const [year, month, day] = txn.date.split('-')
          formattedDate = `${month}/${day}/${year}`
        }

        retailerSheetData.push([
          formattedDate,
          txn.customer,
          txn.order_number,
          txn.subtotal,
          txn.serviceFee,
          txn.serviceFeeTax,
          txn.total
        ])
        })

        const retailerSheet = XLSX.utils.aoa_to_sheet(retailerSheetData)

        // Format section headers (Customer Summary and Detailed Transactions)
        const customerSummaryRow = 1
        const detailedTransactionsRow = retailerSheetData.findIndex(row => 
          row[0] === 'Detailed Transactions'
        ) + 1

        retailerSheet[`A${customerSummaryRow}`].s = { font: { bold: true, sz: 12 } }
        retailerSheet[`A${detailedTransactionsRow}`].s = { font: { bold: true, sz: 12 } }

        // Format column headers
        const customerSummaryHeaders = 2
        const detailedTransactionsHeaders = detailedTransactionsRow + 1

        for (let col = 0; col < 4; col++) {
          const cellRef = XLSX.utils.encode_cell({ r: customerSummaryHeaders - 1, c: col })
          if (retailerSheet[cellRef]) {
            retailerSheet[cellRef].s = { font: { bold: true } }
          }
        }

        for (let col = 0; col < 7; col++) {
          const cellRef = XLSX.utils.encode_cell({ r: detailedTransactionsHeaders - 1, c: col })
          if (retailerSheet[cellRef]) {
            retailerSheet[cellRef].s = { font: { bold: true } }
          }
        }

        // Format TOTAL row in Customer Summary
        const customerTotalRow = customerSummaryHeaders + sortedCustomers.length + 1
        for (let col = 0; col < 4; col++) {
          const cellRef = XLSX.utils.encode_cell({ r: customerTotalRow - 1, c: col })
          if (retailerSheet[cellRef]) {
            retailerSheet[cellRef].s = { font: { bold: true } }
          }
        }

        // Set currency format for monetary columns
        const customerSummaryStartRow = customerSummaryHeaders + 1
        const customerSummaryEndRow = customerTotalRow
        for (let row = customerSummaryStartRow; row <= customerSummaryEndRow; row++) {
          for (let col = 1; col <= 3; col++) {
            const cellRef = XLSX.utils.encode_cell({ r: row - 1, c: col })
            if (retailerSheet[cellRef]) {
              retailerSheet[cellRef].z = currencyFormat
            }
          }
        }

        const detailedTransactionsStartRow = detailedTransactionsHeaders + 1
        const detailedTransactionsEndRow = detailedTransactionsStartRow + sortedTransactions.length - 1
        for (let row = detailedTransactionsStartRow; row <= detailedTransactionsEndRow; row++) {
          for (let col = 3; col <= 6; col++) {
            const cellRef = XLSX.utils.encode_cell({ r: row - 1, c: col })
            if (retailerSheet[cellRef]) {
              retailerSheet[cellRef].z = currencyFormat
            }
          }
        }

        // Calculate and set column widths based on content
        retailerSheet['!cols'] = [
          { wch: calculateColumnWidth(retailerSheet, 0, 10, 15) }, // Date
          { wch: calculateColumnWidth(retailerSheet, 1, 15, 40) }, // Customer
          { wch: calculateColumnWidth(retailerSheet, 2, 12, 20) }, // Order Number
          { wch: calculateColumnWidth(retailerSheet, 3, 12, 20) }, // Subtotal
          { wch: calculateColumnWidth(retailerSheet, 4, 12, 25) }, // Bevvi Marketing Fee
          { wch: calculateColumnWidth(retailerSheet, 5, 12, 20) }, // Service Fee Tax
          { wch: calculateColumnWidth(retailerSheet, 6, 12, 20) }  // Total
        ]

      XLSX.utils.book_append_sheet(wb, retailerSheet, sanitizeSheetName(retailerName))

      // Generate filename
      const filename = `bevvi_report_${dateRange.startDate}_to_${dateRange.endDate}_${sanitizeSheetName(retailerName)}.xlsx`

      // Write file
      XLSX.writeFile(wb, filename)

      console.log(`✅ Report generated: ${filename}`)
    } catch (error) {
      console.error('Error generating report:', error)
      alert(`Error generating report: ${error.message}`)
    }
  }

  // CSV download handler
  const handleDownloadCSV = () => {
    const headers = ['Retailer', 'GMV', 'Service Fee', 'Retailer Fee', 'Total Charges', 'Order Count']
    const rows = sortedRetailerData.map(retailer => [
      retailer.retailerName,
      retailer.gmv.toFixed(2),
      retailer.serviceFee.toFixed(2),
      retailer.retailerFee.toFixed(2),
      retailer.totalCharges.toFixed(2),
      retailer.orderCount.toString()
    ])
    
    // Add totals row
    rows.push([
      'TOTAL',
      totals.gmv.toFixed(2),
      totals.serviceFee.toFixed(2),
      totals.retailerFee.toFixed(2),
      totals.totalCharges.toFixed(2),
      totals.orderCount.toString()
    ])
    
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n')
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    const url = URL.createObjectURL(blob)
    link.setAttribute('href', url)
    link.setAttribute('download', `retailer-report-${dateRange.startDate}-to-${dateRange.endDate}.csv`)
    link.style.visibility = 'hidden'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  // Auto-fetch on date range change
  useEffect(() => {
    // Only fetch if both dates are set
    if (!dateRange.startDate || !dateRange.endDate) {
      return
    }
    
    const debounceTimer = setTimeout(() => {
      fetchOrders()
    }, 500)
    
    return () => clearTimeout(debounceTimer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateRange.startDate, dateRange.endDate])

  return (
    <div className="bg-gray-50 pb-20 sm:pb-16">
      <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-8 py-4 sm:py-6 lg:py-8">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Retailer Management</h1>
          <p className="text-gray-600">View GMV and charges by retailer for selected date range</p>
        </div>

        {/* Date Range Filter */}
        <div className={`bg-white rounded-lg shadow transition-all duration-300 mb-6 ${collapsedFilters.dateRange ? 'p-3 sm:p-4' : 'p-4 sm:p-6'}`}>
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

        {/* Loading Overlay */}
        {isLoading && (
          <div className="fixed inset-0 bg-gradient-to-br from-blue-900 to-blue-800 bg-opacity-95 flex items-center justify-center z-50 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-2xl p-12 max-w-lg mx-4 border-4 border-blue-500">
              <div className="flex flex-col items-center">
                <div className="relative mb-6">
                  <div className="animate-spin rounded-full h-24 w-24 border-8 border-gray-200"></div>
                  <div className="animate-spin rounded-full h-24 w-24 border-8 border-blue-600 border-t-transparent absolute top-0"></div>
                </div>
                <h3 className="text-2xl font-bold text-gray-900 mb-3 animate-pulse">
                  🔄 Fetching Orders...
                </h3>
                <p className="text-gray-600 text-center text-lg">
                  Please wait while we retrieve your data
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Error Display */}
        {apiError && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
            <h3 className="text-lg font-medium text-red-800 mb-2">API Error: {apiError.message}</h3>
            <p className="text-red-700">Status: {apiError.status}</p>
            <p className="text-red-700">Details: {apiError.details}</p>
          </div>
        )}

        {/* Summary Cards */}
        {!isLoading && retailerData.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 mb-6">
            <div className="bg-white rounded-lg shadow p-4 sm:p-6">
              <div className="flex items-center mb-2">
                <Store className="h-5 w-5 text-blue-600 mr-2" />
                <p className="text-xs sm:text-sm font-medium text-gray-600">Total Retailers</p>
              </div>
              <p className="text-xl sm:text-2xl font-bold text-gray-900">{formatNumber(retailerData.length)}</p>
            </div>
            <div className="bg-white rounded-lg shadow p-4 sm:p-6">
              <p className="text-xs sm:text-sm font-medium text-gray-600 mb-2">Total GMV</p>
              <p className="text-xl sm:text-2xl font-bold text-gray-900">{formatDollarAmount(totals.gmv)}</p>
            </div>
            <div className="bg-white rounded-lg shadow p-4 sm:p-6">
              <p className="text-xs sm:text-sm font-medium text-gray-600 mb-2">Total Charges</p>
              <p className="text-xl sm:text-2xl font-bold text-gray-900">{formatDollarAmount(totals.totalCharges)}</p>
            </div>
            <div className="bg-white rounded-lg shadow p-4 sm:p-6">
              <p className="text-xs sm:text-sm font-medium text-gray-600 mb-2">Total Orders</p>
              <p className="text-xl sm:text-2xl font-bold text-gray-900">{formatNumber(totals.orderCount)}</p>
            </div>
          </div>
        )}

        {/* Retailer Table */}
        {!isLoading && (
          <div className="bg-white rounded-lg shadow">
            <div className="p-4 sm:p-6 border-b border-gray-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <h2 className="text-lg sm:text-xl font-semibold text-gray-900">
                Retailer Breakdown
              </h2>
              {sortedRetailerData.length > 0 && (
                <button
                  onClick={handleDownloadCSV}
                  className="flex items-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm"
                >
                  <Download className="h-4 w-4 mr-2" />
                  Download CSV
                </button>
              )}
            </div>

            {sortedRetailerData.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full table-auto divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th 
                        className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                        onClick={() => handleSort('retailerName')}
                      >
                        <div className="flex items-center space-x-1">
                          <span>Retailer</span>
                          {getSortIcon('retailerName')}
                        </div>
                      </th>
                      <th 
                        className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                        onClick={() => handleSort('gmv')}
                      >
                        <div className="flex items-center space-x-1">
                          <span>GMV</span>
                          {getSortIcon('gmv')}
                        </div>
                      </th>
                      <th 
                        className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                        onClick={() => handleSort('serviceFee')}
                      >
                        <div className="flex items-center space-x-1">
                          <span>Service Fee</span>
                          {getSortIcon('serviceFee')}
                        </div>
                      </th>
                      <th 
                        className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                        onClick={() => handleSort('retailerFee')}
                      >
                        <div className="flex items-center space-x-1">
                          <span>Retailer Fee</span>
                          {getSortIcon('retailerFee')}
                        </div>
                      </th>
                      <th 
                        className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                        onClick={() => handleSort('totalCharges')}
                      >
                        <div className="flex items-center space-x-1">
                          <span>Total Charges</span>
                          {getSortIcon('totalCharges')}
                        </div>
                      </th>
                      <th 
                        className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                        onClick={() => handleSort('orderCount')}
                      >
                        <div className="flex items-center space-x-1">
                          <span>Orders</span>
                          {getSortIcon('orderCount')}
                        </div>
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {sortedRetailerData.map((retailer, index) => (
                      <tr key={index} className="hover:bg-gray-50">
                        <td className="px-4 py-4 text-sm font-medium text-gray-900">
                          {retailer.retailerName}
                        </td>
                        <td className="px-4 py-4 text-sm text-gray-900">
                          {formatDollarAmount(retailer.gmv)}
                        </td>
                        <td className="px-4 py-4 text-sm text-gray-900">
                          {formatDollarAmount(retailer.serviceFee)}
                        </td>
                        <td className="px-4 py-4 text-sm text-gray-900">
                          {formatDollarAmount(retailer.retailerFee)}
                        </td>
                        <td className="px-4 py-4 text-sm text-gray-900 font-medium">
                          {formatDollarAmount(retailer.totalCharges)}
                        </td>
                        <td className="px-4 py-4 text-sm text-gray-900">
                          {formatNumber(retailer.orderCount)}
                        </td>
                        <td className="px-4 py-4 text-sm">
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleChargeFees(retailer.retailerName)}
                              className="px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-md hover:bg-blue-700 transition-colors"
                            >
                              Charge Fees
                            </button>
                            <button
                              onClick={() => handleGenerateReport(retailer.retailerName)}
                              className="px-3 py-1.5 bg-green-600 text-white text-xs font-medium rounded-md hover:bg-green-700 transition-colors flex items-center"
                            >
                              <FileSpreadsheet className="h-3 w-3 mr-1" />
                              Generate Report
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {/* Totals Row */}
                    <tr className="bg-gray-50 font-semibold">
                      <td className="px-4 py-4 text-sm text-gray-900">TOTAL</td>
                      <td className="px-4 py-4 text-sm text-gray-900">{formatDollarAmount(totals.gmv)}</td>
                      <td className="px-4 py-4 text-sm text-gray-900">{formatDollarAmount(totals.serviceFee)}</td>
                      <td className="px-4 py-4 text-sm text-gray-900">{formatDollarAmount(totals.retailerFee)}</td>
                      <td className="px-4 py-4 text-sm text-gray-900">{formatDollarAmount(totals.totalCharges)}</td>
                      <td className="px-4 py-4 text-sm text-gray-900">{formatNumber(totals.orderCount)}</td>
                      <td className="px-4 py-4 text-sm text-gray-900"></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-8 text-center">
                <Store className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-500">
                  {orders.length === 0 
                    ? 'No orders found for the selected date range. Please select a date range and fetch orders.'
                    : 'No retailers found with accepted orders for the selected date range.'}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Refresh Button */}
        {!isLoading && (
          <div className="mt-6">
            <button
              onClick={fetchOrders}
              disabled={isLoading}
              className="w-full sm:w-auto px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? 'Refreshing...' : 'Refresh Data'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default RetailerManagement
