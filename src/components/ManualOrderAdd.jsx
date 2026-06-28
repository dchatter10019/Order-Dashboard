import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Trash2, Loader2, ShoppingCart, CheckCircle, AlertCircle, Search, MapPin, ExternalLink, Copy, Mail, RefreshCw, Upload, FileText, ScanLine, Ban } from 'lucide-react'
import { apiFetch, parseApiJsonResponse } from '../utils/api'
import { formatDollarAmount } from '../utils/formatCurrency'
import { buildPaymentEmailMailto } from '../utils/paymentLink'
import PageHeader from './ui/PageHeader'
import { TAB_COPY } from '../constants/brand'

const emptyLineItem = () => ({ query: '', name: '', size: '', quantity: '1', price: '' })

const VALID_PRODUCT_SIZE_UNITS = /^(ML|L|OZ|CL|G|LB|PK|PACK|LT|LITER|LITRE)$/i
const PACK_SIZE_IN_NAME_PATTERN = /(\d+)\s*x\s*(\d+(?:\.\d+)?)\s*(OZ|ML|L|CL|G|LB)\b/i
const PACK_UNITS_PATTERN = /^x(\d+(?:\.\d+)?)\s*(OZ|ML|L|CL|G|LB)\b/i

function parsePackSizeFromProductName(name) {
  const match = String(name || '').match(PACK_SIZE_IN_NAME_PATTERN)
  if (!match) return ''
  return `${match[1]}x${match[2]} ${match[3].toUpperCase()}`
}

function isPackStyleProduct(product) {
  const units = String(product?.units || '').trim()
  const sizeNum = parseFloat(product?.size)
  if (!Number.isNaN(sizeNum) && sizeNum > 0 && PACK_UNITS_PATTERN.test(units)) {
    return true
  }
  return Boolean(parsePackSizeFromProductName(productFullLabel(product)))
}

function isValidProductSize(product) {
  if (isPackStyleProduct(product)) return true
  const units = String(product?.units || '').trim()
  const sizeNum = parseFloat(product?.size)
  return VALID_PRODUCT_SIZE_UNITS.test(units) && !Number.isNaN(sizeNum) && sizeNum > 0
}

const formatProductSize = (product) => {
  const packFromName = parsePackSizeFromProductName(productFullLabel(product))
  if (packFromName) return packFromName

  if (isPackStyleProduct(product)) {
    const units = String(product?.units || '').trim()
    const sizeNum = parseFloat(product?.size)
    const packMatch = units.match(PACK_UNITS_PATTERN)
    if (packMatch && !Number.isNaN(sizeNum) && sizeNum > 0) {
      return `${sizeNum}x${packMatch[1]} ${packMatch[2].toUpperCase()}`
    }
  }

  if (isValidProductSize(product)) {
    return `${product.size} ${product.units || ''}`.trim()
  }
  return parseQueryToNameAndSize(productFullLabel(product)).size
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

  const packMatch = trimmed.match(/^(.+?)\s+(\d+\s*x\s*\d+(?:\.\d+)?\s*(?:OZ|ML|L|CL|G|LB))\b/i)
  if (packMatch) {
    return {
      name: packMatch[1].trim(),
      size: packMatch[2].replace(/\s+/g, ' ').replace(/(\d+)\s*x\s*(\d+)/i, '$1x$2').trim()
    }
  }

  return { name: trimmed, size: '' }
}

