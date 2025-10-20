import React, { useState, useRef, useMemo, useCallback, useEffect } from 'react'
import { Search, Plus, Store, Building, Package, RefreshCw } from 'lucide-react'

const ProductManagement = () => {
  // State declarations first
  const [products, setProducts] = useState([]) // Not cached - search uses API directly
  const [stores, setStores] = useState(() => {
    try {
      const saved = sessionStorage.getItem('bevvi_stores')
      return saved ? JSON.parse(saved) : []
    } catch (error) {
      console.error('Error loading stores from sessionStorage:', error)
      sessionStorage.removeItem('bevvi_stores')
      return []
    }
  })
  // Set company to "airculinaire" by default
  const [companies] = useState([{ name: 'airculinaire' }])
  const [selectedProduct, setSelectedProduct] = useState('')
  const [selectedStore, setSelectedStore] = useState('')
  const [selectedCompany, setSelectedCompany] = useState('airculinaire')
  const [price, setPrice] = useState('')
  const [quantity, setQuantity] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingData, setIsLoadingData] = useState(false)
  const [message, setMessage] = useState('')
  const [productSearchTerm, setProductSearchTerm] = useState('')
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('')
  const [showProductDropdown, setShowProductDropdown] = useState(false)
  const [isSearching, setIsSearching] = useState(false)
  const [searchResults, setSearchResults] = useState([])
  const [isLoadingAllProducts, setIsLoadingAllProducts] = useState(false)
  
  const searchTimeoutRef = useRef(null)
  const productSearchRef = useRef(null)

  // Debounce only the filtering, not the input value
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current)
    }
    
    searchTimeoutRef.current = setTimeout(() => {
      setDebouncedSearchTerm(productSearchTerm)
    }, 150) // Faster debounce for better UX
    
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current)
      }
    }
  }, [productSearchTerm])

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

  // Persist stores to sessionStorage whenever they change
  useEffect(() => {
    if (stores.length > 0) {
      sessionStorage.setItem('bevvi_stores', JSON.stringify(stores))
    }
  }, [stores])

  // Load only stores on mount (products loaded on-demand during search)
  useEffect(() => {
    const loadInitialData = async () => {
      // Check if stores are in sessionStorage
      const hasStoresInStorage = sessionStorage.getItem('bevvi_stores')
      
      // Only load stores if not cached
      if (!hasStoresInStorage) {
        setIsLoadingData(true)
        try {
          await loadStores()
          setMessage('✓ Stores loaded from API. Products will load as you search.')
        } catch (error) {
          setMessage(`Error loading stores: ${error.message}`)
        } finally {
          setIsLoadingData(false)
        }
      }
    }
    loadInitialData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Only run once on mount

  // Function to load stores from API
  const loadStores = async () => {
    try {
      const response = await fetch('https://api.getbevvi.com/api/corputil/getStoresAsJSON')
      if (!response.ok) throw new Error('Failed to fetch stores')
      
      const data = await response.json()
      console.log('🏪 Stores loaded from API:', data)
      
      const storesList = data.results || []
      setStores(storesList)
      return storesList.length
    } catch (error) {
      console.error('❌ Error loading stores:', error)
      throw error
    }
  }

  // Function to load stores from API
  const loadDataFromAPIs = async () => {
    setIsLoadingData(true)
    setMessage('')
    
    try {
      const storesCount = await loadStores()
      setMessage(`✓ Loaded ${storesCount} stores from API. Products available via search.`)
    } catch (error) {
      setMessage(`Error loading data: ${error.message}`)
    } finally {
      setIsLoadingData(false)
    }
  }

  // Load all products from Bevvi API
  const loadAllProducts = async () => {
    setIsLoadingAllProducts(true)
    setMessage('⏳ Loading all products from server... This may take 10-15 seconds.')
    
    try {
      console.log('🔄 Fetching all products from Bevvi API...')
      console.time('Load All Products')
      
      const response = await fetch('https://api.getbevvi.com/api/corputil/getBevviProductsAsJSON', {
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache'
        }
      })
      
      if (!response.ok) throw new Error(`Server error: ${response.status}`)
      
      const data = await response.json()
      const productsList = data.results || []
      
      console.timeEnd('Load All Products')
      console.log(`✅ Loaded ${productsList.length.toLocaleString()} products from server`)
      
      setProducts(productsList)
      setMessage(`✅ Success! ${productsList.length.toLocaleString()} products loaded. Search is now instant!`)
    } catch (error) {
      console.error('❌ Error loading all products:', error)
      setMessage(`❌ Error: ${error.message}. Using on-demand API search instead.`)
    } finally {
      setIsLoadingAllProducts(false)
    }
  }

  // Search products - use local cache if available, otherwise API search
  useEffect(() => {
    const searchProducts = async () => {
      if (!debouncedSearchTerm || debouncedSearchTerm.length < 3) {
        setSearchResults([])
        return
      }
      
      setIsSearching(true)
      try {
        // If we have products loaded locally, search them (instant)
        if (products.length > 0) {
          console.log(`🔍 Searching local cache for "${debouncedSearchTerm}"`)
          const searchLower = debouncedSearchTerm.toLowerCase().trim()
          const filtered = products.filter(p => {
            const name = (p.name || p.Name || '').toLowerCase()
            const upc = (p.upc || p.UPC || '').toString().toLowerCase()
            return name.includes(searchLower) || upc.includes(searchLower)
          }).slice(0, 100)
          console.log(`✅ Found ${filtered.length} results in local cache`)
          setSearchResults(filtered)
        } else {
          // Otherwise, search API directly
          console.log(`🔍 Searching API for "${debouncedSearchTerm}"`)
          const filter = {
            where: {
              or: [
                { name: { like: debouncedSearchTerm, options: 'i' } },
                { upc: { like: debouncedSearchTerm, options: 'i' } }
              ]
            },
            fields: { name: true, upc: true, id: true, client: true },
            limit: 100
          }
          const encodedFilter = encodeURIComponent(JSON.stringify(filter))
          
          const cacheBuster = `t=${Date.now()}`
          const response = await fetch(
            `https://api.getbevvi.com/api/corpproducts?filter=${encodedFilter}&${cacheBuster}`,
            {
              headers: {
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache'
              }
            }
          )
          if (!response.ok) throw new Error('Search failed')
          
          const data = await response.json()
          const results = Array.isArray(data) ? data : (data.results || [])
          console.log(`✅ Found ${results.length} results from API`)
          setSearchResults(results)
        }
      } catch (error) {
        console.error('Search error:', error)
        setSearchResults([])
      } finally {
        setIsSearching(false)
      }
    }
    
    searchProducts()
  }, [debouncedSearchTerm, products])
  
  // Use search results instead of filtering local data
  const filteredProducts = searchResults


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
      // Find the selected product to get UPC from search results
      const product = searchResults.find(p => 
        p.name === selectedProduct || p.Name === selectedProduct
      )
      
      if (!product) {
        setMessage('Selected product not found. Please search and select a product again.')
        setIsLoading(false)
        return
      }

      const upc = product.upc || product.UPC
      const storeName = encodeURIComponent(selectedStore)
      const client = encodeURIComponent(selectedCompany)

      const apiUrl = `https://api.getbevvi.com/api/corpproducts/addCorpProduct?storeName=${storeName}&upc=${upc}&price=${price}&inventory=${quantity}&client=${client}`

      const response = await fetch(apiUrl)
      const result = await response.json()

      if (response.ok) {
        setMessage('✓ Product added successfully! Note: Search results update in real-time from the API.')
        // Reset form
        setSelectedProduct('')
        setProductSearchTerm('')
        setDebouncedSearchTerm('')
        setSelectedStore('')
        setSelectedCompany('airculinaire')
        setPrice('')
        setQuantity('')
        setShowProductDropdown(false)
        setSearchResults([])
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
        <p className="text-gray-600">Manage product inventory across stores for airculinaire</p>
      </div>

      {/* Helpful banner */}
      {stores.length === 0 && !isLoadingData && (
        <div className="mb-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-start">
            <div className="flex-shrink-0">
              <Package className="h-5 w-5 text-blue-600 mt-0.5" />
            </div>
            <div className="ml-3 flex-1">
              <h3 className="text-sm font-medium text-blue-800">Product Search Options</h3>
              <div className="mt-2 text-sm text-blue-700">
                <p><strong>Option 1 (Recommended):</strong> Click "Load All" to load all products once (10-15 sec), then search instantly</p>
                <p className="mt-1"><strong>Option 2:</strong> Just start typing to search via API (real-time, but slower)</p>
                <p className="mt-1 text-xs">After loading all products, your UPC 03185370303382 will be searchable if it exists in the catalog.</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* API Data Status Section */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        {/* Products Status */}
        <div className="bg-white p-6 rounded-lg shadow-md border">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center">
              <Package className="w-6 h-6 text-blue-600 mr-3" />
              <h3 className="text-lg font-semibold">Products</h3>
            </div>
            <button
              onClick={loadAllProducts}
              disabled={isLoadingAllProducts}
              className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center transition-all"
              title="Load all products from server for instant search"
            >
              {isLoadingAllProducts ? (
                <>
                  <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white mr-1"></div>
                  <span className="text-xs">Loading...</span>
                </>
              ) : (
                <>
                  <RefreshCw className="w-3 h-3 mr-1" />
                  <span className="text-xs">Load All</span>
                </>
              )}
            </button>
          </div>
          {products.length > 0 ? (
            <>
              <p className="text-sm text-green-600 mt-2">✓ {products.length.toLocaleString()} products loaded</p>
              <p className="text-xs text-gray-400 mt-1">Search is instant (local filter)</p>
              {searchResults.length > 0 && (
                <p className="text-xs text-blue-600 mt-1">{searchResults.length} results for your search</p>
              )}
            </>
          ) : (
            <>
              <p className="text-sm text-gray-500 mt-2">Real-Time API Search</p>
              <p className="text-xs text-gray-400 mt-1">Click "Load All" for instant search</p>
            </>
          )}
        </div>

        {/* Stores Status */}
        <div className="bg-white p-6 rounded-lg shadow-md border">
          <div className="flex items-center mb-4">
            <Store className="w-6 h-6 text-green-600 mr-3" />
            <h3 className="text-lg font-semibold">Stores</h3>
          </div>
          <p className="text-sm text-gray-500 mt-2">Loaded from API</p>
          {isLoadingData && stores.length === 0 ? (
            <div className="flex items-center text-sm text-blue-600 mt-2">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mr-2"></div>
              Loading stores...
            </div>
          ) : stores.length > 0 ? (
            <p className="text-sm text-green-600 mt-2">✓ {stores.length} stores available</p>
          ) : null}
        </div>

        {/* Company Info */}
        <div className="bg-white p-6 rounded-lg shadow-md border">
          <div className="flex items-center mb-4">
            <Building className="w-6 h-6 text-purple-600 mr-3" />
            <h3 className="text-lg font-semibold">Company</h3>
          </div>
          <p className="text-sm text-gray-500 mt-2">Active Company</p>
          <p className="text-sm text-green-600 mt-2 font-semibold">✓ airculinaire</p>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="mb-8 flex justify-center gap-4">
        {stores.length === 0 && (
          <button
            onClick={loadDataFromAPIs}
            disabled={isLoadingData}
            className="flex items-center px-6 py-3 bg-indigo-600 text-white font-medium rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoadingData ? (
              <>
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2"></div>
                Loading Stores...
              </>
            ) : (
              <>
                <RefreshCw className="w-5 h-5 mr-2" />
                Load Stores
              </>
            )}
          </button>
        )}
        
        {stores.length > 0 && (
          <button
            onClick={() => {
              sessionStorage.removeItem('bevvi_stores')
              setStores([])
              setSearchResults([])
              setProductSearchTerm('')
              setDebouncedSearchTerm('')
              setMessage('Cache cleared. Stores will reload automatically.')
            }}
            className="flex items-center px-4 py-3 bg-gray-500 text-white font-medium rounded-md hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
          >
            Clear Cache
          </button>
        )}
      </div>

      {/* Info about real-time updates */}
      {message.includes('successfully') && (
        <div className="mb-6 bg-green-50 border border-green-200 rounded-lg p-4">
          <div className="flex items-start">
            <div className="flex-shrink-0">
              <Package className="h-5 w-5 text-green-600 mt-0.5" />
            </div>
            <div className="ml-3 flex-1">
              <h3 className="text-sm font-medium text-green-800">Product Mapping Saved!</h3>
              <div className="mt-2 text-sm text-green-700">
                <p>Your product mapping is saved. All searches query the API in real-time with latest data.</p>
                <p className="mt-1 text-xs">Products added in Bevvi admin appear instantly in search results.</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Product Management Form */}
      <div className="bg-white p-6 rounded-lg shadow-md border">
        <h3 className="text-xl font-semibold mb-6">Add Corporate Product</h3>
        
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Product Selection */}
            <div ref={productSearchRef} className="relative">
              <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center justify-between">
                <span>Product *</span>
                {productSearchTerm.length >= 3 && (
                  <button
                    type="button"
                    onClick={() => {
                      // Force re-search by updating the debounced term
                      setDebouncedSearchTerm('')
                      setTimeout(() => setDebouncedSearchTerm(productSearchTerm), 10)
                    }}
                    className="text-xs text-blue-600 hover:text-blue-800 flex items-center"
                  >
                    <RefreshCw className="w-3 h-3 mr-1" />
                    Refresh Search
                  </button>
                )}
              </label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none z-10" />
                <input
                  type="text"
                  value={productSearchTerm}
                  placeholder="Type at least 3 characters to search products..."
                  onChange={(e) => {
                    setProductSearchTerm(e.target.value)
                    setShowProductDropdown(true)
                  }}
                  onFocus={() => {
                    if (productSearchTerm.length >= 3) {
                      setShowProductDropdown(true)
                    }
                  }}
                  className="pl-10 w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  autoComplete="off"
                />
                {(isSearching || (debouncedSearchTerm !== productSearchTerm && productSearchTerm.length >= 3)) && (
                  <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                  </div>
                )}
              </div>
              
              {/* Dropdown results */}
              {showProductDropdown && productSearchTerm.length >= 3 && (
                <div className="absolute z-50 mt-1 w-full max-h-64 overflow-y-auto border border-gray-200 rounded-md bg-white shadow-lg">
                  {isSearching ? (
                    <div className="px-3 py-4 text-gray-400 text-sm text-center flex items-center justify-center">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mr-2"></div>
                      Searching products...
                    </div>
                  ) : filteredProducts.length > 0 ? (
                    <>
                      {filteredProducts.map((product, index) => (
                        <div
                          key={`${product.upc || product.UPC}-${index}`}
                          onClick={() => {
                            const productName = product.name || product.Name
                            setSelectedProduct(productName)
                            setProductSearchTerm(productName)
                            setDebouncedSearchTerm(productName)
                            setShowProductDropdown(false)
                          }}
                          className="px-3 py-2 hover:bg-blue-50 cursor-pointer border-b border-gray-100 last:border-b-0 transition-colors"
                        >
                          <div className="font-medium text-gray-900">{product.name || product.Name}</div>
                          <div className="text-xs text-gray-500">UPC: {product.upc || product.UPC}</div>
                        </div>
                      ))}
                      {filteredProducts.length === 100 && (
                        <div className="px-3 py-2 text-xs text-gray-500 bg-gray-50 border-t border-gray-200">
                          Showing first 100 results. Type more characters for better results.
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="px-3 py-4 text-gray-500 text-sm text-center">
                      No products found matching "{productSearchTerm}"
                    </div>
                  )}
                </div>
              )}
              
              {productSearchTerm.length > 0 && productSearchTerm.length < 3 && (
                <p className="text-xs text-gray-500 mt-1">Type at least 3 characters to search</p>
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
              <input
                type="text"
                value={selectedCompany}
                disabled
                className="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-100 text-gray-700 cursor-not-allowed"
              />
              <p className="text-xs text-gray-500 mt-1">Company is set to airculinaire</p>
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
      {stores.length > 0 && (
        <div className="mt-8">
          <div className="bg-white p-4 rounded-lg shadow-md border max-w-md mx-auto">
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
        </div>
      )}
    </div>
  )
}

export default ProductManagement
