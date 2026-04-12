import React, { useState, useEffect, useMemo } from 'react'
import { Store, Calendar, RefreshCw, Download, ChevronUp, ChevronDown, FileSpreadsheet } from 'lucide-react'
import DateRangePicker from './DateRangePicker'
import { formatDollarAmount, formatNumber } from '../utils/formatCurrency'
import { normalizeEstablishmentForFees, FLAT_RETAILER_FEES_USD } from '../utils/feeMatching'
import * as XLSX from 'xlsx-js-style'

// xlsx community build drops fills; xlsx-js-style preserves them for .xlsx export
const EXCEL_HEADER_STYLE = {
  fill: { patternType: 'solid', fgColor: { rgb: 'FF1F4E79' } },
  font: { bold: true, color: { rgb: 'FFFFFFFF' }, sz: 11 },
  alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
  border: {
    top: { style: 'thin', color: { rgb: 'FF1F4E79' } },
    bottom: { style: 'thin', color: { rgb: 'FF1F4E79' } },
    left: { style: 'thin', color: { rgb: 'FF1F4E79' } },
    right: { style: 'thin', color: { rgb: 'FF1F4E79' } }
  }
}

const EXCEL_TOTAL_ROW_STYLE = {
  fill: { patternType: 'solid', fgColor: { rgb: 'FFFFFFCC' } },
  font: { bold: true, sz: 11 },
  alignment: { vertical: 'center' }
}

const EXCEL_SECTION_TITLE_STYLE = {
  font: { bold: true, sz: 12 },
  alignment: { horizontal: 'left', vertical: 'center' }
}

function applyRowStyle(sheet, row0Based, colCount, style) {
  for (let c = 0; c < colCount; c++) {
    const ref = XLSX.utils.encode_cell({ r: row0Based, c })
    if (!sheet[ref]) continue
    const cell = sheet[ref]
    cell.s = { ...style }
  }
}

