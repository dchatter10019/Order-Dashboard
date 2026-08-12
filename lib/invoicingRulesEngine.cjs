/**
 * Parse docs/Bevvi-Invoicing-Rules.md and calculate Bevvi fees from the parsed config.
 * Used by the server (file loader) and the browser (via /api/invoicing-rules JSON).
 */

const MONTHS = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12
}

function normalizeEstablishmentForFees(establishment) {
  return (establishment || '')
    .trim()
    .toLowerCase()
    .replace(/\s*&\s*/g, ' and ')
    .replace(/\s+/g, ' ')
}

function normalizeCustomerName(customer) {
  return (customer || '').trim().toLowerCase()
}

function parseMoney(text) {
  const match = String(text || '').match(/\$\s*([\d,.]+)/)
  if (!match) return null
  return parseFloat(match[1].replace(/,/g, ''))
}

function parsePercent(text) {
  const match = String(text || '').match(/([\d.]+)\s*%/)
  if (!match) return null
  return parseFloat(match[1]) / 100
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

function lastDayOfMonth(year, month) {
  return new Date(year, month, 0).getDate()
}

function parseEffectiveDates(text) {
  const value = String(text || '').trim().toLowerCase()
  if (!value || value.includes('all dates')) {
    return { fromDate: null, toDate: null }
  }

  const monthYearOnly = value.match(/^([a-z]+)\s+(\d{4})\s+only$/)
  if (monthYearOnly) {
    const month = MONTHS[monthYearOnly[1]]
    const year = parseInt(monthYearOnly[2], 10)
    if (!month) return { fromDate: null, toDate: null }
    return {
      fromDate: `${year}-${pad2(month)}-01`,
      toDate: `${year}-${pad2(month)}-${pad2(lastDayOfMonth(year, month))}`
    }
  }

  const monthYearOnwards = value.match(/^([a-z]+)\s+(\d{4})\s+onwards$/)
  if (monthYearOnwards) {
    const month = MONTHS[monthYearOnwards[1]]
    const year = parseInt(monthYearOnwards[2], 10)
    if (!month) return { fromDate: null, toDate: null }
    return { fromDate: `${year}-${pad2(month)}-01`, toDate: null }
  }

  const upTo = value.match(/^up to\s+([a-z]+)\s+(\d{1,2}),?\s+(\d{4})$/)
  if (upTo) {
    const month = MONTHS[upTo[1]]
    const day = parseInt(upTo[2], 10)
    const year = parseInt(upTo[3], 10)
    if (!month) return { fromDate: null, toDate: null }
    return { fromDate: null, toDate: `${year}-${pad2(month)}-${pad2(day)}` }
  }

  const fromOnwards = value.match(/^([a-z]+)\s+(\d{1,2}),?\s+(\d{4})\s+onwards$/)
  if (fromOnwards) {
    const month = MONTHS[fromOnwards[1]]
    const day = parseInt(fromOnwards[2], 10)
    const year = parseInt(fromOnwards[3], 10)
    if (!month) return { fromDate: null, toDate: null }
    return { fromDate: `${year}-${pad2(month)}-${pad2(day)}`, toDate: null }
  }

  const through = value.match(/^through\s+([a-z]+)\s+(\d{1,2}),?\s+(\d{4})$/)
  if (through) {
    const month = MONTHS[through[1]]
    const day = parseInt(through[2], 10)
    const year = parseInt(through[3], 10)
    if (!month) return { fromDate: null, toDate: null }
    return { fromDate: null, toDate: `${year}-${pad2(month)}-${pad2(day)}` }
  }

  const monthDayRange = value.match(/^([a-z]+)\s+(\d{1,2})\s*[–-]\s*(\d{1,2}),?\s+(\d{4})/)
  if (monthDayRange) {
    const month = MONTHS[monthDayRange[1]]
    const fromDay = parseInt(monthDayRange[2], 10)
    const toDay = parseInt(monthDayRange[3], 10)
    const year = parseInt(monthDayRange[4], 10)
    if (!month) return { fromDate: null, toDate: null }
    return {
      fromDate: `${year}-${pad2(month)}-${pad2(fromDay)}`,
      toDate: `${year}-${pad2(month)}-${pad2(toDay)}`
    }
  }

  return { fromDate: null, toDate: null }
}

function extractSection(markdown, headingPattern) {
  const match = markdown.match(headingPattern)
  if (!match) return ''
  const start = match.index + match[0].length
  const rest = markdown.slice(start)
  const nextHeading = rest.search(/\n##\s+\d+\.|\n##\s+[A-Z]/)
  return nextHeading === -1 ? rest : rest.slice(0, nextHeading)
}

/** Stops at the next ## or ### heading (used under Retailer-Based Rates). */
function extractSubsection(markdown, headingPattern) {
  const match = markdown.match(headingPattern)
  if (!match) return ''
  const start = match.index + match[0].length
  const rest = markdown.slice(start)
  const nextHeading = rest.search(/\n#{2,3}\s+/)
  return nextHeading === -1 ? rest : rest.slice(0, nextHeading)
}

function parseMarkdownTable(section) {
  const rows = []
  for (const line of section.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('|')) continue
    if (/^\|\s*-+\s*\|/.test(trimmed)) continue
    const cells = trimmed
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.replace(/\*\*/g, '').trim())
    if (cells.length > 0 && cells.some(Boolean)) {
      rows.push(cells)
    }
  }
  return rows
}

function parseSingleColumnRetailers(section) {
  const rows = parseMarkdownTable(section)
  return rows
    .map((cells) => cells[0])
    .filter((name) => name && !/^retailer$/i.test(name))
}

function parseFlatFeeRetailers(section) {
  const rows = parseMarkdownTable(section)
  return rows
    .filter((cells) => cells.length >= 3 && !/^retailer$/i.test(cells[0]))
    .map((cells) => {
      const dates = parseEffectiveDates(cells[2])
      return {
        retailer: cells[0],
        retailerKey: normalizeEstablishmentForFees(cells[0]),
        amount: parseMoney(cells[1]),
        ...dates
      }
    })
    .filter((row) => row.retailer && row.amount != null)
}

function parseCustomerOverrides(section) {
  const rows = parseMarkdownTable(section)
  return rows
    .filter((cells) => cells.length >= 2 && !/^customer$/i.test(cells[0]))
    .filter((cells) => !/no override/i.test(cells[1]) && !/vjprivate/i.test(cells[0]))
    .map((cells) => {
      const names = cells[0].split('/').map((part) => part.trim()).filter(Boolean)
      const primaryName = names[0] || cells[0]
      const notes = (cells[2] || '').toLowerCase()
      const matchPrefix =
        notes.includes('starting with') ||
        primaryName.toLowerCase().startsWith('vistajet')
      return {
        label: cells[0],
        names: names.map((name) => normalizeCustomerName(name)),
        rate: parsePercent(cells[1]),
        matchPrefix
      }
    })
    .filter((row) => row.names.length > 0 && row.rate != null)
}

function parseGopuffSection(section) {
  const prefixes = []
  const prefixMatch = section.match(/beginning with\s+"([^"]+)"(?:,\s*"([^"]+)")?(?:,\s*or\s+"([^"]+)")?/i)
  if (prefixMatch) {
    ;[prefixMatch[1], prefixMatch[2], prefixMatch[3]].filter(Boolean).forEach((value) => {
      prefixes.push(value.toLowerCase())
    })
  }
  if (prefixes.length === 0) {
    prefixes.push('gopuff', 'go-puff', 'go puff')
  }

  const rows = parseMarkdownTable(section)
  const tiers = rows
    .filter((cells) => cells.length >= 2 && !/^date range$/i.test(cells[0]))
    .map((cells) => ({
      ...parseEffectiveDates(cells[0]),
      rate: parsePercent(cells[1])
    }))
    .filter((tier) => tier.rate != null)

  return { prefixes, tiers }
}

