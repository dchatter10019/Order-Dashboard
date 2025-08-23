import React from 'react'
import { Calendar, RefreshCw } from 'lucide-react'

const DateRangePicker = ({ dateRange, onDateRangeChange, onFetchOrders, refreshInfo }) => {
  const handleDateChange = (field, value) => {
    const newDateRange = {
      ...dateRange,
      [field]: value
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
          className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-xl transition-all duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 flex items-center"
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
              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-300 transition-all duration-200 bg-gray-50"
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
              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:border-blue-300 transition-all duration-200 bg-gray-50"
              value={dateRange.endDate}
              onChange={(e) => handleDateChange('endDate', e.target.value)}
              min={dateRange.startDate}
            />
        </div>
      </div>
      
              <div className="mt-4 text-sm text-gray-600">
          <p>Selected range: <span className="font-medium">{dateRange.startDate}</span> to <span className="font-medium">{dateRange.endDate}</span></p>
          <p className="mt-1 text-xs text-gray-500">Click "Fetch Orders" to call the Bevvi API with these dates</p>
        </div>
        
        {/* Refresh Timing Information removed as requested */}
    </div>
  )
}

export default DateRangePicker
