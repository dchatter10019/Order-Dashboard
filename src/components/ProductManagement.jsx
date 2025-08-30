import React, { useState, useRef, useMemo, useCallback, useEffect } from 'react'
import { Upload, Search, Plus, FileText, Store, Building, Package } from 'lucide-react'

const ProductManagement = () => {
  const [products, setProducts] = useState([])
  const [stores, setStores] = useState([])
  const [companies, setCompanies] = useState([])
  const [selectedProduct, setSelectedProduct] = useState('')
  const [selectedStore, setSelectedStore] = useState('')
  const [selectedCompany, setSelectedCompany] = useState('')
  const [price, setPrice] = useState('')
  const [quantity, setQuantity] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [productSearchTerm, setProductSearchTerm] = useState('')
  const [showProductDropdown, setShowProductDropdown] = useState(false)
  
  const fileInputRef = useRef(null)
  const searchTimeoutRef = useRef(null)
  const productSearchRef = useRef(null)

  // Debounced search function for better performance
  const debouncedSearch = useCallback((searchTerm, setSearchTerm) => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current)
    }
    
    // Show dropdown immediately when typing
    setShowProductDropdown(true)
    
    searchTimeoutRef.current = setTimeout(() => {
      setSearchTerm(searchTerm)
    }, 200) // Reduced to 200ms for better responsiveness
  }, [])

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current)
      }
    }
  }, [])

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (productSearchRef.current && !productSearchRef.current.contains(event.target)) {
        setShowProductDropdown(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

    // Handle CSV file uploads
  const handleFileUpload = (event, type) => {
    const file = event.target.files[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (e) => {
      const csv = e.target.result
      const lines = csv.split('\n')
      const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''))
      
      const data = lines.slice(1).map(line => {
        const values = line.split(',').map(v => v.trim().replace(/"/g, ''))
        const obj = {}
        headers.forEach((header, index) => {
          obj[header] = values[index] || ''
        })
        return obj
      }).filter(item => Object.values(item).some(val => val !== ''))

      switch (type) {
        case 'products':
          setProducts(data)
          setMessage(`Loaded ${data.length} products`)
          break
        case 'stores':
          setStores(data)
          setMessage(`Loaded ${data.length} stores`)
          break
        case 'companies':
          setCompanies(data)
          setMessage(`Loaded ${data.length} companies`)
          break
        default:
          break
      }
    }
    reader.readAsText(file)
  }

  // Filter products by name or UPC with better performance
  const filteredProducts = useMemo(() => {
    if (!productSearchTerm.trim()) return [] // Don't show anything until user types
    
    const searchLower = productSearchTerm.toLowerCase()
    let count = 0
    const results = []
    
    // Use a more efficient search with early termination
    for (const product of products) {
      if (count >= 50) break // Limit to 50 results for better performance
      
      const name = (product.name || product.Name || '').toLowerCase()
      const upc = (product.upc || product.UPC || '').toLowerCase()
      
      if (name.includes(searchLower) || upc.includes(searchLower)) {
        results.push(product)
        count++
      }
    }
    
    return results
  }, [products, productSearchTerm])

  // Handle form submission
  const handleSubmit = async (e) => {
    e.preventDefault()
    
    if (!selectedProduct || !selectedStore || !selectedCompany || !price || !quantity) {
      setMessage('Please fill in all fields')
      return
    }

    setIsLoading(true)
    setMessage('')

    try {
      // Find the selected product to get UPC
      const product = products.find(p => 
        p.name === selectedProduct || p.Name === selectedProduct
      )
      
      if (!product) {
        setMessage('Selected product not found')
        return
      }

      const upc = product.upc || product.UPC
      const storeName = encodeURIComponent(selectedStore)
      const client = encodeURIComponent(selectedCompany)

      const apiUrl = `https://api.getbevvi.com/api/corpproducts/addCorpProduct?storeName=${storeName}&upc=${upc}&price=${price}&inventory=${quantity}&client=${client}`

      const response = await fetch(apiUrl)
      const result = await response.json()

      if (response.ok) {
        setMessage('Product added successfully!')
        // Reset form
        setSelectedProduct('')
        setSelectedStore('')
        setSelectedCompany('')
        setPrice('')
        setQuantity('')
      } else {
        setMessage(`Error: ${result.message || 'Failed to add product'}`)
      }
    } catch (error) {
      setMessage(`Error: ${error.message}`)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Product Management</h1>
        <p className="text-gray-600">Upload CSV files and manage product inventory across stores</p>
      </div>

      {/* CSV Upload Section */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        {/* Products Upload */}
        <div className="bg-white p-6 rounded-lg shadow-md border">
          <div className="flex items-center mb-4">
            <Package className="w-6 h-6 text-blue-600 mr-3" />
            <h3 className="text-lg font-semibold">Products</h3>
          </div>
          <input
            type="file"
            accept=".csv"
            onChange={(e) => handleFileUpload(e, 'products')}
            className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
          />
          <p className="text-sm text-gray-500 mt-2">Upload CSV with Name and UPC columns</p>
          {products.length > 0 && (
            <p className="text-sm text-green-600 mt-2">✓ {products.length} products loaded</p>
          )}
        </div>

        {/* Stores Upload */}
        <div className="bg-white p-6 rounded-lg shadow-md border">
          <div className="flex items-center mb-4">
            <Store className="w-6 h-6 text-green-600 mr-3" />
            <h3 className="text-lg font-semibold">Stores</h3>
          </div>
          <input
            type="file"
            accept=".csv"
            onChange={(e) => handleFileUpload(e, 'stores')}
            className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-green-50 file:text-green-700 hover:file:bg-green-100"
          />
          <p className="text-sm text-gray-500 mt-2">Upload CSV with Name column</p>
          {stores.length > 0 && (
            <p className="text-sm text-green-600 mt-2">✓ {stores.length} stores loaded</p>
          )}
        </div>

        {/* Companies Upload */}
        <div className="bg-white p-6 rounded-lg shadow-md border">
          <div className="flex items-center mb-4">
            <Building className="w-6 h-6 text-purple-600 mr-3" />
            <h3 className="text-lg font-semibold">Companies</h3>
          </div>
          <input
            type="file"
            accept=".csv"
            onChange={(e) => handleFileUpload(e, 'companies')}
            className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-purple-50 file:text-purple-700 hover:file:bg-purple-100"
          />
          <p className="text-sm text-gray-500 mt-2">Upload CSV with Name column</p>
          {companies.length > 0 && (
            <p className="text-sm text-green-600 mt-2">✓ {companies.length} companies loaded</p>
          )}
        </div>
      </div>

      {/* Product Management Form */}
      <div className="bg-white p-6 rounded-lg shadow-md border">
        <h3 className="text-xl font-semibold mb-6">Add Corporate Product</h3>
        
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Product Selection */}
            <div ref={productSearchRef}>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Product *
              </label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="text"
                  value={productSearchTerm}
                  placeholder="Search products by name or UPC..."
                  onChange={(e) => debouncedSearch(e.target.value, setProductSearchTerm)}
                  className="pl-10 w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              {showProductDropdown && productSearchTerm && filteredProducts.length > 0 && (
                <div className="mt-2 max-h-40 overflow-y-auto border border-gray-200 rounded-md bg-white">
                  {filteredProducts.length > 0 ? (
                    <>
                      {filteredProducts.map((product, index) => (
                        <div
                          key={index}
                          onClick={() => {
                            setSelectedProduct(product.name || product.Name)
                            setProductSearchTerm(product.name || product.Name) // Show selected product in search box
                            setShowProductDropdown(false) // Hide dropdown after selection
                          }}
                          className="px-3 py-2 hover:bg-blue-50 cursor-pointer border-b border-gray-100 last:border-b-0"
                        >
                          <div className="font-medium">{product.name || product.Name}</div>
                          <div className="text-sm text-gray-500">{product.upc || product.UPC}</div>
                        </div>
                      ))}
                      {filteredProducts.length === 100 && (
                        <div className="px-3 py-2 text-xs text-gray-400 border-t border-gray-100">
                          Showing first 100 results. Refine your search for more specific results.
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="px-3 py-2 text-gray-500 text-sm">No products found</div>
                  )}
                </div>
              )}

            </div>

            {/* Store Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Store *
              </label>
              <select
                value={selectedStore}
                onChange={(e) => setSelectedStore(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
              >
                <option value="">Select a store</option>
                {stores.map((store, index) => (
                  <option key={index} value={store.name || store.Name}>
                    {store.name || store.Name}
                  </option>
                ))}
              </select>
            </div>

            {/* Company Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Company *
              </label>
              <select
                value={selectedCompany}
                onChange={(e) => setSelectedCompany(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
              >
                <option value="">Select a company</option>
                {companies.map((company, index) => (
                  <option key={index} value={company.name || company.Name}>
                    {company.name || company.Name}
                  </option>
                ))}
              </select>
            </div>

            {/* Price Input */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Price *
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="0.00"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
              />
            </div>

            {/* Quantity Input */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Quantity *
              </label>
              <input
                type="number"
                min="0"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="0"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
              />
            </div>
          </div>

          {/* Submit Button */}
          <div className="flex items-center justify-between">
            <button
              type="submit"
              disabled={isLoading}
              className="flex items-center px-6 py-3 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <>
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2"></div>
                  Adding Product...
                </>
              ) : (
                <>
                  <Plus className="w-5 h-5 mr-2" />
                  Add Product
                </>
              )}
            </button>

            {message && (
              <div className={`px-4 py-2 rounded-md text-sm ${
                message.includes('Error') 
                  ? 'bg-red-100 text-red-700' 
                  : 'bg-green-100 text-green-700'
              }`}>
                {message}
              </div>
            )}
          </div>
        </form>
      </div>

      {/* Data Preview Section */}
      {(products.length > 0 || stores.length > 0 || companies.length > 0) && (
        <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-6">
          {products.length > 0 && (
            <div className="bg-white p-4 rounded-lg shadow-md border">
              <h4 className="font-semibold mb-3 text-blue-600">Products Preview</h4>
              <div className="max-h-40 overflow-y-auto">
                {products.slice(0, 5).map((product, index) => (
                  <div key={index} className="text-sm py-1 border-b border-gray-100">
                    <div className="font-medium">{product.name || product.Name}</div>
                    <div className="text-gray-500">{product.upc || product.UPC}</div>
                  </div>
                ))}
                {products.length > 5 && (
                  <div className="text-xs text-gray-400 mt-2">
                    +{products.length - 5} more products
                  </div>
                )}
              </div>
            </div>
          )}

          {stores.length > 0 && (
            <div className="bg-white p-4 rounded-lg shadow-md border">
              <h4 className="font-semibold mb-3 text-green-600">Stores Preview</h4>
              <div className="max-h-40 overflow-y-auto">
                {stores.slice(0, 5).map((store, index) => (
                  <div key={index} className="text-sm py-1 border-b border-gray-100">
                    <div className="font-medium">{store.name || store.Name}</div>
                  </div>
                ))}
                {stores.length > 5 && (
                  <div className="text-xs text-gray-400 mt-2">
                    +{stores.length - 5} more stores
                  </div>
                )}
              </div>
            </div>
          )}

          {companies.length > 0 && (
            <div className="bg-white p-4 rounded-lg shadow-md border">
              <h4 className="font-semibold mb-3 text-purple-600">Companies Preview</h4>
              <div className="max-h-40 overflow-y-auto">
                {companies.slice(0, 5).map((company, index) => (
                  <div key={index} className="text-sm py-1 border-b border-gray-100">
                    <div className="font-medium">{company.name || company.Name}</div>
                  </div>
                ))}
                {companies.length > 5 && (
                  <div className="text-xs text-gray-400 mt-2">
                    +{companies.length - 5} more companies
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default ProductManagement
