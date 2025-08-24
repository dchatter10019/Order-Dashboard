import React from 'react'
import { Calendar, RefreshCw } from 'lucide-react'

const DateRangePicker = ({ dateRange, onDateRangeChange, onFetchOrders, refreshInfo }) => {
  const [validationError, setValidationError] = React.useState('')
  
  const validateDateRange = (startDate, endDate) => {
    if (!startDate || !endDate) return true // Allow empty dates during input
    
    const start = new Date(startDate)
    const end = new Date(endDate)
    const today = new Date()
    today.setHours(23, 59, 59, 999) // End of today
    
    // Check if dates are in the future
    if (start > today || end > today) {
      setValidationError('Cannot select future dates. Please select dates up to today.')
      return false
    }
    
    if (start > end) {
      setValidationError('Start date must be less than or equal to end date')
      return false
    } else {
      setValidationError('')
      return true
    }
  }
  
  const handleDateChange = (field, value) => {
    const newDateRange = {
      ...dateRange,
      [field]: value
    }
    
    // Validate the new date range
    if (field === 'startDate') {
      validateDateRange(value, newDateRange.endDate)
    } else if (field === 'endDate') {
      validateDateRange(newDateRange.startDate, value)
    }
    
    onDateRangeChange(newDateRange)
    
    // Auto-fetch orders when dates change (optional - you can remove this if you prefer manual fetch)
    // setTimeout(() => onFetchOrders(), 100)
  }

  const handleFetchOrders = () => {
    onFetchOrders()
  }

  return (
    <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900 flex items-center">
          <Calendar className="h-5 w-5 text-blue-600 mr-2" />
          Date Range
        </h3>
        <button
          onClick={handleFetchOrders}
          disabled={!!validationError}
          className={`font-semibold py-2 px-4 rounded-xl transition-all duration-200 shadow-lg transform flex items-center ${
            validationError 
              ? 'bg-gray-400 cursor-not-allowed' 
              : 'bg-blue-600 hover:bg-blue-700 hover:shadow-xl hover:-translate-y-0.5'
          } text-white`}
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          Fetch Orders
        </button>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label htmlFor="startDate" className="block text-sm font-medium text-gray-700 mb-2">
            Start Date
          </label>
                      <input
              id="startDate"
              type="date"
              max={new Date().toISOString().split('T')[0]}
              className="w-full min-w-[160px] px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-300 transition-all duration-200 bg-gray-50 text-gray-900 text-base font-medium"
              style={{ minWidth: '160px', fontSize: '16px' }}
              value={dateRange.startDate}
              onChange={(e) => handleDateChange('startDate', e.target.value)}
            />
        </div>
        
        <div>
          <label htmlFor="endDate" className="block text-sm font-medium text-gray-700 mb-2">
            End Date
          </label>
                      <input
              id="endDate"
              type="date"
              max={new Date().toISOString().split('T')[0]}
              className="w-full min-w-[160px] px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:border-blue-300 transition-all duration-200 bg-gray-50 text-gray-900 text-base font-medium"
              style={{ minWidth: '160px', fontSize: '16px' }}
              value={dateRange.endDate}
              onChange={(e) => handleDateChange('endDate', e.target.value)}
              min={dateRange.startDate}
            />
        </div>
      </div>
      
      {/* Validation Error Display */}
      {validationError && (
        <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-700 font-medium">{validationError}</p>
        </div>
      )}
      
      <div className="mt-4 text-sm text-gray-600">
        <p>Selected range: <span className="font-medium">{dateRange.startDate}</span> to <span className="font-medium">{dateRange.endDate}</span></p>
        <p className="mt-1 text-xs text-gray-500">Click "Fetch Orders" to call the Bevvi API with these dates</p>
      </div>
        
        {/* Refresh Timing Information removed as requested */}
    </div>
  )
}

export default DateRangePicker