function parseOrderStatuses(section) {
  const rows = parseMarkdownTable(section)
  const excluded = new Set()
  for (const cells of rows) {
    if (cells.length >= 2) {
      const excludedCell = cells[1].replace(/[^\w\s]/g, '').trim().toLowerCase()
      excludedCell.split(/\s+/).forEach((word) => {
        if (['pending', 'rejected', 'canceled', 'cancelled'].includes(word)) {
          excluded.add(word === 'cancelled' ? 'canceled' : word)
        }
      })
    }
  }
  if (excluded.size === 0) {
    return ['pending', 'rejected', 'canceled']
  }
  return [...excluded]
}

function parseAltOrderStatuses(section) {
  const rows = parseMarkdownTable(section)
  const excluded = new Set()
  for (const cells of rows) {
    if (cells.length >= 2 && /^exclude$/i.test(cells[1].replace(/[^\w\s]/g, '').trim())) {
      const status = cells[0].replace(/[^\w\s/]/g, '').trim().toLowerCase()
      status.split(/\s+/).forEach((word) => {
        if (['pending', 'rejected', 'canceled', 'cancelled'].includes(word)) {
          excluded.add(word === 'cancelled' ? 'canceled' : word)
        }
      })
    }
  }
  if (excluded.size === 0) {
    return ['pending', 'rejected', 'canceled']
  }
  return [...excluded]
}