function mergeCellStyle(sheet, ref, patch) {
  if (!sheet[ref]) return
  sheet[ref].s = { ...(sheet[ref].s || {}), ...patch }
}

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
    const normalizedRetailer = (retailer || '').trim().toLowerCase()
    
    // Priority 1: VistaJet Customer Rule (8%)
    if (normalizedCustomer === 'vistajet') {
      return 0.08
    }
    
    // Priority 2: Total Wine Manual (0%)
    if (normalizedRetailer === 'total wine manual') {
      return 0
    }
    
    // Priority 3: 10% Retailer List Rule
    const tenPercentRetailers = [
      'wine & spirits market',
      'freshco',
      'national liquor and package',
      'mavy clippership wine & spirits',
      'liquor master',
      "sam's liquor & market",
      'dallas fine wine',
      'super duper liquor',
      'fountain liquor & spirits',
      'aficionados',
      'wine & spirits discount warehouse',
      'youbooze',
      'garfields beverage',
      'royal wines & spirits'
    ]
    if (tenPercentRetailers.includes(normalizedRetailer)) {
      return 0.10
    }

    // Priority 3b: All stores starting with GoPuff (15%)
    if (normalizedRetailer.startsWith('gopuff')) {
      return 0.15
    }
    
    // Priority 4: 15% retailer list (Ashburn Wine Shop + GoPuff-style locations)
    const fifteenPercentRetailers = [
      'ashburn wine shop',
      'rezerve wine & spirits',
      'san_point-loma_446',
      'sea_southcenter_596',
      'pit_pittsburgh_294',
      'mia_miami_183'
    ]
    if (fifteenPercentRetailers.includes(normalizedRetailer)) {
      return 0.15
    }
    
    // Priority 5: Sendoso Customer Rule (12%)
    if (normalizedCustomer === 'sendoso') {
      return 0.12
    }
    
    // Priority 6: In Good Taste Wines Rule (25%)
    if (normalizedRetailer === 'in good taste wines') {
      return 0.25
    }
    
    // Priority 7: Default Rule (20%)
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

    const normalizedCustomer = customer.toLowerCase()
    const establishmentKey = normalizeEstablishmentForFees(retailer)
    const serviceFee = parseFloat(order.serviceCharge) || 0
    if (normalizedCustomer !== 'vistajet' && FLAT_RETAILER_FEES_USD[establishmentKey] != null) {
      return { serviceFee, retailerFee: FLAT_RETAILER_FEES_USD[establishmentKey] }
    }
    
    const feeRate = calculateFeeRate(retailer, customer)
    const retailerFee = Math.round(revenue * feeRate * 100) / 100
    
    return { serviceFee, retailerFee }
  }

  /** Human-readable retailer-fee rule per order (must stay aligned with calculateOrderFees). */
  const getOrderRetailerFeeLabel = (order) => {
    const retailer = (order.establishment || '').trim()
    const customer = (order.customerName || '').trim()
    const normC = customer.toLowerCase()
    const estKey = normalizeEstablishmentForFees(retailer)
    if (normC === 'vistajet') return '8%'
    if (normC !== 'vistajet' && FLAT_RETAILER_FEES_USD[estKey] != null) {
      return `$${FLAT_RETAILER_FEES_USD[estKey]} / order`
    }
    const rate = calculateFeeRate(retailer, customer)
    return `${Math.round(rate * 100)}%`
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
    return Array.from(retailerMap.values()).map(retailer => {
      const labelSet = new Set()
      retailer.orders.forEach(order => labelSet.add(getOrderRetailerFeeLabel(order)))
      const feeRuleSummary = [...labelSet].sort().join(', ') || '—'
      return {
        ...retailer,
        feeRuleSummary,
        gmv: Math.round(retailer.gmv * 100) / 100,
        serviceFee: Math.round(retailer.serviceFee * 100) / 100,
        retailerFee: Math.round(retailer.retailerFee * 100) / 100,
        totalCharges: Math.round(retailer.totalCharges * 100) / 100
      }
    })
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
      ? <ChevronUp className="h-4 w-4 text-bevvi-primary-600" />
      : <ChevronDown className="h-4 w-4 text-bevvi-primary-600" />
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
      const clientTz = encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)
      const apiUrl = `/api/orders?startDate=${dateRange.startDate}&endDate=${dateRange.endDate}&timeZone=${clientTz}&t=${timestamp}&r=${randomId}`
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
    const retailerTrim = (retailer || '').trim()
    const retailerLower = retailerTrim.toLowerCase()
    
    // Priority 1: VistaJet Customer Rule (8%)
    if (normalizedCustomer === 'vistajet') {
      return 0.08
    }
    
    // Priority 2: Total Wine Manual (0%)
    if (retailerLower === 'total wine manual') {
      return 0
    }
    
    // Priority 3: 10% Retailer List Rule
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
      'ROYAL WINES & SPIRITS'
    ]
    if (tenPercentRetailers.includes(retailerTrim)) {
      return 0.10
    }

    // Priority 3b: All stores starting with GoPuff (15%)
    if (retailerLower.startsWith('gopuff')) {
      return 0.15
    }
    
    // Priority 4: 15% retailer list (Ashburn Wine Shop + GoPuff-style locations)
    const fifteenPercentRetailers = [
      'ashburn wine shop',
      'rezerve wine & spirits',
      'san_point-loma_446',
      'sea_southcenter_596',
      'pit_pittsburgh_294',
      'mia_miami_183'
    ]
    if (fifteenPercentRetailers.includes(retailerLower)) {
      return 0.15
    }
    
    // Priority 5: Sendoso Customer Rule (12%)
    if (normalizedCustomer === 'sendoso') {
      return 0.12
    }
    
    // Priority 6: In Good Taste Wines Rule (25%)
    if (retailerTrim === 'In Good Taste Wines') {
      return 0.25
    }
    
    // Priority 7: Default Rule (20%)
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

      const formatReportDate = (iso) => {
        if (!iso) return ''
        const s = String(iso).trim()
        if (s.match(/^\d{4}-\d{2}-\d{2}$/)) {
          const [y, m, d] = s.split('-')
          return `${parseInt(m, 10)}/${parseInt(d, 10)}/${y}`
        }
        return s
      }
      const reportDateRange = `${formatReportDate(dateRange.startDate)} to ${formatReportDate(dateRange.endDate)}`

      // Prepare transaction data for this retailer only
      const transactions = retailerOrders.map(order => {
        const subtotal = parseFloat(order.revenue) || 0
        const normCustomer = (order.customerName || '').trim().toLowerCase()
        const establishmentKey = normalizeEstablishmentForFees(order.establishment)
        const feeRate = determineFeeRate(order.establishment, order.customerName)
        let bevviFees = 0
        if (subtotal > 0) {
          if (normCustomer !== 'vistajet' && FLAT_RETAILER_FEES_USD[establishmentKey] != null) {
            bevviFees = FLAT_RETAILER_FEES_USD[establishmentKey]
          } else {
            bevviFees = Math.round(subtotal * feeRate * 100) / 100
          }
        }
        const tax = parseFloat(order.tax) || 0
        const tip = parseFloat(order.tip) || 0
        const shippingFee = parseFloat(order.shippingFee) || 0
        const deliveryFee = parseFloat(order.deliveryFee) || 0
        const platformServiceFee = parseFloat(order.serviceCharge) || 0
        const serviceChargeTax = parseFloat(order.serviceChargeTax) || 0
        let totalAmount = parseFloat(order.totalAmount) || 0
        if (!totalAmount && subtotal > 0) {
          totalAmount = Math.round((subtotal + tax + tip + shippingFee + deliveryFee + platformServiceFee + serviceChargeTax) * 100) / 100
        }
        const feeRatePct = subtotal > 0 ? Math.round((bevviFees / subtotal) * 1000) / 10 : 0

        return {
          id: order.id || order.ordernum || `ORD-${Date.now()}`,
          date: order.orderDate || '',
          retailer: order.establishment || 'Unknown Retailer',
          customer: order.customerName || 'Unknown Customer',
          order_number: order.ordernum || order.id || 'N/A',
          subtotal,
          bevviFees,
          feeRatePct,
          tax,
          tip,
          shippingFee,
          deliveryFee,
          platformServiceFee,
          serviceChargeTax,
          totalAmount,
          paymentId:
            order.stripePaymentId ||
            order.stripepaymentid ||
            order.paymentId ||
            ''
        }
      })

      // Create Executive Summary sheet for this retailer only
      const summaryData = [['Retailer Name', 'Subtotal', 'Bevvi Marketing Fees', 'Total']]
      
      // Aggregate totals for this retailer
      const retailerSubtotal = transactions.reduce((sum, t) => sum + t.subtotal, 0)
      const retailerServiceFees = transactions.reduce((sum, t) => sum + t.bevviFees, 0)
      const retailerTotal = transactions.reduce((sum, t) => sum + (t.totalAmount || 0), 0)

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

      const currencyFormat = '$#,##0.00'
      applyRowStyle(summarySheet, 0, 4, EXCEL_HEADER_STYLE)
      const totalRowIndex0 = summaryData.length - 1
      applyRowStyle(summarySheet, totalRowIndex0, 4, EXCEL_TOTAL_ROW_STYLE)

      for (let row0 = 1; row0 <= totalRowIndex0; row0++) {
        for (let c = 1; c <= 3; c++) {
          const ref = XLSX.utils.encode_cell({ r: row0, c })
          if (summarySheet[ref]) {
            mergeCellStyle(summarySheet, ref, {
              numFmt: currencyFormat,
              alignment: { horizontal: 'right', vertical: 'center' }
            })
          }
        }
      }

      // Calculate and set column widths based on content
      summarySheet['!cols'] = [
        { wch: calculateColumnWidth(summarySheet, 0, 15, 50) }, // Retailer Name
        { wch: calculateColumnWidth(summarySheet, 1, 12, 20) }, // Subtotal
        { wch: calculateColumnWidth(summarySheet, 2, 12, 25) }, // Bevvi Marketing Fees
        { wch: calculateColumnWidth(summarySheet, 3, 12, 20) }  // Total
      ]

      XLSX.utils.book_append_sheet(wb, summarySheet, 'Executive Summary')

      // Create retailer sheet: title + customer summary + detailed transactions (Google Sheets style)
      const retailerSheetData = []

      retailerSheetData.push([`--- ${retailerName} - Customer Summary ---`])
      retailerSheetData.push([])

      const customerSummaryHeader = [
        'Customer',
        'Transactions',
        'Revenue',
        'Bevvi Fees',
        'Fee Rate %',
        'Avg Transaction',
        'Total Tip',
        'Total Delivery Fee',
        'Date Range'
      ]
      retailerSheetData.push(customerSummaryHeader)

      const customerMap = new Map()
      transactions.forEach(txn => {
        const customer = txn.customer
        if (!customerMap.has(customer)) {
          customerMap.set(customer, {
            subtotal: 0,
            bevviFees: 0,
            count: 0,
            totalTip: 0,
            totalDeliveryFee: 0
          })
        }
        const d = customerMap.get(customer)
        d.subtotal += txn.subtotal
        d.bevviFees += txn.bevviFees
        d.count += 1
        d.totalTip += txn.tip
        d.totalDeliveryFee += txn.deliveryFee
      })

      const sortedCustomers = Array.from(customerMap.entries()).sort((a, b) =>
        a[0].localeCompare(b[0])
      )

      sortedCustomers.forEach(([customer, data]) => {
        const rev = Math.round(data.subtotal * 100) / 100
        const fees = Math.round(data.bevviFees * 100) / 100
        const feeRatePct =
          rev > 0 ? `${Math.round((fees / rev) * 1000) / 10}%` : '0%'
        const avgTxn = data.count > 0 ? Math.round((data.subtotal / data.count) * 100) / 100 : 0
        retailerSheetData.push([
          customer,
          data.count,
          rev,
          fees,
          feeRatePct,
          avgTxn,
          Math.round(data.totalTip * 100) / 100,
          Math.round(data.totalDeliveryFee * 100) / 100,
          reportDateRange
        ])
      })

      const customerTotalSubtotal = sortedCustomers.reduce((sum, [, data]) => sum + data.subtotal, 0)
      const customerTotalFees = sortedCustomers.reduce((sum, [, data]) => sum + data.bevviFees, 0)
      const customerTotalCount = sortedCustomers.reduce((sum, [, data]) => sum + data.count, 0)
      const customerTotalTip = sortedCustomers.reduce((sum, [, data]) => sum + data.totalTip, 0)
      const customerTotalDelivery = sortedCustomers.reduce(
        (sum, [, data]) => sum + data.totalDeliveryFee,
        0
      )
      const grandRev = Math.round(customerTotalSubtotal * 100) / 100
      const grandFees = Math.round(customerTotalFees * 100) / 100
      const grandFeeRatePct =
        grandRev > 0 ? `${Math.round((grandFees / grandRev) * 1000) / 10}%` : '0%'
      const grandAvg =
        customerTotalCount > 0
          ? Math.round((customerTotalSubtotal / customerTotalCount) * 100) / 100
          : 0

      retailerSheetData.push([
        'TOTAL',
        customerTotalCount,
        grandRev,
        grandFees,
        grandFeeRatePct,
        grandAvg,
        Math.round(customerTotalTip * 100) / 100,
        Math.round(customerTotalDelivery * 100) / 100,
        reportDateRange
      ])

      retailerSheetData.push([])
      retailerSheetData.push([])
      retailerSheetData.push(['--- Detailed Transactions ---'])
      const detailHeader = [
        'Order Number',
        'Date',
        'Customer',
        'Revenue',
        'Bevvi Fees',
        'Fee Rate %',
        'Tax',
        'Tip',
        'Shipping Fee',
        'Delivery Fee',
        'Service Fee',
        'Service Fee Tax',
        'Total Amount',
        'Payment ID'
      ]
      retailerSheetData.push(detailHeader)

      const sortedTransactions = [...transactions].sort((a, b) => {
        const dateCompare = (a.date || '').localeCompare(b.date || '')
        if (dateCompare !== 0) return dateCompare
        return (a.customer || '').localeCompare(b.customer || '')
      })

      sortedTransactions.forEach(txn => {
        const formattedDate = formatReportDate(txn.date)
        const feePctStr =
          txn.subtotal > 0 ? `${txn.feeRatePct}%` : '0%'
        retailerSheetData.push([
          txn.order_number,
          formattedDate,
          txn.customer,
          txn.subtotal,
          txn.bevviFees,
          feePctStr,
          txn.tax,
          txn.tip,
          txn.shippingFee,
          txn.deliveryFee,
          txn.platformServiceFee,
          txn.serviceChargeTax,
          txn.totalAmount,
          txn.paymentId
        ])
      })

      const retailerSheet = XLSX.utils.aoa_to_sheet(retailerSheetData)

      mergeCellStyle(retailerSheet, 'A1', EXCEL_SECTION_TITLE_STYLE)

      const customerHeaderIdx =
        retailerSheetData.findIndex(
          (row) => row[0] === 'Customer' && row[1] === 'Transactions'
        ) + 1
      const totalRowIdx =
        customerHeaderIdx + sortedCustomers.length + 1
      const detailedTitleRow =
        retailerSheetData.findIndex((row) => row[0] === '--- Detailed Transactions ---') + 1
      const detailHeaderIdx = detailedTitleRow + 1

      applyRowStyle(retailerSheet, customerHeaderIdx - 1, 9, EXCEL_HEADER_STYLE)
      applyRowStyle(retailerSheet, totalRowIdx - 1, 9, EXCEL_TOTAL_ROW_STYLE)

      mergeCellStyle(
        retailerSheet,
        XLSX.utils.encode_cell({ r: detailedTitleRow - 1, c: 0 }),
        EXCEL_SECTION_TITLE_STYLE
      )

      applyRowStyle(retailerSheet, detailHeaderIdx - 1, 14, EXCEL_HEADER_STYLE)

      for (let row = customerHeaderIdx + 1; row <= totalRowIdx; row++) {
        ;[2, 3, 5, 6, 7].forEach((c) => {
          const cellRef = XLSX.utils.encode_cell({ r: row - 1, c })
          if (retailerSheet[cellRef]) {
            mergeCellStyle(retailerSheet, cellRef, {
              numFmt: currencyFormat,
              alignment: { horizontal: 'right', vertical: 'center' }
            })
          }
        })
      }

      const detailFirstRow = detailHeaderIdx + 1
      const detailLastRow = detailFirstRow + sortedTransactions.length - 1
      const detailMoneyCols = [3, 4, 6, 7, 8, 9, 10, 11, 12]
      for (let row = detailFirstRow; row <= detailLastRow; row++) {
        detailMoneyCols.forEach((c) => {
          const cellRef = XLSX.utils.encode_cell({ r: row - 1, c })
          if (retailerSheet[cellRef]) {
            mergeCellStyle(retailerSheet, cellRef, {
              numFmt: currencyFormat,
              alignment: { horizontal: 'right', vertical: 'center' }
            })
          }
        })
      }

      retailerSheet['!cols'] = Array.from({ length: 14 }, (_, c) => ({
        wch: calculateColumnWidth(retailerSheet, c, 12, 40)
      }))

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
    const headers = ['Retailer', 'Retailer Fee Rate', 'GMV', 'Service Fee', 'Retailer Fee', 'Total Charges', 'Order Count']
    const rows = sortedRetailerData.map(retailer => [
      retailer.retailerName,
      retailer.feeRuleSummary,
      retailer.gmv.toFixed(2),
      retailer.serviceFee.toFixed(2),
      retailer.retailerFee.toFixed(2),
      retailer.totalCharges.toFixed(2),
      retailer.orderCount.toString()
    ])
    
    // Add totals row
    rows.push([
      'TOTAL',
      '',
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
              <Calendar className="h-4 w-4 sm:h-5 sm:w-5 text-bevvi-primary-600 mr-1.5 sm:mr-2" />
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
          <div className="fixed inset-0 bg-gradient-to-br from-bevvi-primary-900 to-bevvi-primary-800 bg-opacity-95 flex items-center justify-center z-50 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-2xl p-12 max-w-lg mx-4 border-4 border-bevvi-primary-500">
              <div className="flex flex-col items-center">
                <div className="relative mb-6">
                  <div className="animate-spin rounded-full h-24 w-24 border-8 border-gray-200"></div>
                  <div className="animate-spin rounded-full h-24 w-24 border-8 border-bevvi-primary-600 border-t-transparent absolute top-0"></div>
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
                <Store className="h-5 w-5 text-bevvi-primary-600 mr-2" />
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
                        onClick={() => handleSort('feeRuleSummary')}
                        title="Retailer fee as % of revenue, or flat per order (see fee rules). Multiple values if orders use different rules."
                      >
                        <div className="flex items-center space-x-1">
                          <span>Retailer Fee Rate</span>
                          {getSortIcon('feeRuleSummary')}
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
                        <td className="px-4 py-4 text-sm text-gray-700">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-gray-100 text-gray-800 font-medium">
                            {retailer.feeRuleSummary}
                          </span>
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
                              className="px-3 py-1.5 bg-bevvi-primary-600 text-white text-xs font-medium rounded-md hover:bg-bevvi-primary-700 transition-colors"
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
                      <td className="px-4 py-4 text-sm text-gray-500">—</td>
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
              className="w-full sm:w-auto px-4 py-2 text-sm bg-bevvi-primary-600 text-white rounded-lg hover:bg-bevvi-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
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
