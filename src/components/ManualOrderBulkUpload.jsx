import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Upload,
  Loader2,
  FileSpreadsheet,
  Calculator,
  Send,
  AlertCircle,
  CheckCircle,
  Search,
  MapPin,
  X,
  Pencil,
  Mail,
  ExternalLink,
  Copy,
  Ban,
  RefreshCw
} from 'lucide-react'
import { apiFetch, formatApiFetchError, parseApiJsonResponse } from '../utils/api'
import { formatDollarAmount } from '../utils/formatCurrency'
import { buildPaymentEmailMailto } from '../utils/paymentLink'

const inputClass = 'input-field mt-1 text-sm'
const labelClass = 'bevvi-label !mb-1'

function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error('Timed out reading the file — try again or use a smaller spreadsheet'))
    }, 30000)

    const reader = new FileReader()
    reader.onload = () => {
      window.clearTimeout(timeoutId)
      resolve(reader.result)
    }
    reader.onerror = () => {
      window.clearTimeout(timeoutId)
      reject(new Error('Could not read the file'))
    }
    reader.readAsArrayBuffer(file)
  })
}

function annotateRowsFromFile(rows, sourceFile, sourceFileId) {
  return (rows || []).map((row, index) => ({
    ...row,
    sourceFile,
    sourceFileId,
    bulkRowId: `${sourceFileId}::${row.rowIndex ?? index + 1}`
  }))
}

function assignDisplayIndices(rows) {
  return rows.map((row, index) => ({ ...row, displayIndex: index + 1 }))
}

function isAllowedSpreadsheet(file) {
  const allowed = ['.xlsx', '.xls', '.csv']
  const lower = String(file.name || '').toLowerCase()
  return allowed.some((ext) => lower.endsWith(ext))
}

function rowNeedsGeocoding(row) {
  if (isBulkRowAddressComplete(row)) return false
  return Boolean(String(row?.addressRaw || row?.formattedAddress || '').trim())
}

async function parseSpreadsheetFile(file) {
  const buffer = await readFileAsArrayBuffer(file)
  const { parseBulkOrderSpreadsheet } = await import('@lib/bulk-spreadsheet')
  const parsed = parseBulkOrderSpreadsheet(new Uint8Array(buffer), file.name)
  if (!parsed.success) {
    throw new Error(parsed.error || 'Failed to parse spreadsheet')
  }
  return parsed
}

async function geocodeBulkRows(rows) {
  const response = await apiFetch('/api/manual-order/bulk-geocode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    timeoutMs: 600000,
    body: JSON.stringify({ rows })
  })
  const data = await parseApiJsonResponse(response)
  if (!response.ok || !data.success) {
    throw new Error(data.error || data.message || 'Failed to geocode addresses')
  }
  return data
}

function mergeGeocodedRows(currentRows, geocodedRows) {
  const byId = new Map(
    (geocodedRows || []).map((row) => [row.bulkRowId || `${row.rowIndex}`, row])
  )
  return currentRows.map((row) => {
    const key = row.bulkRowId || `${row.rowIndex}`
    return byId.get(key) || row
  })
}

function isBulkRowAddressComplete(row) {
  return Boolean(
    String(row?.streetAddress || '').trim() &&
      String(row?.city || '').trim() &&
      String(row?.state || '').trim() &&
      String(row?.zip || '').trim()
  )
}

function getBulkRowPreTaxTotal(row) {
  if (row?.preTaxTotal != null) return row.preTaxTotal
  const bottle = parseFloat(row?.productPrice) || 0
  const shipping = parseFloat(row?.shipping) || 0
  const service = parseFloat(row?.service) || 0
  const gift = parseFloat(row?.giftNote) || 0
  return Math.round((bottle + shipping + service + gift) * 100) / 100
}

function getBulkRowTaxTotal(row) {
  if (row?.salesTax == null) return null
  return Math.round(((row.salesTax || 0) + (row.serviceChargeTax || 0)) * 100) / 100
}

function getBulkRowDisplayTotal(row) {
  if (row?.orderTotal != null) return row.orderTotal
  const preTax = getBulkRowPreTaxTotal(row)
  const tax = getBulkRowTaxTotal(row)
  if (tax != null) return Math.round((preTax + tax) * 100) / 100
  return preTax
}

function sumRows(rows, picker) {
  return Math.round(rows.reduce((sum, row) => sum + (picker(row) || 0), 0) * 100) / 100
}

function applyManualAddressToRow(row, { streetAddress, city, state, zip, formattedAddress }) {
  const st = String(streetAddress || '').trim()
  const ci = String(city || '').trim()
  const stt = String(state || '').trim().toUpperCase().slice(0, 2)
  const zp = String(zip || '').trim()
  const complete = Boolean(st && ci && stt && zp)
  const composed = complete ? `${st}, ${ci}, ${stt} ${zp}` : ''

  return {
    ...row,
    streetAddress: st,
    city: ci,
    state: stt,
    zip: zp,
    addressRaw: composed || row.addressRaw || '',
    formattedAddress: formattedAddress || composed || row.formattedAddress || '',
    geocodeStatus: complete ? 'manual' : row.geocodeStatus,
    geocodeError: complete ? null : row.geocodeError,
    salesTax: null,
    serviceChargeTax: null,
    orderTotal: null,
    taxError: null
  }
}

function BulkRowAddressEditor({
  row,
  onSave,
  onCancel,
  AddressLookupField,
  disabled
}) {
  const [addressInput, setAddressInput] = useState(
    row.formattedAddress ||
      row.addressRaw ||
      [row.streetAddress, row.city, row.state, row.zip].filter(Boolean).join(', ')
  )
  const [streetAddress, setStreetAddress] = useState(row.streetAddress || '')
  const [city, setCity] = useState(row.city || '')
  const [state, setState] = useState(row.state || '')
  const [zip, setZip] = useState(row.zip || '')

  const handleSave = () => {
    if (!streetAddress.trim() || !city.trim() || !state.trim() || !zip.trim()) return
    onSave({ streetAddress, city, state, zip, formattedAddress: addressInput })
  }

  return (
    <div
      id={`bulk-address-editor-${row.bulkRowId}`}
      className="rounded-lg border border-amber-200 bg-amber-50/80 p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium text-gray-900">{row.customerName}</p>
          {row.companyName ? (
            <p className="text-xs text-gray-600">{row.companyName}</p>
          ) : null}
          <p className="text-xs text-gray-500">
            Row {row.displayIndex ?? row.rowIndex}
            {row.sourceFile ? ` · ${row.sourceFile}` : ''}
          </p>
        </div>
        {row.geocodeError ? (
          <p className="text-xs text-red-700">{row.geocodeError}</p>
        ) : null}
      </div>

      {AddressLookupField ? (
        <div className="mt-3">
          <AddressLookupField
            value={addressInput}
            onChange={setAddressInput}
            inputClass={inputClass}
            labelClass={labelClass}
            label="Search or paste address"
            inputId={`bulk-address-${row.bulkRowId}`}
            onResolved={(parsed) => {
              setStreetAddress(parsed.streetAddress || '')
              setCity(parsed.city || '')
              setState(parsed.state || '')
              setZip(parsed.zip || '')
              if (parsed.formattedAddress) setAddressInput(parsed.formattedAddress)
            }}
            onClear={() => {
              setStreetAddress('')
              setCity('')
              setState('')
              setZip('')
            }}
          />
        </div>
      ) : null}

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={labelClass} htmlFor={`bulk-street-${row.bulkRowId}`}>Street address</label>
          <input
            id={`bulk-street-${row.bulkRowId}`}
            type="text"
            value={streetAddress}
            disabled={disabled}
            onChange={(e) => setStreetAddress(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor={`bulk-city-${row.bulkRowId}`}>City</label>
          <input
            id={`bulk-city-${row.bulkRowId}`}
            type="text"
            value={city}
            disabled={disabled}
            onChange={(e) => setCity(e.target.value)}
            className={inputClass}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass} htmlFor={`bulk-state-${row.bulkRowId}`}>State</label>
            <input
              id={`bulk-state-${row.bulkRowId}`}
              type="text"
              value={state}
              disabled={disabled}
              onChange={(e) => setState(e.target.value.toUpperCase().slice(0, 2))}
              maxLength={2}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor={`bulk-zip-${row.bulkRowId}`}>Zip</label>
            <input
              id={`bulk-zip-${row.bulkRowId}`}
              type="text"
              value={zip}
              disabled={disabled}
              onChange={(e) => setZip(e.target.value)}
              className={inputClass}
            />
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={disabled || !streetAddress.trim() || !city.trim() || !state.trim() || !zip.trim()}
          className="inline-flex items-center rounded-md bg-bevvi-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-bevvi-900 disabled:opacity-60"
        >
          Save address
        </button>
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            disabled={disabled}
            className="inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          >
            Cancel
          </button>
        ) : null}
      </div>
    </div>
  )
}

