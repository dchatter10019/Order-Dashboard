import React, { useState, useRef, useMemo, useCallback, useEffect } from 'react'
import { Search, Plus, Store, Building, Package, RefreshCw } from 'lucide-react'
import { apiFetch } from '../utils/api'

const ProductManagement = () => {
  // State declarations first
  const [products] = useState([]) // Products searched via API only
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
  // Set companies list with airculinaire, sendoso, and OnGoody
  const [companies] = useState([
    { name: 'airculinaire' },
    { name: 'sendoso' },
    { name: 'OnGoody' }
  ])
  const [selectedProduct, setSelectedProduct] = useState('')
  const [selectedStore, setSelectedStore] = useState('')
  const [storeSearchTerm, setStoreSearchTerm] = useState('')
  const [debouncedStoreSearchTerm, setDebouncedStoreSearchTerm] = useState('')
  const [showStoreDropdown, setShowStoreDropdown] = useState(false)
  const [isSearchingStores, setIsSearchingStores] = useState(false)
  const [storeSearchResults, setStoreSearchResults] = useState([])
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
  const [productCacheStatus, setProductCacheStatus] = useState(null)
  
  const searchTimeoutRef = useRef(null)
  const storeSearchTimeoutRef = useRef(null)
  const productSearchRef = useRef(null)
  const storeSearchRef = useRef(null)

  // Debounce product search
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

  // Debounce store search
  useEffect(() => {
    if (storeSearchTimeoutRef.current) {
      clearTimeout(storeSearchTimeoutRef.current)
    }
    
    storeSearchTimeoutRef.current = setTimeout(() => {
      setDebouncedStoreSearchTerm(storeSearchTerm)
    }, 150)
    
    return () => {
      if (storeSearchTimeoutRef.current) {
        clearTimeout(storeSearchTimeoutRef.current)
      }
    }
  }, [storeSearchTerm])

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (productSearchRef.current && !productSearchRef.current.contains(event.target)) {
        setShowProductDropdown(false)
      }
      if (storeSearchRef.current && !storeSearchRef.current.contains(event.target)) {
        setShowStoreDropdown(false)
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

  // Load stores and check product cache status on mount
  useEffect(() => {
    let isMounted = true // Flag to prevent state updates if component unmounts
    
    const loadInitialData = async () => {
      // Check product cache status from backend
      try {
        const statusResponse = await apiFetch('/api/products/status')
        if (statusResponse.ok && isMounted) {
          // Check if response is JSON before parsing
          const contentType = statusResponse.headers.get('content-type')
          if (contentType && contentType.includes('application/json')) {
            const statusData = await statusResponse.json()
            setProductCacheStatus(statusData)
            console.log('📦 Product cache status:', statusData)
          } else {
            console.warn('⚠️ Product status endpoint returned non-JSON response')
          }
        }
      } catch (error) {
        console.error('Error checking product cache status:', error)
      }
      
      // Always try to load stores on mount (only if component is still mounted)
      if (isMounted) {
        setIsLoadingData(true)
        try {
          await loadStores()
          if (isMounted) {
            console.log('✅ Stores loaded successfully')
          }
        } catch (error) {
          console.error('Error loading stores:', error)
          if (isMounted) {
            setMessage(`Error loading stores: ${error.message}. Click "Load Stores" to retry.`)
          }
        } finally {
          if (isMounted) {
            setIsLoadingData(false)
          }
        }
      }
    }
    
    loadInitialData()
    
    // Cleanup function
    return () => {
      isMounted = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Only run once on mount

  // Function to load stores from API (via backend proxy)
  const loadStores = async () => {
    try {
      const response = await apiFetch('/api/stores')
      
      // Check Content-Type BEFORE trying to parse
      const contentType = response.headers.get('content-type') || ''
      
      if (!response.ok) {
        // If it's JSON, try to parse error details
        if (contentType.includes('application/json')) {
          try {
            const errorData = await response.json()
            throw new Error(errorData.message || `Failed to fetch stores: ${response.status}`)
          } catch (parseError) {
            throw new Error(`Failed to fetch stores: ${response.status} ${response.statusText}`)
          }
        } else {
          // Non-JSON error response (likely HTML error page)
          const text = await response.text()
          console.error('❌ API returned HTML instead of JSON:', text.substring(0, 300))
          throw new Error(`API endpoint returned HTML (status ${response.status}). The backend server may not be running or the route is not configured.`)
        }
      }
      
      // Check if response is JSON before parsing
      if (!contentType.includes('application/json')) {
        // Read as text first to see what we got
        const text = await response.text()
        console.error('❌ Expected JSON but got:', text.substring(0, 300))
        
        // Check if it's HTML
        if (text.trim().startsWith('<!DOCTYPE') || text.trim().startsWith('<html')) {
          throw new Error('API endpoint returned HTML instead of JSON. The backend server may not be running or the /api/stores route is not configured in production.')
        }
        
        throw new Error('Server returned non-JSON response. Check if API endpoint exists.')
      }
      
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

  // Search products via backend cache (all Bevvi products)
  useEffect(() => {
    const searchProducts = async () => {
      if (!debouncedSearchTerm || debouncedSearchTerm.length < 3) {
        setSearchResults([])
        return
      }
      
      setIsSearching(true)
      try {
        // Search backend cache - all Bevvi products
        console.log(`🔍 Searching backend cache for "${debouncedSearchTerm}"`)
        
        const response = await fetch(`/api/products/search?q=${encodeURIComponent(debouncedSearchTerm)}`)
        if (!response.ok) throw new Error('Search failed')
        
        const data = await response.json()
        
        if (data.success && data.results) {
          console.log(`✅ Found ${data.results.length} products from cache (${data.totalProducts} total products available)`)
          setSearchResults(data.results)
        } else {
          console.log('❌ No results found')
          setSearchResults([])
        }
      } catch (error) {
        console.error('Search error:', error)
        setSearchResults([])
      } finally {
        setIsSearching(false)
      }
    }
    
    searchProducts()
  }, [debouncedSearchTerm])

  // Search stores based on debounced search term
  useEffect(() => {
    const searchStores = () => {
      if (!debouncedStoreSearchTerm || debouncedStoreSearchTerm.length < 2) {
        setStoreSearchResults([])
        return
      }
      
      setIsSearchingStores(true)
      try {
        console.log(`🏪 Searching stores for "${debouncedStoreSearchTerm}"`)
        
        // Filter stores based on search term
        const filtered = stores.filter(store => {
          const storeName = (store.name || store.Name || '').toLowerCase()
          const searchTerm = debouncedStoreSearchTerm.toLowerCase()
          return storeName.includes(searchTerm)
        })
        
        console.log(`✅ Found ${filtered.length} stores matching "${debouncedStoreSearchTerm}"`)
        setStoreSearchResults(filtered)
      } catch (error) {
        console.error('Store search error:', error)
        setStoreSearchResults([])
      } finally {
        setIsSearchingStores(false)
      }
    }
    
    searchStores()
  }, [debouncedStoreSearchTerm, stores])
  
  // Use search results instead of filtering local data
  const filteredProducts = searchResults
  const filteredStores = storeSearchResults


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
        setMessage('✓ Product added successfully! Search the product to verify it was added.')
        // Reset form
        setSelectedProduct('')
        setProductSearchTerm('')
        setDebouncedSearchTerm('')
        setSelectedStore('')
        setStoreSearchTerm('')
        setDebouncedStoreSearchTerm('')
        setSelectedCompany(companies[0].name)
        setPrice('')
        setQuantity('')
        setShowProductDropdown(false)
        setShowStoreDropdown(false)
        setSearchResults([])
        setStoreSearchResults([])
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
        <p className="text-gray-600">Manage product inventory across stores for multiple companies</p>
      </div>

      {/* Helpful banner */}
      <div className="mb-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-start">
          <div className="flex-shrink-0">
            <Package className="h-5 w-5 text-blue-600 mt-0.5" />
          </div>
          <div className="ml-3 flex-1">
            <h3 className="text-sm font-medium text-blue-800">Backend-Cached Product Search</h3>
            <div className="mt-2 text-sm text-blue-700">
              <p>All products and stores are loaded automatically!</p>
              <p className="mt-1 text-xs">✓ ALL Bevvi products cached in backend (50,000+)</p>
              <p className="mt-1 text-xs">✓ Instant search results from server memory (&lt; 10ms)</p>
              <p className="mt-1 text-xs">✓ Stores loaded from API automatically</p>
              <p className="mt-1 text-xs">✓ Type 3+ characters to search products</p>
            </div>
          </div>
        </div>
      </div>

      {/* API Data Status Section */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        {/* Products Status */}
        <div className="bg-white p-6 rounded-lg shadow-md border">
          <div className="flex items-center mb-4">
            <Package className="w-6 h-6 text-blue-600 mr-3" />
            <h3 className="text-lg font-semibold">Products</h3>
          </div>
          {productCacheStatus ? (
            <>
              <p className="text-sm text-green-600 mt-2">✓ {productCacheStatus.totalProducts.toLocaleString()} products cached</p>
              <p className="text-xs text-gray-400 mt-1">All Bevvi products loaded in backend</p>
              {productCacheStatus.lastUpdated && (
                <p className="text-xs text-gray-500 mt-1">
                  Last updated: {new Date(productCacheStatus.lastUpdated).toLocaleTimeString()}
                </p>
              )}
              {searchResults.length > 0 && (
                <p className="text-xs text-blue-600 mt-1">{searchResults.length} results found</p>
              )}
            </>
          ) : (
            <div className="flex items-center text-sm text-blue-600 mt-2">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mr-2"></div>
              Checking cache status...
            </div>
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
            <h3 className="text-lg font-semibold">Companies</h3>
          </div>
          <p className="text-sm text-gray-500 mt-2">Available Companies</p>
          <div className="mt-2 space-y-1">
            {companies.map((company, index) => (
              <p key={index} className="text-sm text-green-600 font-semibold">✓ {company.name}</p>
            ))}
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="mb-8 flex justify-center gap-4">
        <button
          onClick={async () => {
            setIsLoadingData(true)
            try {
              // Refresh stores from API
              await loadStores()
              // Refresh product cache status
              const statusResponse = await apiFetch('/api/products/status')
              if (!statusResponse.ok) {
                throw new Error(`Failed to fetch product status: ${statusResponse.status}`)
              }
              
              // Check if response is JSON before parsing
              const contentType = statusResponse.headers.get('content-type')
              if (!contentType || !contentType.includes('application/json')) {
                const text = await statusResponse.text()
                console.error('❌ Expected JSON but got:', text.substring(0, 200))
                throw new Error('Server returned non-JSON response for product status. Check if API endpoint exists.')
              }
              
              const statusData = await statusResponse.json()
              setProductCacheStatus(statusData)
              setMessage('✅ Stores and product cache refreshed from API')
            } catch (error) {
              console.error('Error refreshing data:', error)
              setMessage(`Error refreshing data: ${error.message}`)
            } finally {
              setIsLoadingData(false)
            }
          }}
          disabled={isLoadingData}
          className="flex items-center px-6 py-3 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoadingData ? (
            <>
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2"></div>
              {stores.length > 0 ? 'Refreshing...' : 'Loading...'}
            </>
          ) : (
            <>
              <RefreshCw className="w-5 h-5 mr-2" />
              {stores.length > 0 ? 'Refresh Stores' : 'Load Stores'}
            </>
          )}
        </button>
        
        <button
          onClick={async () => {
            try {
              const response = await apiFetch('/api/products/refresh', { method: 'POST' })
              if (!response.ok) {
                throw new Error(`Failed to refresh products: ${response.status}`)
              }
              
              // Check if response is JSON before parsing
              const contentType = response.headers.get('content-type')
              if (!contentType || !contentType.includes('application/json')) {
                const text = await response.text()
                console.error('❌ Expected JSON but got:', text.substring(0, 200))
                throw new Error('Server returned non-JSON response. Check if API endpoint exists.')
              }
              
              const data = await response.json()
              if (data.success) {
                setProductCacheStatus({
                  totalProducts: data.totalProducts,
                  lastUpdated: data.timestamp
                })
                setMessage(`✅ Product cache refreshed: ${data.totalProducts.toLocaleString()} products`)
              } else {
                setMessage(`Error: ${data.message}`)
              }
            } catch (error) {
              console.error('Error refreshing products:', error)
              setMessage(`Error refreshing products: ${error.message}`)
            }
          }}
          className="flex items-center px-6 py-3 bg-green-600 text-white font-medium rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2"
        >
          <RefreshCw className="w-5 h-5 mr-2" />
          Refresh Product Cache
        </button>
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
                <p>Your product mapping is saved and ready to use.</p>
                <p className="mt-2"><strong>💡 Backend Product Cache:</strong></p>
                <ul className="list-disc list-inside mt-1 text-xs space-y-1">
                  <li>All Bevvi products cached in backend for fast searching</li>
                  <li>Search across the entire product catalog (all companies)</li>
                  <li>Cache refreshes automatically every hour</li>
                  <li>Instant search results from server memory</li>
                </ul>
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
            <div ref={storeSearchRef} className="relative">
              <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center justify-between">
                <span>Store *</span>
              </label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none z-10" />
                <input
                  type="text"
                  value={storeSearchTerm}
                  placeholder="Type at least 2 characters to search stores..."
                  onChange={(e) => {
                    setStoreSearchTerm(e.target.value)
                    setShowStoreDropdown(true)
                  }}
                  onFocus={() => {
                    if (storeSearchTerm.length >= 2) {
                      setShowStoreDropdown(true)
                    }
                  }}
                  className="pl-10 w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  autoComplete="off"
                />
                {(isSearchingStores || (debouncedStoreSearchTerm !== storeSearchTerm && storeSearchTerm.length >= 2)) && (
                  <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                  </div>
                )}
              </div>
              
              {/* Store dropdown results */}
              {showStoreDropdown && storeSearchTerm.length >= 2 && (
                <div className="absolute z-50 mt-1 w-full max-h-64 overflow-y-auto border border-gray-200 rounded-md bg-white shadow-lg">
                  {isSearchingStores ? (
                    <div className="px-3 py-4 text-gray-400 text-sm text-center flex items-center justify-center">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mr-2"></div>
                      Searching stores...
                    </div>
                  ) : filteredStores.length > 0 ? (
                    <>
                      {filteredStores.map((store, index) => (
                        <div
                          key={index}
                          onClick={() => {
                            const storeName = store.name || store.Name
                            setSelectedStore(storeName)
                            setStoreSearchTerm(storeName)
                            setDebouncedStoreSearchTerm(storeName)
                            setShowStoreDropdown(false)
                          }}
                          className="px-3 py-2 hover:bg-blue-50 cursor-pointer border-b border-gray-100 last:border-b-0 transition-colors"
                        >
                          <div className="font-medium text-gray-900">{store.name || store.Name}</div>
                        </div>
                      ))}
                    </>
                  ) : (
                    <div className="px-3 py-4 text-gray-500 text-sm text-center">
                      No stores found matching "{storeSearchTerm}"
                    </div>
                  )}
                </div>
              )}
              
              {storeSearchTerm.length > 0 && storeSearchTerm.length < 2 && (
                <p className="text-xs text-gray-500 mt-1">Type at least 2 characters to search</p>
              )}
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
                  <option key={index} value={company.name}>
                    {company.name}
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
