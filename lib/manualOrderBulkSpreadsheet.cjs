const XLSX = require('xlsx-js-style')

const HEADER_ALIASES = {
  firstName: ['first', 'first name', 'firstname', 'fname'],
  lastName: ['last', 'last name', 'lastname', 'lname', 'surname'],
  companyName: ['company name', 'company', 'organization', 'employer'],
  shipToType: ['ship to', 'ship to type', 'delivery type', 'ship to: home or office'],
  streetAddress: [
    'address 1',
    'address1',
    'address line 1',
    'address line1',
    'street address',
    'street',
    'addr1'
  ],
  city: ['office city', 'city', 'delivery city', 'ship city', 'town'],
  state: ['office state', 'state', 'delivery state', 'ship state', 'st'],
  zip: ['office zip', 'zip code', 'zip', 'postal code', 'delivery zip', 'postal'],
  address: ['address', 'shipping address', 'delivery address', 'recipient address', 'full address'],
  productPrice: [
    'price of the bottle',
    'bottle price',
    'product price',
    'item price',
    'unit price'
  ],
  shipping: ['shipping', 'shipping fee', 'shipping charge', 'ship fee'],
  service: ['service', 'service charge', 'service fee'],
  giftNote: ['gift note', 'gift note charge', 'gift message', 'engraving', 'gift card'],
  total: ['total', 'order total', 'line total', 'amount'],
  email: ['email', 'e-mail', 'email address'],
  productName: ['product', 'product name', 'item', 'bottle', 'wine', 'sku']
}

function normalizeHeader(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function matchHeaderColumn(header, aliases) {
  const normalized = normalizeHeader(header)
  if (!normalized) return false
  return aliases.some((alias) => normalized === alias || normalized.includes(alias))
}

function headerRowHasAddressColumns(texts) {
  const hasCombinedAddress = texts.some((text) => matchHeaderColumn(text, HEADER_ALIASES.address))
  const hasStreet = texts.some((text) => matchHeaderColumn(text, HEADER_ALIASES.streetAddress))
  const hasCity = texts.some((text) => matchHeaderColumn(text, HEADER_ALIASES.city))
  const hasZip = texts.some((text) => matchHeaderColumn(text, HEADER_ALIASES.zip))
  return hasCombinedAddress || (hasStreet && (hasCity || hasZip))
}

function findHeaderRowIndex(rows) {
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const row = rows[i] || []
    const texts = row.map((cell) => normalizeHeader(cell))
    const hasFirst = texts.some((text) => matchHeaderColumn(text, HEADER_ALIASES.firstName))
    if (hasFirst && headerRowHasAddressColumns(texts)) return i
  }
  return -1
}

function buildColumnMap(headerRow) {
  const map = {}
  const fieldPriority = [
    'firstName',
    'lastName',
    'companyName',
    'shipToType',
    'streetAddress',
    'city',
    'state',
    'zip',
    'address',
    'productPrice',
    'shipping',
    'service',
    'giftNote',
    'total',
    'email',
    'productName'
  ]

  headerRow.forEach((cell, index) => {
    const text = normalizeHeader(cell)
    if (!text) return
    for (const field of fieldPriority) {
      if (map[field] != null) continue
      if (matchHeaderColumn(text, HEADER_ALIASES[field])) {
        map[field] = index
        break
      }
    }
  })
  return map
}

function parseMoney(value) {
  if (value == null || value === '') return null
  if (typeof value === 'number' && !Number.isNaN(value)) return Math.round(value * 100) / 100
  const cleaned = String(value).replace(/[$,\s]/g, '')
  const parsed = parseFloat(cleaned)
  return Number.isNaN(parsed) ? null : Math.round(parsed * 100) / 100
}

function cellValue(row, index) {
  if (index == null || index < 0) return null
  const value = row[index]
  if (value == null) return null
  if (typeof value === 'string') {
    const trimmed = value.replace(/\u00a0/g, ' ').trim()
    return trimmed || null
  }
  return value
}