function rankProductsForQuery(products, query) {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return []

  const tokens = q.split(/\s+/).filter(Boolean)

  return products
    .filter((product) => isValidProductSize(product) || parseQueryToNameAndSize(productFullLabel(product)).size)
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
        if (/^\d+x\d+$/i.test(token) && sizeLabel.replace(/\s+/g, '').includes(token.toLowerCase())) score += 50
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

        if (ranked.length === 1 && ranked[0].score >= 100 && formatProductSize(ranked[0].product)) {
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
    if (resolvedLabel && term === resolvedLabel.trim()) {
      setPredictions([])
      setShowDropdown(false)
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
  }, [value, googleEnabled, resolvedLabel])

  const applyResolvedAddress = (parsed) => {
    if (parsed.formattedAddress) onChange(parsed.formattedAddress)
    onResolved(parsed)
    setResolvedLabel(parsed.formattedAddress || value)
    setPredictions([])
    setLookupError(null)
    setShowDropdown(false)
  }

  const handleSelectPrediction = async (prediction) => {
    setShowDropdown(false)
    setPredictions([])
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
          onFocus={() => {
            if (!(resolvedLabel && value.trim() === resolvedLabel.trim())) {
              setShowDropdown(true)
            }
          }}
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

const getStoreName = (store) => store.name || store.Name || store.storeName || ''

function RetailerStripeAccountDisplay({ storeName }) {
  const [info, setInfo] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const name = String(storeName || '').trim()
    if (!name) {
      setInfo(null)
      setLoading(false)
      return undefined
    }

    let cancelled = false
    setLoading(true)
    apiFetch(`/api/manual-order/retailer-stripe-account?storeName=${encodeURIComponent(name)}`)
      .then((response) => parseApiJsonResponse(response))
      .then((data) => {
        if (!cancelled) setInfo(data)
      })
      .catch(() => {
        if (!cancelled) setInfo({ settlementType: 'error' })
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [storeName])

  if (!storeName) return null

  if (loading) {
    return (
      <p className="mt-2 flex items-center gap-2 text-xs text-gray-500">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        Looking up Stripe account…
      </p>
    )
  }

  if (!info || info.settlementType === 'error') {
    return (
      <p className="mt-2 text-xs text-red-700" role="alert">
        Could not load Stripe account for this retailer.
      </p>
    )
  }

  if (info.settlementType === 'bevvi_platform') {
    return (
      <div className="mt-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
        <span className="font-medium">Stripe account:</span>{' '}
        Bevvi platform — full payment stays on Bevvi (not Connect)
      </div>
    )
  }

  if (info.settlementType === 'connected_account' && info.stripeAccountId) {
    return (
      <div className="mt-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-900">
        <span className="font-medium">Stripe account:</span>{' '}
        <code className="font-mono">{info.stripeAccountId}</code>
        {info.businessName ? (
          <span className="text-green-800"> ({info.businessName})</span>
        ) : null}
      </div>
    )
  }

  return (
    <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
      <span className="font-medium">Stripe account:</span> Not configured for this retailer.
      Payment links will fail until a Connect account is mapped.
    </div>
  )
}

function RetailerCombobox({ stores, loading, value, onChange, onReload, inputClass, labelClass }) {
  const [query, setQuery] = useState(value || '')
  const [showDropdown, setShowDropdown] = useState(false)
  const containerRef = useRef(null)

  const storeNames = useMemo(() => {
    const names = stores.map(getStoreName).filter(Boolean)
    return [...new Set(names)].sort((a, b) => a.localeCompare(b))
  }, [stores])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q
      ? storeNames.filter((name) => name.toLowerCase().includes(q))
      : storeNames
    return list.slice(0, 100)
  }, [query, storeNames])

  useEffect(() => {
    setQuery(value || '')
  }, [value])

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const selectStore = (name) => {
    setQuery(name)
    onChange(name)
    setShowDropdown(false)
  }

  const handleBlur = () => {
    setTimeout(() => {
      const exact = storeNames.find(
        (name) => name.toLowerCase() === query.trim().toLowerCase()
      )
      if (exact) selectStore(exact)
    }, 150)
  }

  const isSelected = Boolean(value && value === query)

  return (
    <div ref={containerRef} className="relative">
      <label htmlFor="storeName" className={labelClass}>Retailer name</label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          id="storeName"
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            if (value) onChange('')
            setShowDropdown(true)
          }}
          onFocus={() => setShowDropdown(true)}
          onBlur={handleBlur}
          placeholder={loading ? 'Loading retailers…' : 'Type to search retailers…'}
          disabled={loading}
          autoComplete="off"
          className={`${inputClass} pl-9 ${isSelected ? 'border-green-400 ring-1 ring-green-300' : ''}`}
        />
        <input
          tabIndex={-1}
          className="sr-only"
          value={value}
          onChange={() => {}}
          required
          aria-hidden="true"
        />
      </div>
      {showDropdown && !loading && (
        <div className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border border-gray-200 bg-white shadow-lg">
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-sm text-gray-500">No matching retailers</div>
          ) : (
            filtered.map((name) => (
              <button
                key={name}
                type="button"
                className="block w-full px-3 py-2 text-left text-sm hover:bg-bevvi-primary-50"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => selectStore(name)}
              >
                {name}
              </button>
            ))
          )}
        </div>
      )}
      {stores.length === 0 && !loading && (
        <button
          type="button"
          onClick={onReload}
          className="mt-2 text-sm text-bevvi-primary-600 hover:underline"
        >
          Reload retailers
        </button>
      )}
      <p className="mt-1 text-xs text-gray-500">
        Type to filter the retailer list, then select one.
      </p>
    </div>
  )
}

const todayInputValue = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result || '')
      resolve(result.includes(',') ? result.split(',')[1] : result)
    }
    reader.onerror = () => reject(new Error('Could not read the file'))
    reader.readAsDataURL(file)
  })
}

function matchRetailerFromList(target, stores) {
  const needle = String(target || '').trim().toLowerCase()
  if (!needle) return ''
  const names = stores
    .map((store) => store.name || store.Name || store.storeName || '')
    .filter(Boolean)
  const exact = names.find((name) => name.toLowerCase() === needle)
  if (exact) return exact
  const partial = names.find(
    (name) => name.toLowerCase().includes(needle) || needle.includes(name.toLowerCase())
  )
  return partial || String(target || '').trim()
}

