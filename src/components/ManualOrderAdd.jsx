import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Trash2, Loader2, ShoppingCart, CheckCircle, AlertCircle, Search, MapPin, ExternalLink, Copy, Mail, RefreshCw } from 'lucide-react'
import { apiFetch } from '../utils/api'
import { formatDollarAmount } from '../utils/formatCurrency'
import { buildPaymentEmailMailto } from '../utils/paymentLink'
import PageHeader from './ui/PageHeader'
import { TAB_COPY } from '../constants/brand'

const emptyLineItem = () => ({ query: '', name: '', size: '', quantity: '1', price: '' })

const formatProductSize = (product) => {
  if (product.size == null || product.size === '') return (product.units || '').trim()
  return `${product.size} ${product.units || ''}`.trim()
}

const productFullLabel = (product) => String(product.name || '').trim()

const productBaseName = (product) =>
  String(product.name || '').replace(/\s*-\s*\d+(?:\.\d+)?(?:\s*(?:ML|L|OZ|CL|G|LB|PK|PACK|LT|LITER|LITRE))?\s*$/i, '').trim()

function parseQueryToNameAndSize(query) {
  const trimmed = String(query || '').trim()
  if (!trimmed) return { name: '', size: '' }

  const dashMatch = trimmed.match(/^(.+?)\s*-\s*(\d+(?:\.\d+)?)\s*(ML|L|OZ|CL|G|LB|PK|PACK|LT|LITER|LITRE)?\s*$/i)
  if (dashMatch) {
    return {
      name: dashMatch[1].trim(),
      size: `${dashMatch[2]} ${(dashMatch[3] || 'ML').toUpperCase()}`.trim()
    }
  }

  const tailMatch = trimmed.match(/^(.+?)\s+(\d+(?:\.\d+)?)\s*(ML|L|OZ|CL|G|LB|PK|PACK|LT|LITER|LITRE)?\s*$/i)
  if (tailMatch) {
    return {
      name: tailMatch[1].trim(),
      size: `${tailMatch[2]} ${(tailMatch[3] || 'ML').toUpperCase()}`.trim()
    }
  }

  return { name: trimmed, size: '' }
}

function rankProductsForQuery(products, query) {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return []

  const tokens = q.split(/\s+/).filter(Boolean)

  return products
    .map(product => {
      const fullName = productFullLabel(product).toLowerCase()
      const sizeLabel = formatProductSize(product).toLowerCase()
      let score = 0

      if (fullName === q) score += 200
      if (fullName.includes(q)) score += 80

      for (const token of tokens) {
        if (fullName.includes(token)) score += 20
        if (sizeLabel.includes(token)) score += 35
        if (/^\d+(?:\.\d+)?$/.test(token) && sizeLabel.startsWith(token)) score += 40
      }

      const parsed = parseQueryToNameAndSize(query)
      if (parsed.name && productBaseName(product).toLowerCase().includes(parsed.name.toLowerCase())) {
        score += 30
      }
      if (parsed.size && sizeLabel.includes(parsed.size.toLowerCase())) {
        score += 40
      }

      return { product, score }
    })
    .filter(entry => entry.score >= 40)
    .sort((a, b) => b.score - a.score)
}