function normalizeZip(value) {
  if (value == null || value === '') return ''
  if (typeof value === 'number' && !Number.isNaN(value)) {
    const digits = String(Math.round(value))
    if (digits.length <= 5) return digits.padStart(5, '0')
    return digits.slice(0, 10)
  }
  const cleaned = String(value).trim().replace(/[^\d-]/g, '')
  if (/^\d{1,5}$/.test(cleaned)) return cleaned.padStart(5, '0')
  return cleaned.slice(0, 10)
}

function normalizeState(value) {
  const text = String(value || '')
    .trim()
    .replace(/\u00a0/g, ' ')
    .toUpperCase()
  if (!text) return ''
  if (text.length === 2) return text
  const stateNames = {
    ALABAMA: 'AL',
    ALASKA: 'AK',
    ARIZONA: 'AZ',
    ARKANSAS: 'AR',
    CALIFORNIA: 'CA',
    COLORADO: 'CO',
    CONNECTICUT: 'CT',
    DELAWARE: 'DE',
    FLORIDA: 'FL',
    GEORGIA: 'GA',
    HAWAII: 'HI',
    IDAHO: 'ID',
    ILLINOIS: 'IL',
    INDIANA: 'IN',
    IOWA: 'IA',
    KANSAS: 'KS',
    KENTUCKY: 'KY',
    LOUISIANA: 'LA',
    MAINE: 'ME',
    MARYLAND: 'MD',
    MASSACHUSETTS: 'MA',
    MICHIGAN: 'MI',
    MINNESOTA: 'MN',
    MISSISSIPPI: 'MS',
    MISSOURI: 'MO',
    MONTANA: 'MT',
    NEBRASKA: 'NE',
    NEVADA: 'NV',
    'NEW HAMPSHIRE': 'NH',
    'NEW JERSEY': 'NJ',
    'NEW MEXICO': 'NM',
    'NEW YORK': 'NY',
    'NORTH CAROLINA': 'NC',
    'NORTH DAKOTA': 'ND',
    OHIO: 'OH',
    OKLAHOMA: 'OK',
    OREGON: 'OR',
    PENNSYLVANIA: 'PA',
    'RHODE ISLAND': 'RI',
    'SOUTH CAROLINA': 'SC',
    'SOUTH DAKOTA': 'SD',
    TENNESSEE: 'TN',
    TEXAS: 'TX',
    UTAH: 'UT',
    VERMONT: 'VT',
    VIRGINIA: 'VA',
    WASHINGTON: 'WA',
    'WEST VIRGINIA': 'WV',
    WISCONSIN: 'WI',
    WYOMING: 'WY',
    'DISTRICT OF COLUMBIA': 'DC'
  }
  return stateNames[text] || text.slice(0, 2)
}

