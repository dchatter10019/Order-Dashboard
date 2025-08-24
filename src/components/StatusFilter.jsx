import React from 'react'
import { Filter } from 'lucide-react'

const StatusFilter = ({ statusFilter, onStatusFilterChange }) => {
  const statusOptions = [
    { value: 'delivered', label: 'Delivered', count: null },
    { value: 'in_transit', label: 'In Transit', count: null },
    { value: 'accepted', label: 'Accepted', count: null },
    { value: 'pending', label: 'Pending', count: null },
    { value: 'canceled', label: 'Canceled', count: null }
  ]

  return (
    <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-6">
      <div className="flex items-center mb-4">
        <Filter className="h-5 w-5 text-blue-600 mr-2" />
        <h3 className="text-lg font-semibold text-gray-900">
          Status Filter
        </h3>
      </div>
      
      <div className="space-y-2">
        {/* Select All Option */}
        <label className="flex items-center cursor-pointer border-b border-gray-200 pb-2">
          <input
            type="checkbox"
            name="selectAll"
            checked={statusFilter.length === statusOptions.length || statusFilter.length === 0}
            onChange={(e) => {
              if (e.target.checked) {
                // Select all options
                onStatusFilterChange(statusOptions.map(option => option.value))
              } else {
                // Deselect all options (this will default to showing all)
                onStatusFilterChange([])
              }
            }}
            className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
          />
          <span className="ml-3 text-sm font-medium text-gray-700">
            {statusFilter.length === 0 ? 'Select All (Default)' : 'Select All'}
          </span>
        </label>
        
        {/* Individual Options */}
        {statusOptions.map((option) => (
          <label key={option.value} className="flex items-center cursor-pointer">
            <input
              type="checkbox"
              name="statusFilter"
              value={option.value}
              checked={statusFilter.includes(option.value)}
              onChange={(e) => {
                const value = e.target.value
                if (e.target.checked) {
                  // Add to selection
                  onStatusFilterChange([...statusFilter, value])
                } else {
                  // Remove from selection
                  onStatusFilterChange(statusFilter.filter(item => item !== value))
                }
              }}
              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
            />
            <span className="ml-3 text-sm text-gray-700 capitalize">
              {option.label.replace('_', ' ')}
            </span>
          </label>
        ))}
      </div>
    </div>
  )
}

export default StatusFilter