function parseFlatFeeRetailersAlt(section) {
  const rows = parseMarkdownTable(section)
  return rows
    .filter((cells) => cells.length >= 3 && !/^retailer$/i.test(cells[0]))
    .map((cells) => {
      const dates = parseEffectiveDates(cells[1])
      return {
        retailer: cells[0],
        retailerKey: normalizeEstablishmentForFees(cells[0]),
        amount: parseMoney(cells[2]),
        ...dates
      }
    })
    .filter((row) => row.retailer && row.amount != null)
}

function parseCustomerOverridesAlt(section) {
  const rows = parseMarkdownTable(section)
  const overrides = []
  let vistajetPrivateBypass = false

  for (const cells of rows) {
    if (cells.length < 2 || /^customer condition$/i.test(cells[0])) continue

    const condition = cells[0]
    const rateText = cells[1]
    const notes = (cells[2] || '').toLowerCase()

    if (/no vistajet override/i.test(rateText) || /vjprivate/i.test(condition)) {
      vistajetPrivateBypass = true
      continue
    }

    const rate = parsePercent(rateText)
    if (rate == null) continue

    if (/begins with\s+[`']?vistajet/i.test(condition) || notes.includes('prefix match')) {
      overrides.push({
        label: condition,
        names: ['vistajet'],
        rate,
        matchPrefix: true
      })
      continue
    }

    const names = condition.split('/').map((part) => part.trim()).filter(Boolean)
    overrides.push({
      label: condition,
      names: names.map((name) => normalizeCustomerName(name)),
      rate,
      matchPrefix: false
    })
  }

  return { customerOverrides: overrides, vistajetPrivateBypass }
}

function parseRetailerRatesCombinedTable(section) {
  const rows = parseMarkdownTable(section)
  const result = {
    tenPercent: [],
    fifteenPercent: [],
    twentyFivePercent: [],
    defaultRate: null
  }

  for (const cells of rows) {
    if (cells.length < 2 || /^fee rate$/i.test(cells[0])) continue
    const rate = parsePercent(cells[0])
    const retailersText = cells[1]
    if (rate == null) continue
    if (/every other/i.test(retailersText)) {
      result.defaultRate = rate
      continue
    }

    const names = retailersText
      .split(/;/)
      .map((name) => name.trim())
      .filter((name) => name && !/matching rule/i.test(name))

    if (Math.abs(rate - 0.1) < 0.001) result.tenPercent.push(...names)
    else if (Math.abs(rate - 0.15) < 0.001) result.fifteenPercent.push(...names)
    else if (Math.abs(rate - 0.25) < 0.001) result.twentyFivePercent.push(...names)
  }

  return result
}

function parseGopuffSectionAlt(section) {
  const prefixes = []
  const boldPrefixes = section.match(/\*\*([^*]+)\*\*/g) || []
  for (const token of boldPrefixes) {
    const value = token.replace(/\*\*/g, '').trim().toLowerCase()
    if (['gopuff', 'go-puff', 'go puff'].includes(value)) {
      prefixes.push(value)
    }
  }
  if (prefixes.length === 0) {
    prefixes.push('gopuff', 'go-puff', 'go puff')
  }

  const rows = parseMarkdownTable(section)
  const tiers = rows
    .filter((cells) => cells.length >= 2 && !/^transaction date$/i.test(cells[0]))
    .map((cells) => ({
      ...parseEffectiveDates(cells[0]),
      rate: parsePercent(cells[1])
    }))
    .filter((tier) => tier.rate != null)

  return { prefixes, tiers }
}

function isLegacyInvoicingRulesFormat(markdown) {
  return /##\s*1\.\s*Flat Fee Retailers/i.test(markdown)
}

function isAltInvoicingRulesFormat(markdown) {
  return (
    /##\s*4\.\s*Flat-Fee Retailer Rules/i.test(markdown) ||
    /##\s*6\.\s*Retailer Percentage Rates/i.test(markdown)
  )
}

function parseLegacyInvoicingRulesMarkdown(markdown) {
  const flatSection = extractSection(markdown, /##\s*1\.\s*Flat Fee Retailers/i)
  const customerSection = extractSection(markdown, /##\s*2\.\s*Customer Overrides/i)
  const retailerSection = extractSection(markdown, /##\s*3\.\s*Retailer-Based Rates/i)
  const defaultSection = extractSection(markdown, /##\s*4\.\s*Default Rate/i)
  const statusSection = extractSection(markdown, /##\s*Order Status Filter/i)
  const gopuffSection = extractSubsection(retailerSection, /###\s*Gopuff Stores/i)

  const defaultRate = parsePercent(defaultSection) ?? 0.2
  const flatFeeRetailers = parseFlatFeeRetailers(flatSection)
  const customerOverrides = parseCustomerOverrides(customerSection)
  const tenPercentRetailers = parseSingleColumnRetailers(
    extractSubsection(retailerSection, /###\s*10%\s*Retailers/i)
  )
  const fifteenPercentRetailers = parseSingleColumnRetailers(
    extractSubsection(retailerSection, /###\s*15%\s*Retailers/i)
  )
  const twentyFivePercentRetailers = parseSingleColumnRetailers(
    extractSubsection(retailerSection, /###\s*25%\s*Retailers/i)
  )
  const gopuff = parseGopuffSection(gopuffSection)
  const excludedOrderStatuses = parseOrderStatuses(statusSection)
  const vistajetPrivateBypass = /vjprivate/i.test(customerSection)

  return {
    defaultRate,
    flatFeeRetailers,
    customerOverrides,
    vistajetPrivateBypass,
    retailerRates: {
      tenPercent: tenPercentRetailers,
      fifteenPercent: fifteenPercentRetailers,
      twentyFivePercent: twentyFivePercentRetailers
    },
    gopuff,
    excludedOrderStatuses
  }
}

function parseAltInvoicingRulesMarkdown(markdown) {
  const flatSection = extractSection(markdown, /##\s*4\.\s*Flat-Fee Retailer Rules/i)
  const customerSection = extractSection(markdown, /##\s*5\.\s*Customer-Specific Overrides/i)
  const retailerSection = extractSection(markdown, /##\s*6\.\s*Retailer Percentage Rates/i)
  const gopuffSection = extractSection(markdown, /##\s*7\.\s*GoPuff Date-Based Rate/i)
  const statusSection = extractSection(markdown, /##\s*1\.\s*Transaction Eligibility/i)

  const flatFeeRetailers = parseFlatFeeRetailersAlt(flatSection)
  const { customerOverrides, vistajetPrivateBypass } = parseCustomerOverridesAlt(customerSection)
  const retailerRates = parseRetailerRatesCombinedTable(retailerSection)
  const gopuff = parseGopuffSectionAlt(gopuffSection)
  const excludedOrderStatuses = parseAltOrderStatuses(statusSection)

  return {
    defaultRate: retailerRates.defaultRate ?? 0.2,
    flatFeeRetailers,
    customerOverrides,
    vistajetPrivateBypass,
    retailerRates: {
      tenPercent: retailerRates.tenPercent,
      fifteenPercent: retailerRates.fifteenPercent,
      twentyFivePercent: retailerRates.twentyFivePercent
    },
    gopuff,
    excludedOrderStatuses
  }
}

function parseInvoicingRulesMarkdown(markdown) {
  if (isLegacyInvoicingRulesFormat(markdown)) {
    return parseLegacyInvoicingRulesMarkdown(markdown)
  }
  if (isAltInvoicingRulesFormat(markdown)) {
    return parseAltInvoicingRulesMarkdown(markdown)
  }

  // Unknown format — return empty config (engine falls back to default rate only).
  return {
    defaultRate: 0.2,
    flatFeeRetailers: [],
    customerOverrides: [],
    vistajetPrivateBypass: false,
    retailerRates: {
      tenPercent: [],
      fifteenPercent: [],
      twentyFivePercent: []
    },
    gopuff: { prefixes: ['gopuff', 'go-puff', 'go puff'], tiers: [] },
    excludedOrderStatuses: ['pending', 'rejected', 'canceled']
  }
}

function dateInRange(orderDate, fromDate, toDate) {
  if (!orderDate) return true
  if (fromDate && orderDate < fromDate) return false
  if (toDate && orderDate > toDate) return false
  return true
}

function createInvoicingRulesEngine(config) {
  const rules = config || {}
  const defaultRate = rules.defaultRate ?? 0.2
  const flatFeeRetailers = Array.isArray(rules.flatFeeRetailers) ? rules.flatFeeRetailers : []
  const customerOverrides = Array.isArray(rules.customerOverrides) ? rules.customerOverrides : []
  const tenPercent = new Set(
    (rules.retailerRates?.tenPercent || []).map((name) => normalizeEstablishmentForFees(name))
  )
  const fifteenPercent = new Set(
    (rules.retailerRates?.fifteenPercent || []).map((name) => normalizeEstablishmentForFees(name))
  )
  const twentyFivePercent = new Set(
    (rules.retailerRates?.twentyFivePercent || []).map((name) => normalizeEstablishmentForFees(name))
  )
  const gopuffPrefixes = (rules.gopuff?.prefixes || ['gopuff', 'go-puff', 'go puff']).map((p) =>
    p.toLowerCase()
  )
  const gopuffTiers = Array.isArray(rules.gopuff?.tiers) ? rules.gopuff.tiers : []
  const vistajetPrivateBypass = Boolean(rules.vistajetPrivateBypass)
  const excludedStatuses = new Set(
    (rules.excludedOrderStatuses || ['pending', 'rejected', 'canceled']).map((s) => s.toLowerCase())
  )

  function parseOrderCalendarDate(order) {
    const raw = order?.orderDate || order?.date || ''
    const value = String(raw).trim()
    if (!value) return null
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) return null
    return `${parsed.getFullYear()}-${pad2(parsed.getMonth() + 1)}-${pad2(parsed.getDate())}`
  }

  function isIncludedOrderStatus(status) {
    const normalized = String(status || '').trim().toLowerCase()
    return normalized.length > 0 && !excludedStatuses.has(normalized)
  }

  function isGopuffRetailer(establishment) {
    const normalized = normalizeEstablishmentForFees(establishment)
    return gopuffPrefixes.some(
      (prefix) =>
        normalized.startsWith(prefix) ||
        normalized.startsWith(prefix.replace(/-/g, ' ')) ||
        normalized.startsWith(prefix.replace(/\s+/g, ''))
    )
  }

  function getFlatRetailerFee(establishment, orderDate) {
    const key = normalizeEstablishmentForFees(establishment)
    const matches = flatFeeRetailers.filter((row) => row.retailerKey === key)
    if (matches.length === 0) return null

    const dated = matches.filter((row) => dateInRange(orderDate, row.fromDate, row.toDate))
    const pool = dated.length > 0 ? dated : matches.filter((row) => !row.fromDate && !row.toDate)
    if (pool.length === 0) return null

    return pool[0].amount
  }

  function getCustomerOverrideRate(customer, orderNumber) {
    const normalized = normalizeCustomerName(customer)
    const orderNum = String(orderNumber || '').trim().toLowerCase()

    if (
      vistajetPrivateBypass &&
      normalized.startsWith('vistajet') &&
      orderNum.startsWith('vjprivate')
    ) {
      return null
    }

    for (const override of customerOverrides) {
      if (override.matchPrefix) {
        if (override.names.some((name) => normalized.startsWith(name))) {
          return override.rate
        }
      } else if (override.names.some((name) => normalized === name)) {
        return override.rate
      }
    }
    return null
  }

  function getGopuffRate(orderDate) {
    if (gopuffTiers.length === 0) return null
    for (const tier of gopuffTiers) {
      if (dateInRange(orderDate, tier.fromDate, tier.toDate)) {
        return tier.rate
      }
    }
    return gopuffTiers[gopuffTiers.length - 1]?.rate ?? null
  }

  function getRetailerPercentRate(establishment, orderDate) {
    const key = normalizeEstablishmentForFees(establishment)
    if (twentyFivePercent.has(key)) return 0.25
    if (fifteenPercent.has(key)) return 0.15
    if (tenPercent.has(key)) return 0.1
    if (isGopuffRetailer(establishment)) {
      return getGopuffRate(orderDate)
    }
    return null
  }

  function resolveBevviFeeRule({ retailer, customer, orderDate = null, orderNumber = null } = {}) {
    const flatFee = getFlatRetailerFee(retailer, orderDate)
    if (flatFee != null) {
      return {
        kind: 'flat',
        amount: flatFee,
        label: `$${flatFee} / order`,
        rule: 'flat_fee_retailer'
      }
    }

    const customerRate = getCustomerOverrideRate(customer, orderNumber)
    if (customerRate != null) {
      return {
        kind: 'percent',
        rate: customerRate,
        label: `${Math.round(customerRate * 1000) / 10}%`,
        rule: 'customer_override'
      }
    }

    const retailerRate = getRetailerPercentRate(retailer, orderDate)
    if (retailerRate != null) {
      return {
        kind: 'percent',
        rate: retailerRate,
        label: `${Math.round(retailerRate * 1000) / 10}%`,
        rule: isGopuffRetailer(retailer) ? 'gopuff_date_rate' : 'retailer_rate'
      }
    }

    return {
      kind: 'percent',
      rate: defaultRate,
      label: `${Math.round(defaultRate * 1000) / 10}%`,
      rule: 'default'
    }
  }

  function calculateBevviFee(order) {
    const revenue = parseFloat(order?.revenue) || 0
    const orderDate = parseOrderCalendarDate(order)
    const rule = resolveBevviFeeRule({
      retailer: order?.establishment,
      customer: order?.customerName,
      orderDate,
      orderNumber: order?.ordernum || order?.id || order?.orderNumber
    })

    if (revenue <= 0) {
      return {
        bevviFee: 0,
        feeRate: rule.kind === 'percent' ? rule.rate : null,
        feeRateLabel: rule.label,
        rule
      }
    }

    if (rule.kind === 'flat') {
      return {
        bevviFee: rule.amount,
        feeRate: null,
        feeRateLabel: rule.label,
        rule
      }
    }

    return {
      bevviFee: Math.round(revenue * rule.rate * 100) / 100,
      feeRate: rule.rate,
      feeRateLabel: rule.label,
      rule
    }
  }

  function calculateOrderFees(order) {
    const serviceFee = parseFloat(order?.serviceCharge) || 0
    const { bevviFee } = calculateBevviFee(order)
    return { serviceFee, retailerFee: bevviFee }
  }

  function getOrderRetailerFeeLabel(order) {
    return calculateBevviFee(order).feeRateLabel
  }

  return {
    rules,
    parseOrderCalendarDate,
    isIncludedOrderStatus,
    isGopuffRetailer,
    getFlatRetailerFee,
    getCustomerOverrideRate,
    getRetailerPercentRate,
    resolveBevviFeeRule,
    calculateBevviFee,
    calculateOrderFees,
    getOrderRetailerFeeLabel
  }
}

module.exports = {
  parseInvoicingRulesMarkdown,
  createInvoicingRulesEngine,
  normalizeEstablishmentForFees
}