function parseUsAddressFallback(rawAddress) {
  const text = String(rawAddress || '')
    .trim()
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
  if (!text) return null

  const commaStateZipMatch = text.match(/^(.+?),\s*([^,]+?),\s*([A-Z]{2}),?\s*(\d{5}(?:-\d{4})?)$/i)
  if (commaStateZipMatch) {
    return {
      streetAddress: commaStateZipMatch[1].trim(),
      city: commaStateZipMatch[2].trim(),
      state: commaStateZipMatch[3].toUpperCase(),
      zip: commaStateZipMatch[4]
    }
  }

  const cityZipOnlyMatch = text.match(/^(.+?),\s*([^,]+?)\s+(\d{5}(?:-\d{4})?)$/i)
  if (cityZipOnlyMatch) {
    return {
      streetAddress: cityZipOnlyMatch[1].trim(),
      city: cityZipOnlyMatch[2].trim(),
      state: '',
      zip: cityZipOnlyMatch[3]
    }
  }

  const commaMatch = text.match(/^(.+?),\s*([^,]+?),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/i)
  if (commaMatch) {
    return {
      streetAddress: commaMatch[1].trim(),
      city: commaMatch[2].trim(),
      state: commaMatch[3].toUpperCase(),
      zip: commaMatch[4]
    }
  }

  const stateZipMatch = text.match(/^(.+?)\s+([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/i)
  if (stateZipMatch) {
    const beforeState = stateZipMatch[1].trim()
    const cityStreetMatch = beforeState.match(/^(.+?),\s*(.+)$/)
    if (cityStreetMatch) {
      return {
        streetAddress: cityStreetMatch[1].trim(),
        city: cityStreetMatch[2].trim(),
        state: stateZipMatch[2].toUpperCase(),
        zip: stateZipMatch[3]
      }
    }
    const lastComma = beforeState.lastIndexOf(',')
    if (lastComma > 0) {
      return {
        streetAddress: beforeState.slice(0, lastComma).trim(),
        city: beforeState.slice(lastComma + 1).trim(),
        state: stateZipMatch[2].toUpperCase(),
        zip: stateZipMatch[3]
      }
    }
    const lastSpace = beforeState.lastIndexOf(' ')
    if (lastSpace > 0) {
      return {
        streetAddress: beforeState.slice(0, lastSpace).trim(),
        city: beforeState.slice(lastSpace + 1).trim(),
        state: stateZipMatch[2].toUpperCase(),
        zip: stateZipMatch[3]
      }
    }
  }

  return null
}

function resolveSpreadsheetAddress(row, columnMap) {
  const streetFromColumn = String(cellValue(row, columnMap.streetAddress) || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s*\n\s*/g, ', ')
    .trim()
  const combinedAddress = String(cellValue(row, columnMap.address) || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s*\n\s*/g, ', ')
    .trim()
  const city = String(cellValue(row, columnMap.city) || '').trim()
  const state = normalizeState(cellValue(row, columnMap.state))
  const zip = normalizeZip(cellValue(row, columnMap.zip))

  const streetAddress = streetFromColumn || combinedAddress
  if (streetAddress && city && state && zip) {
    return {
      streetAddress,
      city,
      state,
      zip,
      addressRaw: `${streetAddress}, ${city}, ${state} ${zip}`,
      geocodeStatus: 'spreadsheet'
    }
  }

  if (combinedAddress) {
    const fallback = parseUsAddressFallback(combinedAddress)
    if (fallback) {
      return {
        ...fallback,
        addressRaw: combinedAddress,
        geocodeStatus: 'parsed'
      }
    }
    return {
      streetAddress: '',
      city: '',
      state: '',
      zip: '',
      addressRaw: combinedAddress,
      geocodeStatus: 'pending'
    }
  }

  return {
    streetAddress: streetFromColumn,
    city,
    state,
    zip,
    addressRaw: '',
    geocodeStatus: streetFromColumn && city && state && zip ? 'spreadsheet' : 'pending'
  }
}

function extractSpreadsheetTitle(rows, headerRowIndex) {
  for (let i = 0; i < headerRowIndex; i++) {
    const row = rows[i] || []
    for (const cell of row) {
      const text = String(cell || '').trim()
      if (text && text.length > 2 && !/^\d+$/.test(text)) return text
    }
  }
  return null
}

function rowHasRecipientData(row, columnMap) {
  const firstName = cellValue(row, columnMap.firstName)
  const lastName = cellValue(row, columnMap.lastName)
  const street = cellValue(row, columnMap.streetAddress) || cellValue(row, columnMap.address)
  const price = parseMoney(cellValue(row, columnMap.productPrice))
  return Boolean(String(firstName || lastName || street || '').trim() || price != null)
}

function parseBulkOrderSpreadsheet(buffer, fileName = '') {
  const readAsArray = buffer instanceof ArrayBuffer || ArrayBuffer.isView(buffer)
  const workbook = XLSX.read(buffer, {
    type: readAsArray ? 'array' : 'buffer',
    cellDates: true
  })
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) {
    return { success: false, error: 'Spreadsheet has no sheets' }
  }

  const sheet = workbook.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true })
  if (!rows.length) {
    return { success: false, error: 'Spreadsheet is empty' }
  }

  const headerRowIndex = findHeaderRowIndex(rows)
  if (headerRowIndex < 0) {
    return {
      success: false,
      error:
        'Could not find a header row. Expected columns like First Name, Address (or Address 1 / City / State / Zip), Price of the Bottle, Shipping, Service.'
    }
  }

  const columnMap = buildColumnMap(rows[headerRowIndex])
  if (columnMap.firstName == null && columnMap.lastName == null) {
    return { success: false, error: 'Spreadsheet must include First and/or Last name columns.' }
  }
  if (
    columnMap.address == null &&
    (columnMap.streetAddress == null || (columnMap.city == null && columnMap.zip == null))
  ) {
    return {
      success: false,
      error: 'Spreadsheet must include an Address column or Address 1 + City/State/Zip columns.'
    }
  }

  const title = extractSpreadsheetTitle(rows, headerRowIndex)
  const parsedRows = []
  const warnings = []

  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const row = rows[i] || []
    if (!rowHasRecipientData(row, columnMap)) continue

    const firstName = String(cellValue(row, columnMap.firstName) || '').trim()
    const lastName = String(cellValue(row, columnMap.lastName) || '').trim()
    const company = String(cellValue(row, columnMap.companyName) || '').trim()
    const shipToType = String(cellValue(row, columnMap.shipToType) || '').trim()
    const resolvedAddress = resolveSpreadsheetAddress(row, columnMap)
    const productPrice = parseMoney(cellValue(row, columnMap.productPrice))
    const shipping = parseMoney(cellValue(row, columnMap.shipping)) ?? 0
    const service = parseMoney(cellValue(row, columnMap.service)) ?? 0
    const giftNote = parseMoney(cellValue(row, columnMap.giftNote)) ?? 0
    const totalExpected = parseMoney(cellValue(row, columnMap.total))
    const email = String(cellValue(row, columnMap.email) || '').trim()
    const productName = String(cellValue(row, columnMap.productName) || '').trim()
    const rowErrors = []

    if (!firstName && !lastName) rowErrors.push('Missing recipient name')
    if (!resolvedAddress.streetAddress && !resolvedAddress.addressRaw) rowErrors.push('Missing address')
    if (!resolvedAddress.zip && !resolvedAddress.addressRaw) rowErrors.push('Missing zip code')
    if (productPrice == null || productPrice < 0) rowErrors.push('Missing or invalid product price')

    const preTaxTotal =
      productPrice != null ? Math.round((productPrice + shipping + service + giftNote) * 1000) / 1000 : null

    if (totalExpected != null && preTaxTotal != null) {
      const diff = Math.abs(totalExpected - preTaxTotal)
      if (diff > 0.05) {
        warnings.push(
          `Row ${parsedRows.length + 1}: spreadsheet total ${totalExpected} differs from fees sum ${preTaxTotal.toFixed(2)} (tax may be included in Total column).`
        )
      }
    }

    parsedRows.push({
      rowIndex: i + 1,
      firstName,
      lastName,
      customerName: [firstName, lastName].filter(Boolean).join(' ').trim(),
      companyName: company || null,
      shipToType: shipToType || null,
      email: email || null,
      addressRaw: resolvedAddress.addressRaw,
      streetAddress: resolvedAddress.streetAddress || '',
      city: resolvedAddress.city || '',
      state: resolvedAddress.state || '',
      zip: resolvedAddress.zip || '',
      productPrice,
      shipping,
      service,
      giftNote,
      totalExpected,
      productName: productName || null,
      preTaxTotal,
      rowErrors,
      geocodeStatus: resolvedAddress.geocodeStatus
    })
  }

  if (parsedRows.length === 0) {
    return { success: false, error: 'No recipient rows found below the header.' }
  }

  return {
    success: true,
    fileName,
    sheetName,
    title,
    columnMap,
    rowCount: parsedRows.length,
    rows: parsedRows,
    warnings
  }
}

module.exports = {
  parseBulkOrderSpreadsheet,
  parseUsAddressFallback,
  normalizeZip,
  normalizeState,
  resolveSpreadsheetAddress
}