function BulkProductPicker({ product, onChange, disabled }) {
  const [query, setQuery] = useState(product?.query || '')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const timeoutRef = useRef(null)

  useEffect(() => {
    if (product?.name && product?.size) {
      setQuery(`${product.name}${product.size ? ` ${product.size}` : ''}`.trim())
    }
  }, [product?.name, product?.size])

  useEffect(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    const term = query.trim()
    if (term.length < 3 || (product?.name && product?.size)) {
      setResults([])
      return undefined
    }

    timeoutRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const response = await apiFetch(`/api/products/search?q=${encodeURIComponent(term)}`)
        const data = await response.json()
        setResults(data.success && Array.isArray(data.results) ? data.results.slice(0, 8) : [])
      } catch {
        setResults([])
      } finally {
        setLoading(false)
      }
    }, 300)

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [query, product?.name, product?.size])

  const selectProduct = (entry) => {
    const name = String(entry.name || '').trim()
    const size =
      entry.size && entry.units
        ? `${entry.size} ${entry.units}`.trim()
        : String(entry.size || '').trim()
    onChange({
      query: name,
      name,
      size,
      quantity: product?.quantity || '1'
    })
    setResults([])
  }

  return (
    <div>
      <label htmlFor="bulkProductSearch" className={labelClass}>
        Product for all recipients <span className="text-red-600">*</span>
      </label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
        <input
          id="bulkProductSearch"
          type="text"
          value={query}
          disabled={disabled}
          onChange={(e) => {
            setQuery(e.target.value)
            onChange({ ...product, query: e.target.value, name: '', size: '' })
          }}
          placeholder='Search catalog, e.g. "Perrier Jouet Grand Brut 750 ML"'
          className={`${inputClass} pl-9`}
        />
      </div>
      {product?.name && product?.size ? (
        <p className="mt-1 text-xs text-green-700">
          Selected: <strong>{product.name}</strong> · {product.size}
        </p>
      ) : (
        <p className="mt-1 text-xs text-gray-500">
          Each spreadsheet row supplies the bottle price; pick the catalog product here.
        </p>
      )}
      {loading && (
        <p className="mt-2 flex items-center gap-2 text-xs text-gray-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Searching products…
        </p>
      )}
      {!loading && results.length > 0 && !product?.name && (
        <ul className="mt-2 max-h-48 overflow-y-auto rounded-md border border-gray-200 bg-white shadow-sm">
          {results.map((entry) => (
            <li key={`${entry.upc || entry.name}-${entry.size}`}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => selectProduct(entry)}
                className="block w-full border-b border-gray-100 px-3 py-2 text-left text-sm hover:bg-bevvi-primary-50 last:border-b-0"
              >
                <span className="font-medium text-gray-900">{entry.name}</span>
                {entry.size ? (
                  <span className="ml-2 text-xs text-gray-500">
                    {entry.size} {entry.units || ''}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const ManualOrderBulkUpload = ({
  stores,
  loadingStores,
  loadStores,
  RetailerCombobox,
  RetailerStripeAccountDisplay,
  AddressLookupField,
  todayInputValue
}) => {
  const fileInputRef = useRef(null)
  const appendNextUploadRef = useRef(false)
  const uploadGenerationRef = useRef(0)
  const [uploadedFiles, setUploadedFiles] = useState([])
  const [uploading, setUploading] = useState(false)
  const [geocoding, setGeocoding] = useState(false)
  const [uploadPhase, setUploadPhase] = useState(null)
  const [uploadProgress, setUploadProgress] = useState(null)
  const [uploadError, setUploadError] = useState(null)
  const [spreadsheetTitle, setSpreadsheetTitle] = useState('')
  const [rows, setRows] = useState([])
  const [warnings, setWarnings] = useState([])
  const [dragActive, setDragActive] = useState(false)

  const [storeName, setStoreName] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [email, setEmail] = useState('')
  const [orderDate, setOrderDate] = useState(todayInputValue())
  const [externalOrderNumber, setExternalOrderNumber] = useState('')
  const [product, setProduct] = useState({ query: '', name: '', size: '', quantity: '1' })

  const [taxLoading, setTaxLoading] = useState(false)
  const [taxError, setTaxError] = useState(null)
  const [taxSummary, setTaxSummary] = useState(null)

  const [submitting, setSubmitting] = useState(false)
  const [submitResults, setSubmitResults] = useState(null)
  const [submitError, setSubmitError] = useState(null)
  const [editingRowId, setEditingRowId] = useState(null)

  const [billToName, setBillToName] = useState('')
  const [billToAddressInput, setBillToAddressInput] = useState('')
  const [billToStreetAddress, setBillToStreetAddress] = useState('')
  const [billToCity, setBillToCity] = useState('')
  const [billToState, setBillToState] = useState('')
  const [billToZip, setBillToZip] = useState('')

  const [combinedInvoiceLoading, setCombinedInvoiceLoading] = useState(false)
  const [combinedInvoiceLookupLoading, setCombinedInvoiceLookupLoading] = useState(false)
  const [combinedInvoiceVoiding, setCombinedInvoiceVoiding] = useState(false)
  const [combinedInvoiceError, setCombinedInvoiceError] = useState(null)
  const [combinedInvoice, setCombinedInvoice] = useState(null)
  const [combinedInvoiceCopied, setCombinedInvoiceCopied] = useState(false)
  const [combinedInvoiceRegenerated, setCombinedInvoiceRegenerated] = useState(false)
  const [combinedInvoiceVoidSuccess, setCombinedInvoiceVoidSuccess] = useState(false)
  const invoiceLookupRequestIdRef = useRef(0)

  const rowsNeedingAddress = rows.filter((row) => !isBulkRowAddressComplete(row))
  const editingRow = rows.find((row) => row.bulkRowId === editingRowId) || null

  const updateRowAddress = useCallback((bulkRowId, fields) => {
    setRows((current) =>
      assignDisplayIndices(
        current.map((row) =>
          row.bulkRowId === bulkRowId ? applyManualAddressToRow(row, fields) : row
        )
      )
    )
    setTaxSummary(null)
    setTaxError(null)
    setEditingRowId(null)
  }, [])

  const mergeTaxResults = useCallback((taxResults) => {
    setRows((current) =>
      current.map((row) => {
        const tax = taxResults.find(
          (entry) =>
            (entry.bulkRowId && entry.bulkRowId === row.bulkRowId) ||
            entry.rowIndex === row.rowIndex
        )
        if (!tax?.success) {
          return {
            ...row,
            salesTax: null,
            serviceChargeTax: null,
            orderTotal: null,
            taxError: tax?.error || null
          }
        }
        return {
          ...row,
          salesTax: tax.salesTax,
          serviceChargeTax: tax.serviceChargeTax,
          orderTotal: tax.orderTotal,
          taxError: null
        }
      })
    )
  }, [])

  const openFilePicker = (append = false) => {
    appendNextUploadRef.current = append
    fileInputRef.current?.click()
  }

  const clearUploadState = useCallback(() => {
    setSubmitResults(null)
    setSubmitError(null)
    setTaxSummary(null)
    setTaxError(null)
    setCombinedInvoice(null)
    setCombinedInvoiceError(null)
    setCombinedInvoiceRegenerated(false)
    setCombinedInvoiceVoidSuccess(false)
  }, [])

  const handleFiles = async (fileList, { append = false } = {}) => {
    const files = Array.from(fileList || []).filter(Boolean)
    if (!files.length) return
    if (uploading || geocoding) return

    const generation = ++uploadGenerationRef.current
    const isCurrentUpload = () => generation === uploadGenerationRef.current

    const invalid = files.filter((file) => !isAllowedSpreadsheet(file))
    if (invalid.length > 0) {
      setUploadError(`Unsupported file type: ${invalid.map((file) => file.name).join(', ')}`)
      return
    }

    const tooLarge = files.filter((file) => file.size > 10 * 1024 * 1024)
    if (tooLarge.length > 0) {
      setUploadError(`These files exceed 10 MB: ${tooLarge.map((file) => file.name).join(', ')}`)
      return
    }

    setUploading(true)
    setGeocoding(false)
    setUploadPhase('reading')
    setUploadError(null)
    clearUploadState()
    if (!append) {
      setUploadedFiles([])
      setRows([])
      setWarnings([])
      setSpreadsheetTitle('')
    }

    try {
      const nextFileEntries = []
      const nextRows = []
      const nextWarnings = []
      const fileErrors = []
      let geocodeFailures = 0
      let parsedTitle = spreadsheetTitle

      for (let i = 0; i < files.length; i++) {
        if (!isCurrentUpload()) return

        const file = files[i]
        const fileId = `${file.name}-${Date.now()}-${i}`
        setUploadPhase('reading')
        setUploadProgress({ current: i + 1, total: files.length, fileName: file.name })

        try {
          setUploadPhase('parsing')
          const data = await parseSpreadsheetFile(file)
          if (!isCurrentUpload()) return

          const annotatedRows = annotateRowsFromFile(data.rows, file.name, fileId)
          nextRows.push(...annotatedRows)
          nextFileEntries.push({
            id: fileId,
            name: file.name,
            rowCount: data.rows.length,
            title: data.title || null,
            error: null
          })
          if (data.title && !parsedTitle) parsedTitle = data.title
          if (Array.isArray(data.warnings)) {
            nextWarnings.push(...data.warnings.map((warning) => `${file.name}: ${warning}`))
          }
        } catch (e) {
          fileErrors.push(`${file.name}: ${formatApiFetchError(e, { longRunning: true })}`)
          nextFileEntries.push({
            id: fileId,
            name: file.name,
            rowCount: 0,
            title: null,
            error: formatApiFetchError(e, { longRunning: true })
          })
        }
      }

      if (!isCurrentUpload()) return

      let mergedRows = []
      setRows((current) => {
        mergedRows = append
          ? assignDisplayIndices([...current, ...nextRows])
          : assignDisplayIndices(nextRows)
        return mergedRows
      })
      setUploadedFiles((current) => (append ? [...current, ...nextFileEntries] : nextFileEntries))
      setWarnings((current) => (append ? [...current, ...nextWarnings] : nextWarnings))
      if (parsedTitle) {
        setSpreadsheetTitle(parsedTitle)
        if (!companyName) setCompanyName(parsedTitle)
      }

      setUploading(false)
      setUploadPhase(null)
      setUploadProgress(null)

      const rowsToGeocode = mergedRows.filter(rowNeedsGeocoding)
      if (rowsToGeocode.length > 0 && fileErrors.length < files.length) {
        setGeocoding(true)
        setUploadPhase('geocoding')
        setUploadProgress({
          current: 0,
          total: rowsToGeocode.length,
          fileName: `${rowsToGeocode.length} address${rowsToGeocode.length === 1 ? '' : 'es'}`
        })
        try {
          const geocodeData = await geocodeBulkRows(rowsToGeocode)
          if (!isCurrentUpload()) return

          geocodeFailures = geocodeData.geocodeFailures || 0
          setRows((current) => assignDisplayIndices(mergeGeocodedRows(current, geocodeData.rows)))
        } catch (e) {
          setUploadError(
            `Spreadsheet parsed, but geocoding failed: ${formatApiFetchError(e, { longRunning: true })}. Fix addresses manually below.`
          )
        } finally {
          if (isCurrentUpload()) {
            setGeocoding(false)
            setUploadPhase(null)
            setUploadProgress(null)
          }
        }
      }

      if (fileErrors.length > 0) {
        setUploadError(
          fileErrors.length === files.length
            ? fileErrors.join(' ')
            : `Some files failed: ${fileErrors.join(' ')}`
        )
      } else if (geocodeFailures > 0) {
        setUploadError(
          `${geocodeFailures} address${geocodeFailures === 1 ? '' : 'es'} could not be geocoded. Fix them in the section below before calculating tax.`
        )
      } else if (mergedRows.length > 0 && fileErrors.length === 0) {
        setUploadError(null)
      }
    } catch (e) {
      if (isCurrentUpload()) {
        setUploadError(formatApiFetchError(e, { longRunning: true }))
      }
    } finally {
      if (isCurrentUpload()) {
        setUploadProgress(null)
        setUploadPhase(null)
        setUploading(false)
        setGeocoding(false)
      }
    }
  }

  const handleRemoveFile = (fileId) => {
    const entry = uploadedFiles.find((file) => file.id === fileId)
    if (!entry) return
    setUploadedFiles((current) => current.filter((file) => file.id !== fileId))
    setRows((current) => assignDisplayIndices(current.filter((row) => row.sourceFileId !== fileId)))
    setTaxSummary(null)
    setTaxError(null)
    setSubmitResults(null)
    setSubmitError(null)
  }

  const handleClearAllFiles = () => {
    setUploadedFiles([])
    setRows([])
    setWarnings([])
    setSpreadsheetTitle('')
    setUploadError(null)
    clearUploadState()
  }

  const handleCalculateTax = async () => {
    if (!product.name || !product.size) {
      setTaxError('Select a catalog product before calculating tax.')
      return
    }
    if (rows.length === 0) {
      setTaxError('Upload a spreadsheet first.')
      return
    }

    const missingAddress = rows.filter((row) => !isBulkRowAddressComplete(row))
    if (missingAddress.length > 0) {
      setTaxError(
        `${missingAddress.length} row(s) still need a complete address (street, city, state, zip). Use Fix address below.`
      )
      return
    }

    setTaxLoading(true)
    setTaxError(null)
    try {
      const response = await apiFetch('/api/manual-order/bulk-calculate-tax', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        timeoutMs: 600000,
        body: JSON.stringify({
          product: {
            name: product.name,
            size: product.size,
            quantity: parseInt(product.quantity, 10) || 1
          },
          rows
        })
      })
      const data = await parseApiJsonResponse(response)
      if (!response.ok || !data.success) {
        setTaxError(data.error || data.message || 'Tax calculation failed')
        return
      }
      mergeTaxResults(data.results || [])
      setTaxSummary(data.summary || null)
    } catch (e) {
      setTaxError(formatApiFetchError(e, { longRunning: true }))
    } finally {
      setTaxLoading(false)
    }
  }

  const handleSubmitAll = async () => {
    if (!storeName || !email) {
      setSubmitError('Retailer and contact email are required.')
      return
    }
    if (!product.name || !product.size) {
      setSubmitError('Select a catalog product before submitting.')
      return
    }
    if (rows.length === 0) {
      setSubmitError('Upload a spreadsheet first.')
      return
    }

    const rowsMissingTax = rows.filter((row) => row.salesTax == null)
    if (rowsMissingTax.length > 0) {
      setSubmitError('Calculate tax for all rows before submitting.')
      return
    }

    if (
      !window.confirm(
        `Create one Bevvi order for ${rows.length} recipient${rows.length === 1 ? '' : 's'} with combined totals?`
      )
    ) {
      return
    }

    setSubmitting(true)
    setSubmitError(null)
    setCombinedInvoice(null)
    setCombinedInvoiceError(null)
    setCombinedInvoiceRegenerated(false)

    try {
      const response = await apiFetch('/api/manual-order/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        timeoutMs: 300000,
        body: JSON.stringify({
          storeName,
          companyName,
          email,
          orderDate,
          externalOrderNumber,
          product: {
            name: product.name,
            size: product.size,
            quantity: parseInt(product.quantity, 10) || 1
          },
          rows,
          billToName: billToName.trim() || undefined,
          billToStreetAddress: billToStreetAddress.trim() || undefined,
          billToCity: billToCity.trim() || undefined,
          billToState: billToState.trim() || undefined,
          billToZip: billToZip.trim() || undefined
        })
      })
      const data = await parseApiJsonResponse(response)
      setSubmitResults(data)
      if (!response.ok || !data.success) {
        setSubmitError(data.message || data.error || 'Order creation failed')
      }
    } catch (e) {
      setSubmitError(formatApiFetchError(e, { longRunning: true }))
    } finally {
      setSubmitting(false)
    }
  }

  const readyToSubmit =
    rows.length > 0 &&
    rows.every((row) => isBulkRowAddressComplete(row) && row.salesTax != null)

  const submitBlockers = useMemo(() => {
    const blockers = []
    if (!storeName) blockers.push('Select a retailer')
    if (!email?.trim()) blockers.push('Enter contact email')
    if (!product.name || !product.size) blockers.push('Select a catalog product')
    const missingAddress = rows.filter((row) => !isBulkRowAddressComplete(row)).length
    if (missingAddress > 0) {
      blockers.push(`Fix ${missingAddress} address${missingAddress === 1 ? '' : 'es'}`)
    }
    const missingTax = rows.filter((row) => row.salesTax == null).length
    if (missingTax > 0) blockers.push('Calculate tax for all rows')
    return blockers
  }, [storeName, email, product.name, product.size, rows])

  const orderCreated = Boolean(submitResults?.success && submitResults?.orderNumber)

  const invoiceEligibleRows = useMemo(() => {
    if (!orderCreated) return []
    return rows.filter((row) => row.salesTax != null && isBulkRowAddressComplete(row))
  }, [rows, orderCreated])

  const createdOrderNumber = submitResults?.orderNumber || null
  const createdOrderNumbers = createdOrderNumber ? [createdOrderNumber] : []

  const combinedInvoicePaid =
    combinedInvoice?.invoiceStatus === 'paid' || combinedInvoice?.status === 'paid'

  const combinedInvoiceActive = Boolean(combinedInvoice?.url) || combinedInvoicePaid

  const loadBulkInvoice = useCallback(async () => {
    if (!createdOrderNumber) return

    const requestId = ++invoiceLookupRequestIdRef.current
    setCombinedInvoiceLookupLoading(true)
    setCombinedInvoiceError(null)
    try {
      const response = await apiFetch(
        `/api/manual-order/payment-link?orderNumber=${encodeURIComponent(createdOrderNumber)}`,
        { timeoutMs: 30000 }
      )
      const data = await response.json()
      if (requestId !== invoiceLookupRequestIdRef.current) return
      if (!response.ok || !data.success) {
        setCombinedInvoiceError(data.message || data.error || 'Failed to load invoice')
        setCombinedInvoice(null)
        return
      }
      const link = data.paymentLink
      setCombinedInvoice(link?.url || link?.invoiceStatus === 'paid' || link?.status === 'paid' ? link : null)
      setCombinedInvoiceRegenerated(false)
      setCombinedInvoiceVoidSuccess(false)
    } catch (e) {
      if (requestId !== invoiceLookupRequestIdRef.current) return
      setCombinedInvoiceError(formatApiFetchError(e))
      setCombinedInvoice(null)
    } finally {
      if (requestId === invoiceLookupRequestIdRef.current) {
        setCombinedInvoiceLookupLoading(false)
      }
    }
  }, [createdOrderNumber])

  useEffect(() => {
    if (!orderCreated || !createdOrderNumber) {
      invoiceLookupRequestIdRef.current += 1
      return undefined
    }
    loadBulkInvoice()
    return () => {
      invoiceLookupRequestIdRef.current += 1
    }
  }, [orderCreated, createdOrderNumber, loadBulkInvoice])

  const handleCreateCombinedInvoice = async (regenerate = false) => {
    if (!orderCreated) {
      setCombinedInvoiceError('Create the Bevvi order before creating a combined invoice.')
      return
    }
    if (invoiceEligibleRows.length === 0) {
      setCombinedInvoiceError('No submitted rows with tax are available for a combined invoice.')
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

    setCombinedInvoiceLoading(true)
    setCombinedInvoiceError(null)
    setCombinedInvoiceVoidSuccess(false)
    if (!regenerate) {
      setCombinedInvoiceRegenerated(false)
    }
    try {
      const response = await apiFetch('/api/manual-order/bulk/combined-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        timeoutMs: 180000,
        body: JSON.stringify({
          storeName,
          companyName,
          email,
          customerName: billToName.trim() || companyName,
          externalOrderNumber,
          product: {
            name: product.name,
            size: product.size,
            quantity: parseInt(product.quantity, 10) || 1
          },
          rows: invoiceEligibleRows,
          orderNumbers: createdOrderNumbers,
          billToName: billToName.trim() || undefined,
          billToStreetAddress: billToStreetAddress.trim() || undefined,
          billToCity: billToCity.trim() || undefined,
          billToState: billToState.trim() || undefined,
          billToZip: billToZip.trim() || undefined,
          regenerate
        })
      })
      const data = await response.json()
      if (!response.ok || !data.success) {
        setCombinedInvoiceError(
          response.status === 409
            ? data.error || 'The previous invoice has already been paid and cannot be regenerated.'
            : data.error || data.message || 'Failed to create invoice'
        )
        return
      }
      setCombinedInvoice(data.paymentLink || null)
      setCombinedInvoiceRegenerated(Boolean(data.regenerated))
    } catch (e) {
      setCombinedInvoiceError(formatApiFetchError(e))
    } finally {
      setCombinedInvoiceLoading(false)
    }
  }

  const handleVoidCombinedInvoice = async () => {
    if (!createdOrderNumber) return
    if (
      !window.confirm(
        'Void this Stripe invoice? The customer will no longer be able to pay using the current link. You can create a new invoice afterward if needed.'
      )
    ) {
      return
    }

    setCombinedInvoiceVoiding(true)
    setCombinedInvoiceError(null)
    try {
      const response = await apiFetch('/api/manual-order/payment-link/void', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderNumber: createdOrderNumber })
      })
      const data = await parseApiJsonResponse(response)
      if (!response.ok || !data.success) {
        setCombinedInvoiceError(
          response.status === 409
            ? data.error || 'This invoice has already been paid and cannot be voided.'
            : data.error || data.message || 'Failed to void invoice'
        )
        return
      }
      setCombinedInvoice(null)
      setCombinedInvoiceRegenerated(false)
      setCombinedInvoiceVoidSuccess(true)
      window.setTimeout(() => setCombinedInvoiceVoidSuccess(false), 10000)
    } catch (e) {
      setCombinedInvoiceError(formatApiFetchError(e))
    } finally {
      setCombinedInvoiceVoiding(false)
    }
  }

  const uploadBusy = uploading || geocoding

  const uploadStatusLabel = uploading
    ? uploadPhase === 'reading'
      ? 'Reading file…'
      : uploadProgress
        ? `Parsing ${uploadProgress.current}/${uploadProgress.total}…`
        : 'Parsing…'
    : geocoding
      ? uploadProgress
        ? `Geocoding ${uploadProgress.fileName}…`
        : 'Geocoding addresses…'
      : null

  const submitButtonLabel = submitting ? 'Creating order…' : 'Create order'

  const bulkTotals = useMemo(() => {
    const bottle = sumRows(rows, (row) => parseFloat(row.productPrice) || 0)
    const shipping = sumRows(rows, (row) => parseFloat(row.shipping) || 0)
    const service = sumRows(rows, (row) => parseFloat(row.service) || 0)
    const giftNote = sumRows(rows, (row) => parseFloat(row.giftNote) || 0)
    const preTax = sumRows(rows, getBulkRowPreTaxTotal)
    const tax = sumRows(rows, (row) => getBulkRowTaxTotal(row) ?? 0)
    const taxRowsCalculated = rows.filter((row) => row.salesTax != null).length
    const grandTotal =
      taxRowsCalculated === rows.length && rows.length > 0
        ? sumRows(rows, getBulkRowDisplayTotal)
        : preTax + (taxRowsCalculated > 0 ? tax : 0)

    return {
      bottle,
      shipping,
      service,
      giftNote,
      preTax,
      tax,
      taxRowsCalculated,
      grandTotal: Math.round(grandTotal * 100) / 100,
      allTaxCalculated: taxRowsCalculated === rows.length && rows.length > 0
    }
  }, [rows])

  return (
    <div className="space-y-8">
      {submitError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
          {submitError}
        </div>
      ) : null}

      {orderCreated ? (
        <>
          <div
            className="rounded-lg border border-green-200 bg-green-50 px-6 py-8 text-center"
            role="status"
            aria-live="polite"
          >
            <CheckCircle className="mx-auto h-10 w-10 text-green-600" aria-hidden />
            <p className="mt-3 text-lg font-semibold text-green-900">Order submitted successfully</p>
            <p className="mt-1 text-sm text-green-800">
              One Bevvi order for <strong>{submitResults.recipientCount ?? rows.length}</strong> recipient
              {(submitResults.recipientCount ?? rows.length) === 1 ? '' : 's'}.
            </p>
            <p className="mt-1 text-sm text-green-800">
              Order <strong>{submitResults.orderNumber}</strong>
              {submitResults.orderTotal != null ? (
                <> · {formatDollarAmount(submitResults.orderTotal)}</>
              ) : null}
            </p>
            {submitResults.addressSource === 'firstRecipient' ? (
              <p className="mt-2 text-xs text-green-700">
                Bill to address was not set — the first recipient address was used on the Bevvi order. Individual
                ship-to rows are saved with this order.
              </p>
            ) : null}
            <p className="mt-2 text-xs text-green-700">
              Create a Stripe invoice below to email the customer, or upload a new spreadsheet when you&apos;re done.
            </p>
          </div>

          <div className="space-y-4">
            {combinedInvoiceLookupLoading ? (
              <p className="flex items-center gap-2 text-sm text-gray-600">
                <Loader2 className="h-4 w-4 animate-spin" />
                Checking for an existing invoice…
              </p>
            ) : null}

            {combinedInvoiceError && !combinedInvoiceActive ? (
              <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
                {combinedInvoiceError}
              </p>
            ) : null}

            {combinedInvoiceVoidSuccess ? (
              <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-4 text-sm text-green-900">
                <p className="font-semibold">Invoice voided</p>
                <p className="mt-1 text-green-800">
                  The Stripe invoice for order <strong>{createdOrderNumber}</strong> has been voided. Create a new
                  invoice below if needed.
                </p>
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => handleCreateCombinedInvoice(false)}
                    disabled={combinedInvoiceLoading || invoiceEligibleRows.length === 0}
                    className="inline-flex items-center rounded-md bg-bevvi-800 px-4 py-2 text-sm font-medium text-white hover:bg-bevvi-900 disabled:opacity-60"
                  >
                    {combinedInvoiceLoading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Creating…
                      </>
                    ) : (
                      'Create invoice'
                    )}
                  </button>
                </div>
              </div>
            ) : combinedInvoicePaid ? (
              <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-4 text-sm text-green-900">
                <p className="font-semibold">Invoice paid</p>
                <p className="mt-1 text-green-800">
                  The Stripe invoice for order <strong>{createdOrderNumber}</strong> has been paid in full.
                </p>
                {combinedInvoice?.totalAmount != null ? (
                  <p className="mt-1 text-green-800">
                    Total: <strong>{formatDollarAmount(combinedInvoice.totalAmount)}</strong>
                  </p>
                ) : null}
                {combinedInvoice?.stripeDashboardUrl ? (
                  <div className="mt-3">
                    <a
                      href={combinedInvoice.stripeDashboardUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center rounded-md border border-green-300 bg-white px-3 py-2 text-sm font-medium text-green-900 hover:bg-green-100"
                    >
                      <ExternalLink className="mr-2 h-4 w-4" />
                      View in Stripe
                    </a>
                  </div>
                ) : null}
              </div>
            ) : combinedInvoice?.url ? (
              <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-4">
                <h4 className="text-sm font-semibold text-indigo-900">
                  {combinedInvoiceRegenerated ? 'New Stripe invoice created' : 'Stripe invoice ready'}
                </h4>
                {combinedInvoiceRegenerated ? (
                  <p className="mt-1 text-sm text-indigo-800">
                    The previous invoice was voided. Use the link below to pay or email the customer.
                  </p>
                ) : (
                  <p className="mt-1 text-sm text-indigo-800">
                    Email this invoice to the customer, or copy the link into your own message.
                  </p>
                )}
                <p className="mt-2 text-sm text-indigo-900">
                  {combinedInvoice.recipientCount != null ? (
                    <span className="mr-4">
                      Recipients: <strong>{combinedInvoice.recipientCount}</strong>
                    </span>
                  ) : null}
                  {combinedInvoice.totalAmount != null ? (
                    <span>
                      Total: <strong>{formatDollarAmount(combinedInvoice.totalAmount)}</strong>
                    </span>
                  ) : null}
                </p>
                {Array.isArray(combinedInvoice.stateTaxBreakdown) &&
                combinedInvoice.stateTaxBreakdown.length > 0 ? (
                  <ul className="mt-2 space-y-1 text-xs text-indigo-800">
                    {combinedInvoice.stateTaxBreakdown.map((entry) => (
                      <li key={entry.state}>
                        <strong>{entry.state}</strong>
                        {entry.salesTax > 0 ? (
                          <span> · Sales tax {formatDollarAmount(entry.salesTax)}</span>
                        ) : null}
                        {entry.serviceChargeTax > 0 ? (
                          <span> · Service tax {formatDollarAmount(entry.serviceChargeTax)}</span>
                        ) : null}
                        <span className="text-indigo-600">
                          {' '}
                          ({entry.recipientCount} recipient{entry.recipientCount === 1 ? '' : 's'})
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                  <a
                    href={buildPaymentEmailMailto({
                      customerEmail: combinedInvoice.customerEmail || email,
                      customerName: billToName.trim() || companyName,
                      orderNumber: createdOrderNumber || externalOrderNumber,
                      totalAmount: combinedInvoice.totalAmount ?? bulkTotals.grandTotal,
                      paymentUrl: combinedInvoice.url
                    })}
                    className="inline-flex items-center justify-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
                  >
                    <Mail className="mr-2 h-4 w-4" />
                    Email customer
                  </a>
                  <a
                    href={combinedInvoice.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center rounded-md border border-indigo-300 bg-white px-4 py-2 text-sm font-medium text-indigo-800 hover:bg-indigo-100"
                  >
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Open invoice
                  </a>
                  {combinedInvoice.stripeDashboardUrl ? (
                    <a
                      href={combinedInvoice.stripeDashboardUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center rounded-md border border-indigo-300 bg-white px-4 py-2 text-sm font-medium text-indigo-800 hover:bg-indigo-100"
                    >
                      <ExternalLink className="mr-2 h-4 w-4" />
                      View in Stripe
                    </a>
                  ) : null}
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(combinedInvoice.url)
                        setCombinedInvoiceCopied(true)
                        window.setTimeout(() => setCombinedInvoiceCopied(false), 2000)
                      } catch {
                        setCombinedInvoiceError('Could not copy link to clipboard')
                      }
                    }}
                    className="inline-flex items-center justify-center rounded-md border border-indigo-300 bg-white px-4 py-2 text-sm font-medium text-indigo-800 hover:bg-indigo-100"
                  >
                    <Copy className="mr-2 h-4 w-4" />
                    {combinedInvoiceCopied ? 'Copied!' : 'Copy link'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCreateCombinedInvoice(true)}
                    disabled={combinedInvoiceLoading || combinedInvoiceVoiding}
                    className="inline-flex items-center justify-center rounded-md border border-indigo-300 bg-white px-4 py-2 text-sm font-medium text-indigo-800 hover:bg-indigo-100 disabled:opacity-60"
                  >
                    {combinedInvoiceLoading ? (
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
                    onClick={handleVoidCombinedInvoice}
                    disabled={combinedInvoiceLoading || combinedInvoiceVoiding}
                    className="inline-flex items-center justify-center rounded-md border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-800 hover:bg-red-50 disabled:opacity-60"
                  >
                    {combinedInvoiceVoiding ? (
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
                {!combinedInvoiceRegenerated ? (
                  <p className="mt-2 text-xs text-indigo-700">
                    Need updated line items or totals? Regenerate to void this invoice and create a fresh one.
                  </p>
                ) : null}
              </div>
            ) : !combinedInvoiceLookupLoading ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900">
                <p className="font-semibold">Create a Stripe invoice?</p>
                <p className="mt-1 text-amber-800">
                  The order was submitted. Create an itemized invoice for{' '}
                  <strong>{formatDollarAmount(submitResults.orderTotal ?? bulkTotals.grandTotal)}</strong>
                  {createdOrderNumber ? (
                    <> (order <strong>{createdOrderNumber}</strong>)</>
                  ) : null}{' '}
                  — {invoiceEligibleRows.length} recipient{invoiceEligibleRows.length === 1 ? '' : 's'} with sales
                  tax by state — so you can email it to the customer.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => handleCreateCombinedInvoice(false)}
                    disabled={combinedInvoiceLoading || invoiceEligibleRows.length === 0}
                    className="inline-flex items-center justify-center rounded-md bg-amber-700 px-4 py-2 text-sm font-medium text-white hover:bg-amber-800 disabled:opacity-60"
                  >
                    {combinedInvoiceLoading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Creating invoice…
                      </>
                    ) : (
                      'Yes, create invoice'
                    )}
                  </button>
                </div>
              </div>
            ) : null}

            {combinedInvoiceError && combinedInvoiceActive ? (
              <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
                {combinedInvoiceError}
              </p>
            ) : null}
          </div>
        </>
      ) : null}

      <section className="rounded-lg border border-bevvi-primary-100 bg-bevvi-primary-50/40 p-4">
        <h3 className="text-base font-semibold text-gray-900 flex items-center">
          <FileSpreadsheet className="mr-2 h-5 w-5 text-bevvi-primary-600" />
          Bulk spreadsheet upload
        </h3>
        <p className="mt-1 text-sm text-gray-600">
          Upload one or more spreadsheets with one row per recipient — names, shipping addresses, bottle price,
          shipping, service, and gift note. Tax is calculated per address, then everything is submitted as{' '}
          <strong>one consolidated Bevvi order</strong>.
        </p>
        <p className="mt-1 text-xs text-gray-500">
          Expected columns: First, Last, Address (or Address 1 + City + State + Zip), Price of the Bottle,
          Shipping, Service, Gift Note. Split-address and single-address formats are both supported.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => openFilePicker(false)}
            disabled={uploadBusy || submitting}
            className="inline-flex items-center rounded-md bg-bevvi-800 px-4 py-2 text-sm font-medium text-white hover:bg-bevvi-900 disabled:opacity-60"
          >
            {uploadBusy ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {uploadStatusLabel}
              </>
            ) : (
              <>
                <Upload className="mr-2 h-4 w-4" />
                Choose spreadsheet{uploadedFiles.length > 0 ? 's' : ''}
              </>
            )}
          </button>
          {uploadedFiles.length > 0 ? (
            <button
              type="button"
              onClick={() => openFilePicker(true)}
              disabled={uploadBusy || submitting}
              className="inline-flex items-center rounded-md border border-bevvi-primary-300 bg-white px-3 py-2 text-sm font-medium text-bevvi-primary-700 hover:bg-bevvi-primary-50 disabled:opacity-60"
            >
              <Upload className="mr-2 h-4 w-4" />
              Add more files
            </button>
          ) : null}
          {uploadedFiles.length > 0 ? (
            <button
              type="button"
              onClick={handleClearAllFiles}
              disabled={uploadBusy || submitting}
              className="inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
            >
              Clear all
            </button>
          ) : null}
          {rows.length > 0 ? (
            <span className="text-sm font-medium text-green-800">
              {rows.length} recipient{rows.length === 1 ? '' : 's'} from {uploadedFiles.filter((f) => !f.error).length} file
              {uploadedFiles.filter((f) => !f.error).length === 1 ? '' : 's'}
            </span>
          ) : null}
        </div>

        <div
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') openFilePicker(uploadedFiles.length > 0)
          }}
          onClick={() => !uploadBusy && openFilePicker(uploadedFiles.length > 0)}
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
          onDrop={(event) => {
            event.preventDefault()
            setDragActive(false)
            if (!uploadBusy) {
              handleFiles(Array.from(event.dataTransfer.files || []), { append: uploadedFiles.length > 0 })
            }
          }}
          className={`mt-4 cursor-pointer rounded-md border border-dashed px-4 py-5 text-center transition-colors ${
            dragActive
              ? 'border-bevvi-primary-400 bg-white'
              : 'border-gray-300 bg-white/80 hover:border-bevvi-primary-300'
          } ${uploadBusy ? 'pointer-events-none opacity-70' : ''}`}
        >
          <FileSpreadsheet className="mx-auto h-8 w-8 text-gray-400" />
          {uploadBusy ? (
            <>
              <p className="mt-2 flex items-center justify-center gap-2 text-sm text-gray-700">
                <Loader2 className="h-4 w-4 animate-spin" />
                {uploadStatusLabel}
              </p>
              {geocoding ? (
                <p className="mt-1 text-xs text-gray-500">
                  Large lists can take a few minutes — recipients appear as soon as parsing finishes
                </p>
              ) : null}
            </>
          ) : (
            <>
              <p className="mt-2 text-sm text-gray-700">
                Drag and drop one or more spreadsheets here
              </p>
              <p className="mt-1 text-xs text-gray-500">Excel or CSV, up to 10 MB each</p>
            </>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
          className="sr-only"
          onChange={(e) => {
            const selectedFiles = Array.from(e.target.files || [])
            const append = appendNextUploadRef.current
            appendNextUploadRef.current = false
            e.target.value = ''
            if (selectedFiles.length > 0) {
              handleFiles(selectedFiles, { append })
            }
          }}
        />

        {uploadedFiles.length > 0 ? (
          <ul className="mt-4 space-y-2">
            {uploadedFiles.map((file) => (
              <li
                key={file.id}
                className={`flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm ${
                  file.error ? 'border-red-200 bg-red-50 text-red-900' : 'border-gray-200 bg-white text-gray-800'
                }`}
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{file.name}</p>
                  <p className="text-xs text-gray-500">
                    {file.error
                      ? file.error
                      : `${file.rowCount} recipient${file.rowCount === 1 ? '' : 's'}${file.title ? ` · ${file.title}` : ''}`}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemoveFile(file.id)}
                  disabled={uploadBusy || submitting}
                  className="inline-flex flex-shrink-0 items-center rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-800 disabled:opacity-50"
                  title="Remove file"
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {uploadError ? (
          <p className="mt-3 text-sm text-amber-800" role="alert">{uploadError}</p>
        ) : null}
        {warnings.length > 0 ? (
          <ul className="mt-3 space-y-1 text-xs text-amber-800">
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="space-y-4">
        <h3 className="text-base font-semibold text-gray-900">Order settings</h3>
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
            <label htmlFor="bulkCompanyName" className={labelClass}>Company name</label>
            <input
              id="bulkCompanyName"
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder={spreadsheetTitle || 'PDSI Employees'}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="bulkEmail" className={labelClass}>
              Contact email <span className="text-red-600">*</span>
            </label>
            <input
              id="bulkEmail"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
              required
            />
            <p className="mt-1 text-xs text-gray-500">
              Must be a registered Bevvi account email — used for the order and Stripe invoice.
            </p>
          </div>
          <div>
            <label htmlFor="bulkOrderDate" className={labelClass}>Order date</label>
            <input
              id="bulkOrderDate"
              type="date"
              value={orderDate}
              onChange={(e) => setOrderDate(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="bulkExternalOrderNumber" className={labelClass}>External PO / reference</label>
            <input
              id="bulkExternalOrderNumber"
              type="text"
              value={externalOrderNumber}
              onChange={(e) => setExternalOrderNumber(e.target.value)}
              className={inputClass}
            />
          </div>
          <div className="sm:col-span-2">
            <BulkProductPicker product={product} onChange={setProduct} disabled={submitting} />
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h3 className="text-base font-semibold text-gray-900">
          Bill to <span className="text-sm font-normal text-gray-500">(optional)</span>
        </h3>
        <p className="text-sm text-gray-600">
          Billing contact on the consolidated Bevvi order and Stripe invoice. Recommended — if omitted, the first
          recipient address is used and all ship-to rows are saved with the order.
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor="bulkBillToName" className={labelClass}>Bill to name</label>
            <input
              id="bulkBillToName"
              type="text"
              value={billToName}
              onChange={(e) => setBillToName(e.target.value)}
              placeholder={companyName || 'Person or company name'}
              className={inputClass}
              disabled={submitting}
            />
          </div>
          {AddressLookupField ? (
            <AddressLookupField
              value={billToAddressInput}
              onChange={setBillToAddressInput}
              inputClass={inputClass}
              labelClass={labelClass}
              label="Bill to address"
              inputId="bulkBillToAddress"
              onResolved={(parsed) => {
                setBillToStreetAddress(parsed.streetAddress || '')
                setBillToCity(parsed.city || '')
                setBillToState(parsed.state || '')
                setBillToZip(parsed.zip || '')
              }}
              onClear={() => {
                setBillToStreetAddress('')
                setBillToCity('')
                setBillToState('')
                setBillToZip('')
              }}
            />
          ) : null}
        </div>
      </section>

      {rows.length > 0 ? (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-base font-semibold text-gray-900">Recipients</h3>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleCalculateTax}
                disabled={taxLoading || submitting || !product.name}
                className="inline-flex items-center rounded-md border border-indigo-300 bg-white px-3 py-2 text-sm font-medium text-indigo-800 hover:bg-indigo-50 disabled:opacity-60"
              >
                {taxLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Calculating tax ({rows.length} rows)…
                  </>
                ) : (
                  <>
                    <Calculator className="mr-2 h-4 w-4" />
                    Calculate tax for all
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={handleSubmitAll}
                disabled={submitting || !readyToSubmit || !storeName || !email}
                className="inline-flex items-center rounded-md bg-bevvi-800 px-4 py-2 text-sm font-medium text-white hover:bg-bevvi-900 disabled:opacity-60"
              >
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {submitButtonLabel}
                  </>
                ) : (
                  <>
                    <Send className="mr-2 h-4 w-4" />
                    Create order
                  </>
                )}
              </button>
            </div>
          </div>

          {taxError ? (
            <p className="text-sm text-red-700" role="alert">{taxError}</p>
          ) : null}

          {rowsNeedingAddress.length > 0 ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-4">
              <h4 className="text-sm font-semibold text-amber-950">
                {rowsNeedingAddress.length} address{rowsNeedingAddress.length === 1 ? '' : 'es'} need attention
              </h4>
              <p className="mt-1 text-sm text-amber-900">
                Search with Google or enter street, city, state, and zip manually for each recipient below.
              </p>
              <div className="mt-4 space-y-4">
                {rowsNeedingAddress.map((row) => (
                  <BulkRowAddressEditor
                    key={row.bulkRowId}
                    row={row}
                    AddressLookupField={AddressLookupField}
                    disabled={submitting || taxLoading}
                    onSave={(fields) => updateRowAddress(row.bulkRowId, fields)}
                  />
                ))}
              </div>
            </div>
          ) : null}

          {editingRow && isBulkRowAddressComplete(editingRow) ? (
            <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-4">
              <h4 className="text-sm font-semibold text-indigo-950">Edit address</h4>
              <div className="mt-3">
                <BulkRowAddressEditor
                  row={editingRow}
                  AddressLookupField={AddressLookupField}
                  disabled={submitting || taxLoading}
                  onSave={(fields) => updateRowAddress(editingRow.bulkRowId, fields)}
                  onCancel={() => setEditingRowId(null)}
                />
              </div>
            </div>
          ) : null}

          {taxSummary ? (
            <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-900">
              <p>
                Tax calculated for <strong>{taxSummary.successCount}</strong> of{' '}
                <strong>{taxSummary.rowCount}</strong> rows.
              </p>
            </div>
          ) : null}

          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <h4 className="text-sm font-semibold text-gray-900">Order totals</h4>
            <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3 lg:grid-cols-4">
              <div className="flex justify-between gap-4 sm:block">
                <dt className="text-gray-600">Bottles</dt>
                <dd className="font-medium tabular-nums text-gray-900">{formatDollarAmount(bulkTotals.bottle)}</dd>
              </div>
              <div className="flex justify-between gap-4 sm:block">
                <dt className="text-gray-600">Shipping</dt>
                <dd className="font-medium tabular-nums text-gray-900">{formatDollarAmount(bulkTotals.shipping)}</dd>
              </div>
              <div className="flex justify-between gap-4 sm:block">
                <dt className="text-gray-600">Service</dt>
                <dd className="font-medium tabular-nums text-gray-900">{formatDollarAmount(bulkTotals.service)}</dd>
              </div>
              <div className="flex justify-between gap-4 sm:block">
                <dt className="text-gray-600">Gift note</dt>
                <dd className="font-medium tabular-nums text-gray-900">{formatDollarAmount(bulkTotals.giftNote)}</dd>
              </div>
              <div className="flex justify-between gap-4 sm:block">
                <dt className="text-gray-600">Subtotal (pre-tax)</dt>
                <dd className="font-medium tabular-nums text-gray-900">{formatDollarAmount(bulkTotals.preTax)}</dd>
              </div>
              <div className="flex justify-between gap-4 sm:block">
                <dt className="text-gray-600">Sales tax</dt>
                <dd className="font-medium tabular-nums text-gray-900">
                  {bulkTotals.taxRowsCalculated > 0
                    ? formatDollarAmount(bulkTotals.tax)
                    : '—'}
                </dd>
              </div>
              <div className="col-span-2 flex justify-between gap-4 border-t border-gray-200 pt-2 sm:col-span-3 lg:col-span-4">
                <dt className="font-semibold text-gray-900">
                  Grand total
                  {!bulkTotals.allTaxCalculated && bulkTotals.taxRowsCalculated === 0 ? (
                    <span className="ml-1 text-xs font-normal text-gray-500">(pre-tax)</span>
                  ) : !bulkTotals.allTaxCalculated ? (
                    <span className="ml-1 text-xs font-normal text-gray-500">(partial tax)</span>
                  ) : null}
                </dt>
                <dd className="text-base font-semibold tabular-nums text-gray-900">
                  {formatDollarAmount(bulkTotals.grandTotal)}
                </dd>
              </div>
            </dl>
            <p className="mt-2 text-xs text-gray-500">
              {bulkTotals.allTaxCalculated
                ? `${rows.length} recipients · one consolidated order`
                : bulkTotals.taxRowsCalculated > 0
                  ? `Tax calculated for ${bulkTotals.taxRowsCalculated} of ${rows.length} rows — calculate tax for all to finalize grand total`
                  : `${rows.length} recipients · calculate tax to include sales tax in grand total`}
            </p>
          </div>

          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-gray-700">#</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-700">File</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-700">Recipient</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-700">Address</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-700">Bottle</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-700">Ship</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-700">Service</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-700">Gift</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-700">Tax</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-700">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {rows.map((row) => (
                  <tr
                    key={row.bulkRowId}
                    className={!isBulkRowAddressComplete(row) ? 'bg-red-50' : ''}
                  >
                    <td className="px-3 py-2 text-gray-500">{row.displayIndex ?? row.rowIndex}</td>
                    <td className="px-3 py-2 text-xs text-gray-500">{row.sourceFile}</td>
                    <td className="px-3 py-2 font-medium text-gray-900">{row.customerName}</td>
                    <td className="px-3 py-2 text-gray-700">
                      <div className="flex items-start gap-2">
                        <MapPin className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-gray-400" />
                        <div className="min-w-0 flex-1">
                          {isBulkRowAddressComplete(row) ? (
                            <>
                              <span>{row.formattedAddress || row.addressRaw}</span>
                              <span className="mt-0.5 block text-xs text-gray-500">
                                {row.streetAddress}, {row.city}, {row.state} {row.zip}
                                {row.geocodeStatus === 'manual' ? ' · edited' : null}
                              </span>
                            </>
                          ) : (
                            <>
                              <span className="text-red-800">
                                {row.addressRaw || row.formattedAddress || 'Address missing'}
                              </span>
                              {row.geocodeError ? (
                                <span className="mt-0.5 block text-xs text-red-700">{row.geocodeError}</span>
                              ) : (
                                <span className="mt-0.5 block text-xs text-red-700">
                                  Enter street, city, state, and zip below
                                </span>
                              )}
                            </>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              if (isBulkRowAddressComplete(row)) {
                                setEditingRowId(row.bulkRowId)
                              } else {
                                document
                                  .getElementById(`bulk-address-editor-${row.bulkRowId}`)
                                  ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                              }
                            }}
                            disabled={submitting}
                            className="mt-1 inline-flex items-center text-xs font-medium text-indigo-700 hover:text-indigo-900 disabled:opacity-50"
                          >
                            <Pencil className="mr-1 h-3 w-3" />
                            {isBulkRowAddressComplete(row) ? 'Edit address' : 'Fix address'}
                          </button>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatDollarAmount(row.productPrice)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatDollarAmount(row.shipping)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatDollarAmount(row.service)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatDollarAmount(row.giftNote)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {row.salesTax != null ? (
                        formatDollarAmount((row.salesTax || 0) + (row.serviceChargeTax || 0))
                      ) : row.taxError ? (
                        <span className="text-xs text-red-700">{row.taxError}</span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">
                      {formatDollarAmount(getBulkRowDisplayTotal(row))}
                      {row.orderTotal == null && row.salesTax == null ? (
                        <span className="block text-[10px] font-normal text-gray-500">pre-tax</span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-50 font-semibold text-gray-900">
                <tr>
                  <td colSpan={4} className="px-3 py-2 text-right text-sm">
                    Totals ({rows.length} recipients)
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatDollarAmount(bulkTotals.bottle)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatDollarAmount(bulkTotals.shipping)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatDollarAmount(bulkTotals.service)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatDollarAmount(bulkTotals.giftNote)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {bulkTotals.taxRowsCalculated > 0 ? formatDollarAmount(bulkTotals.tax) : '—'}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatDollarAmount(bulkTotals.grandTotal)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h4 className="text-sm font-semibold text-gray-900">Ready to create order?</h4>
                <p className="mt-1 text-sm text-gray-600">
                  {readyToSubmit
                    ? `Create one Bevvi order for ${rows.length} recipient${rows.length === 1 ? '' : 's'} with combined totals.`
                    : 'Complete the steps below, then create the order in Bevvi.'}
                </p>
                {!readyToSubmit && submitBlockers.length > 0 ? (
                  <ul className="mt-2 space-y-1 text-sm text-amber-900">
                    {submitBlockers.map((blocker) => (
                      <li key={blocker} className="flex items-center gap-1.5">
                        <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                        {blocker}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleCalculateTax}
                  disabled={taxLoading || submitting || !product.name}
                  className="inline-flex items-center rounded-md border border-indigo-300 bg-white px-4 py-2 text-sm font-medium text-indigo-800 hover:bg-indigo-50 disabled:opacity-60"
                >
                  {taxLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Calculating tax ({rows.length} rows)…
                    </>
                  ) : (
                    <>
                      <Calculator className="mr-2 h-4 w-4" />
                      Calculate tax
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={handleSubmitAll}
                  disabled={submitting || !readyToSubmit || !storeName || !email}
                  className="inline-flex items-center rounded-md bg-bevvi-800 px-5 py-2.5 text-sm font-semibold text-white hover:bg-bevvi-900 disabled:opacity-60"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {submitButtonLabel}
                    </>
                  ) : (
                    <>
                      <Send className="mr-2 h-4 w-4" />
                      Create order
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  )
}

export default ManualOrderBulkUpload