function ProductLineRow({ index, item, validation, onChange, onChangeFields, onRemove, canRemove, onSelectProduct }) {
  const [rankedResults, setRankedResults] = useState([])
  const [isSearching, setIsSearching] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const [liveMatch, setLiveMatch] = useState(null)
  const searchTimeoutRef = useRef(null)
  const lastAutoMatchRef = useRef('')
  const containerRef = useRef(null)

  const isLocked = Boolean(item.name && item.size)

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)

    const term = item.query.trim()
    if (term.length < 3) {
      setRankedResults([])
      setLiveMatch(null)
      lastAutoMatchRef.current = ''
      return undefined
    }

    searchTimeoutRef.current = setTimeout(async () => {
      setIsSearching(true)
      try {
        const response = await apiFetch(`/api/products/search?q=${encodeURIComponent(term)}`)
        if (!response.ok) throw new Error('Search failed')
        const data = await response.json()
        const results = data.success && Array.isArray(data.results) ? data.results : []
        const ranked = rankProductsForQuery(results, term)
        setRankedResults(ranked)

        if (isLocked && item.query) {
          setLiveMatch({ matched: true, matchedName: item.query })
          return
        }

        if (ranked.length === 1 && ranked[0].score >= 100) {
          const product = ranked[0].product
          const matchName = productFullLabel(product)
          const autoKey = `${term}::${matchName}`
          if (lastAutoMatchRef.current !== autoKey) {
            lastAutoMatchRef.current = autoKey
            setLiveMatch({ matched: true, matchedName: matchName })
            onSelectProduct(product, matchName, { silent: true })
          }
          return
        }
      } catch {
        setRankedResults([])
        setLiveMatch(null)
      } finally {
        setIsSearching(false)
      }
    }, 200)

    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.query, isLocked])

  const inputClass =
    'mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-bevvi-primary-500 focus:outline-none focus:ring-1 focus:ring-bevvi-primary-500'
  const labelClass = 'block text-sm font-medium text-gray-700'

  const matchInfo = validation || liveMatch

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium text-gray-700">Product {index + 1}</span>
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="text-red-600 hover:text-red-800"
            aria-label={`Remove product ${index + 1}`}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="sm:col-span-2 relative" ref={containerRef}>
          <label className={labelClass}>Product</label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={item.query}
              onChange={(e) => {
                onChangeFields({ query: e.target.value, name: '', size: '' })
                lastAutoMatchRef.current = ''
                setLiveMatch(null)
                setShowDropdown(true)
              }}
              onFocus={() => setShowDropdown(true)}
              placeholder="Type name and size, e.g. Lafite 750 ML"
              className={`${inputClass} pl-9 ${matchInfo?.matched ? 'border-green-400 ring-1 ring-green-300' : ''}`}
              required
              autoComplete="off"
            />
          </div>
          {showDropdown && item.query.trim().length >= 3 && (
            <div className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border border-gray-200 bg-white shadow-lg">
              {isSearching && (
                <div className="px-3 py-2 text-sm text-gray-500">Searching master list…</div>
              )}
              {!isSearching && rankedResults.length === 0 && (
                <div className="px-3 py-2 text-sm text-gray-500">No matching products</div>
              )}
              {!isSearching && rankedResults.map(({ product, score }, i) => (
                <button
                  key={`${product.upc || product.name}-${i}`}
                  type="button"
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-bevvi-primary-50"
                  onClick={() => {
                    onSelectProduct(product, productFullLabel(product))
                    setShowDropdown(false)
                    setLiveMatch({ matched: true, matchedName: productFullLabel(product) })
                  }}
                >
                  <div className="font-medium text-gray-900">{productFullLabel(product)}</div>
                  <div className="text-xs text-gray-500">
                    {formatProductSize(product)}
                    {i === 0 && score >= 100 ? ' · best match' : ''}
                  </div>
                </button>
              ))}
            </div>
          )}
          <p className="mt-1 text-xs text-gray-500">
            Results update as you type. Include size in your search (e.g. &quot;Whispering Angel 750&quot;).
          </p>
        </div>
        <div>
          <label className={labelClass}>Quantity</label>
          <input
            type="number"
            min="1"
            step="1"
            value={item.quantity}
            onChange={(e) => onChange('quantity', e.target.value)}
            className={inputClass}
            required
          />
        </div>
        <div>
          <label className={labelClass}>Price</label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={item.price}
            onChange={(e) => onChange('price', e.target.value)}
            className={inputClass}
            required
          />
        </div>
      </div>
      {matchInfo && (
        <div className={`mt-2 flex items-start gap-2 text-sm ${matchInfo.matched ? 'text-green-700' : 'text-red-700'}`}>
          {matchInfo.matched ? (
            <CheckCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          ) : (
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          )}
          <div>
            <span>
              {matchInfo.matched
                ? `Matched: ${matchInfo.matchedName || item.query}`
                : 'No match yet — keep typing or pick from the list'}
            </span>
            {!matchInfo.matched && matchInfo.suggestions?.length > 0 && (
              <ul className="mt-2 space-y-1 text-xs text-gray-700">
                <li className="font-medium">Did you mean:</li>
                {matchInfo.suggestions.map((s, i) => (
                  <li key={i}>{s.fullName}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function AddressLookupField({ value, onChange, onResolved, onClear, inputClass, labelClass }) {
  const [predictions, setPredictions] = useState([])
  const [isSearching, setIsSearching] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const [resolvedLabel, setResolvedLabel] = useState('')
  const [lookupError, setLookupError] = useState(null)
  const [googleEnabled, setGoogleEnabled] = useState(null)
  const searchTimeoutRef = useRef(null)
  const containerRef = useRef(null)

  useEffect(() => {
    apiFetch('/api/address/config')
      .then(res => res.json())
      .then(data => setGoogleEnabled(!!data.enabled))
      .catch(() => setGoogleEnabled(false))
  }, [])

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    const term = value.trim()
    if (term.length < 3) {
      setPredictions([])
      return undefined
    }
    if (googleEnabled === false) {
      return undefined
    }

    searchTimeoutRef.current = setTimeout(async () => {
      setIsSearching(true)
      setShowDropdown(true)
      setLookupError(null)
      try {
        const response = await apiFetch(`/api/address/autocomplete?input=${encodeURIComponent(term)}`)
        const data = await response.json()
        if (response.status === 503) {
          setGoogleEnabled(false)
          setLookupError(data.message || data.error || 'Google Maps API key not configured on server')
          setPredictions([])
          return
        }
        if (!response.ok) {
          setLookupError(data.message || data.error || 'Address lookup unavailable')
          setPredictions([])
          return
        }
        setGoogleEnabled(true)
        setPredictions(data.predictions || [])
      } catch {
        setLookupError('Address lookup failed — is the backend running?')
        setPredictions([])
      } finally {
        setIsSearching(false)
      }
    }, 200)

    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    }
  }, [value, googleEnabled])

  const applyResolvedAddress = (parsed) => {
    if (parsed.formattedAddress) onChange(parsed.formattedAddress)
    onResolved(parsed)
    setResolvedLabel(parsed.formattedAddress || value)
    setLookupError(null)
    setShowDropdown(false)
  }

  const handleSelectPrediction = async (prediction) => {
    setIsSearching(true)
    setLookupError(null)
    try {
      const response = await apiFetch(`/api/address/details?placeId=${encodeURIComponent(prediction.placeId)}`)
      const data = await response.json()
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Could not resolve address')
      }
      applyResolvedAddress(data)
    } catch (e) {
      setLookupError(e.message || 'Could not resolve address')
      onClear()
    } finally {
      setIsSearching(false)
    }
  }

  const handleGeocodeCurrent = async () => {
    const term = value.trim()
    if (!term) return
    setIsSearching(true)
    setLookupError(null)
    try {
      const response = await apiFetch(`/api/address/geocode?address=${encodeURIComponent(term)}`)
      const data = await response.json()
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Address not found')
      }
      applyResolvedAddress(data)
    } catch (e) {
      setLookupError(e.message || 'Address not found')
      onClear()
    } finally {
      setIsSearching(false)
    }
  }

  return (
    <div className="sm:col-span-2 relative" ref={containerRef}>
      <label htmlFor="customerAddress" className={labelClass}>Delivery address</label>
      <div className="relative">
        <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          id="customerAddress"
          type="text"
          value={value}
          onChange={(e) => {
            onChange(e.target.value)
            onClear()
            setResolvedLabel('')
            setLookupError(null)
            setShowDropdown(true)
          }}
          onFocus={() => setShowDropdown(true)}
          onBlur={() => {
            window.setTimeout(() => {
              if (googleEnabled && value.trim().length >= 5 && !resolvedLabel) {
                handleGeocodeCurrent()
              }
            }, 200)
          }}
          placeholder="Start typing an address, e.g. 1 E Wacker Dr, Chicago IL"
          className={`${inputClass} pl-9`}
          required
          autoComplete="off"
        />
      </div>
      {googleEnabled === false && (
        <p className="mt-1 text-xs text-amber-700">
          Google address lookup is not configured. Add GOOGLE_MAPS_API_KEY to the server .env file.
        </p>
      )}
      {showDropdown && value.trim().length >= 3 && (
        <div className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border border-gray-200 bg-white shadow-lg">
          {isSearching && (
            <div className="px-3 py-2 text-sm text-gray-500">Searching Google for addresses…</div>
          )}
          {!isSearching && lookupError && (
            <div className="px-3 py-2 text-sm text-red-700">{lookupError}</div>
          )}
          {!isSearching && !lookupError && predictions.length === 0 && (
            <div className="px-3 py-2 text-sm text-gray-500">No address suggestions — keep typing</div>
          )}
          {!isSearching && predictions.map((prediction) => (
            <button
              key={prediction.placeId}
              type="button"
              className="block w-full px-3 py-2 text-left text-sm hover:bg-bevvi-primary-50"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleSelectPrediction(prediction)}
            >
              {prediction.description}
            </button>
          ))}
        </div>
      )}
      {resolvedLabel && (
        <p className="mt-2 flex items-start gap-2 text-sm text-green-700">
          <CheckCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>{resolvedLabel}</span>
        </p>
      )}
      {lookupError && !showDropdown && (
        <p className="mt-2 text-sm text-red-700">{lookupError}</p>
      )}
      <p className="mt-1 text-xs text-gray-500">
        Start typing a US street address — Google suggestions appear as you type.
      </p>
    </div>
  )
}

const todayInputValue = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const ManualOrderAdd = () => {
  const [lineItems, setLineItems] = useState([emptyLineItem()])
  const [stores, setStores] = useState([])
  const [storeName, setStoreName] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [email, setEmail] = useState('')
  const [addressInput, setAddressInput] = useState('')
  const [streetAddress, setStreetAddress] = useState('')
  const [city, setCity] = useState('')
  const [state, setState] = useState('')
  const [zip, setZip] = useState('')
  const [orderDate, setOrderDate] = useState(todayInputValue())
  const [delivery, setDelivery] = useState('0')
  const [discount, setDiscount] = useState('0')
  const [engraving, setEngraving] = useState('0')
  const [salesTax, setSalesTax] = useState('0')
  const [service, setService] = useState('0')
  const [serviceChargeTax, setServiceChargeTax] = useState('0')
  const [shipping, setShipping] = useState('0')
  const [tip, setTip] = useState('0')
  const [loadingStores, setLoadingStores] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [validationResults, setValidationResults] = useState(null)
  const [message, setMessage] = useState(null)
  const [submitResponse, setSubmitResponse] = useState(null)
  const [error, setError] = useState(null)
  const [paymentLinkCopied, setPaymentLinkCopied] = useState(false)
  const [showPaymentLinkPrompt, setShowPaymentLinkPrompt] = useState(false)
  const [creatingPaymentLink, setCreatingPaymentLink] = useState(false)
  const [paymentLinkError, setPaymentLinkError] = useState(null)

  const loadStores = useCallback(async () => {
    setLoadingStores(true)
    try {
      const response = await apiFetch('/api/stores')
      if (!response.ok) throw new Error(`Failed to load retailers (${response.status})`)
      const data = await response.json()
      const list = Array.isArray(data?.results)
        ? data.results
        : Array.isArray(data?.stores)
          ? data.stores
          : Array.isArray(data)
            ? data
            : []
      setStores(list)
    } catch (e) {
      setError({ message: e.message || 'Failed to load retailers' })
    } finally {
      setLoadingStores(false)
    }
  }, [])

  useEffect(() => {
    loadStores()
  }, [loadStores])

  const lineSubtotals = useMemo(() => {
    return lineItems.map((item, index) => {
      const qty = parseFloat(item.quantity) || 0
      const price = parseFloat(item.price) || 0
      const label = item.query?.trim() || `Product ${index + 1}`
      return { index, label, qty, price, total: qty * price }
    })
  }, [lineItems])

  const subTotal = useMemo(() => {
    return lineSubtotals.reduce((sum, line) => sum + line.total, 0)
  }, [lineSubtotals])

  useEffect(() => {
    const charge = Math.round(subTotal * 0.1 * 100) / 100
    setService(charge === 0 ? '0' : charge.toFixed(2))
  }, [subTotal])

  const estimatedTotal = useMemo(() => {
    const add = (v) => parseFloat(v) || 0
    return (
      subTotal +
      add(delivery) +
      add(salesTax) +
      add(service) +
      add(serviceChargeTax) +
      add(shipping) +
      add(tip) +
      add(engraving) -
      add(discount)
    )
  }, [subTotal, delivery, discount, engraving, salesTax, service, serviceChargeTax, shipping, tip])

  const updateLineItem = (index, field, value) => {
    setLineItems(prev => prev.map((item, i) => (i === index ? { ...item, [field]: value } : item)))
    setValidationResults(null)
  }

  const addLineItem = () => {
    setLineItems(prev => [...prev, emptyLineItem()])
    setValidationResults(null)
  }

  const removeLineItem = (index) => {
    setLineItems(prev => (prev.length === 1 ? prev : prev.filter((_, i) => i !== index)))
    setValidationResults(null)
  }

  const selectProductForLine = useCallback((index, product, displayName, options = {}) => {
    setLineItems(prev => prev.map((item, i) => (
      i === index
        ? {
            ...item,
            query: displayName || productFullLabel(product),
            name: productBaseName(product),
            size: formatProductSize(product)
          }
        : item
    )))
    if (!options.silent) {
      setValidationResults(null)
    }
  }, [])

  const updateLineItemFields = useCallback((index, fields) => {
    setLineItems(prev => prev.map((item, i) => (i === index ? { ...item, ...fields } : item)))
    setValidationResults(null)
  }, [])

  const resolveLineItemForApi = (item) => {
    if (item.name && item.size) {
      return { name: item.name.trim(), size: item.size.trim() }
    }
    return parseQueryToNameAndSize(item.query)
  }

  const resolveAddressBeforeSubmit = async () => {
    if (streetAddress && city && state && zip) {
      return { streetAddress, city, state, zip }
    }
    const term = addressInput.trim()
    if (!term) {
      throw new Error('Enter a delivery address and select a suggestion from Google.')
    }
    const response = await apiFetch(`/api/address/geocode?address=${encodeURIComponent(term)}`)
    const data = await response.json()
    if (!response.ok || !data.success) {
      throw new Error(data.error || 'Could not verify the delivery address. Pick a Google suggestion.')
    }
    setAddressInput(data.formattedAddress || term)
    setStreetAddress(data.streetAddress || '')
    setCity(data.city || '')
    setState(data.state || '')
    setZip(data.zip || '')
    return {
      streetAddress: data.streetAddress || '',
      city: data.city || '',
      state: data.state || '',
      zip: data.zip || ''
    }
  }

  const buildPayload = (addressOverride = null) => ({
    products: lineItems.map(item => {
      const { name, size } = resolveLineItemForApi(item)
      return {
        name,
        size,
        quantity: parseInt(item.quantity, 10),
        price: parseFloat(item.price)
      }
    }),
    storeName,
    companyName,
    customerName,
    email,
    streetAddress: addressOverride?.streetAddress ?? streetAddress,
    city: addressOverride?.city ?? city,
    state: addressOverride?.state ?? state,
    zip: addressOverride?.zip ?? zip,
    orderDate,
    delivery,
    discount,
    engraving,
    salesTax,
    service,
    serviceChargeTax,
    shipping,
    tip
  })

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    setMessage(null)
    setSubmitResponse(null)
    setPaymentLinkCopied(false)
    setShowPaymentLinkPrompt(false)
    setPaymentLinkError(null)
    setSubmitting(true)
    try {
      const resolvedAddress = await resolveAddressBeforeSubmit()
      const response = await apiFetch('/api/manual-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload(resolvedAddress))
      })
      const data = await response.json()
      if (!response.ok || !data.success) {
        setError({
          message: data.error || data.message || 'Failed to submit order',
          details: data.productErrors || data.details || null
        })
        if (data.productErrors) {
          setValidationResults(
            lineItems.map((item, index) => {
              const err = data.productErrors.find(p => p.index === index)
              return {
                index,
                name: item.query,
                matched: !err,
                matchedName: err ? null : item.query
              }
            })
          )
        }
        return
      }
      setSubmitResponse(data)
      setShowPaymentLinkPrompt(true)
      setMessage('Manual order submitted successfully.')
    } catch (e) {
      setError({ message: e.message || 'Network error' })
    } finally {
      setSubmitting(false)
    }
  }

  const buildPaymentLinkPayload = (regenerate = false) => ({
    orderNumber: submitResponse.orderNumber,
    email: submitResponse.payload?.email || email,
    customerName,
    storeName: submitResponse.payload?.storeName || storeName,
    totalAmount: submitResponse.orderTotal ?? estimatedTotal,
    matchedProducts: submitResponse.matchedProducts || [],
    streetAddress: submitResponse.payload?.streetAddress || streetAddress,
    city: submitResponse.payload?.city || city,
    state: submitResponse.payload?.state || state,
    zip: submitResponse.payload?.zip || zip,
    salesTax: submitResponse.payload?.salesTax ?? salesTax,
    delivery: submitResponse.payload?.delivery ?? delivery,
    shipping: submitResponse.payload?.shipping ?? shipping,
    service: submitResponse.payload?.service ?? service,
    serviceChargeTax: submitResponse.payload?.serviceChargeTax ?? serviceChargeTax,
    giftNoteCharge: submitResponse.payload?.engraving ?? engraving,
    engraving: submitResponse.payload?.engraving ?? engraving,
    tip: submitResponse.payload?.tip ?? tip,
    discount: submitResponse.payload?.discount ?? discount,
    country: 'US',
    regenerate
  })

  const handleCreatePaymentLink = async ({ regenerate = false } = {}) => {
    if (!submitResponse) return
    if (
      regenerate &&
      !window.confirm(
        'Create a new payment link using the current order details? The previous Stripe invoice/link will be voided or removed.'
      )
    ) {
      return
    }
    setPaymentLinkError(null)
    setCreatingPaymentLink(true)
    try {
      const response = await apiFetch('/api/manual-order/payment-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPaymentLinkPayload(regenerate))
      })
      const data = await response.json()
      if (!response.ok || !data.success) {
        setPaymentLinkError(
          response.status === 409
            ? data.error || 'The previous invoice has already been paid and cannot be regenerated.'
            : data.message || data.error || 'Failed to create payment link'
        )
        return
      }
      if (data.paymentLink?.skipped) {
        setPaymentLinkError(data.paymentLink.reason || 'Payment link was not created')
        setShowPaymentLinkPrompt(false)
        return
      }
      if (!data.paymentLink?.url) {
        setPaymentLinkError('Payment link was not returned by the server')
        return
      }
      setSubmitResponse((prev) => ({ ...prev, paymentLink: data.paymentLink }))
      setShowPaymentLinkPrompt(false)
      setMessage('Payment link created. Email it to the customer or copy the link below.')
    } catch (e) {
      setPaymentLinkError(e.message || 'Network error')
    } finally {
      setCreatingPaymentLink(false)
    }
  }

  const inputClass = 'input-field mt-1 text-sm'
  const labelClass = 'bevvi-label !mb-1'

  return (
    <div className="bevvi-page-panel">
      <div className="max-w-4xl">
        <PageHeader
          icon={ShoppingCart}
          title={TAB_COPY['manual-order'].title}
          description="Search curated products, build the order, and email a seamless Stripe payment link to your customer."
        />

        <form onSubmit={handleSubmit} className="space-y-8">
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-gray-900">Products</h3>
              <button
                type="button"
                onClick={addLineItem}
                className="inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                <Plus className="mr-1 h-4 w-4" />
                Add product
              </button>
            </div>

            {lineItems.map((item, index) => (
              <ProductLineRow
                key={index}
                index={index}
                item={item}
                validation={validationResults?.find(r => r.index === index)}
                onChange={(field, value) => updateLineItem(index, field, value)}
                onChangeFields={(fields) => updateLineItemFields(index, fields)}
                onRemove={() => removeLineItem(index)}
                canRemove={lineItems.length > 1}
                onSelectProduct={(product, displayName, options) =>
                  selectProductForLine(index, product, displayName, options)
                }
              />
            ))}

            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <h4 className="text-sm font-semibold text-gray-900">Subtotal</h4>
              <ul className="mt-3 space-y-2">
                {lineSubtotals.map((line) => (
                  <li
                    key={line.index}
                    className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm text-gray-700"
                  >
                    <span className="min-w-0 truncate">{line.label}</span>
                    <span className="flex-shrink-0 tabular-nums text-gray-600">
                      {line.qty > 0 && line.price > 0 ? (
                        <>
                          {line.qty} × {formatDollarAmount(line.price)} ={' '}
                          <strong className="text-gray-900">{formatDollarAmount(line.total)}</strong>
                        </>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex items-center justify-between border-t border-gray-200 pt-3 text-sm font-semibold text-gray-900">
                <span>Products subtotal</span>
                <span className="tabular-nums">{formatDollarAmount(subTotal)}</span>
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <h3 className="text-base font-semibold text-gray-900">Retailer</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="storeName" className={labelClass}>Retailer name</label>
                <select
                  id="storeName"
                  value={storeName}
                  onChange={(e) => setStoreName(e.target.value)}
                  className={inputClass}
                  required
                  disabled={loadingStores}
                >
                  <option value="">
                    {loadingStores ? 'Loading retailers…' : 'Select a retailer'}
                  </option>
                  {stores.map((store, i) => {
                    const name = store.name || store.Name || store.storeName || ''
                    return (
                      <option key={`${name}-${i}`} value={name}>
                        {name}
                      </option>
                    )
                  })}
                </select>
                {stores.length === 0 && !loadingStores && (
                  <button
                    type="button"
                    onClick={loadStores}
                    className="mt-2 text-sm text-bevvi-primary-600 hover:underline"
                  >
                    Reload retailers
                  </button>
                )}
              </div>
              <div>
                <label htmlFor="companyName" className={labelClass}>Company name</label>
                <input
                  id="companyName"
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="Air Culinaire - CHI"
                  className={inputClass}
                />
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <h3 className="text-base font-semibold text-gray-900">Customer</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="customerName" className={labelClass}>Customer name</label>
                <input
                  id="customerName"
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Juan Gutierrez"
                  className={inputClass}
                  required
                />
              </div>
              <div>
                <label htmlFor="email" className={labelClass}>Customer email</label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={inputClass}
                  required
                />
              </div>
              <AddressLookupField
                value={addressInput}
                onChange={setAddressInput}
                inputClass={inputClass}
                labelClass={labelClass}
                onResolved={(parsed) => {
                  setStreetAddress(parsed.streetAddress || '')
                  setCity(parsed.city || '')
                  setState(parsed.state || '')
                  setZip(parsed.zip || '')
                }}
                onClear={() => {
                  setStreetAddress('')
                  setCity('')
                  setState('')
                  setZip('')
                }}
              />
            </div>
          </section>

          <section className="space-y-4">
            <h3 className="text-base font-semibold text-gray-900">Order details &amp; fees</h3>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              <div>
                <label htmlFor="orderDate" className={labelClass}>Order date</label>
                <input
                  id="orderDate"
                  type="date"
                  value={orderDate}
                  onChange={(e) => setOrderDate(e.target.value)}
                  className={inputClass}
                  required
                />
              </div>
              {[
                ['delivery', delivery, setDelivery, 'Delivery'],
                ['discount', discount, setDiscount, 'Discount'],
                ['engraving', engraving, setEngraving, 'Engraving'],
                ['salesTax', salesTax, setSalesTax, 'Sales tax'],
                ['service', service, setService, 'Service (10% of subtotal)'],
                ['serviceChargeTax', serviceChargeTax, setServiceChargeTax, 'Service charge tax'],
                ['shipping', shipping, setShipping, 'Shipping'],
                ['tip', tip, setTip, 'Tip']
              ].map(([id, value, setter, label]) => (
                <div key={id}>
                  <label htmlFor={id} className={labelClass}>
                    {label}
                  </label>
                  <input
                    id={id}
                    type="number"
                    min="0"
                    step="0.01"
                    value={value}
                    onChange={(e) => setter(e.target.value)}
                    className={inputClass}
                  />
                </div>
              ))}
            </div>
            <p className="text-sm text-gray-600">
              Estimated total: <strong>{formatDollarAmount(estimatedTotal)}</strong>
            </p>
          </section>

          {message && (
            <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
              {message}
            </div>
          )}

          {error && (
            <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              <p className="font-medium">{error.message}</p>
              {error.details && (
                <pre className="mt-2 overflow-auto text-xs">{JSON.stringify(error.details, null, 2)}</pre>
              )}
            </div>
          )}

          {showPaymentLinkPrompt && !submitResponse?.paymentLink?.url && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900">
              <p className="font-semibold">Create a Stripe payment link?</p>
              <p className="mt-1 text-amber-800">
                The order was submitted. Create a payment link for{' '}
                <strong>{formatDollarAmount(submitResponse?.orderTotal ?? estimatedTotal)}</strong>
                {submitResponse?.orderNumber ? (
                  <> (order <strong>{submitResponse.orderNumber}</strong>)</>
                ) : null}{' '}
                so you can email it to the customer.
              </p>
              {paymentLinkError && (
                <p className="mt-2 text-red-800" role="alert">{paymentLinkError}</p>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleCreatePaymentLink}
                  disabled={creatingPaymentLink}
                  className="inline-flex items-center justify-center rounded-md bg-amber-700 px-4 py-2 text-sm font-medium text-white hover:bg-amber-800 disabled:opacity-50"
                >
                  {creatingPaymentLink ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Creating link…
                    </>
                  ) : (
                    'Yes, create payment link'
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setShowPaymentLinkPrompt(false)}
                  disabled={creatingPaymentLink}
                  className="inline-flex items-center justify-center rounded-md border border-amber-300 bg-white px-4 py-2 text-sm font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
                >
                  No thanks
                </button>
              </div>
            </div>
          )}

          {submitResponse?.paymentLink?.url && (
            <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-4">
              <h4 className="text-sm font-semibold text-indigo-900">Payment link for customer</h4>
              <p className="mt-1 text-sm text-indigo-800">
                Email this link to the customer manually, or copy it into your own message. The link stays
                active until you deactivate it in Stripe.
              </p>
              {(submitResponse.paymentLink.orderNumber || submitResponse.paymentLink.totalAmount != null) && (
                <p className="mt-2 text-sm text-indigo-900">
                  {submitResponse.paymentLink.orderNumber && (
                    <span className="mr-4">Order: <strong>{submitResponse.paymentLink.orderNumber}</strong></span>
                  )}
                  {submitResponse.paymentLink.totalAmount != null && (
                    <span>Total: <strong>{formatDollarAmount(submitResponse.paymentLink.totalAmount)}</strong></span>
                  )}
                </p>
              )}
              <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                <a
                  href={buildPaymentEmailMailto({
                    customerEmail: submitResponse.paymentLink.customerEmail || email,
                    customerName,
                    orderNumber: submitResponse.paymentLink.orderNumber || submitResponse.orderNumber,
                    totalAmount: submitResponse.paymentLink.totalAmount,
                    paymentUrl: submitResponse.paymentLink.url
                  })}
                  className="inline-flex items-center justify-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
                >
                  <Mail className="mr-2 h-4 w-4" />
                  Email to customer
                </a>
                <a
                  href={submitResponse.paymentLink.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center rounded-md border border-indigo-300 bg-white px-4 py-2 text-sm font-medium text-indigo-800 hover:bg-indigo-100"
                >
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Preview payment page
                </a>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(submitResponse.paymentLink.url)
                      setPaymentLinkCopied(true)
                      setTimeout(() => setPaymentLinkCopied(false), 2000)
                    } catch {
                      setPaymentLinkCopied(false)
                    }
                  }}
                  className="inline-flex items-center justify-center rounded-md border border-indigo-300 bg-white px-4 py-2 text-sm font-medium text-indigo-800 hover:bg-indigo-100"
                >
                  <Copy className="mr-2 h-4 w-4" />
                  {paymentLinkCopied ? 'Copied!' : 'Copy link'}
                </button>
                <button
                  type="button"
                  onClick={() => handleCreatePaymentLink({ regenerate: true })}
                  disabled={creatingPaymentLink}
                  className="inline-flex items-center justify-center rounded-md border border-indigo-300 bg-white px-4 py-2 text-sm font-medium text-indigo-800 hover:bg-indigo-100 disabled:opacity-50"
                >
                  {creatingPaymentLink ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Regenerating…
                    </>
                  ) : (
                    <>
                      <RefreshCw className="mr-2 h-4 w-4" />
                      Regenerate link
                    </>
                  )}
                </button>
              </div>
              <p className="mt-3 break-all text-xs text-indigo-700">{submitResponse.paymentLink.url}</p>
            </div>
          )}

          {paymentLinkError && !showPaymentLinkPrompt && !submitResponse?.paymentLink?.url && (
            <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
              <p className="font-medium">Payment link not created</p>
              <p className="mt-1">{paymentLinkError}</p>
            </div>
          )}

          {submitResponse && (
            <div className="rounded-lg border border-slate-700 bg-slate-900 p-4">
              <h4 className="text-sm font-semibold text-emerald-100">API response</h4>
              <pre className="mt-2 overflow-auto text-xs text-emerald-100 font-mono max-h-64">
                {JSON.stringify(submitResponse.data, null, 2)}
              </pre>
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center rounded-md bg-bevvi-primary-600 px-6 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-bevvi-primary-700 focus:outline-none focus:ring-2 focus:ring-bevvi-primary-500 focus:ring-offset-2 disabled:opacity-50"
          >
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Submitting order…
              </>
            ) : (
              'Submit manual order'
            )}
          </button>
        </form>
      </div>
    </div>
  )
}

export default ManualOrderAdd
