import React from 'react'
import { Clock } from 'lucide-react'

const DeliveryFilter = ({ deliveryFilter, onDeliveryFilterChange }) => {
  const deliveryOptions = [
    { value: 'all_dates', label: 'All Dates' },
    { value: 'today', label: 'Today' },
    { value: 'tomorrow', label: 'Tomorrow' },
    { value: 'this_week', label: 'This Week' }
  ]

  return (
    <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-6">
      <div className="flex items-center mb-4">
        <Clock className="h-5 w-5 text-blue-600 mr-2" />
        <h3 className="text-lg font-semibold text-gray-900">
          Delivery Filter
        </h3>
        <p className="text-sm text-gray-600 mt-1">
          Select multiple delivery date options
        </p>
      </div>
      
      <div className="space-y-2">
        {/* All Dates Option - Default when no filters selected */}
        <label className="flex items-center cursor-pointer border-b border-gray-200 pb-2">
          <input
            type="checkbox"
            name="allDates"
            checked={deliveryFilter.length === 0 || deliveryFilter.includes('all_dates')}
            onChange={(e) => {
              if (e.target.checked) {
                // Show all dates (clear other filters)
                onDeliveryFilterChange(['all_dates'])
              } else {
                // Clear all filters (this will default to showing all)
                onDeliveryFilterChange([])
              }
            }}
            className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
          />
          <span className="ml-3 text-sm font-medium text-gray-700">
            {deliveryFilter.length === 0 ? 'All Dates (Default)' : 'All Dates'}
          </span>
        </label>
        
        {/* Individual Date Options */}
        {deliveryOptions.filter(option => option.value !== 'all_dates').map((option) => (
          <label key={option.value} className="flex items-center cursor-pointer">
            <input
              type="checkbox"
              name="deliveryFilter"
              value={option.value}
              checked={deliveryFilter.includes(option.value)}
              onChange={(e) => {
                const value = e.target.value
                
                if (e.target.checked) {
                  // Add to selection and remove 'all_dates' if it was selected
                  const newFilter = deliveryFilter.filter(item => item !== 'all_dates')
                  const finalFilter = [...newFilter, value]
                  onDeliveryFilterChange(finalFilter)
                } else {
                  // Remove from selection
                  const finalFilter = deliveryFilter.filter(item => item !== value)
                  onDeliveryFilterChange(finalFilter)
                }
              }}
              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
            />
            <span className="ml-3 text-sm text-gray-700">
              {option.label}
            </span>
          </label>
        ))}
      </div>
    </div>
  )
}

export default DeliveryFilter