function formatReceiptMoney(value) {
  if (value == null || value === '') return null
  const parsed = parseFloat(value)
  if (Number.isNaN(parsed)) return null
  return parsed === 0 ? '0' : parsed.toFixed(2)
}

function inferReceiptMimeType(file) {
  if (file.type) return file.type
  const lower = String(file.name || '').toLowerCase()
  if (lower.endsWith('.pdf')) return 'application/pdf'
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  return ''
}

function ReceiptScanSection({ onParsed, stores, disabled }) {
  const fileInputRef = useRef(null)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState(null)
  const [fileName, setFileName] = useState('')
  const [dragActive, setDragActive] = useState(false)

  const scanFile = async (file) => {
    if (!file || disabled) return

    const mimeType = inferReceiptMimeType(file)
    const allowedTypes = new Set([
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
      'application/pdf'
    ])
    if (!allowedTypes.has(mimeType)) {
      setError('Upload a JPEG, PNG, WebP, GIF, or PDF file.')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('File must be under 10 MB.')
      return
    }

    setScanning(true)
    setError(null)
    setFileName(file.name)

    try {
      const dataBase64 = await readFileAsBase64(file)
      const response = await apiFetch('/api/manual-order/parse-receipt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        timeoutMs: 180000,
        body: JSON.stringify({
          fileName: file.name,
          mimeType,
          dataBase64
        })
      })
      const data = await parseApiJsonResponse(response)
      if (!response.ok || !data.success || !data.parsed) {
        throw new Error(data.message || data.error || 'Could not scan receipt')
      }
      onParsed(data.parsed, { stores })
      setError(null)
    } catch (e) {
      if (e.name === 'AbortError') {
        setError('Receipt scan timed out. Try a smaller file or a screenshot of the receipt.')
      } else if (e.message === 'Failed to fetch' || e instanceof TypeError) {
        setError(
          'Could not reach the server. Start the backend (npm run server on port 3001) and, for local dev, the frontend (npm run dev on port 3000).'
        )
      } else {
        setError(e.message || 'Could not scan receipt')
      }
    } finally {
      setScanning(false)
    }
  }

  const handleInputChange = (event) => {
    const file = event.target.files?.[0]
    if (file) scanFile(file)
    event.target.value = ''
  }

  const handleDrop = (event) => {
    event.preventDefault()
    setDragActive(false)
    const file = event.dataTransfer.files?.[0]
    if (file) scanFile(file)
  }

  return (
    <section className="rounded-lg border border-dashed border-bevvi-primary-200 bg-bevvi-primary-50/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-base font-semibold text-gray-900">
            <ScanLine className="h-4 w-4 text-bevvi-primary-600" />
            Scan receipt or invoice
          </h3>
          <p className="mt-1 text-sm text-gray-600">
            Upload a photo or PDF and we&apos;ll fill in products, customer, address, and fees.
          </p>
        </div>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || scanning}
          className="inline-flex items-center rounded-md border border-bevvi-primary-300 bg-white px-3 py-1.5 text-sm font-medium text-bevvi-primary-700 hover:bg-bevvi-primary-50 disabled:opacity-60"
        >
          {scanning ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <Upload className="mr-1.5 h-4 w-4" />
          )}
          {scanning ? 'Scanning…' : 'Choose file'}
        </button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
        className="sr-only"
        onChange={handleInputChange}
      />

      <div
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') fileInputRef.current?.click()
        }}
        onClick={() => !scanning && fileInputRef.current?.click()}
        onDragEnter={(event) => {
          event.preventDefault()
          setDragActive(true)
        }}
        onDragOver={(event) => {
          event.preventDefault()
          setDragActive(true)
        }}
        onDragLeave={(event) => {
          event.preventDefault()
          setDragActive(false)
        }}
        onDrop={handleDrop}
        className={`mt-3 cursor-pointer rounded-md border px-4 py-6 text-center transition-colors ${
          dragActive
            ? 'border-bevvi-primary-400 bg-white'
            : 'border-gray-200 bg-white/80 hover:border-bevvi-primary-300'
        } ${scanning ? 'pointer-events-none opacity-70' : ''}`}
      >
        <FileText className="mx-auto h-8 w-8 text-gray-400" />
        <p className="mt-2 text-sm text-gray-700">
          Drag and drop a receipt image or PDF here
        </p>
        <p className="mt-1 text-xs text-gray-500">JPEG, PNG, WebP, GIF, or PDF up to 10 MB</p>
        {fileName && !scanning && (
          <p className="mt-2 text-xs text-gray-600">Last file: {fileName}</p>
        )}
      </div>

      {error && (
        <p className="mt-3 text-sm text-red-700" role="alert">{error}</p>
      )}
    </section>
  )
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
  const [externalOrderNumber, setExternalOrderNumber] = useState('')
  const [delivery, setDelivery] = useState('0')
  const [discount, setDiscount] = useState('0')
  const [engraving, setEngraving] = useState('0')
  const [salesTax, setSalesTax] = useState('0')
  const [salesTaxFromStripe, setSalesTaxFromStripe] = useState(false)
  const [salesTaxManualOverride, setSalesTaxManualOverride] = useState(false)
  const [salesTaxLoading, setSalesTaxLoading] = useState(false)
  const [salesTaxError, setSalesTaxError] = useState(null)
  const [service, setService] = useState('0')
  const [serviceChargeTax, setServiceChargeTax] = useState('0')
  const [shipping, setShipping] = useState('0')
  const [tipPercent, setTipPercent] = useState('0')
  const [loadingStores, setLoadingStores] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [validationResults, setValidationResults] = useState(null)
  const [message, setMessage] = useState(null)
  const [submitResponse, setSubmitResponse] = useState(null)
  const [error, setError] = useState(null)
  const [paymentLinkCopied, setPaymentLinkCopied] = useState(false)
  const [showPaymentLinkPrompt, setShowPaymentLinkPrompt] = useState(false)
  const [creatingPaymentLink, setCreatingPaymentLink] = useState(false)
  const [voidingPaymentLink, setVoidingPaymentLink] = useState(false)
  const [paymentLinkError, setPaymentLinkError] = useState(null)
  const [submitSuccessNotice, setSubmitSuccessNotice] = useState(null)
  const resetFormTimeoutRef = useRef(null)

  const resetManualOrderForm = useCallback(() => {
    if (resetFormTimeoutRef.current) {
      window.clearTimeout(resetFormTimeoutRef.current)
      resetFormTimeoutRef.current = null
    }
    setLineItems([emptyLineItem()])
    setStoreName('')
    setCompanyName('')
    setCustomerName('')
    setEmail('')
    setAddressInput('')
    setStreetAddress('')
    setCity('')
    setState('')
    setZip('')
    setOrderDate(todayInputValue())
    setExternalOrderNumber('')
    setDelivery('0')
    setDiscount('0')
    setEngraving('0')
    setSalesTax('0')
    setSalesTaxFromStripe(false)
    setSalesTaxManualOverride(false)
    setSalesTaxLoading(false)
    setSalesTaxError(null)
    setService('0')
    setServiceChargeTax('0')
    setShipping('0')
    setTipPercent('0')
    setValidationResults(null)
    setMessage(null)
    setSubmitResponse(null)
    setError(null)
    setPaymentLinkCopied(false)
    setShowPaymentLinkPrompt(false)
    setCreatingPaymentLink(false)
    setVoidingPaymentLink(false)
    setPaymentLinkError(null)
    setSubmitSuccessNotice(null)
  }, [])

  useEffect(() => {
    return () => {
      if (resetFormTimeoutRef.current) {
        window.clearTimeout(resetFormTimeoutRef.current)
      }
    }
  }, [])

  const applyParsedReceipt = useCallback((parsed, { stores: storeList = stores } = {}) => {
    setValidationResults(null)
    setError(null)
    setSubmitResponse(null)
    setSalesTaxFromStripe(false)
    setSalesTaxManualOverride(false)
    setSalesTaxError(null)

    if (parsed.storeName) {
      setStoreName(matchRetailerFromList(parsed.storeName, storeList))
    }
    if (parsed.companyName) setCompanyName(parsed.companyName)
    if (parsed.customerName) setCustomerName(parsed.customerName)
    if (parsed.email) setEmail(parsed.email)
    if (parsed.orderDate) setOrderDate(parsed.orderDate)
    if (parsed.externalOrderNumber) setExternalOrderNumber(parsed.externalOrderNumber)

    const applyMoney = (value, setter) => {
      const formatted = formatReceiptMoney(value)
      if (formatted != null) setter(formatted)
    }

    applyMoney(parsed.delivery, setDelivery)
    applyMoney(parsed.discount, setDiscount)
    applyMoney(parsed.engraving, setEngraving)
    applyMoney(parsed.salesTax, setSalesTax)
    applyMoney(parsed.service, setService)
    applyMoney(parsed.serviceChargeTax, setServiceChargeTax)
    applyMoney(parsed.shipping, setShipping)

    if (Array.isArray(parsed.products) && parsed.products.length > 0) {
      setLineItems(
        parsed.products.map((product) => ({
          query: product.query || `${product.name || ''}${product.size ? ` ${product.size}` : ''}`.trim(),
          name: product.catalogMatched ? (product.name || '') : '',
          size: product.catalogMatched ? (product.size || '') : '',
          quantity: String(product.quantity || 1),
          price: product.price != null ? String(product.price) : ''
        }))
      )

      if (parsed.tip != null) {
        const tipDollars = parseFloat(parsed.tip) || 0
        const productSubtotal = parsed.products.reduce(
          (sum, product) => sum + (parseFloat(product.price) || 0) * (parseInt(product.quantity, 10) || 1),
          0
        )
        if (productSubtotal > 0 && tipDollars > 0) {
          const percent = Math.round((tipDollars / productSubtotal) * 10000) / 100
          setTipPercent(percent === 0 ? '0' : String(percent))
        } else {
          setTipPercent('0')
        }
      }
    } else if (parsed.tip != null && (parseFloat(parsed.tip) || 0) <= 0) {
      setTipPercent('0')
    }

    if (parsed.streetAddress || parsed.city || parsed.state || parsed.zip) {
      const formattedAddress = [
        parsed.streetAddress,
        parsed.city,
        parsed.state,
        parsed.zip
      ].filter(Boolean).join(', ')
      setAddressInput(formattedAddress)
      setStreetAddress(parsed.streetAddress || '')
      setCity(parsed.city || '')
      setState(parsed.state || '')
      setZip(parsed.zip || '')
    }

    const matchedCount = (parsed.products || []).filter((product) => product.catalogMatched).length
    const productCount = parsed.products?.length || 0
    let summary = 'Receipt scanned — review the fields below before submitting.'
    if (productCount > 0) {
      summary += ` Found ${productCount} product${productCount === 1 ? '' : 's'}`
      if (matchedCount > 0) {
        summary += ` (${matchedCount} matched to the master catalog).`
      } else {
        summary += '.'
      }
    }
    if (parsed.confidenceNotes) {
      summary += ` Note: ${parsed.confidenceNotes}`
    }
    setMessage(summary)
  }, [stores])

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

  const tipAmount = useMemo(() => {
    const percent = parseFloat(tipPercent) || 0
    if (percent <= 0 || subTotal <= 0) return 0
    return Math.round(subTotal * percent / 100 * 100) / 100
  }, [tipPercent, subTotal])

  const tip = useMemo(() => (tipAmount === 0 ? '0' : tipAmount.toFixed(2)), [tipAmount])

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

  const taxCalculationInput = useMemo(() => ({
    zip: zip.trim(),
    streetAddress: streetAddress.trim(),
    city: city.trim(),
    state: state.trim(),
    products: lineItems.map((item) => {
      const { name, size } = resolveLineItemForApi(item)
      return { name, size, quantity: item.quantity, price: item.price }
    }),
    delivery,
    shipping,
    service,
    engraving,
    tip,
    subTotal
  }), [
    zip,
    streetAddress,
    city,
    state,
    lineItems,
    delivery,
    shipping,
    service,
    engraving,
    tip,
    subTotal
  ])

  const hasTaxableProductsForCalculation = useCallback((products, total) => {
    if (total <= 0) return false
    return products.some((product) => {
      const price = parseFloat(product.price)
      const quantity = parseFloat(product.quantity) || parseInt(product.quantity, 10) || 0
      const label = `${product.name || ''} ${product.size || ''}`.trim()
      return label && !Number.isNaN(price) && price >= 0 && quantity > 0
    })
  }, [])

  const taxCalculationInputRef = useRef(taxCalculationInput)
  taxCalculationInputRef.current = taxCalculationInput
  const taxRequestSeqRef = useRef(0)

  useEffect(() => {
    if (!taxCalculationInput.zip) {
      setSalesTaxFromStripe(false)
      setSalesTaxError(null)
      return undefined
    }

    if (salesTaxManualOverride) {
      return undefined
    }

    let cancelled = false
    const timeoutId = window.setTimeout(async () => {
      const input = taxCalculationInputRef.current
      const products = input.products
      const canCalculateTax = hasTaxableProductsForCalculation(products, input.subTotal)

      if (!canCalculateTax) {
        return
      }

      const requestSeq = taxRequestSeqRef.current + 1
      taxRequestSeqRef.current = requestSeq

      setSalesTaxLoading(true)
      setSalesTaxError(null)
      try {
        const response = await apiFetch('/api/manual-order/calculate-tax', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            products,
            streetAddress: input.streetAddress,
            city: input.city,
            state: input.state,
            zip: input.zip,
            delivery: input.delivery,
            shipping: input.shipping,
            service: input.service,
            engraving: input.engraving,
            tip: input.tip
          })
        })
        const data = await parseApiJsonResponse(response)
        if (cancelled || requestSeq !== taxRequestSeqRef.current) return
        if (!response.ok || !data.success) {
          throw new Error(data.message || data.error || 'Could not calculate sales tax')
        }
        const taxAmount = data.salesTax ?? 0
        const serviceTaxAmount = data.serviceChargeTax ?? 0
        setSalesTax(taxAmount === 0 ? '0' : taxAmount.toFixed(2))
        setServiceChargeTax(serviceTaxAmount === 0 ? '0' : serviceTaxAmount.toFixed(2))
        setSalesTaxFromStripe(true)
      } catch (e) {
        if (cancelled || requestSeq !== taxRequestSeqRef.current) return
        setSalesTaxError(e.message || 'Could not calculate sales tax')
        setSalesTaxFromStripe(false)
      } finally {
        if (!cancelled && requestSeq === taxRequestSeqRef.current) {
          setSalesTaxLoading(false)
        }
      }
    }, 450)

    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [taxCalculationInput, salesTaxManualOverride, hasTaxableProductsForCalculation])

  useEffect(() => {
    setSalesTaxManualOverride(false)
  }, [
    taxCalculationInput.zip,
    taxCalculationInput.streetAddress,
    taxCalculationInput.city,
    taxCalculationInput.state,
    taxCalculationInput.products,
    taxCalculationInput.delivery,
    taxCalculationInput.shipping,
    taxCalculationInput.service,
    taxCalculationInput.engraving,
    taxCalculationInput.tip,
    taxCalculationInput.subTotal
  ])

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
    externalOrderNumber,
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
    if (submitSuccessNotice) return
    if (resetFormTimeoutRef.current) {
      window.clearTimeout(resetFormTimeoutRef.current)
      resetFormTimeoutRef.current = null
    }
    setError(null)
    setMessage(null)
    setSubmitResponse(null)
    setSubmitSuccessNotice(null)
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
      setSubmitResponse({
        orderNumber: data.orderNumber,
        orderTotal: data.orderTotal ?? estimatedTotal,
        matchedProducts: data.matchedProducts || [],
        payload: data.payload,
        data: data.data,
        paymentSnapshot: {
          email,
          customerName,
          storeName,
          streetAddress: resolvedAddress.streetAddress,
          city: resolvedAddress.city,
          state: resolvedAddress.state,
          zip: resolvedAddress.zip,
          salesTax,
          delivery,
          shipping,
          service,
          serviceChargeTax,
          engraving,
          tip,
          discount
        }
      })
      setShowPaymentLinkPrompt(true)
      setSubmitSuccessNotice({
        orderNumber: data.orderNumber,
        orderTotal: data.orderTotal ?? estimatedTotal
      })
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (e) {
      setError({ message: e.message || 'Network error' })
    } finally {
      setSubmitting(false)
    }
  }

  const buildPaymentLinkPayload = (regenerate = false) => {
    const snapshot = submitResponse?.paymentSnapshot || {}
    return {
      orderNumber: submitResponse.orderNumber,
      email: submitResponse.payload?.email || snapshot.email || email,
      customerName: snapshot.customerName || customerName,
      storeName: submitResponse.payload?.storeName || snapshot.storeName || storeName,
      totalAmount: submitResponse.orderTotal ?? estimatedTotal,
      matchedProducts: submitResponse.matchedProducts || [],
      streetAddress: submitResponse.payload?.streetAddress || snapshot.streetAddress || streetAddress,
      city: submitResponse.payload?.city || snapshot.city || city,
      state: submitResponse.payload?.state || snapshot.state || state,
      zip: submitResponse.payload?.zip || snapshot.zip || zip,
      salesTax: submitResponse.payload?.salesTax ?? snapshot.salesTax ?? salesTax,
      orderTax: submitResponse.payload?.salesTax ?? snapshot.salesTax ?? salesTax,
      delivery: submitResponse.payload?.delivery ?? snapshot.delivery ?? delivery,
      shipping: submitResponse.payload?.shipping ?? snapshot.shipping ?? shipping,
      service: submitResponse.payload?.service ?? snapshot.service ?? service,
      serviceChargeTax: submitResponse.payload?.serviceChargeTax ?? snapshot.serviceChargeTax ?? serviceChargeTax,
      giftNoteCharge: submitResponse.payload?.engraving ?? snapshot.engraving ?? engraving,
      engraving: submitResponse.payload?.engraving ?? snapshot.engraving ?? engraving,
      tip: submitResponse.payload?.tip ?? snapshot.tip ?? tip,
      discount: submitResponse.payload?.discount ?? snapshot.discount ?? discount,
      country: 'US',
      regenerate
    }
  }

  const handleCreatePaymentLink = async ({ regenerate = false } = {}) => {
    if (!submitResponse) return
    const snapshot = submitResponse.paymentSnapshot || {}
    const invoiceZip = submitResponse.payload?.zip || snapshot.zip || zip
    if (!invoiceZip?.trim()) {
      setPaymentLinkError('Recipient zip code is required so Stripe can calculate tax.')
      return
    }
    if (
      regenerate &&
      !window.confirm(
        'Create a new Stripe invoice using the current order details? The previous invoice will be voided.'
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
      setMessage('Stripe invoice created. Email it to the customer or copy the link below.')
    } catch (e) {
      setPaymentLinkError(e.message || 'Network error')
    } finally {
      setCreatingPaymentLink(false)
    }
  }

  const handleVoidPaymentLink = async () => {
    if (!submitResponse?.orderNumber) return
    if (
      !window.confirm(
        'Void this Stripe invoice? The customer will no longer be able to pay using the current link.'
      )
    ) {
      return
    }
    setPaymentLinkError(null)
    setVoidingPaymentLink(true)
    try {
      const response = await apiFetch('/api/manual-order/payment-link/void', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderNumber: submitResponse.orderNumber })
      })
      const data = await parseApiJsonResponse(response)
      if (!response.ok || !data.success) {
        setPaymentLinkError(
          response.status === 409
            ? data.error || 'This invoice has already been paid and cannot be voided.'
            : data.error || data.message || 'Failed to void invoice'
        )
        return
      }
      setSubmitResponse((prev) => ({ ...prev, paymentLink: null }))
      setShowPaymentLinkPrompt(true)
      setMessage('Stripe invoice voided. Create a new invoice if needed.')
    } catch (e) {
      setPaymentLinkError(e.message || 'Network error')
    } finally {
      setVoidingPaymentLink(false)
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

        {submitSuccessNotice && (
          <div
            className="mb-6 rounded-lg border border-green-200 bg-green-50 px-6 py-8 text-center"
            role="status"
            aria-live="polite"
          >
            <CheckCircle className="mx-auto h-10 w-10 text-green-600" aria-hidden />
            <p className="mt-3 text-lg font-semibold text-green-900">Order submitted successfully</p>
            {submitSuccessNotice.orderNumber && (
              <p className="mt-1 text-sm text-green-800">
                Order <strong>{submitSuccessNotice.orderNumber}</strong>
                {submitSuccessNotice.orderTotal != null && (
                  <> · {formatDollarAmount(submitSuccessNotice.orderTotal)}</>
                )}
              </p>
            )}
            <p className="mt-2 text-xs text-green-700">
              Create a Stripe invoice below to email the customer, or start a new order when you&apos;re done.
            </p>
          </div>
        )}

        {submitResponse && (showPaymentLinkPrompt || submitResponse.paymentLink?.url || paymentLinkError) && (
          <div className="mb-6 space-y-4">
            {showPaymentLinkPrompt && !submitResponse.paymentLink?.url && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900">
                <p className="font-semibold">Create a Stripe invoice?</p>
                <p className="mt-1 text-amber-800">
                  The order was submitted. Create an itemized invoice for{' '}
                  <strong>{formatDollarAmount(submitResponse.orderTotal ?? estimatedTotal)}</strong>
                  {submitResponse.orderNumber ? (
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
                        Creating invoice…
                      </>
                    ) : (
                      'Yes, create invoice'
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowPaymentLinkPrompt(false)}
                    disabled={creatingPaymentLink}
                    className="inline-flex items-center justify-center rounded-md border border-amber-300 bg-white px-4 py-2 text-sm font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
                  >
                    Skip for now
                  </button>
                </div>
              </div>
            )}

            {submitResponse.paymentLink?.url && (
              <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-4">
                <h4 className="text-sm font-semibold text-indigo-900">Stripe invoice ready</h4>
                <p className="mt-1 text-sm text-indigo-800">
                  Email this invoice to the customer, or copy the link into your own message.
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
                      customerEmail: submitResponse.paymentLink.customerEmail || submitResponse.paymentSnapshot?.email || email,
                      customerName: submitResponse.paymentSnapshot?.customerName || customerName,
                      orderNumber: submitResponse.paymentLink.orderNumber || submitResponse.orderNumber,
                      totalAmount: submitResponse.paymentLink.totalAmount,
                      paymentUrl: submitResponse.paymentLink.url
                    })}
                    className="inline-flex items-center justify-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
                  >
                    <Mail className="mr-2 h-4 w-4" />
                    Email customer
                  </a>
                  <a
                    href={submitResponse.paymentLink.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center rounded-md border border-indigo-300 bg-white px-4 py-2 text-sm font-medium text-indigo-800 hover:bg-indigo-100"
                  >
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Open invoice
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
                    disabled={creatingPaymentLink || voidingPaymentLink}
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
                        Regenerate invoice
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={handleVoidPaymentLink}
                    disabled={creatingPaymentLink || voidingPaymentLink}
                    className="inline-flex items-center justify-center rounded-md border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-800 hover:bg-red-50 disabled:opacity-50"
                  >
                    {voidingPaymentLink ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Voiding…
                      </>
                    ) : (
                      <>
                        <Ban className="mr-2 h-4 w-4" />
                        Void invoice
                      </>
                    )}
                  </button>
                </div>
                <p className="mt-3 break-all text-xs text-indigo-700">{submitResponse.paymentLink.url}</p>
              </div>
            )}

            {paymentLinkError && !showPaymentLinkPrompt && !submitResponse.paymentLink?.url && (
              <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
                <p className="font-medium">Invoice not created</p>
                <p className="mt-1">{paymentLinkError}</p>
                <button
                  type="button"
                  onClick={() => setShowPaymentLinkPrompt(true)}
                  className="mt-2 text-sm font-medium text-red-900 underline hover:no-underline"
                >
                  Try again
                </button>
              </div>
            )}

            {submitSuccessNotice && (
              <button
                type="button"
                onClick={resetManualOrderForm}
                className="inline-flex items-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Start next order
              </button>
            )}
          </div>
        )}

        <ReceiptScanSection
          onParsed={applyParsedReceipt}
          stores={stores}
          disabled={submitting || Boolean(submitSuccessNotice)}
        />

        <form
          onSubmit={handleSubmit}
          className={`space-y-8 ${submitSuccessNotice ? 'pointer-events-none opacity-40' : ''}`}
        >
          <section className="space-y-4">
            <h3 className="text-base font-semibold text-gray-900">Products</h3>

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

            <button
              type="button"
              onClick={addLineItem}
              className="inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              <Plus className="mr-1 h-4 w-4" />
              Add product
            </button>

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
                <RetailerCombobox
                  stores={stores}
                  loading={loadingStores}
                  value={storeName}
                  onChange={setStoreName}
                  onReload={loadStores}
                  inputClass={inputClass}
                  labelClass={labelClass}
                />
                <RetailerStripeAccountDisplay storeName={storeName} />
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
            <h3 className="text-base font-semibold text-gray-900">Order details</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
              <div>
                <label htmlFor="externalOrderNumber" className={labelClass}>
                  External order / PO number
                </label>
                <input
                  id="externalOrderNumber"
                  type="text"
                  value={externalOrderNumber}
                  onChange={(e) => setExternalOrderNumber(e.target.value)}
                  placeholder="Customer PO or reference number"
                  className={inputClass}
                  autoComplete="off"
                />
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <h3 className="text-base font-semibold text-gray-900">Fees</h3>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {[
                ['discount', discount, setDiscount, 'Discount'],
                ['engraving', engraving, setEngraving, 'Engraving'],
                ['service', service, setService, 'Service (10% of subtotal)'],
                ['serviceChargeTax', serviceChargeTax, setServiceChargeTax, 'Service charge tax'],
                ['delivery', delivery, setDelivery, 'Delivery'],
                ['shipping', shipping, setShipping, 'Shipping']
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
              <div>
                <label htmlFor="tipPercent" className={labelClass}>
                  Tip (% of product cost)
                </label>
                <input
                  id="tipPercent"
                  type="number"
                  min="0"
                  step="0.1"
                  value={tipPercent}
                  onChange={(e) => setTipPercent(e.target.value)}
                  className={inputClass}
                />
                {tipAmount > 0 && (
                  <p className="mt-1 text-xs text-gray-500">
                    {formatDollarAmount(tipAmount)} added to total
                    {subTotal > 0 && (
                      <span> ({tipPercent}% of {formatDollarAmount(subTotal)} in products)</span>
                    )}
                  </p>
                )}
              </div>
              <div>
                <label htmlFor="salesTax" className={labelClass}>
                  Sales tax
                  {salesTaxFromStripe && !salesTaxManualOverride && (
                    <span className="ml-1 text-xs font-normal text-gray-500">(from Stripe)</span>
                  )}
                  {salesTaxManualOverride && (
                    <span className="ml-1 text-xs font-normal text-gray-500">(manual)</span>
                  )}
                  {salesTaxLoading && (
                    <Loader2 className="ml-1 inline h-3.5 w-3.5 animate-spin text-bevvi-primary-600" aria-hidden="true" />
                  )}
                </label>
                <input
                  id="salesTax"
                  type="number"
                  min="0"
                  step="0.01"
                  value={salesTax}
                  onChange={(e) => {
                    setSalesTax(e.target.value)
                    setSalesTaxFromStripe(false)
                    setSalesTaxManualOverride(true)
                    setSalesTaxError(null)
                  }}
                  className={inputClass}
                />
                {salesTaxError && (
                  <p className="mt-1 text-xs text-amber-700">{salesTaxError}</p>
                )}
                {!zip?.trim() && (
                  <p className="mt-1 text-xs text-gray-500">
                    Add a delivery address to calculate tax automatically, or enter tax manually.
                  </p>
                )}
              </div>
            </div>
            <div className="space-y-1 text-sm text-gray-600">
              {tipAmount > 0 && (
                <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                  <span>Tip ({tipPercent}% of product cost)</span>
                  <span className="tabular-nums font-medium text-gray-900">{formatDollarAmount(tipAmount)}</span>
                </div>
              )}
              <p>
                Estimated total: <strong>{formatDollarAmount(estimatedTotal)}</strong>
              </p>
            </div>
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

          <button
            type="submit"
            disabled={submitting || Boolean(submitSuccessNotice)}
            className="inline-flex items-center rounded-md bg-bevvi-primary-600 px-6 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-bevvi-primary-700 focus:outline-none focus:ring-2 focus:ring-bevvi-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Submitting order…
              </>
            ) : submitSuccessNotice ? (
              'Order submitted'
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
