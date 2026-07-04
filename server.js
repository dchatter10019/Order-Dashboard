const express = require('express')
const cors = require('cors')
const axios = require('axios')
const fs = require('fs').promises
const path = require('path')
const OpenAI = require('openai')
require('dotenv').config({ path: path.join(__dirname, '.env'), override: true })

/** Calendar YYYY-MM-DD in a specific IANA zone (not server local / not raw UTC date). */
const DEFAULT_ORDER_TIMEZONE = process.env.BEVVI_ORDER_TIMEZONE || 'America/New_York'
const MAX_ORDER_DATE_RANGE_DAYS = 31
const MS_PER_DAY = 24 * 60 * 60 * 1000

/** Bevvi often stores calendar dates as midnight UTC — use the UTC date, not local TZ shift. */
function parseUtcMidnightCalendarDate(dateTimeValue) {
  if (!dateTimeValue) return null
  const match = String(dateTimeValue).trim().match(/^(\d{4}-\d{2}-\d{2})T00:00:00(?:\.000)?Z$/i)
  return match ? match[1] : null
}

function getYyyyMmDdInTimeZone(dateInput, timeZone = DEFAULT_ORDER_TIMEZONE) {
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput)
  if (isNaN(d.getTime())) return null
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(d)
    const y = parts.find(p => p.type === 'year')?.value
    const m = parts.find(p => p.type === 'month')?.value
    const day = parts.find(p => p.type === 'day')?.value
    if (!y || !m || !day) return null
    return `${y}-${m}-${day}`
  } catch (e) {
    return null
  }
}

function resolveOrderTimeZone(raw) {
  if (!raw || typeof raw !== 'string') return DEFAULT_ORDER_TIMEZONE
  const t = decodeURIComponent(raw.trim())
  if (t.length > 80 || !/^[\w/+_-]+$/.test(t)) return DEFAULT_ORDER_TIMEZONE
  try {
    Intl.DateTimeFormat('en-US', { timeZone: t }).format(new Date(0))
    return t
  } catch {
    return DEFAULT_ORDER_TIMEZONE
  }
}

/**
 * UTC epoch ms for a wall-clock moment YYYY-MM-DD H:M:S in an IANA timezone
 * (used to turn the user's local calendar range into UTC bounds for the Bevvi CSV API).
 */
function zonedWallClockToUtcMs(dateStr, hour, minute, second, timeZone) {
  const [Y, M, D] = dateStr.split('-').map(Number)
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  })

  function wallAt(utcMs) {
    const o = {}
    for (const p of formatter.formatToParts(new Date(utcMs))) {
      if (p.type !== 'literal') o[p.type] = parseInt(p.value, 10)
    }
    return o
  }

  function cmpWall(utcMs) {
    const o = wallAt(utcMs)
    if (o.year !== Y) return o.year - Y
    if (o.month !== M) return o.month - M
    if (o.day !== D) return o.day - D
    if (o.hour !== hour) return o.hour - hour
    if (o.minute !== minute) return o.minute - minute
    return o.second - second
  }

  let lo = Date.UTC(Y, M - 1, D, 12, 0, 0) - 48 * 3600000
  let hi = Date.UTC(Y, M - 1, D, 12, 0, 0) + 48 * 3600000

  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2)
    const c = cmpWall(mid)
    if (c === 0) return mid
    if (c < 0) lo = mid + 1
    else hi = mid - 1
  }
  return Date.UTC(Y, M - 1, D, hour, minute, second)
}

/** Bevvi CSV API expects UTC calendar start/end; derive from user's local YYYY-MM-DD range in `timeZone`. */
function bevviCsvUtcDateRange(startDate, endDate, timeZone) {
  const startMs = zonedWallClockToUtcMs(startDate, 0, 0, 0, timeZone)
  const endMs = zonedWallClockToUtcMs(endDate, 23, 59, 59, timeZone)
  const utcStartString = new Date(startMs).toISOString().split('T')[0]
  const utcEndString = new Date(endMs).toISOString().split('T')[0]
  return utcStartString <= utcEndString
    ? { utcStartString, utcEndString }
    : { utcStartString: utcEndString, utcEndString: utcStartString }
}

function parseYyyyMmDdUtc(dateString) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateString || '')
  if (!match) return null
  const [, year, month, day] = match.map(Number)
  const utcMs = Date.UTC(year, month - 1, day)
  const parsed = new Date(utcMs)
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null
  }
  return parsed
}

function validateOrderDateRange(startDate, endDate) {
  const start = parseYyyyMmDdUtc(startDate)
  const end = parseYyyyMmDdUtc(endDate)
  if (!start || !end) {
    return 'Dates must be in YYYY-MM-DD format.'
  }

  if (start > end) {
    return 'Start date must be less than or equal to end date.'
  }

  const inclusiveDays = Math.floor((end.getTime() - start.getTime()) / MS_PER_DAY) + 1
  if (inclusiveDays > MAX_ORDER_DATE_RANGE_DAYS) {
    return `Date range cannot exceed ${MAX_ORDER_DATE_RANGE_DAYS} days. Please select a shorter range.`
  }

  return null
}

const app = express()
const PORT = process.env.PORT || 3001
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL
const SERPAPI_API_KEY = process.env.SERPAPI_API_KEY
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY
const STRIPE_PAYMENT_SUCCESS_URL =
  process.env.STRIPE_PAYMENT_SUCCESS_URL || 'https://getbevvi.com/?payment=success&session_id={CHECKOUT_SESSION_ID}'
const STRIPE_PAYMENT_CANCEL_URL =
  process.env.STRIPE_PAYMENT_CANCEL_URL || 'https://getbevvi.com/?payment=cancelled'

let stripe = null
if (STRIPE_SECRET_KEY) {
  stripe = require('stripe')(STRIPE_SECRET_KEY)
} else {
  console.warn('⚠️ STRIPE_SECRET_KEY not set; manual order payment links will be disabled.')
}

const OPTIONAL_PRODUCT_FIELDS = [
  'imageFileName',
  'brandLogo',
  'industryRatings',
  'sku'
]

const REQUIRED_PRODUCT_FIELDS = [
  'upc',
  'name',
  'description',
  'category',
  'subcategory',
  'varietal',
  'region',
  'appellation',
  'country',
  'abv',
  'color',
  'body',
  'aroma',
  'flavor',
  'pairings',
  'brandName',
  'parentBrand',
  'productNotes',
  'year',
  'size',
  'units',
  'companyName',
  'lowestPrice',
  'containerType',
  'containerCount',
  'averagePrice',
  'slug'
]

// Initialize OpenAI client only when configured
let openai = null
if (process.env.OPENAI_API_KEY) {
  openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  })
} else {
  console.warn('⚠️ OPENAI_API_KEY not set; AI parsing endpoint will be disabled.')
}


// Slack notifications state (in-memory)
const slackNotificationState = new Map()

// New order notifications — track seen order keys so we only alert once per order
const knownOrderIds = new Set()
let ordersNotificationBaselineSeeded = false
let ordersNotificationContextKey = null

function getOrdersNotificationContextKey(dateRange) {
  if (!dateRange?.startDate || !dateRange?.endDate) return null
  const timeZone = dateRange.timeZone || 'UTC'
  return `${dateRange.startDate}|${dateRange.endDate}|${timeZone}`
}

function seedOrderNotificationBaseline(orders) {
  const list = Array.isArray(orders) ? orders : []
  knownOrderIds.clear()
  for (const order of list) {
    const key = getOrderNotificationKey(order)
    if (key) knownOrderIds.add(key)
  }
  ordersNotificationBaselineSeeded = true
  console.log(`🔔 Order notification baseline seeded with ${knownOrderIds.size} order(s)`)
}

function getSlackNotificationState(orderId) {
  if (!slackNotificationState.has(orderId)) {
    slackNotificationState.set(orderId, {
      pending15Sent: false,
      accepted30Sent: false
    })
  }
  return slackNotificationState.get(orderId)
}

function pruneSlackNotificationState(currentOrderIds) {
  for (const orderId of slackNotificationState.keys()) {
    if (!currentOrderIds.has(orderId)) {
      slackNotificationState.delete(orderId)
    }
  }
}

function formatSlackDateTime(dateTimeValue) {
  if (!dateTimeValue) return 'N/A'
  const parsed = new Date(dateTimeValue)
  if (isNaN(parsed.getTime())) return 'N/A'
  return parsed.toLocaleString()
}

function slugify(value) {
  if (!value || typeof value !== 'string') return null
  return value
    .toLowerCase()
    .trim()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || null
}

function extractFilenameFromUrl(url) {
  if (!url || typeof url !== 'string') return null
  try {
    const cleaned = url.split('?')[0]
    const parts = cleaned.split('/')
    const filename = parts[parts.length - 1]
    return filename || null
  } catch {
    return null
  }
}

function extractSizeUnitsFromName(name) {
  if (!name || typeof name !== 'string') return null
  const match = name.match(/\b(\d+(?:\.\d+)?)\s*(ml|mL|ML|l|L|oz|OZ|g|G|kg|KG|cl|CL|lt|LT)\b/)
  if (!match) return null
  return {
    size: match[1],
    units: match[2].toUpperCase()
  }
}

function buildSerpCorpus(...chunks) {
  const parts = []
  const pushText = (value) => {
    if (!value || typeof value !== 'string') return
    parts.push(value)
  }
  const pushArray = (arr) => {
    if (!Array.isArray(arr)) return
    arr.forEach(item => {
      if (typeof item === 'string') {
        parts.push(item)
      } else if (item && typeof item === 'object') {
        pushText(item.title)
        pushText(item.snippet)
        pushText(item.snippet_highlighted_words?.join?.(' '))
        pushText(item.content)
        // Include pages from targeted searches (e.g. { field, query, results, pages })
        if (Array.isArray(item.pages)) {
          pushArray(item.pages)
        }
      }
    })
  }

  chunks.forEach(chunk => {
    if (!chunk) return
    if (Array.isArray(chunk)) {
      pushArray(chunk)
      return
    }
    if (typeof chunk === 'string') {
      parts.push(chunk)
      return
    }
    if (typeof chunk === 'object') {
      pushText(chunk.search_metadata?.status)
      pushText(chunk.search_information?.query_displayed)
      pushArray((chunk.organic_results || []).slice(0, 5))
      pushArray((chunk.shopping_results || []).slice(0, 5))
      pushArray((chunk.news_results || []).slice(0, 3))
      pushArray((chunk.top_stories || []).slice(0, 3))
      pushArray((chunk.images_results || []).slice(0, 3))
      if (Array.isArray(chunk.pages)) {
        pushArray(chunk.pages)
      }
    }
  })

  return parts.join(' ').slice(0, 15000)
}

function extractFieldsFromCorpus(corpus) {
  if (!corpus || typeof corpus !== 'string') return {}

  const extract = (pattern) => {
    const match = corpus.match(pattern)
    return match?.[1]?.trim() || null
  }

  const abvMatch = corpus.match(/(\d{1,2}(?:\.\d+)?)\s*%?\s*(?:abv|alc(?:\/vol)?|alcohol)\b/i)
  const ratingMatch = corpus.match(/(\d{2,3})\s*(?:pts|points)\b/i)
  const percentMatch = corpus.match(/(\d{1,2}(?:\.\d+)?)\s*%/i)
  const countryMatch = corpus.match(/\b(United States|USA|France|Italy|Spain|Portugal|Germany|Austria|Greece|Argentina|Chile|Australia|New Zealand|South Africa|Canada|Mexico|Israel|Lebanon)\b/i)
  const regionMatch = corpus.match(/\b(Napa Valley|Oakville|Sonoma County|Paso Robles|Santa Barbara County|Willamette Valley|Columbia Valley|Walla Walla|Bordeaux|Burgundy|Champagne|Rhone|Loire|Alsace|Mosel|Piedmont|Tuscany|Rioja|Priorat|Douro|Porto|Mendoza|Barossa|Marlborough)\b/i)
  const ratingSources = [
    'Wine Spectator',
    'Wine Advocate',
    'James Suckling',
    'Decanter',
    'Vinous',
    'Jeb Dunnuck',
    'Wine Enthusiast',
    'The Wine Independent',
    'Tastingbook',
    'Robert Parker',
    'Burghound',
    'Jane Anson'
  ]
  const ratings = []
  const ratingsRegex = new RegExp(`\\b(${ratingSources.join('|')})\\b[^0-9]{0,20}(\\d{2,3})\\b`, 'gi')
  let ratingMatchIter = ratingsRegex.exec(corpus)
  while (ratingMatchIter) {
    ratings.push(`${ratingMatchIter[1]} ${ratingMatchIter[2]}`)
    ratingMatchIter = ratingsRegex.exec(corpus)
  }
  const industryRatingsValue = ratings.length > 0
    ? Array.from(new Set(ratings)).join('; ')
    : (ratingMatch ? `${ratingMatch[1]} pts` : null)

  return {
    description: extract(/(?:description|overview|about|tasting\s+notes|notes)[:\s\-]+([a-z0-9\s,;'().-]{20,})/i),
    appellation: extract(/appellation[:\s\-]+([a-z0-9\s'().-]+)/i),
    region: extract(/region[:\s\-]+([a-z0-9\s'().-]+)/i) || (regionMatch ? regionMatch[1] : null),
    country: extract(/country[:\s\-]+([a-z0-9\s'().-]+)/i) || (countryMatch ? countryMatch[1] : null),
    abv: abvMatch ? abvMatch[1] : (percentMatch ? percentMatch[1] : null),
    body: extract(/body[:\s\-]+([a-z0-9\s'().-]+)/i),
    aroma: extract(/(?:aroma|nose)[:\s\-]+([a-z0-9\s,;'().-]+?)(?=\s+[a-z]+:|\s+flavor\b|$)/i),
    flavor: extract(/flavor[:\s\-]+([a-z0-9\s'().-]+)/i),
    pairings: extract(/pairings?[:\s\-]+([a-z0-9\s,;'().-]+)/i),
    industryRatings: industryRatingsValue,
    parentBrand: extract(/parent\s*brand[:\s\-]+([a-z0-9\s'().-]+)/i),
    productNotes: extract(/(?:tasting\s+notes|notes)[:\s\-]+([a-z0-9\s,;'().-]+)/i) ||
      extract(/(?:aromas?|flavors?)\s+(?:of|:)\s+([a-z0-9\s,;'().-]+)/i),
    companyName: extract(/(?:producer|winery|company)[:\s\-]+([a-z0-9\s'().-]+)/i)
  }
}

async function fetchUpcItemDb(upc) {
  try {
    const response = await axios.get('https://api.upcitemdb.com/prod/trial/lookup', {
      params: { upc },
      timeout: 10000,
      headers: { 'Accept': 'application/json' }
    })
    return response.data || null
  } catch (error) {
    console.warn('⚠️ UPCitemdb lookup failed:', error.message)
    return null
  }
}

async function fetchSerpApiResults(query) {
  if (!SERPAPI_API_KEY) {
    console.warn('⚠️ SERPAPI_API_KEY not configured; web search disabled')
    return {}
  }
  try {
    console.log(`🔎 SerpAPI search: ${query}`)
    const response = await axios.get('https://serpapi.com/search.json', {
      params: {
        engine: 'google',
        q: query,
        api_key: SERPAPI_API_KEY,
        num: 10
      },
      timeout: 10000
    })
    return response.data || {}
  } catch (error) {
    console.warn('⚠️ SerpAPI search failed:', error.message)
    return {}
  }
}

function stripHtmlToText(html) {
  if (!html || typeof html !== 'string') return ''
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

async function fetchSerpResultPages(serpData, limit = 1) {
  const results = serpData?.organic_results || []
  const pages = []
  for (const result of results.slice(0, limit)) {
    if (!result?.link) continue
    try {
      const response = await axios.get(result.link, { timeout: 8000 })
      const text = stripHtmlToText(response.data || '')
      pages.push({
        url: result.link,
        title: result.title || null,
        snippet: result.snippet || null,
        content: text.slice(0, 4000)
      })
    } catch (error) {
      pages.push({
        url: result.link,
        title: result.title || null,
        snippet: result.snippet || null,
        content: null,
        error: error.message
      })
    }
  }
  return pages
}

function buildFallbackProductData({ upc, name, upcData }) {
  const item = upcData?.items?.[0] || null
  const imageUrl = item?.images?.[0] || null
  const inferredName = name || item?.title || null
  const inferredSlug = slugify(inferredName)

  return {
    upc: upc || null,
    name: inferredName,
    description: item?.description || null,
    category: item?.category || null,
    subcategory: item?.subcategory || null,
    varietal: null,
    region: null,
    appellation: null,
    country: null,
    abv: null,
    color: null,
    body: null,
    aroma: null,
    flavor: null,
    pairings: null,
    industryRatings: null,
    brandName: item?.brand || null,
    parentBrand: item?.brand || null,
    productNotes: null,
    imageFileName: extractFilenameFromUrl(imageUrl),
    brandLogo: null,
    year: null,
    size: item?.size || null,
    units: null,
    companyName: null,
    lowestPrice: item?.lowest_recorded_price || null,
    containerType: null,
    containerCount: null,
    averagePrice: item?.average_price || null,
    sku: item?.sku || null,
    slug: inferredSlug
  }
}

async function formatProductForDisplayWithAI(product) {
  if (!openai || !product) return null
  const systemPrompt = `Format product data for clear, readable display in a UI.
Given a product object, output a clean formatted summary. Use human-friendly labels.
Structure: group related fields, use proper capitalization, keep descriptions concise.
Output plain text with clear line breaks. No markdown. No bullet points.
Example format:
Name: [product name]
UPC: [upc]
Category: [category] | Region: [region] | Country: [country]
Size: [size] [units] | ABV: [abv]% | Year: [year]
Brand: [brand]
Description: [1-2 sentence summary if long, else full]
Tasting Notes: [productNotes or aroma/flavor combined]
Ratings: [industryRatings if present]
Omit empty fields. Keep it scannable and professional.`
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: JSON.stringify(product, null, 2) }
      ],
      temperature: 0.2,
      max_tokens: 600
    })
    return completion.choices?.[0]?.message?.content?.trim() || null
  } catch (err) {
    console.warn('⚠️ LLM format for display failed:', err.message)
    return null
  }
}

async function extractProductDetailsWithAI({ upc, name, upcData, serpData, userFields }) {
  if (!openai) return null

  const payload = {
    upc,
    name,
    userFields,
    upcData,
    serpData
  }

  const systemPrompt = `You extract product details from web data.
Use ONLY information present in the provided web data (UPC and search results). Do NOT guess or invent.
If a value is missing, return null.
Always preserve any user-provided fields and do not overwrite them.

Normalize formatting:
- size = numeric value only (e.g. 750). units = ML, L, OZ, CL, G, KG (uppercase) - NOT "bottle".
- abv = alcohol percentage numeric string (12-16 for wine), NOT wine scores (80, 90 pts).
- year = 4-digit string
- country/region/appellation = proper case (e.g. "United States", "Napa Valley", "Oakville")
- industryRatings = semicolon-separated list like "Wine Spectator 92; James Suckling 96"
- description/aroma/flavor/productNotes = short sentence fragments, no marketing fluff

Return ONLY valid JSON with these keys:
upc, name, description, category, subcategory, varietal, region, appellation, country, abv, color, body, aroma, flavor, pairings, industryRatings, brandName, parentBrand, productNotes, imageFileName, brandLogo, year, size, units, companyName, lowestPrice, containerType, containerCount, averagePrice, sku, slug.`

  const safeParse = (content) => {
    if (!content || typeof content !== 'string') return null
    try {
      return JSON.parse(content)
    } catch {
      const match = content.match(/\{[\s\S]*\}/)
      if (!match) return null
      try {
        return JSON.parse(match[0])
      } catch {
        return null
      }
    }
  }

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: JSON.stringify(payload, null, 2) }
      ],
      temperature: 0.1,
      max_tokens: 800,
      response_format: { type: 'json_object' }
    })

    const content = completion.choices?.[0]?.message?.content
    const parsed = safeParse(content)
    if (parsed) return parsed

    console.warn('⚠️ AI extraction returned invalid JSON')
    return null
  } catch (error) {
    console.warn('⚠️ AI extraction failed:', error.message)
    return null
  }
}

function parseJsonFromAiContent(content) {
  if (!content || typeof content !== 'string') return null
  try {
    return JSON.parse(content)
  } catch {
    const match = content.match(/\{[\s\S]*\}/)
    if (!match) return null
    try {
      return JSON.parse(match[0])
    } catch {
      return null
    }
  }
}

function normalizeReceiptMoneyValue(value) {
  if (value == null || value === '') return null
  const parsed = parseFloat(String(value).replace(/[$,]/g, '').trim())
  return Number.isNaN(parsed) ? null : parsed
}

function normalizeReceiptDate(value) {
  if (!value) return null
  const str = String(value).trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str
  const slashMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (slashMatch) {
    const [, month, day, year] = slashMatch
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  }
  const parsed = new Date(str)
  if (Number.isNaN(parsed.getTime())) return null
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`
}

function formatCatalogProductSize(product) {
  if (product.size == null || product.size === '') return String(product.units || '').trim()
  return `${product.size} ${product.units || ''}`.trim()
}

function roundReceiptMoney(value) {
  return Math.round(Number(value) * 100) / 100
}

function moneyRoughlyEqual(a, b, tolerance = 0.03) {
  if (a == null || b == null) return false
  return Math.abs(Number(a) - Number(b)) <= tolerance
}

function normalizeReceiptProductPricing(product) {
  const quantity = Math.max(1, parseInt(product?.quantity, 10) || 1)
  const explicitUnitPrice = normalizeReceiptMoneyValue(product?.unitPrice)
  const explicitLineTotal = normalizeReceiptMoneyValue(
    product?.lineTotal ??
      product?.lineTotalPrice ??
      product?.extendedPrice ??
      product?.extPrice ??
      product?.totalPrice ??
      product?.amount
  )
  const legacyPrice = normalizeReceiptMoneyValue(product?.price)

  let unitPrice = explicitUnitPrice
  let lineTotal = explicitLineTotal

  if (unitPrice == null && legacyPrice != null) {
    if (lineTotal != null) {
      unitPrice = legacyPrice
    } else if (quantity > 1 && explicitUnitPrice == null && product?.lineTotal == null) {
      // Receipt line amounts with qty > 1 are usually extended totals, not unit prices.
      lineTotal = legacyPrice
      unitPrice = roundReceiptMoney(legacyPrice / quantity)
    } else {
      unitPrice = legacyPrice
    }
  }

  if (lineTotal != null && lineTotal > 0) {
    const unitFromLine = roundReceiptMoney(lineTotal / quantity)
    if (unitPrice == null) {
      unitPrice = unitFromLine
    } else if (quantity > 1) {
      const lineFromUnit = roundReceiptMoney(unitPrice * quantity)
      const priceIsLineTotal = moneyRoughlyEqual(unitPrice, lineTotal)
      const unitPriceIsConsistent = moneyRoughlyEqual(lineFromUnit, lineTotal)
      if (priceIsLineTotal && !unitPriceIsConsistent) {
        unitPrice = unitFromLine
      } else if (!unitPriceIsConsistent && unitFromLine > 0 && unitPrice > lineTotal) {
        // unitPrice larger than the stated line total — likely swapped
        unitPrice = unitFromLine
      }
    }
  }

  return {
    ...product,
    quantity,
    price: unitPrice
  }
}

function inferReceiptPricesFromSubtotal(products, productSubtotal) {
  if (!Array.isArray(products) || products.length === 0) return products
  const subtotal = normalizeReceiptMoneyValue(productSubtotal)
  if (subtotal == null || subtotal <= 0) return products

  const pricedProducts = products.filter((product) => product.price != null && product.price > 0)
  if (pricedProducts.length === 0) return products

  const sumAsUnitPrices = roundReceiptMoney(
    pricedProducts.reduce((sum, product) => sum + product.price * product.quantity, 0)
  )
  const sumAsLineTotals = roundReceiptMoney(
    pricedProducts.reduce((sum, product) => sum + product.price, 0)
  )

  const unitPricingMatches = moneyRoughlyEqual(sumAsUnitPrices, subtotal, 0.5)
  const linePricingMatches = moneyRoughlyEqual(sumAsLineTotals, subtotal, 0.5)

  if (linePricingMatches && !unitPricingMatches) {
    return products.map((product) => {
      if (product.price == null || product.quantity <= 1) return product
      return {
        ...product,
        price: roundReceiptMoney(product.price / product.quantity)
      }
    })
  }

  return products
}

function normalizeManualOrderReceiptParse(raw) {
  if (!raw || typeof raw !== 'object') return null

  const productSubtotal = normalizeReceiptMoneyValue(
    raw.productSubtotal ?? raw.productsSubtotal ?? raw.merchandiseSubtotal ?? raw.subtotal
  )

  let products = (Array.isArray(raw.products) ? raw.products : [])
    .map((product) =>
      normalizeReceiptProductPricing({
        name: String(product?.name || '').trim(),
        size: String(product?.size || '').trim(),
        quantity: product?.quantity,
        unitPrice: product?.unitPrice,
        price: product?.price,
        lineTotal:
          product?.lineTotal ??
          product?.lineTotalPrice ??
          product?.extendedPrice ??
          product?.extPrice ??
          product?.totalPrice ??
          product?.amount
      })
    )
    .filter((product) => product.name)

  products = inferReceiptPricesFromSubtotal(products, productSubtotal)

  let confidenceNotes = String(raw.confidenceNotes || '').trim() || null
  if (productSubtotal != null) {
    const correctedSum = roundReceiptMoney(
      products.reduce((sum, product) => sum + (product.price || 0) * product.quantity, 0)
    )
    if (moneyRoughlyEqual(correctedSum, productSubtotal, 0.5)) {
      const note = 'Unit prices normalized from receipt line totals using the merchandise subtotal.'
      confidenceNotes = confidenceNotes ? `${confidenceNotes} ${note}` : note
    }
  }

  return {
    storeName: String(raw.storeName || '').trim() || null,
    companyName: String(raw.companyName || '').trim() || null,
    customerName: String(raw.customerName || '').trim() || null,
    email: String(raw.email || '').trim() || null,
    streetAddress: String(raw.streetAddress || '').trim() || null,
    city: String(raw.city || '').trim() || null,
    state: String(raw.state || '').trim().toUpperCase().slice(0, 2) || null,
    zip: String(raw.zip || '').trim().replace(/[^\d-]/g, '').slice(0, 10) || null,
    orderDate: normalizeReceiptDate(raw.orderDate),
    externalOrderNumber: String(raw.externalOrderNumber || raw.poNumber || raw.po || '').trim() || null,
    productSubtotal,
    products,
    delivery: normalizeReceiptMoneyValue(raw.delivery),
    discount: normalizeReceiptMoneyValue(raw.discount),
    engraving: normalizeReceiptMoneyValue(raw.engraving),
    salesTax: normalizeReceiptMoneyValue(raw.salesTax),
    service: normalizeReceiptMoneyValue(raw.service),
    serviceChargeTax: normalizeReceiptMoneyValue(raw.serviceChargeTax),
    shipping: normalizeReceiptMoneyValue(raw.shipping),
    tip: normalizeReceiptMoneyValue(raw.tip),
    confidenceNotes
  }
}

async function enrichParsedReceiptProducts(products = []) {
  await ensureProductsCacheLoaded()
  return products.map((product) => {
    const size = product.size || parseSizeFromCombinedName(product.name) || ''
    const cached = findProductInCache(product.name, size)
    if (cached) {
      const catalogSize = formatCatalogProductSize(cached)
      const displayName = buildManualOrderProductName(cached)
      return {
        ...product,
        name: String(cached.name || product.name).replace(/\s*-\s*\d+(?:\.\d+)?(?:\s*(?:ML|L|OZ|CL|G|LB|PK|PACK|LT|LITER|LITRE))?\s*$/i, '').trim() || product.name,
        size: catalogSize || product.size,
        query: displayName,
        catalogMatched: true
      }
    }
    return {
      ...product,
      query: `${product.name}${product.size ? ` ${product.size}` : ''}`.trim(),
      catalogMatched: false
    }
  })
}

async function parseManualOrderReceiptWithAI({ mimeType, dataBase64, fileName }) {
  if (!openai) {
    return { skipped: true, reason: 'OpenAI is not configured on the server' }
  }

  const normalizedMime = String(mimeType || '').trim().toLowerCase()
  const allowedImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
  if (normalizedMime !== 'application/pdf' && !allowedImageTypes.has(normalizedMime)) {
    return { skipped: true, reason: 'Unsupported file type. Upload a JPEG, PNG, WebP, GIF, or PDF.' }
  }

  const systemPrompt = `You extract structured order data from Bevvi liquor/wine retail receipts, invoices, purchase orders, or delivery documents.
Read all visible text carefully. Extract only values that are clearly present — never invent data.
Products are typically wine, beer, or spirits with sizes like 750 ML, 1 L, 1.75 L, 375 ML, 12 OZ.
Return numeric money amounts without currency symbols. Use null for missing optional fields.
Dates must be YYYY-MM-DD when possible.
US state as 2-letter code. Zip as 5 or 9 digits.
Capture purchase order numbers, invoice numbers, or customer reference numbers in externalOrderNumber when present.

IMPORTANT pricing rules:
- Each product must include quantity, unitPrice (price for ONE item), and lineTotal (extended amount = unitPrice x quantity).
- If the receipt shows only one dollar amount for a line, put the per-item amount in unitPrice when qty is 1.
- If qty > 1 and the receipt shows an extended/line total, put that amount in lineTotal and compute unitPrice = lineTotal / quantity.
- Never put a line total into unitPrice when quantity is greater than 1.
- Also extract productSubtotal when visible (merchandise/product total before tax, delivery, service, and tip).

Return ONLY valid JSON with this shape:
{
  "storeName": null,
  "companyName": null,
  "customerName": null,
  "email": null,
  "streetAddress": null,
  "city": null,
  "state": null,
  "zip": null,
  "orderDate": null,
  "externalOrderNumber": null,
  "productSubtotal": null,
  "products": [{ "name": "", "size": "", "quantity": 1, "unitPrice": null, "lineTotal": null, "price": null }],
  "delivery": null,
  "discount": null,
  "engraving": null,
  "salesTax": null,
  "service": null,
  "serviceChargeTax": null,
  "shipping": null,
  "tip": null,
  "confidenceNotes": ""
}`

  const dataUrl = `data:${normalizedMime};base64,${dataBase64}`
  const userContent = []

  if (normalizedMime === 'application/pdf') {
    userContent.push({
      type: 'file',
      file: {
        filename: fileName || 'receipt.pdf',
        file_data: dataUrl
      }
    })
  } else {
    userContent.push({
      type: 'image_url',
      image_url: { url: dataUrl, detail: 'high' }
    })
  }

  userContent.push({
    type: 'text',
    text: 'Extract all order fields from this receipt/document for a manual liquor delivery order.'
  })

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent }
      ],
      temperature: 0.1,
      max_tokens: 2500,
      response_format: { type: 'json_object' }
    })

    const parsed = parseJsonFromAiContent(completion.choices?.[0]?.message?.content)
    const normalized = normalizeManualOrderReceiptParse(parsed)
    if (!normalized) {
      return { success: false, error: 'Could not parse receipt contents' }
    }

    normalized.products = await enrichParsedReceiptProducts(normalized.products)
    return { success: true, parsed: normalized }
  } catch (error) {
    console.error('Receipt scan failed:', error.message)
    return { success: false, error: 'Failed to scan receipt', message: error.message }
  }
}

function expandWineSearchQuery(name) {
  if (!name || typeof name !== 'string') return name
  // "Opus 2022" is commonly Opus One; expand for better wine-specific results
  const m = name.match(/^Opus\s+(\d{4})(.*)$/i)
  return m ? `Opus One ${m[1]}${m[2] || ''}`.replace(/\s+/g, ' ').trim() : name
}

function normalizeProductFields(payload) {
  if (!payload || typeof payload !== 'object') return payload
  const out = { ...payload }

  // ABV sanity: 80, 90, 95 etc are likely wine scores, not ABV (wine is typically 12-16%)
  const abvNum = parseFloat(out.abv)
  if (!isNaN(abvNum) && (abvNum > 25 || abvNum < 5)) {
    out.abv = null
  }

  // Size/units: "750 ml" -> size=750, units=ML; "750" with units "bottle" -> units=ML for wine
  const sizeStr = String(out.size || '').trim()
  const unitsStr = String(out.units || '').trim().toUpperCase()
  const combinedMatch = sizeStr.match(/^(\d+(?:\.\d+)?)\s*(ml|mL|L|oz|OZ|cl|CL)?$/i)
  if (combinedMatch) {
    out.size = combinedMatch[1]
    out.units = (combinedMatch[2] || 'ML').toUpperCase()
  } else {
    const withUnitsMatch = sizeStr.match(/^(\d+(?:\.\d+)?)\s*(ml|mL|L|oz|cl)\b/i)
    if (withUnitsMatch) {
      out.size = withUnitsMatch[1]
      out.units = withUnitsMatch[2].toUpperCase()
    } else if (unitsStr === 'BOTTLE' && /^\d+(?:\.\d+)?$/.test(sizeStr)) {
      out.size = sizeStr
      out.units = 'ML'
    }
  }

  // Description cleanup: remove field labels and noisy concatenations
  if (out.description) {
    let desc = String(out.description).replace(/\s+/g, ' ').trim()
    desc = desc.replace(/\b(size|units|companyName|lowestPrice|containerType|containerCount|averagePrice|varietal\s+composition)\b/gi, '')
    const nameStr = String(out.name || '').trim()
    if (nameStr && desc.toLowerCase().startsWith(nameStr.toLowerCase())) {
      desc = desc.slice(nameStr.length).trim()
    }
    // Truncate to first two sentences or 280 chars
    const sentences = desc.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0)
    if (sentences.length >= 2) {
      desc = `${sentences[0]} ${sentences[1]}`.trim()
    }
    if (desc.length > 280) {
      desc = `${desc.slice(0, 277).trim()}...`
    }
    out.description = desc || null
  }

  // Reject aroma if it contains field labels (wrong extraction); use description's aroma if available
  const aromaStr = String(out.aroma || '').trim()
  if (aromaStr && /\b(flavor|pairings|parentBrand|productNotes)\b/i.test(aromaStr)) {
    const desc = String(out.description || '')
    const aromaFromDesc = desc.match(/(?:Primary\s+)?aromas?\s+of\s+[^.]{15,250}/i)?.[0]?.trim()
    out.aroma = aromaFromDesc || null
  }

  // productNotes: if garbled (multiple snippets with ...), use description's tasting content or first good segment
  const notesStr = String(out.productNotes || '').trim()
  if (notesStr && notesStr.includes('...')) {
    const desc = String(out.description || '')
    const aromaMatch = desc.match(/(?:Primary\s+)?aromas?\s+of\s+[^.]{20,300}\.(?:\s+On\s+the\s+palate[^.]{20,200}\.)?/i)
    const palateMatch = desc.match(/On\s+the\s+palate[^.]{20,300}\./i)
    if (aromaMatch) {
      out.productNotes = aromaMatch[0].trim()
    } else if (palateMatch) {
      out.productNotes = palateMatch[0].trim()
    } else {
      const segments = notesStr.split(/\s*\.{2,}\s*/).filter(s => s.trim().length > 30)
      out.productNotes = segments[0]?.trim() || out.productNotes
    }
  }

  return out
}

async function enrichProductFromWeb({ upc, name, userFields }) {
  const upcData = upc ? await fetchUpcItemDb(upc) : await fetchUpcItemDb(name)
  const expandedName = expandWineSearchQuery(name)
  const searchQuery = [upc, expandedName].filter(Boolean).join(' ')
  const serpData = await fetchSerpApiResults(searchQuery)
  const serpPages = await fetchSerpResultPages(serpData, 3)
  const nameSizeUnits = extractSizeUnitsFromName(name)
  const initialCorpus = buildSerpCorpus(serpData, serpPages)
  const extractedFromText = extractFieldsFromCorpus(initialCorpus)

  let aiResult = await extractProductDetailsWithAI({ upc, name, upcData, serpData: { ...serpData, pages: serpPages }, userFields })
  if (aiResult) {
    const primaryMerged = {
      ...buildFallbackProductData({ upc, name, upcData }),
      ...aiResult,
      ...extractedFromText,
      ...userFields,
      upc: aiResult.upc || upc || null,
      name: aiResult.name || name || null,
      size: aiResult.size || nameSizeUnits?.size || null,
      units: aiResult.units || nameSizeUnits?.units || null,
      slug: aiResult.slug || slugify(aiResult.name || name || '') || null
    }
    const missingFields = REQUIRED_PRODUCT_FIELDS.filter(field => {
      const value = primaryMerged[field]
      if (value === null || value === undefined) return true
      if (typeof value === 'string' && value.trim() === '') return true
      return false
    })
    if (missingFields.length === 0 || !SERPAPI_API_KEY) {
      return normalizeProductFields(primaryMerged)
    }

    const secondaryQuery = [expandedName, upc, missingFields.join(' ')].filter(Boolean).join(' ')
    const serpSecondary = await fetchSerpApiResults(secondaryQuery)
    const serpSecondaryPages = await fetchSerpResultPages(serpSecondary, 3)

    const wineFields = ['abv', 'industryRatings', 'productNotes']
    const targetedSearches = []
    for (const field of missingFields.slice(0, 4)) {
      const wineHint = wineFields.includes(field) ? ' wine' : ''
      const fieldQuery = ([expandedName, field].filter(Boolean).join(' ') + wineHint).trim()
      const serpTargeted = await fetchSerpApiResults(fieldQuery)
      const serpTargetedPages = await fetchSerpResultPages(serpTargeted, 2)
      targetedSearches.push({
        field,
        query: fieldQuery,
        results: serpTargeted,
        pages: serpTargetedPages
      })
    }
    const secondaryCorpus = buildSerpCorpus(serpSecondary, serpSecondaryPages, targetedSearches)
    const extractedSecondary = extractFieldsFromCorpus(secondaryCorpus)
    aiResult = await extractProductDetailsWithAI({
      upc,
      name,
      upcData,
      serpData: {
        primary: { ...serpData, pages: serpPages },
        secondary: { ...serpSecondary, pages: serpSecondaryPages },
        targeted: targetedSearches
      },
      userFields
    })

    if (aiResult) {
      return normalizeProductFields({
        ...primaryMerged,
        ...aiResult,
        ...extractedSecondary,
        ...userFields,
        upc: aiResult.upc || primaryMerged.upc,
        name: aiResult.name || primaryMerged.name,
        size: aiResult.size || primaryMerged.size,
        units: aiResult.units || primaryMerged.units,
        slug: aiResult.slug || primaryMerged.slug
      })
    }

    return normalizeProductFields({
      ...primaryMerged,
      ...extractedSecondary,
      ...userFields
    })
  }

  const fallback = buildFallbackProductData({ upc, name, upcData })
  return normalizeProductFields({
    ...fallback,
    ...extractedFromText,
    ...userFields,
    size: fallback.size || nameSizeUnits?.size || null,
    units: fallback.units || nameSizeUnits?.units || null
  })
}

function normalizeUserFields(input) {
  if (!input || typeof input !== 'object') return {}
  const normalized = { ...input }
  if (normalized.units && typeof normalized.units === 'string') {
    normalized.units = normalized.units.toUpperCase()
  }
  return normalized
}

async function sendSlackMessage(text) {
  if (!SLACK_WEBHOOK_URL) {
    return false
  }
  try {
    await axios.post(SLACK_WEBHOOK_URL, { text })
    return true
  } catch (error) {
    console.error('❌ Slack notification failed:', error.message)
    return false
  }
}

async function evaluateSlackNotifications(orders) {
  if (!SLACK_WEBHOOK_URL || !Array.isArray(orders)) {
    return
  }
  if (orders.length === 0) {
    pruneSlackNotificationState(new Set())
    return
  }

  const now = new Date()
  const currentOrderIds = new Set()

  for (const order of orders) {
    if (!order || !order.id) continue
    currentOrderIds.add(order.id)

    const state = getSlackNotificationState(order.id)
    const normalizedStatus = (order.status || '').toLowerCase()

    if (normalizedStatus === 'pending' && !state.pending15Sent && order.orderDateTime) {
      const orderDateTime = new Date(order.orderDateTime)
      if (!isNaN(orderDateTime.getTime())) {
        const minutesSinceReceipt = (now.getTime() - orderDateTime.getTime()) / (1000 * 60)
        if (minutesSinceReceipt >= 15) {
          const message = [
            '⚠️ Order Pending > 15 mins',
            `Order ID: ${order.id}`,
            `Customer: ${order.customerName || 'N/A'}`,
            `Status: ${order.status || 'N/A'}`,
            `Order Time: ${formatSlackDateTime(order.orderDateTime)}`,
            `Delivery Time: ${formatSlackDateTime(order.deliveryDateTime)}`,
            `Total: $${(order.total || 0).toFixed(2)}`
          ].join('\n')
          const sent = await sendSlackMessage(message)
          if (sent) {
            state.pending15Sent = true
          }
        }
      }
    }

    if (normalizedStatus === 'accepted' && !state.accepted30Sent && order.deliveryDateTime) {
      const deliveryDateTime = new Date(order.deliveryDateTime)
      if (!isNaN(deliveryDateTime.getTime())) {
        const minutesUntilDelivery = (deliveryDateTime.getTime() - now.getTime()) / (1000 * 60)
        if (minutesUntilDelivery <= 30 && minutesUntilDelivery >= 0) {
          const message = [
            '⚠️ Order Still Accepted 30 mins Before Delivery',
            `Order ID: ${order.id}`,
            `Customer: ${order.customerName || 'N/A'}`,
            `Status: ${order.status || 'N/A'}`,
            `Order Time: ${formatSlackDateTime(order.orderDateTime)}`,
            `Delivery Time: ${formatSlackDateTime(order.deliveryDateTime)}`,
            `Total: $${(order.total || 0).toFixed(2)}`
          ].join('\n')
          const sent = await sendSlackMessage(message)
          if (sent) {
            state.accepted30Sent = true
          }
        }
      }
    }

  }

  pruneSlackNotificationState(currentOrderIds)
}

/** Update in-memory orders used for Slack checks and re-run time-based Slack alerts. */
async function refreshOrdersForAlerts(orders, dateRange = null) {
  const list = Array.isArray(orders) ? orders : []
  const range = dateRange || lastAutoRefreshRange || (global.lastRefreshedOrders && global.lastRefreshedOrders.dateRange) || null
  global.lastRefreshedOrders = {
    orders: list,
    timestamp: new Date(),
    dateRange: range
  }

  const contextKey = getOrdersNotificationContextKey(range)
  const contextChanged = Boolean(contextKey && contextKey !== ordersNotificationContextKey)
  if (contextChanged) {
    ordersNotificationContextKey = contextKey
    console.log(`🔔 Order notification context changed — reseeding baseline (${contextKey})`)
  }

  const newOrders = detectNewOrders(list, { reseed: contextChanged })
  if (newOrders.length > 0) {
    notifyClientsOfNewOrders(newOrders)
  }

  try {
    await evaluateSlackNotifications(list)
  } catch (err) {
    console.error('Slack notification evaluation failed:', err.message)
  }
}

// CRITICAL: Set API route headers FIRST, before any other middleware
// This ensures API routes always return JSON, never HTML
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    // Immediately set JSON content type for all API routes
    res.setHeader('Content-Type', 'application/json')
    console.log(`🔵 API route detected early: ${req.method} ${req.path}`)
  }
  next()
})

// Middleware
const CORS_ORIGINS = new Set([
  'http://localhost:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
  'http://localhost:4173',
  'http://127.0.0.1:4173'
])
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true)
    if (CORS_ORIGINS.has(origin)) return callback(null, true)
    if (process.env.CORS_ORIGIN && origin === process.env.CORS_ORIGIN) return callback(null, true)
    callback(null, false)
  },
  credentials: true
}))
app.use(express.json({
  limit: '25mb',
  verify: (req, res, buf) => {
    req.rawBody = buf
  }
}))

app.use((err, req, res, next) => {
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({
      success: false,
      error: 'Upload is too large. Use a file under 10 MB.'
    })
  }
  next(err)
})

// Add some debugging
app.use((req, res, next) => {
  console.log(`${req.method} ${req.path}`)
  next()
})

// Serve static files from the dist directory with no-cache headers for HTML
// IMPORTANT: Static files are served AFTER API routes to prevent API requests from being intercepted
// See line ~2840 where static files are actually served

// CSV parsing function
function parseCSVToOrders(csvData, orderDate, displayTimeZone = DEFAULT_ORDER_TIMEZONE) {
  try {
    console.log('Starting CSV parsing...')
    console.log('Raw CSV data type:', typeof csvData)
    console.log('Raw CSV data length:', csvData.length)
    
    // Split CSV into lines
    const lines = csvData.split('\n').filter(line => line.trim())
    console.log('Number of lines after splitting:', lines.length)
    console.log('First few lines:', lines.slice(0, 3))
    
    if (lines.length < 2) {
      console.log('CSV has insufficient data (less than 2 lines)')
      return []
    }
    
    // Check if the CSV actually contains meaningful data (not just headers)
    if (lines.length === 2 && lines[1].trim().length < 10) {
      console.log('CSV contains only headers and minimal data')
      return []
    }
    
    // Parse header row
    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''))
    console.log('CSV Headers:', headers)
    console.log('Number of headers:', headers.length)
    // Log first data row to see actual values
    if (lines.length > 1) {
      const firstDataRow = parseCSVLine(lines[1])
      console.log('First data row sample:', firstDataRow.slice(0, 10))
      // Create a map of header to value for easier debugging
      const headerValueMap = {}
      headers.forEach((header, index) => {
        if (index < firstDataRow.length) {
          headerValueMap[header] = firstDataRow[index]
        }
      })
      console.log('Header to value map (first order):', JSON.stringify(headerValueMap, null, 2))
    }
    
    // Parse data rows
    const orders = []
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]
      if (!line.trim()) continue
      
      // Simple CSV parsing (handles quoted fields)
      const values = parseCSVLine(line)
      console.log(`Line ${i}: values count = ${values.length}, headers count = ${headers.length}`)
      
      if (values.length >= headers.length) {
        const order = createOrderFromCSV(headers, values, orderDate, displayTimeZone)
        if (order) {
          orders.push(order)
        }
      } else {
        console.log(`Line ${i} skipped: insufficient values (${values.length} < ${headers.length})`)
      }
    }
    
    console.log(`Parsed ${orders.length} orders from CSV`)
    if (orders.length === 0) {
      console.log('No orders parsed for this date range')
    }
    return orders // Return empty array instead of mock data
    
  } catch (error) {
    console.error('CSV parsing error:', error)
    return [] // Return empty array instead of mock data
  }
}

// Parse CSV line with proper quote handling and JSON field support
function parseCSVLine(line) {
  const values = []
  let current = ''
  let inQuotes = false
  let braceDepth = 0
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    const nextChar = i + 1 < line.length ? line[i + 1] : ''
    
    if (char === '"' && inQuotes && nextChar === '"') {
      current += '"'
      i += 1
      continue
    }
    
    if (char === '"') {
      inQuotes = !inQuotes
      continue
    }
    
    if (!inQuotes && char === '{') {
      braceDepth += 1
    } else if (!inQuotes && char === '}' && braceDepth > 0) {
      braceDepth -= 1
    }
    
    if (char === ',' && !inQuotes && braceDepth === 0) {
      values.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  
  values.push(current.trim())
  return values
}

// Check delivery status based on order type and timing
function checkOrderDeliveryStatus(order, currentStatus) {
  const now = new Date()
  const orderDate = new Date(order.orderDate)
  
  // For shipping orders: check if not in_transit within 3 business days
  if ((parseFloat(order.shippingFee) || 0) > 0) {
    if (currentStatus === 'delivered') {
      return 'On Time' // Delivered orders are considered on time
    } else if (currentStatus === 'in_transit') {
      return 'On Time' // In transit orders are on time
    } else {
      const businessDays = calculateBusinessDays(orderDate, now)
      if (businessDays > 3) {
        return 'Delayed'
      } else {
        return 'On Time'
      }
    }
  }
  
  // For delivery orders: check delivery timing
  if ((parseFloat(order.shippingFee) || 0) === 0 && order.deliveryDate !== 'N/A') {
    try {
      const deliveryDateTime = new Date(order.deliveryDate)
      const timeDiff = deliveryDateTime.getTime() - now.getTime()
      const minutesUntilDelivery = timeDiff / (1000 * 60)
      
      // Scenario 1: Orders not delivered after delivery window
      if (currentStatus !== 'delivered' && minutesUntilDelivery < -30) {
        return 'Delayed'
      }
      
      // Scenario 2: Orders delivered but after delivery window
      if (currentStatus === 'delivered' && minutesUntilDelivery < -30) {
        return 'Delayed'
      }
      
      // In transit orders are considered on time
      if (currentStatus === 'in_transit') {
        return 'On Time'
      }
      
      // Orders within delivery window or not significantly past
      if (minutesUntilDelivery >= -30) {
        return 'On Time'
      }
      
      return 'On Time' // Default case
    } catch (e) {
      // If delivery date parsing fails, return N/A
      console.log(`Delivery date parsing error for delivery status check: ${e.message}`)
      return 'N/A'
    }
  }
  
  // For orders without clear shipping/delivery classification
  return 'N/A'
}

// Extract state from text (establishment name, address, etc.)
function extractStateFromText(text) {
  if (!text) return null
  
  // Airport code to state mapping (major US airports)
  const airportToState = {
    'LGB': 'CA', 'LAX': 'CA', 'SFO': 'CA', 'SAN': 'CA', 'SMF': 'CA', 'SJC': 'CA',
    'TEB': 'NJ', 'EWR': 'NJ',
    'DAL': 'TX', 'DFW': 'TX', 'IAH': 'TX', 'AUS': 'TX',
    'SDL': 'AZ', 'PHX': 'AZ',
    'PBI': 'FL', 'MIA': 'FL', 'FLL': 'FL', 'TPA': 'FL', 'MCO': 'FL', 'JAX': 'FL',
    'BOS': 'MA', 'ORH': 'MA',
    'JFK': 'NY', 'LGA': 'NY', 'EWR': 'NJ', 'BUF': 'NY',
    'ORD': 'IL', 'CHI': 'IL', 'MDW': 'IL',
    'ATL': 'GA',
    'DEN': 'CO',
    'SEA': 'WA',
    'PDX': 'OR',
    'LAS': 'NV',
    'PHX': 'AZ',
    'MSP': 'MN',
    'DTW': 'MI',
    'PHL': 'PA',
    'CLT': 'NC',
    'BWI': 'MD',
    'DCA': 'DC', 'IAD': 'VA',
    'SLC': 'UT',
    'HNL': 'HI'
  }
  
  // Try to find airport code (3 capital letters, like "LGB", "TEB", "DAL")
  const airportMatch = text.match(/\b([A-Z]{3})\b/)
  if (airportMatch && airportToState[airportMatch[1]]) {
    return airportToState[airportMatch[1]]
  }
  
  // Common US state abbreviations
  const stateMap = {
    'AL': 'Alabama', 'AK': 'Alaska', 'AZ': 'Arizona', 'AR': 'Arkansas',
    'CA': 'California', 'CO': 'Colorado', 'CT': 'Connecticut', 'DE': 'Delaware',
    'FL': 'Florida', 'GA': 'Georgia', 'HI': 'Hawaii', 'ID': 'Idaho',
    'IL': 'Illinois', 'IN': 'Indiana', 'IA': 'Iowa', 'KS': 'Kansas',
    'KY': 'Kentucky', 'LA': 'Louisiana', 'ME': 'Maine', 'MD': 'Maryland',
    'MA': 'Massachusetts', 'MI': 'Michigan', 'MN': 'Minnesota', 'MS': 'Mississippi',
    'MO': 'Missouri', 'MT': 'Montana', 'NE': 'Nebraska', 'NV': 'Nevada',
    'NH': 'New Hampshire', 'NJ': 'New Jersey', 'NM': 'New Mexico', 'NY': 'New York',
    'NC': 'North Carolina', 'ND': 'North Dakota', 'OH': 'Ohio', 'OK': 'Oklahoma',
    'OR': 'Oregon', 'PA': 'Pennsylvania', 'RI': 'Rhode Island', 'SC': 'South Carolina',
    'SD': 'South Dakota', 'TN': 'Tennessee', 'TX': 'Texas', 'UT': 'Utah',
    'VT': 'Vermont', 'VA': 'Virginia', 'WA': 'Washington', 'WV': 'West Virginia',
    'WI': 'Wisconsin', 'WY': 'Wyoming', 'DC': 'District of Columbia'
  }
  
  // Try to find state abbreviation (2 capital letters)
  const abbrMatch = text.match(/\b([A-Z]{2})\b/)
  if (abbrMatch && stateMap[abbrMatch[1]]) {
    return abbrMatch[1]
  }
  
  // Try to find full state name
  const lowerText = text.toLowerCase()
  for (const [abbr, fullName] of Object.entries(stateMap)) {
    if (lowerText.includes(fullName.toLowerCase())) {
      return abbr
    }
  }
  
  return null
}

// Calculate business days between two dates (excluding weekends)
function calculateBusinessDays(startDate, endDate) {
  let businessDays = 0
  const current = new Date(startDate)
  
  while (current <= endDate) {
    const dayOfWeek = current.getDay()
    if (dayOfWeek !== 0 && dayOfWeek !== 6) { // 0 = Sunday, 6 = Saturday
      businessDays++
    }
    current.setDate(current.getDate() + 1)
  }
  
  return businessDays
}

// Create order object from CSV data
function createOrderFromCSV(headers, values, orderDate, displayTimeZone = DEFAULT_ORDER_TIMEZONE) {
  try {
    // Map Bevvi CSV fields to our order structure
    const order = {
      id: '',
      customerName: '',
      orderDate: orderDate,
      deliveryDate: '', // Will be set separately if available
      status: 'pending',
      total: 0,
      items: [],
      address: '',
      phone: '',
      establishment: '',
      revenue: 0,
      tax: 0,
      tip: 0,
      shippingFee: 0,
      deliveryFee: 0,
      serviceCharge: 0,
      // Additional Bevvi API fields
      monthYear: '',
      giftNoteCharge: 0,
      promoDiscAmt: 0,
      serviceChargeTax: 0,
      stripePaymentId: '',
      externalOrderNumber: '',
      // State fields
      shippingState: '',
      billingState: '',
      shippingCity: '',
      shippingZip: ''
    }
    
    // First pass: Look for ORDER datetime fields in ALL headers (before switch statement)
    // IMPORTANT: Skip delivery-related fields - they'll be handled separately
    headers.forEach((header, index) => {
      const value = values[index] || ''
      const lowerHeader = header.toLowerCase().trim()
      
      // Skip delivery-related fields - they should not be used for orderDateTime
      const isDeliveryField = lowerHeader.includes('delivery') && !lowerHeader.includes('order')
      
      // Check if this field contains datetime information (even if not in our switch cases)
      // Only process if it's NOT a delivery field and we don't already have orderDateTime
      if (value && value.trim() && value !== 'null' && value !== 'undefined' && !order.orderDateTime && !isDeliveryField) {
        // Check if value looks like a datetime
        const looksLikeDateTime = value.includes('T') || 
                                 (value.includes(' ') && value.match(/\d{1,2}:\d{2}/)) ||
                                 value.match(/\d{1,2}\/\d{1,2}\/\d{4} \d{1,2}:\d{2}/) ||
                                 value.match(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/) ||
                                 value.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)
        
        if (looksLikeDateTime) {
          try {
            const parsedDateTime = new Date(value)
            if (!isNaN(parsedDateTime.getTime())) {
              // Check if it has actual time (not just midnight)
              const hasTime = parsedDateTime.getHours() !== 0 || parsedDateTime.getMinutes() !== 0 || parsedDateTime.getSeconds() !== 0
              if (hasTime) {
                // Ensure datetime is stored with UTC timezone indicator
                let datetimeValue = value
                if (!datetimeValue.includes('Z') && !datetimeValue.match(/[+-]\d{2}:\d{2}$/)) {
                  if (datetimeValue.includes('T')) {
                    datetimeValue = datetimeValue.replace(/\.\d{3}$/, '') + 'Z'
                  } else if (datetimeValue.match(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/)) {
                    datetimeValue = datetimeValue.replace(' ', 'T') + 'Z'
                  }
                }
                
                order.orderDateTime = datetimeValue
                order.orderDate = calendarDateFromDateTimeString(datetimeValue, parsedDateTime, displayTimeZone)
                console.log(`✅ Found ORDER datetime in field "${header}"="${value}" -> "${datetimeValue}" for order ${order.id}`)
              }
            }
          } catch (e) {
            // Ignore parsing errors, continue to switch statement
          }
        }
      }
    })
    
    // Map fields based on Bevvi CSV structure
    headers.forEach((header, index) => {
      const value = values[index] || ''
      const lowerHeader = header.toLowerCase().trim()
      
      switch (lowerHeader) {
        case 'ordernum':
          order.id = value || `ORD${Date.now()}-${index}`
          order.ordernum = value || order.id  // Also set ordernum for state lookup
          break
        case 'customername':
          order.customerName = value || 'Unknown Customer'
          break
        case 'totalamount':
          order.total = parseFloat(value) || 0
          order.totalAmount = parseFloat(value) || 0  // Also preserve the original API value
          break
        case 'revenue':
          order.revenue = parseFloat(value) || 0
          break
        case 'tax':
          order.tax = parseFloat(value) || 0
          break
        case 'tip':
          order.tip = parseFloat(value) || 0
          break
        case 'shippingfee':
          order.shippingFee = parseFloat(value) || 0
          break
        case 'deliveryfee':
          order.deliveryFee = parseFloat(value) || 0
          break
        case 'servicecharge':
          order.serviceCharge = parseFloat(value) || 0
          break
        case 'status':
          // Map status strings from the new store transactions API
          // The new API returns actual status strings like "Delivered", "In Transit", etc.
          let statusValue = 'pending'
          
          // Convert the status string to lowercase and normalize it
          const normalizedStatus = value ? value.toLowerCase().trim() : ''
          
          // Debug: Log the actual status value from CSV
          console.log(`Raw status from CSV for order ${order.id}: "${value}" -> normalized: "${normalizedStatus}"`)
          
          if (normalizedStatus.includes('delivered') || normalizedStatus === 'delivered') {
            statusValue = 'delivered'
          } else if (normalizedStatus.includes('transit') || normalizedStatus === 'in transit') {
            statusValue = 'in_transit'
          } else if (normalizedStatus.includes('accepted') || normalizedStatus === 'accepted') {
            statusValue = 'accepted'
          } else if (normalizedStatus.includes('canceled') || normalizedStatus === 'canceled') {
            statusValue = 'canceled'
          } else if (normalizedStatus.includes('rejected') || normalizedStatus === 'rejected') {
            statusValue = 'rejected'
          } else if (normalizedStatus.includes('pending') || normalizedStatus === 'pending') {
            statusValue = 'pending'
          }
          
          // Special case: If you know certain orders should be delivered, we can override here
          // For example, if all AIRC orders should be delivered:
          // Note: Commented out to use actual API status instead of overriding
          // if (order.id && order.id.includes('AIRC')) {
          //   statusValue = 'delivered'
          // }
          
          order.status = statusValue
          
          // Add delivery status based on timing requirements
          order.deliveryStatus = checkOrderDeliveryStatus(order, statusValue)
          break
        case 'estname':
          order.establishment = value || 'Unknown Establishment'
          break
        case 'date':
        case 'orderdate':
        case 'order_date':
          // Use the date from CSV if available - this is the ORDER date, not delivery date
          if (value) {
            try {
              // Check if value contains time information (datetime format)
              const hasTime = value.includes('T') || value.includes(' ') || value.match(/\d{1,2}:\d{2}/)
              
              if (hasTime) {
                // Parse as datetime and store both date and datetime
                const parsedDateTime = new Date(value)
                if (!isNaN(parsedDateTime.getTime())) {
                  // Ensure datetime is stored with UTC timezone indicator
                  let datetimeValue = value
                  // If value doesn't have timezone, assume it's UTC and add Z
                  if (!datetimeValue.includes('Z') && !datetimeValue.match(/[+-]\d{2}:\d{2}$/)) {
                    if (datetimeValue.includes('T')) {
                      datetimeValue = datetimeValue.replace(/\.\d{3}$/, '') + 'Z'
                    } else if (datetimeValue.match(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/)) {
                      datetimeValue = datetimeValue.replace(' ', 'T') + 'Z'
                    }
                  }
                  
                  // Store full datetime with UTC indicator
                  order.orderDateTime = datetimeValue
                  order.orderDate = calendarDateFromDateTimeString(datetimeValue, parsedDateTime, displayTimeZone)
                  console.log(`✅ Parsed datetime "${value}" -> "${datetimeValue}" to date "${order.orderDate}" for order ${order.id}`)
                }
              } else {
                  // Handle date format like "8/23/2025" by parsing it manually
                  const dateParts = value.split('/')
                  if (dateParts.length === 3) {
                    const month = parseInt(dateParts[0]) - 1 // Month is 0-indexed
                    const day = parseInt(dateParts[1])
                    const year = parseInt(dateParts[2])
                    const parsedDate = new Date(year, month, day)
                    if (!isNaN(parsedDate.getTime())) {
                      // Use local date instead of UTC to avoid timezone issues
                      order.orderDate = parsedDate.getFullYear() + '-' + 
                                       String(parsedDate.getMonth() + 1).padStart(2, '0') + '-' + 
                                       String(parsedDate.getDate()).padStart(2, '0')
                      // Don't set orderDateTime here - wait to see if there's a time field
                      console.log(`Parsed date-only "${value}" to "${order.orderDate}" for order ${order.id} (will check for time field)`)
                    }
                  } else {
                    // Fallback to original parsing for other formats
                    const parsedDate = new Date(value)
                    if (!isNaN(parsedDate.getTime())) {
                      // Check if the parsed date actually has time component (not just midnight)
                      const hasTimeComponent = parsedDate.getHours() !== 0 || parsedDate.getMinutes() !== 0 || parsedDate.getSeconds() !== 0
                      
                      // Use local date instead of UTC to avoid timezone issues
                      order.orderDate = parsedDate.getFullYear() + '-' + 
                                       String(parsedDate.getMonth() + 1).padStart(2, '0') + '-' + 
                                       String(parsedDate.getDate()).padStart(2, '0')
                      
                      if (hasTimeComponent) {
                        // Has time, store as datetime
                        order.orderDateTime = value
                        console.log(`Parsed datetime "${value}" to date "${order.orderDate}" and datetime "${order.orderDateTime}" for order ${order.id}`)
                      } else {
                        // No time component, don't set orderDateTime yet
                        console.log(`Parsed date-only "${value}" to "${order.orderDate}" for order ${order.id} (will check for time field)`)
                      }
                    }
                  }
                }
            } catch (e) {
              console.log(`Date parsing error for value "${value}":`, e.message)
            }
          }
          break
        case 'time':
        case 'ordertime':
        case 'order_time':
        case 'createdtime':
        case 'created_time':
          // Handle time field - combine with orderDate to create orderDateTime
          if (value && order.orderDate) {
            try {
              // Parse time value (could be HH:MM, HH:MM:SS, etc.)
              let timeStr = value.trim()
              // Remove any timezone indicators
              timeStr = timeStr.replace(/[+-]\d{2}:\d{2}$/, '').replace(/Z$/, '')
              
              // Parse time components
              const timeMatch = timeStr.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/)
              if (timeMatch) {
                const hours = parseInt(timeMatch[1])
                const minutes = parseInt(timeMatch[2])
                const seconds = timeMatch[3] ? parseInt(timeMatch[3]) : 0
                
                // Combine with orderDate to create full datetime
                const dateStr = order.orderDate // Format: YYYY-MM-DD
                const [year, month, day] = dateStr.split('-').map(Number)
                const combinedDateTime = new Date(year, month - 1, day, hours, minutes, seconds)
                
                if (!isNaN(combinedDateTime.getTime())) {
                  order.orderDateTime = combinedDateTime.toISOString()
                  // Keep the calendar date we combined from — don't re-derive via timezone.
                  order.orderDate = dateStr
                  console.log(`Combined date "${order.orderDate}" and time "${value}" to datetime "${order.orderDateTime}" for order ${order.id}`)
                }
              }
            } catch (e) {
              console.log(`Time parsing error for value "${value}":`, e.message)
            }
          }
          break
        case 'datetime':
        case 'orderdatetime':
        case 'order_datetime':
        case 'timestamp':
        case 'created_at':
        case 'createdat':
        case 'createddate':
        case 'created_date':
        case 'transactiondatetime':
        case 'transaction_datetime':
        case 'ordercreated':
        case 'order_created':
        case 'ordercreatedat':
        case 'order_created_at':
          // Handle datetime fields - store both date and datetime
          if (value && value.trim() && value !== 'null' && value !== 'undefined') {
            try {
              const parsedDateTime = new Date(value)
              if (!isNaN(parsedDateTime.getTime())) {
                // Ensure datetime is stored with UTC timezone indicator
                let datetimeValue = value
                // If value doesn't have timezone, assume it's UTC and add Z
                if (!datetimeValue.includes('Z') && !datetimeValue.match(/[+-]\d{2}:\d{2}$/)) {
                  if (datetimeValue.includes('T')) {
                    datetimeValue = datetimeValue.replace(/\.\d{3}$/, '') + 'Z'
                  } else if (datetimeValue.match(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/)) {
                    datetimeValue = datetimeValue.replace(' ', 'T') + 'Z'
                  }
                }
                
                // Store full datetime with UTC indicator
                order.orderDateTime = datetimeValue
                order.orderDate = calendarDateFromDateTimeString(datetimeValue, parsedDateTime, displayTimeZone)
                console.log(`✅ Parsed datetime field "${lowerHeader}"="${value}" -> "${datetimeValue}" to date "${order.orderDate}" for order ${order.id}`)
              } else {
                order.orderDateTime = null
                console.log(`⚠️ Failed to parse datetime field "${lowerHeader}"="${value}" for order ${order.id}`)
              }
            } catch (e) {
              console.log(`Datetime parsing error for field "${lowerHeader}" value "${value}":`, e.message)
              order.orderDateTime = null
            }
          } else {
            order.orderDateTime = null
          }
          break
        case 'monthyear':
          order.monthYear = value || ''
          break
        case 'giftnotecharge':
          order.giftNoteCharge = parseFloat(value) || 0
          break
        case 'promodiscamt':
          order.promoDiscAmt = parseFloat(value) || 0
          break
        case 'servicechargetax':
          order.serviceChargeTax = parseFloat(value) || 0
          break
        case 'stripepaymentid':
          order.stripePaymentId = value || ''
          break
        case 'externalordernumber':
          order.externalOrderNumber = value || ''
          break
        case 'deliverydatetime':
          // Use actual delivery date/time from API if available
          console.log(`Processing deliveryDateTime for order ${order.id}: value="${value}", type=${typeof value}, length=${value ? value.length : 0}`)
          if (value && value.trim() && value !== 'null' && value !== 'undefined') {
            try {
              const parsedDeliveryDate = new Date(value)
              if (!isNaN(parsedDeliveryDate.getTime())) {
                let deliveryDateTimeValue = value
                if (!deliveryDateTimeValue.includes('Z') && !deliveryDateTimeValue.match(/[+-]\d{2}:\d{2}$/)) {
                  if (deliveryDateTimeValue.includes('T')) {
                    deliveryDateTimeValue = deliveryDateTimeValue.replace(/\.\d{3}$/, '') + 'Z'
                  } else if (deliveryDateTimeValue.match(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/)) {
                    deliveryDateTimeValue = deliveryDateTimeValue.replace(' ', 'T') + 'Z'
                  }
                }
                order.deliveryDate = getYyyyMmDdInTimeZone(deliveryDateTimeValue, displayTimeZone) ||
                                   getYyyyMmDdInTimeZone(parsedDeliveryDate, displayTimeZone) ||
                                   parsedDeliveryDate.getUTCFullYear() + '-' +
                                   String(parsedDeliveryDate.getUTCMonth() + 1).padStart(2, '0') + '-' +
                                   String(parsedDeliveryDate.getUTCDate()).padStart(2, '0')
                order.deliveryDateTime = deliveryDateTimeValue
                console.log(`✅ Set deliveryDate to: ${order.deliveryDate} and deliveryDateTime to: ${order.deliveryDateTime} for order ${order.id}`)
                
                // IMPORTANT: Don't set orderDateTime from deliveryDateTime - they should be separate
                if (!order.orderDateTime) {
                  console.log(`ℹ️  Order ${order.id}: deliveryDateTime set but orderDateTime not yet set - will look for order-specific datetime field`)
                }
              } else {
                order.deliveryDate = 'N/A'
                order.deliveryDateTime = null
                console.log(`Invalid date, set deliveryDate to: N/A`)
              }
            } catch (e) {
              console.log(`Delivery date parsing error for value "${value}":`, e.message)
              order.deliveryDate = 'N/A'
              order.deliveryDateTime = null
            }
          } else {
            order.deliveryDate = 'N/A'
            order.deliveryDateTime = null
            console.log(`Empty/null value, set deliveryDate to: N/A`)
          }
          break
        case 'doordashdeliverywindow':
          // Handle malformed JSON in DoorDash fields
          try {
            if (value && value.trim()) {
              // Try to parse as JSON, if it fails, store as string
              order.doorDashDeliveryWindow = value
            } else {
              order.doorDashDeliveryWindow = ''
            }
          } catch (e) {
            order.doorDashDeliveryWindow = value || ''
          }
          break
        case 'doordashpickupwindow':
          // Handle malformed JSON in DoorDash fields
          try {
            if (value && value.trim()) {
              // Try to parse as JSON, if it fails, store as string
              order.doorDashPickupWindow = value
            } else {
              order.doorDashPickupWindow = ''
            }
          } catch (e) {
            order.doorDashPickupWindow = value || ''
          }
          break
        case 'senttodoordash':
          order.sentToDoordash = value === 'true' || value === true
          break
        case 'doordashstatus':
          order.doorDashStatus = value || ''
          break
        case 'shippingstate':
        case 'shipping_state':
        case 'state':
          order.shippingState = value || ''
          break
        case 'billingstate':
        case 'billing_state':
          order.billingState = value || ''
          break
        case 'shippingcity':
        case 'shipping_city':
        case 'city':
          order.shippingCity = value || ''
          break
        case 'shippingzip':
        case 'shipping_zip':
        case 'zip':
        case 'zipcode':
          order.shippingZip = value || ''
          break
        default:
          break
      }

    })
    
    // Set default values if not found
    if (!order.id) order.id = `ORD${Date.now()}-${Math.random().toString(36).substr(2, 5)}`
    if (!order.customerName) order.customerName = 'Unknown Customer'
    if (!order.establishment) order.establishment = 'Unknown Establishment'
    
    // Final pass: If we still don't have orderDateTime, check ALL fields for datetime patterns
    // IMPORTANT: Exclude deliveryDateTime to avoid using delivery time as order time
    if (order.orderDate && !order.orderDateTime) {
      console.log(`⚠️ Order ${order.id} has orderDate "${order.orderDate}" but no orderDateTime. Checking all fields (excluding delivery fields)...`)
      
      // Check all order properties for datetime patterns
      for (const [key, value] of Object.entries(order)) {
        // Skip delivery-related fields
        if (key.includes('delivery') && !key.includes('order')) {
          continue
        }
        
        if (value && typeof value === 'string' && value.trim() && value !== 'null' && value !== 'undefined') {
          // Check if this value looks like a datetime
          const looksLikeDateTime = value.includes('T') || 
                                   (value.includes(' ') && value.match(/\d{1,2}:\d{2}/)) ||
                                   value.match(/\d{1,2}\/\d{1,2}\/\d{4} \d{1,2}:\d{2}/) ||
                                   value.match(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/) ||
                                   value.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)
          
          if (looksLikeDateTime) {
            try {
              const parsedDateTime = new Date(value)
              if (!isNaN(parsedDateTime.getTime())) {
                // Check if it has actual time (not just midnight)
                const hasTime = parsedDateTime.getHours() !== 0 || parsedDateTime.getMinutes() !== 0 || parsedDateTime.getSeconds() !== 0
                if (hasTime) {
                  // Verify the date matches our orderDate
                  const parsedDate = parsedDateTime.getFullYear() + '-' + 
                                   String(parsedDateTime.getMonth() + 1).padStart(2, '0') + '-' + 
                                   String(parsedDateTime.getDate()).padStart(2, '0')
                  
                  if (parsedDate === order.orderDate) {
                    // Ensure UTC timezone indicator
                    let datetimeValue = value
                    if (!datetimeValue.includes('Z') && !datetimeValue.match(/[+-]\d{2}:\d{2}$/)) {
                      if (datetimeValue.includes('T')) {
                        datetimeValue = datetimeValue.replace(/\.\d{3}$/, '') + 'Z'
                      } else if (datetimeValue.match(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/)) {
                        datetimeValue = datetimeValue.replace(' ', 'T') + 'Z'
                      }
                    }
                    order.orderDateTime = datetimeValue
                    console.log(`✅ Found orderDateTime in field "${key}"="${value}" -> "${datetimeValue}" for order ${order.id}`)
                    break
                  }
                }
              }
            } catch (e) {
              // Continue checking other fields
            }
          }
        }
      }
      
      if (!order.orderDateTime) {
        console.log(`❌ Could not find orderDateTime for order ${order.id}. Available date/time fields:`, 
          Object.keys(order).filter(k => {
            const val = order[k]
            return val && typeof val === 'string' && (k.includes('time') || k.includes('date') || k.includes('created')) && !k.includes('delivery')
          }).map(k => `${k}="${order[k]}"`))
      }
    }
    
    // Extract state from establishment name if shippingState is empty
    if (!order.shippingState && order.establishment) {
      console.log(`🔍 Trying to extract state from establishment: "${order.establishment}"`)
      const stateFromEstablishment = extractStateFromText(order.establishment)
      if (stateFromEstablishment) {
        order.shippingState = stateFromEstablishment
        console.log(`✅ Extracted state: ${stateFromEstablishment}`)
      } else {
        console.log(`❌ No state found in establishment name`)
      }
    }
    
    // Log sample order data (removed orders.length check as it's not in scope)
    // Logging moved to parseCSVToOrders function instead
    
    // Use actual delivery date from API if available, otherwise set to N/A
    if (!order.deliveryDate) {
      order.deliveryDate = 'N/A'
    }
    
    // Special case: Goody orders should always show N/A for delivery dates
    if (order.id && order.id.startsWith('GD-BEVVI-')) {
      order.deliveryDate = 'N/A'
    }
    
    // Add a default item if none specified
    if (order.items.length === 0) {
      order.items = [{
        name: `Order from ${order.establishment}`,
        quantity: 1,
        price: order.total
      }]
    }
    
    return order
  } catch (error) {
    console.error('Error creating order from CSV:', error)
    return null
  }
}

// Get mock orders for fallback
function getMockOrders(orderDate) {
  return [
    {
      id: 'ORD001',
      customerName: 'John Smith',
      orderDate: orderDate,
      deliveryDate: 'N/A',
      status: 'delivered',
      total: 45.99,
      items: [
        { name: 'Bevvi Water Bottle', quantity: 2, price: 22.99 },
        { name: 'Bevvi Filter', quantity: 1, price: 0.01 }
      ],
      address: '123 Main St, City, State 12345',
      phone: '+1-555-0123'
    },
    {
      id: 'ORD002',
      customerName: 'Sarah Johnson',
      orderDate: orderDate,
      deliveryDate: 'N/A',
      status: 'in_transit',
      total: 67.50,
      items: [
        { name: 'Bevvi Water Bottle', quantity: 3, price: 22.50 }
      ],
      address: '456 Oak Ave, City, State 12345',
      phone: '+1-555-0456'
    },
    {
      id: 'ORD003',
      customerName: 'Mike Wilson',
      orderDate: orderDate,
      deliveryDate: '2025-08-17',
      status: 'pending',
      total: 89.99,
      items: [
        { name: 'Bevvi Premium Package', quantity: 1, price: 89.99 }
      ],
      address: '789 Pine Rd, City, State 12345',
      phone: '+1-555-0789'
    }
  ]
}

// Helper function to fetch state data from Tableau API
async function fetchStateData(startDate, endDate) {
  try {
    const tableauUrl = `https://api.getbevvi.com/api/bevviutils/exportTableauDataCsv?startDate=${startDate}&endDate=${endDate}`
    
    const response = await axios.get(tableauUrl, {
      timeout: 30000, // Reduced timeout to 30 seconds to avoid hanging
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Bevvi-Order-Tracking-System/2.0'
      }
    })
    
    if (response.status === 200 && response.data && Array.isArray(response.data)) {
      // Log ALL available fields and sample data for debugging
      if (response.data.length > 0) {
        const allFields = Object.keys(response.data[0])
        console.log('=' .repeat(70))
        console.log('📋 TABLEAU API - ALL AVAILABLE FIELDS')
        console.log('=' .repeat(70))
        console.log(`Total records: ${response.data.length}`)
        console.log(`Total fields: ${allFields.length}`)
        console.log('')
        console.log('Complete Field List:')
        allFields.forEach((field, index) => {
          console.log(`  ${String(index + 1).padStart(2)}. ${field}`)
        })
        console.log('')
        console.log('Sample Record (first record):')
        console.log(JSON.stringify(response.data[0], null, 2))
        console.log('=' .repeat(70))
      }
      
      // Build state lookup map: { orderNumber: shipToState }
      const stateLookup = {}
      response.data.forEach(item => {
        if (item.orderNumber && item.shipToState) {
          stateLookup[item.orderNumber] = item.shipToState
        }
      })
      
      console.log(`✅ State data: ${Object.keys(stateLookup).length} orders`)
      return stateLookup
    }
    
    console.log('⚠️ Tableau API unexpected format')
    return {}
  } catch (error) {
    console.error(`❌ Tableau API error: ${error.message}`)
    return {} // Return empty map on error, don't block the main request
  }
}

// Helper function to fetch brand/product data from Tableau API
async function fetchBrandData(startDate, endDate) {
  try {
    const tableauUrl = `https://api.getbevvi.com/api/bevviutils/exportTableauDataCsv?startDate=${startDate}&endDate=${endDate}`
    
    const response = await axios.get(tableauUrl, {
      timeout: 30000,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Bevvi-Order-Tracking-System/2.0'
      }
    })
    
    if (response.status === 200 && response.data && Array.isArray(response.data)) {
      console.log(`✅ Brand data: ${response.data.length} line items from Tableau API`)
      
      // Debug: Show sample items
      if (response.data.length > 0) {
        console.log('📦 Sample line items:')
        response.data.slice(0, 3).forEach((item, idx) => {
          console.log(`  ${idx + 1}. Brand: "${item.brandInfo || 'EMPTY'}", Parent: "${item.parentBrand || 'EMPTY'}", Product: "${item.productName}", Price: ${item.price}, Qty: ${item.quantity}`)
        })
      }
      
      // Aggregate revenue by brand
      const brandRevenue = {}
      let unknownCount = 0
      
      response.data.forEach(item => {
        const brand = item.brandInfo || item.parentBrand || 'Unknown'
        if (brand === 'Unknown') unknownCount++
        
        const revenue = parseFloat(item.alcPrice) || parseFloat(item.price) || 0
        const quantity = parseInt(item.quantity) || 1
        const totalRevenue = revenue * quantity
        
        if (!brandRevenue[brand]) {
          brandRevenue[brand] = { revenue: 0, itemCount: 0, orderNumbers: new Set() }
        }
        
        brandRevenue[brand].revenue += totalRevenue
        brandRevenue[brand].itemCount += quantity
        if (item.orderNumber) {
          brandRevenue[brand].orderNumbers.add(item.orderNumber)
        }
      })
      
      console.log(`📊 Brand extraction: ${unknownCount} items without brand info out of ${response.data.length} total`)
      
      // Convert Sets to counts
      const brandData = {}
      Object.entries(brandRevenue).forEach(([brand, data]) => {
        brandData[brand] = {
          revenue: data.revenue,
          itemCount: data.itemCount,
          orderCount: data.orderNumbers.size
        }
      })
      
      console.log(`✅ Aggregated ${Object.keys(brandData).length} unique brands`)
      console.log(`💰 Top 3 brands by revenue:`)
      Object.entries(brandData)
        .sort((a, b) => b[1].revenue - a[1].revenue)
        .slice(0, 3)
        .forEach(([brand, data], idx) => {
          console.log(`  ${idx + 1}. ${brand}: $${data.revenue.toFixed(2)}`)
        })
      
      return brandData
    }
    
    console.log('⚠️ Tableau API unexpected format')
    return {}
  } catch (error) {
    console.error(`❌ Tableau API error: ${error.message}`)
    return {}
  }
}

// Helper function to enrich orders with state data (called on-demand)
async function enrichOrdersWithState(orders, startDate, endDate) {
  console.log(`🗺️  Enriching ${orders.length} orders with state data...`)
  
  // Fetch state data from Tableau API
  const stateLookup = await fetchStateData(startDate, endDate)
  
  // Enrich orders with state information
  const enrichedOrders = orders.map(order => {
    const orderNum = order.ordernum || order.id
    
    // First try: Get state from Tableau API
    if (stateLookup[orderNum]) {
      order.shipToState = stateLookup[orderNum]
    }
    // Second try: Extract from establishment name (for Air Culinaire orders)
    else if (!order.shipToState && order.establishment) {
      const extractedState = extractStateFromText(order.establishment)
      if (extractedState) {
        order.shipToState = extractedState
      }
    }
    
    return order
  })
  
  const enrichedCount = enrichedOrders.filter(o => o.shipToState).length
  console.log(`✅ State enrichment complete: ${enrichedCount}/${enrichedOrders.length} orders`)
  
  return enrichedOrders
}

// Helper: calendar date in client/business timezone (YYYY-MM-DD)
function getOrderLocalDate(order, timeZone = DEFAULT_ORDER_TIMEZONE) {
  if (order.orderDateTime) {
    const utcMidnight = parseUtcMidnightCalendarDate(order.orderDateTime)
    if (utcMidnight) return utcMidnight
    const z = getYyyyMmDdInTimeZone(order.orderDateTime, timeZone)
    if (z) return z
    try {
      const date = new Date(order.orderDateTime)
      if (!isNaN(date.getTime())) {
        return date.getFullYear() + '-' +
          String(date.getMonth() + 1).padStart(2, '0') + '-' +
          String(date.getDate()).padStart(2, '0')
      }
    } catch (e) {
      /* fall through */
    }
  }
  return order.orderDate
}

function getDeliveryLocalDate(order, timeZone = DEFAULT_ORDER_TIMEZONE) {
  if (!order.deliveryDate || order.deliveryDate === 'N/A') {
    return null
  }

  if (order.deliveryDateTime) {
    const utcMidnight = parseUtcMidnightCalendarDate(order.deliveryDateTime)
    if (utcMidnight) return utcMidnight
    const z = getYyyyMmDdInTimeZone(order.deliveryDateTime, timeZone)
    if (z) return z
    try {
      const date = new Date(order.deliveryDateTime)
      if (!isNaN(date.getTime())) {
        return date.getFullYear() + '-' +
          String(date.getMonth() + 1).padStart(2, '0') + '-' +
          String(date.getDate()).padStart(2, '0')
      }
    } catch (e) {
      /* fall through */
    }
  }
  return order.deliveryDate
}

/** Calendar YYYY-MM-DD from a datetime string/value without shifting UTC-midnight dates. */
function calendarDateFromDateTimeString(datetimeValue, parsedDate, displayTimeZone) {
  const utcMidnight = parseUtcMidnightCalendarDate(datetimeValue)
  if (utcMidnight) return utcMidnight

  const zoned = getYyyyMmDdInTimeZone(parsedDate, displayTimeZone)
  if (zoned) return zoned

  return (
    `${parsedDate.getFullYear()}-` +
    `${String(parsedDate.getMonth() + 1).padStart(2, '0')}-` +
    `${String(parsedDate.getDate()).padStart(2, '0')}`
  )
}

// Helper function to fetch orders for a specific date range
async function fetchOrdersForDateRange(startDate, endDate, timeZone = DEFAULT_ORDER_TIMEZONE) {
  const { utcStartString, utcEndString } = bevviCsvUtcDateRange(startDate, endDate, timeZone)
  const apiUrl = `https://api.getbevvi.com/api/bevviutils/getAllStoreTransactionsReportCsv?startDate=${utcStartString}&endDate=${utcEndString}`
  
  let response
  let retryCount = 0
  const maxRetries = 2
  
  while (retryCount < maxRetries) {
    try {
      response = await axios.get(apiUrl, {
        timeout: 180000, // Increased to 3 minutes for large datasets
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Bevvi-Order-Tracking-System/1.0'
        }
      })
      break
    } catch (retryError) {
      retryCount++
      if (retryCount >= maxRetries) {
        throw retryError
      }
      await new Promise(resolve => setTimeout(resolve, 2000))
    }
  }
  
  if (response.status === 200 && response.data && response.data.results) {
    const csvData = response.data.results
    
    const allOrders = parseCSVToOrders(csvData, startDate, timeZone)
    
    // Filter orders by date range - convert to local time before comparing
    const filteredOrders = allOrders.filter(order => {
      const orderLocalDate = getOrderLocalDate(order, timeZone)
      if (orderLocalDate) {
        return orderLocalDate >= startDate && orderLocalDate <= endDate
      }

      const deliveryLocalDate = getDeliveryLocalDate(order, timeZone)
      return deliveryLocalDate && deliveryLocalDate >= startDate && deliveryLocalDate <= endDate
    })
    
    return filteredOrders
  }
  
  return []
}


// API Routes
app.get('/api/orders', async (req, res) => {
  try {
    const { startDate, endDate, timeZone: timeZoneQuery } = req.query
    const orderTimeZone = resolveOrderTimeZone(timeZoneQuery)
    console.log('📥 /api/orders REQUEST received:', { startDate, endDate, orderTimeZone })
    
    if (!startDate || !endDate) {
      console.log('❌ Missing dates in request')
      return res.status(400).json({ 
        error: 'Start date and end date are required' 
      })
    }

    const dateRangeError = validateOrderDateRange(startDate, endDate)
    if (dateRangeError) {
      console.log('❌ Invalid date range:', dateRangeError)
      return res.status(400).json({
        success: false,
        error: 'Invalid date range',
        message: dateRangeError,
        dateRange: { startDate, endDate },
        maxDays: MAX_ORDER_DATE_RANGE_DAYS,
        data: [],
        totalOrders: 0
      })
    }
    
    // Validate that dates are not too far in the future (allow up to 7 days ahead for delivery scheduling)
    // IMPORTANT: Allow ALL past dates - only restrict future dates
    const today = new Date()
    today.setHours(23, 59, 59, 999) // End of today
    
    const maxFutureDate = new Date()
    maxFutureDate.setDate(maxFutureDate.getDate() + 7) // Allow up to 7 days in the future
    
    const start = new Date(startDate + 'T00:00:00') // Parse as local midnight to avoid timezone issues
    const end = new Date(endDate + 'T23:59:59') // Parse as end of day
    
    // Only block if dates are in the FUTURE and more than 7 days ahead
    // Past dates should always be allowed
    if ((start > today && start > maxFutureDate) || (end > today && end > maxFutureDate)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid date range',
        message: 'Cannot fetch orders for dates more than 7 days in the future. Please select dates within the next week.',
        dateRange: { startDate, endDate },
        today: (() => {
          const today = new Date()
          return today.getFullYear() + '-' + 
                 String(today.getMonth() + 1).padStart(2, '0') + '-' + 
                 String(today.getDate()).padStart(2, '0')
        })(),
        maxFuture: (() => {
          const maxFuture = new Date()
          maxFuture.setDate(maxFuture.getDate() + 7)
          return maxFuture.getFullYear() + '-' + 
                 String(maxFuture.getMonth() + 1).padStart(2, '0') + '-' + 
                 String(maxFuture.getDate()).padStart(2, '0')
        })(),
        data: [],
        totalOrders: 0
      })
    }

    // Update auto-refresh range when new dates are requested (preserve client TZ for UTC API conversion)
    updateAutoRefreshRange(startDate, endDate, orderTimeZone)
    
    // Automatically start auto-refresh if not already running
    if (!autoRefreshTimer) {
      startAutoRefresh()
      console.log('🔄 Auto-refresh automatically started for date range:', startDate, 'to', endDate)
    }
    
    console.log('🌐 Fetching orders from Bevvi API...')
    
    // Calculate date range in days
    const diffTime = Math.abs(new Date(endDate) - new Date(startDate))
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
    
    console.log(`📅 Date range: ${startDate} to ${endDate} (${diffDays} days)`)
    
    // For large date ranges (>90 days), use chunking
    if (diffDays > 90) {
      console.log('🔄 Large date range detected, using chunked requests...')
      const chunks = splitDateRange(startDate, endDate, 30) // Split into 30-day chunks
      console.log(`📦 Split into ${chunks.length} chunks`)
      
      let allOrders = []
      let successfulChunks = 0
      
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]
        console.log(`🔄 Processing chunk ${i + 1}/${chunks.length}: ${chunk.startDate} to ${chunk.endDate}`)
        
        try {
          const chunkOrders = await fetchOrdersForDateRange(chunk.startDate, chunk.endDate, orderTimeZone)
          allOrders = allOrders.concat(chunkOrders)
          successfulChunks++
          console.log(`✅ Chunk ${i + 1} complete: ${chunkOrders.length} orders`)
        } catch (error) {
          console.log(`❌ Chunk ${i + 1} failed: ${error.message}`)
          // Continue with other chunks even if one fails
        }
      }
      
      console.log(`✅ All chunks processed: ${allOrders.length} total orders from ${successfulChunks}/${chunks.length} successful chunks`)
      
      // Warn if some chunks failed
      const incompleteData = successfulChunks < chunks.length
      if (incompleteData) {
        console.warn(`⚠️ WARNING: Only ${successfulChunks}/${chunks.length} chunks succeeded - data may be incomplete!`)
      }
      
      await refreshOrdersForAlerts(allOrders, { startDate, endDate, timeZone: orderTimeZone })
      
      return res.json({
        success: true,
        data: allOrders,
        dateRange: { startDate, endDate },
        totalOrders: allOrders.length,
        message: incompleteData 
          ? `⚠️ Partial data: ${allOrders.length} orders from ${successfulChunks}/${chunks.length} successful chunks. Some data may be missing.`
          : `Orders fetched for ${startDate} to ${endDate} (${chunks.length} chunks)`,
        source: 'Bevvi API (Chunked)',
        chunked: true,
        chunks: chunks.length,
        successfulChunks: successfulChunks,
        incompleteData: incompleteData
      })
    }
    
    // For smaller date ranges, interpret calendar days in orderTimeZone then convert to UTC for Bevvi CSV API
    const { utcStartString, utcEndString } = bevviCsvUtcDateRange(startDate, endDate, orderTimeZone)
    const apiUrl = `https://api.getbevvi.com/api/bevviutils/getAllStoreTransactionsReportCsv?startDate=${utcStartString}&endDate=${utcEndString}`
    
    console.log('🕐 Converting local calendar range to UTC for API (IANA TZ:', orderTimeZone + '):')
    console.log('  Local requested range:', startDate, 'to', endDate)
    console.log('  UTC API range:', utcStartString, 'to', utcEndString)
    console.log('Calling Bevvi API:', apiUrl)
    
    try {
      // Make actual API call to Bevvi with retry logic
      let response
      let retryCount = 0
      const maxRetries = 3
      
      while (retryCount < maxRetries) {
        try {
          response = await axios.get(apiUrl, {
            timeout: 180000, // Increased to 180s (3 minutes) for large date ranges
            headers: {
              'Accept': 'application/json',
              'User-Agent': 'Bevvi-Order-Tracking-System/1.0'
            }
          })
          break // Success, exit retry loop
        } catch (retryError) {
          retryCount++
          console.log(`Attempt ${retryCount} failed: ${retryError.message}`)
          
          if (retryCount >= maxRetries) {
            throw retryError // Re-throw if all retries exhausted
          }
          
          // Wait before retrying (exponential backoff)
          const waitTime = Math.min(1000 * Math.pow(2, retryCount - 1), 5000)
          console.log(`Waiting ${waitTime}ms before retry...`)
          await new Promise(resolve => setTimeout(resolve, waitTime))
        }
      }
      
      console.log('Bevvi API Response Status:', response.status)
      console.log('Bevvi API Response Headers:', response.headers)
      
      if (response.status === 200 && response.data) {
        // The API returns JSON with a 'results' field containing CSV data
        const jsonResponse = response.data
        console.log('JSON Response received:', typeof jsonResponse)
        
        if (jsonResponse.results) {
          const csvData = jsonResponse.results
          console.log('CSV Data extracted from results field, length:', csvData.length)
          console.log('CSV Data preview (first 200 chars):', csvData.substring(0, 200))
          
          // Parse the CSV data from the results field
          const allOrders = parseCSVToOrders(csvData, startDate, orderTimeZone)
          
          // Filter orders to show only those delivered within the requested local date range
          // Convert order dates to local time before comparing
          const filteredOrders = allOrders.filter(order => {
            const orderLocalDate = getOrderLocalDate(order, orderTimeZone)
            if (orderLocalDate) {
              return orderLocalDate >= startDate && orderLocalDate <= endDate
            }

            const deliveryLocalDate = getDeliveryLocalDate(order, orderTimeZone)
            return deliveryLocalDate && deliveryLocalDate >= startDate && deliveryLocalDate <= endDate
          })
          
          console.log(`📊 Filtered orders: ${filteredOrders.length} out of ${allOrders.length} total orders`)
          console.log(`📅 Requested range: ${startDate} to ${endDate}`)
          
          if (filteredOrders.length === 0 && allOrders.length > 0) {
            console.log('⚠️  WARNING: CSV returned orders but none match date range!')
            console.log('First order date:', allOrders[0]?.orderDate)
            console.log('Last order date:', allOrders[allOrders.length - 1]?.orderDate)
          }
          
          if (allOrders.length === 0) {
            console.log('⚠️  WARNING: CSV parsing returned 0 orders - API may have no data for this range')
          }
          
          console.log(`📋 Orders with order dates in range: ${filteredOrders.filter(o => o.orderDate && o.orderDate >= startDate && o.orderDate <= endDate).length}`)
          
          // Check if we got real orders from API
          if (filteredOrders.length > 0 && filteredOrders[0].id && !filteredOrders[0].id.startsWith('ORD')) {
            await refreshOrdersForAlerts(filteredOrders, { startDate, endDate, timeZone: orderTimeZone })
            return res.json({
              success: true,
              data: filteredOrders,
              dateRange: { startDate, endDate },
              totalOrders: filteredOrders.length,
              message: `Orders fetched for ${startDate} to ${endDate}`,
              source: 'Bevvi API',
              cached: false
            })
          } else {
            await refreshOrdersForAlerts([], { startDate, endDate, timeZone: orderTimeZone })
            return res.json({
              success: true,
              data: [],
              dateRange: { startDate, endDate },
              totalOrders: 0,
              message: `No orders found for ${startDate} to ${endDate}`,
              source: 'Bevvi API',
              note: 'The selected date range has no orders.',
              cached: false
            })
          }
        } else {
          throw new Error('No results field found in API response')
        }
      } else {
        throw new Error(`Bevvi API returned status ${response.status}`)
      }
    } catch (apiError) {
      console.error('Bevvi API Error:', apiError.message)
      
      // Return the actual error instead of mock data
      const errorStatus = apiError.response?.status || 'Unknown'
      const errorMessage = apiError.message || 'Unknown error occurred'
      
      console.log(`Bevvi API failed with status ${errorStatus}: ${errorMessage}`)
      
      res.json({
        success: false,
        error: 'Bevvi API call failed',
        message: `Failed to fetch orders from Bevvi API`,
        apiStatus: errorStatus,
        apiError: errorMessage,
        apiUrl: apiUrl, // Include the exact API URL that was called
        dateRange: { startDate, endDate },
        data: [],
        totalOrders: 0,
        note: `API Status: ${errorStatus} - ${errorMessage}. Please try again later or contact support if the issue persists.`
      })
    }
  } catch (error) {
    console.error('Error fetching orders:', error)
    res.status(500).json({ 
      error: 'Failed to fetch orders',
      message: error.message 
    })
  }
})

// Helper function to split large date ranges into smaller chunks
function splitDateRange(startDate, endDate, maxDays = 3) {
  const start = new Date(startDate)
  const end = new Date(endDate)
  const diffTime = Math.abs(end - start)
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
  
  if (diffDays <= maxDays) {
    return [{ startDate, endDate }]
  }
  
  const chunks = []
  let currentDate = new Date(start)
  
  while (currentDate <= end) {
    const chunkEnd = new Date(currentDate)
    chunkEnd.setDate(chunkEnd.getDate() + maxDays - 1)
    
    if (chunkEnd > end) {
      chunkEnd.setTime(end.getTime())
    }
    
    chunks.push({
      startDate: (() => {
        const date = new Date(currentDate)
        return date.getFullYear() + '-' + 
               String(date.getMonth() + 1).padStart(2, '0') + '-' + 
               String(date.getDate()).padStart(2, '0')
      })(),
      endDate: (() => {
        const date = new Date(chunkEnd)
        return date.getFullYear() + '-' + 
               String(date.getMonth() + 1).padStart(2, '0') + '-' + 
               String(date.getDate()).padStart(2, '0')
      })()
    })
    
    currentDate.setDate(currentDate.getDate() + maxDays)
  }
  
  return chunks
}

// New endpoint: Get orders WITH state enrichment (for state-based queries only)
app.get('/api/orders-with-state', async (req, res) => {
  try {
    const { startDate, endDate, timeZone } = req.query
    
    console.log('🗺️  /api/orders-with-state REQUEST:', { startDate, endDate, timeZone })
    
    const tzParam = timeZone ? `&timeZone=${encodeURIComponent(timeZone)}` : ''
    // First, get regular orders (fast, from cache if available)
    const ordersResponse = await axios.get(`http://localhost:${PORT}/api/orders?startDate=${startDate}&endDate=${endDate}${tzParam}`)
    
    if (ordersResponse.data && ordersResponse.data.data) {
      const orders = ordersResponse.data.data
      
      // Enrich with state data from Tableau API
      const enrichedOrders = await enrichOrdersWithState(orders, startDate, endDate)
      
      return res.json({
        success: true,
        data: enrichedOrders,
        dateRange: { startDate, endDate },
        totalOrders: enrichedOrders.length,
        stateEnriched: enrichedOrders.filter(o => o.shipToState).length,
        message: `Orders fetched and enriched with state data for ${startDate} to ${endDate}`,
        source: 'Bevvi API + Tableau API'
      })
    } else {
      return res.json({
        success: true,
        data: [],
        totalOrders: 0,
        message: 'No orders found'
      })
    }
  } catch (error) {
    console.error('Error in /api/orders-with-state:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to fetch orders with state data',
      message: error.message
    })
  }
})

// New endpoint: Get customers who bought a specific brand
app.get('/api/brands/customers', async (req, res) => {
  try {
    const { startDate, endDate, brand } = req.query
    
    if (!brand) {
      return res.status(400).json({
        success: false,
        error: 'Brand name is required',
        message: 'Please specify a brand name'
      })
    }
    
    console.log('🏷️  /api/brands/customers REQUEST:', { startDate, endDate, brand })
    
    // Fetch all Tableau data
    const tableauUrl = `https://api.getbevvi.com/api/bevviutils/exportTableauDataCsv?startDate=${startDate}&endDate=${endDate}`
    
    const response = await axios.get(tableauUrl, {
      timeout: 30000,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Bevvi-Order-Tracking-System/2.0'
      }
    })
    
    if (response.status === 200 && response.data && Array.isArray(response.data)) {
      // Filter items by brand (case-insensitive partial match)
      const brandLower = brand.toLowerCase()
      const matchingItems = response.data.filter(item => {
        const itemBrand = (item.brandInfo || item.parentBrand || '').toLowerCase()
        return itemBrand.includes(brandLower)
      })
      
      console.log(`✅ Found ${matchingItems.length} line items for brand "${brand}"`)
      
      // Group by customer (companyName)
      const customerData = {}
      matchingItems.forEach(item => {
        const customer = item.companyName || item.customerName || 'Unknown Customer'
        const revenue = (parseFloat(item.alcPrice) || parseFloat(item.price) || 0) * (parseInt(item.quantity) || 1)
        
        if (!customerData[customer]) {
          customerData[customer] = {
            revenue: 0,
            bottles: 0,
            orders: new Set()
          }
        }
        
        customerData[customer].revenue += revenue
        customerData[customer].bottles += parseInt(item.quantity) || 1
        if (item.orderNumber) {
          customerData[customer].orders.add(item.orderNumber)
        }
      })
      
      // Convert to array and sort by revenue
      const customers = Object.entries(customerData).map(([name, data]) => ({
        customerName: name,
        revenue: data.revenue,
        bottles: data.bottles,
        orderCount: data.orders.size
      })).sort((a, b) => b.revenue - a.revenue)
      
      const totalRevenue = customers.reduce((sum, c) => sum + c.revenue, 0)
      const totalBottles = customers.reduce((sum, c) => sum + c.bottles, 0)
      
      return res.json({
        success: true,
        brand,
        customers,
        totalCustomers: customers.length,
        totalRevenue,
        totalBottles,
        dateRange: { startDate, endDate },
        message: `Customers who bought ${brand}`,
        source: 'Tableau API'
      })
    }
    
    return res.json({
      success: false,
      error: 'No data available',
      message: 'Tableau API returned unexpected format'
    })
  } catch (error) {
    console.error('Error in /api/brands/customers:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to fetch customer data for brand',
      message: error.message
    })
  }
})

// New endpoint: Get brand revenue breakdown (for brand-based queries only)
app.get('/api/brands/revenue', async (req, res) => {
  try {
    const { startDate, endDate, limit } = req.query
    const requestedLimit = parseInt(limit) || 10 // Default to 10 if not specified
    
    console.log('🏷️  /api/brands/revenue REQUEST:', { startDate, endDate, limit: requestedLimit })
    
    // Fetch brand data from Tableau API
    const brandData = await fetchBrandData(startDate, endDate)
    
    // Filter out "Unknown" and sort by revenue descending
    const sortedBrands = Object.entries(brandData)
      .filter(([brand]) => brand !== 'Unknown')  // Exclude Unknown
      .sort((a, b) => b[1].revenue - a[1].revenue)
      .slice(0, requestedLimit) // Use dynamic limit
      .map(([brand, data]) => ({
        brand,
        revenue: data.revenue,
        orderCount: data.orderCount,
        itemCount: data.itemCount
      }))
    
    const totalRevenue = Object.values(brandData).reduce((sum, data) => sum + data.revenue, 0)
    const totalOrders = new Set(Object.values(brandData).flatMap(data => Array(data.orderCount).fill(null))).size
    
    // Calculate known vs unknown brands
    const knownBrandsRevenue = Object.entries(brandData)
      .filter(([brand]) => brand !== 'Unknown')
      .reduce((sum, [, data]) => sum + data.revenue, 0)
    const unknownRevenue = brandData['Unknown']?.revenue || 0
    
    console.log(`💡 Revenue breakdown: Known brands: $${knownBrandsRevenue.toFixed(2)}, Unknown: $${unknownRevenue.toFixed(2)}`)
    
    return res.json({
      success: true,
      brands: sortedBrands,
      totalBrands: Object.keys(brandData).length - 1, // Exclude "Unknown" from count
      knownBrandsCount: Object.keys(brandData).filter(b => b !== 'Unknown').length,
      totalRevenue: knownBrandsRevenue, // Only show revenue from known brands
      unknownRevenue,
      dateRange: { startDate, endDate },
      message: `Brand revenue data for ${startDate} to ${endDate}`,
      source: 'Tableau API'
    })
  } catch (error) {
    console.error('Error in /api/brands/revenue:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to fetch brand revenue data',
      message: error.message
    })
  }
})

// Auto-refresh configuration
const AUTO_REFRESH_INTERVAL = 20 * 60 * 1000 // 20 minutes in milliseconds
const SLACK_CHECK_INTERVAL = 5 * 60 * 1000 // 5 minutes for Slack status checks
let autoRefreshTimer = null
let lastAutoRefreshDate = null
let lastAutoRefreshRange = null
let slackCheckTimer = null

// Store connected clients for real-time updates
let connectedClients = []

// Orders cache removed - always fetch fresh from API

// Products cache - loaded on server startup
let productsCache = []
let productsCacheTimestamp = null
const PRODUCTS_CACHE_DURATION = 60 * 60 * 1000 // 1 hour cache for products
let supplementalProductsLoadAttempted = false

/** If cache is empty after startup, try loading once more (e.g. transient network failure). */
async function ensureProductsCacheLoaded() {
  if (productsCache.length > 0) return
  if (supplementalProductsLoadAttempted) return
  supplementalProductsLoadAttempted = true
  console.log('📦 Product cache empty — running one supplemental load...')
  await loadAllProducts()
}

function normalizeStoresFromApi(data) {
  if (!data) return []
  if (Array.isArray(data)) return data
  if (Array.isArray(data.results)) return data.results
  if (Array.isArray(data.stores)) return data.stores
  if (typeof data === 'string') {
    try {
      return normalizeStoresFromApi(JSON.parse(data))
    } catch {
      return []
    }
  }
  return []
}

// Function to start auto-refresh
function startAutoRefresh() {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer)
  }
  
  autoRefreshTimer = setInterval(async () => {
    if (lastAutoRefreshRange) {
      const tz = lastAutoRefreshRange.timeZone || DEFAULT_ORDER_TIMEZONE
      console.log(`🔄 Auto-refreshing orders for ${lastAutoRefreshRange.startDate} to ${lastAutoRefreshRange.endDate} (${tz})`)
      try {
        const { utcStartString, utcEndString } = bevviCsvUtcDateRange(
          lastAutoRefreshRange.startDate,
          lastAutoRefreshRange.endDate,
          tz
        )
        const apiUrl = `https://api.getbevvi.com/api/bevviutils/getAllStoreTransactionsReportCsv?startDate=${utcStartString}&endDate=${utcEndString}`
        
        let response
        let retryCount = 0
        const maxRetries = 2 // Fewer retries for auto-refresh
        
        while (retryCount < maxRetries) {
          try {
            response = await axios.get(apiUrl, {
              timeout: 30000, // Shorter timeout for auto-refresh
              headers: {
                'Accept': 'application/json',
                'User-Agent': 'Bevvi-Order-Tracking-System/1.0'
              }
            })
            break
          } catch (retryError) {
            retryCount++
            if (retryCount >= maxRetries) {
              console.log(`❌ Auto-refresh failed after ${maxRetries} attempts: ${retryError.message}`)
              return
            }
            await new Promise(resolve => setTimeout(resolve, 2000))
          }
        }
        
        if (response && response.status === 200 && response.data && response.data.results) {
          const csvData = response.data.results
          const orders = parseCSVToOrders(csvData, lastAutoRefreshRange.startDate, tz)
          
          console.log(`✅ Auto-refresh successful: ${orders.length} orders updated`)
          lastAutoRefreshDate = new Date()
          
          await refreshOrdersForAlerts(orders, lastAutoRefreshRange)
          
          // Notify all connected clients about the data refresh
          notifyClientsOfRefresh(orders.length, lastAutoRefreshDate)
        }
      } catch (error) {
        console.log(`❌ Auto-refresh error: ${error.message}`)
      }
    }
  }, AUTO_REFRESH_INTERVAL)
  
  console.log(`🔄 Auto-refresh started - will refresh every ${AUTO_REFRESH_INTERVAL / 60000} minutes`)
}

// Function to stop auto-refresh
function stopAutoRefresh() {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer)
    autoRefreshTimer = null
    console.log('🛑 Auto-refresh stopped')
  }
}

// Function to start Slack check timer (independent of auto-refresh)
function startSlackChecks() {
  if (!SLACK_WEBHOOK_URL) {
    console.log('ℹ️  Slack webhook not configured; Slack checks disabled')
    return
  }
  if (slackCheckTimer) {
    clearInterval(slackCheckTimer)
  }

  slackCheckTimer = setInterval(async () => {
    try {
      const lastOrders = global.lastRefreshedOrders?.orders || []
      if (lastOrders.length > 0) {
        await evaluateSlackNotifications(lastOrders)
      }
    } catch (error) {
      console.error('❌ Slack check error:', error.message)
    }
  }, SLACK_CHECK_INTERVAL)

  console.log(`🔔 Slack checks started - every ${SLACK_CHECK_INTERVAL / 60000} minutes`)
}

// Function to update auto-refresh with new date range
function updateAutoRefreshRange(startDate, endDate, timeZone = DEFAULT_ORDER_TIMEZONE) {
  lastAutoRefreshRange = { startDate, endDate, timeZone }
  console.log(`📅 Auto-refresh range updated to ${startDate} to ${endDate} (${timeZone})`)
}

// Function to notify all connected clients about data refresh
function notifyClientsOfRefresh(ordersCount, refreshTime) {
  const message = JSON.stringify({
    type: 'data_refresh',
    ordersCount: ordersCount,
    refreshTime: refreshTime.toISOString(),
    refreshTimeFormatted: refreshTime.toLocaleString(),
    message: `Data refreshed: ${ordersCount} orders updated at ${refreshTime.toLocaleString()}`
  })
  
  // Send message to all connected clients
  connectedClients.forEach(client => {
    if (client.res && !client.res.destroyed) {
      client.res.write(`data: ${message}\n\n`)
    }
  })
  
  console.log(`📡 Notified ${connectedClients.length} connected clients about data refresh`)
}

function getOrderNotificationKey(order) {
  const key = order?.ordernum || order?.id
  return key ? String(key) : null
}

function serializeOrderForNotification(order) {
  return {
    id: order.id,
    ordernum: order.ordernum,
    customerName: order.customerName || 'Unknown customer',
    establishment: order.establishment || '',
    status: order.status || 'Unknown',
    total: parseFloat(order.total) || 0,
    orderDate: order.orderDate || order.orderDateTime || null
  }
}

function detectNewOrders(orders, { reseed = false } = {}) {
  if (reseed) {
    seedOrderNotificationBaseline(orders)
    return []
  }

  const list = Array.isArray(orders) ? orders : []
  const newOrders = []
  const currentKeys = new Set()

  for (const order of list) {
    const key = getOrderNotificationKey(order)
    if (!key) continue
    currentKeys.add(key)
    if (ordersNotificationBaselineSeeded && !knownOrderIds.has(key)) {
      newOrders.push(serializeOrderForNotification(order))
    }
  }

  for (const key of currentKeys) {
    knownOrderIds.add(key)
  }

  if (!ordersNotificationBaselineSeeded) {
    seedOrderNotificationBaseline(orders)
    return []
  }

  return newOrders
}

function notifyClientsOfNewOrders(newOrders) {
  if (!Array.isArray(newOrders) || newOrders.length === 0) {
    return
  }

  const payload = JSON.stringify({
    type: 'new_orders',
    orders: newOrders,
    count: newOrders.length,
    timestamp: new Date().toISOString()
  })

  connectedClients.forEach((client) => {
    if (client.res && !client.res.destroyed) {
      client.res.write(`data: ${payload}\n\n`)
    }
  })

  console.log(`🔔 Notified ${connectedClients.length} client(s) about ${newOrders.length} new order(s)`)
}

// Function to add a new client connection
function addClient(client) {
  connectedClients.push(client)
  console.log(`📱 New client connected. Total clients: ${connectedClients.length}`)
}

// Function to remove a disconnected client
function removeClient(client) {
  const index = connectedClients.findIndex(c => c.id === client.id)
  if (index > -1) {
    connectedClients.splice(index, 1)
    console.log(`📱 Client disconnected. Total clients: ${connectedClients.length}`)
  }
}

// Function to load all Bevvi products
async function loadAllProducts() {
  try {
    console.log('📦 Loading all Bevvi products from API...')
    const response = await axios.get('https://api.getbevvi.com/api/corputil/getBevviProductsAsJSON', {
      timeout: 120000, // 2 minutes for large dataset
      headers: {
        'Accept': 'application/json'
      }
    })
    
    if (response.status === 200 && response.data && response.data.results) {
      productsCache = response.data.results
      productsCacheTimestamp = Date.now()
      console.log(`✅ Loaded ${productsCache.length} products into cache`)
      return productsCache.length
    } else {
      console.error('❌ Failed to load products: Invalid response format')
      return 0
    }
  } catch (error) {
    console.error('❌ Error loading products:', error.message)
    return 0
  }
}

// Function to search cached products
function productSearchHaystack(product) {
  const sizePart = formatCatalogProductSizeLabel(product) || (
    product.size == null || product.size === ''
      ? String(product.units || '')
      : `${product.size} ${product.units || ''}`.trim()
  )
  return [
    product.name,
    product.upc,
    product.brandinfo,
    product.parentBrand,
    sizePart
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/(\d+)\s*x\s*(\d+)/g, '$1x$2')
}

function searchProducts(searchTerm) {
  if (!searchTerm || searchTerm.length < 3) {
    return []
  }

  const searchLower = searchTerm.toLowerCase().trim().replace(/(\d+)\s*x\s*(\d+)/g, '$1x$2')
  const tokens = searchLower.split(/\s+/).filter(Boolean)

  const results = productsCache.filter(product => {
    const haystack = productSearchHaystack(product)
    const upc = (product.upc || '').toLowerCase()

    if (haystack.includes(searchLower) || upc.includes(searchLower)) {
      return true
    }

    if (tokens.length > 1) {
      return tokens.every(token => haystack.includes(token) || upc.includes(token))
    }

    return haystack.includes(searchLower) || upc.includes(searchLower)
  })

  const scored = results.map(product => {
    const haystack = productSearchHaystack(product)
    let score = 0
    if (haystack.includes(searchLower)) score += 100
    for (const token of tokens) {
      if (haystack.includes(token)) score += 20
      const sizeLabel = productSizeLabel(product)
      if (sizeLabel.includes(token)) score += 25
      if (/^\d+(?:\.\d+)?$/.test(token) && String(product.size ?? '') === token) score += 30
      if (/^\d+x\d+$/i.test(token) && sizeLabel.replace(/\s+/g, '').includes(token.toLowerCase())) score += 40
    }
    return { product, score }
  })

  scored.sort((a, b) => b.score - a.score)

  // Deduplicate by UPC
  const seen = new Set()
  const deduped = scored.filter(({ product }) => {
    if (!isValidCatalogProductSize(product)) return false
    const upc = product.upc
    if (!upc || seen.has(upc)) return false
    seen.add(upc)
    return true
  })

  // Limit to 100 results for performance
  return deduped.slice(0, 100).map(entry => entry.product)
}

function normalizeSizeToken(str) {
  return String(str || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

const VALID_CATALOG_SIZE_UNITS = /^(ml|l|oz|cl|g|lb|pk|pack|lt|liter|litre)$/i
const PACK_SIZE_IN_NAME_PATTERN = /(\d+)\s*x\s*(\d+(?:\.\d+)?)\s*(oz|ml|l|cl|g|lb)\b/i
const PACK_UNITS_PATTERN = /^x(\d+(?:\.\d+)?)\s*(oz|ml|l|cl|g|lb)\b/i

function parsePackSizeFromProductName(name) {
  const match = String(name || '').match(PACK_SIZE_IN_NAME_PATTERN)
  if (!match) return null
  return `${match[1]}x${match[2]} ${match[3].toUpperCase()}`
}

function isPackStyleCatalogProduct(product) {
  const units = String(product?.units || '').trim()
  const sizeNum = parseFloat(product?.size)
  if (!Number.isNaN(sizeNum) && sizeNum > 0 && PACK_UNITS_PATTERN.test(units)) {
    return true
  }
  return Boolean(parsePackSizeFromProductName(product?.name))
}

function isValidCatalogProductSize(product) {
  if (isPackStyleCatalogProduct(product)) return true
  const units = String(product?.units || '').trim()
  if (!VALID_CATALOG_SIZE_UNITS.test(units)) return false
  const sizeNum = parseFloat(product?.size)
  return !Number.isNaN(sizeNum) && sizeNum > 0
}

function formatCatalogProductSizeLabel(product) {
  const packFromName = parsePackSizeFromProductName(product?.name)
  if (packFromName) return packFromName

  if (isPackStyleCatalogProduct(product)) {
    const units = String(product?.units || '').trim()
    const sizeNum = parseFloat(product?.size)
    const packMatch = units.match(PACK_UNITS_PATTERN)
    if (packMatch && !Number.isNaN(sizeNum) && sizeNum > 0) {
      return `${sizeNum}x${packMatch[1]} ${packMatch[2].toUpperCase()}`
    }
  }

  if (!isValidCatalogProductSize(product)) {
    return parseSizeFromCombinedName(product?.name || '') || ''
  }
  return `${product.size} ${product.units || ''}`.trim()
}

function isValidManualOrderSizeInput(sizeInput) {
  const normalized = normalizeSizeToken(sizeInput)
  if (!normalized) return false
  return /^\d+(?:\.\d+)?\s*(?:ml|l|oz|cl|g|lb|pk|pack|lt|liter|litre)$/.test(normalized)
}

function stripSizeSuffixFromName(name) {
  return normalizeSizeToken(name).replace(/\s*-\s*\d+(?:\.\d+)?(?:\s*(?:ml|l|oz|cl|g|lb|pk|pack|lt|liter|litre))?\s*$/i, '').trim()
}

function parseSizeFromCombinedName(name) {
  const match = String(name || '').match(/\s*-\s*(\d+(?:\.\d+)?)\s*(ML|L|OZ|CL|G|LB|PK|PACK|LT|LITER|LITRE)?\s*$/i)
  if (!match) return null
  const sizeNum = match[1]
  const units = (match[2] || 'ML').toUpperCase()
  return `${sizeNum} ${units}`
}

function productSizeLabel(product) {
  const size = product.size
  const units = product.units || ''
  if (size === null || size === undefined || size === '') return normalizeSizeToken(units)
  return normalizeSizeToken(`${size} ${units}`.trim())
}

function sizeTokensMatch(product, sizeInput) {
  const inputNorm = normalizeSizeToken(sizeInput)
  if (!inputNorm) return true

  const productSize = productSizeLabel(product)
  if (!productSize) return false
  if (productSize === inputNorm || productSize.includes(inputNorm) || inputNorm.includes(productSize)) {
    return true
  }

  const inputNum = inputNorm.match(/^(\d+(?:\.\d+)?)/)?.[1]
  const productNum = String(product.size ?? '').trim()
  if (inputNum && productNum && inputNum === productNum) {
    const inputUnit = inputNorm.slice(inputNum.length).trim()
    const productUnit = normalizeSizeToken(product.units || '')
    if (!inputUnit) return true
    if (!productUnit) return true
    return productUnit.startsWith(inputUnit) || inputUnit.startsWith(productUnit)
  }

  return false
}

function nameTokensMatch(product, nameInput) {
  const inputNorm = normalizeSizeToken(nameInput)
  if (!inputNorm) return false

  const fullName = normalizeSizeToken(product.name)
  const productBase = stripSizeSuffixFromName(product.name)
  const inputBase = stripSizeSuffixFromName(nameInput)

  if (fullName === inputNorm) return true
  if (productBase && inputBase && productBase === inputBase) return true
  if (fullName.includes(inputNorm) || inputNorm.includes(fullName)) return true
  if (productBase && inputBase && (productBase.includes(inputBase) || inputBase.includes(productBase))) {
    return true
  }

  return false
}

function scoreProductMatch(product, nameInput, sizeInput) {
  let score = 0
  const inputNorm = normalizeSizeToken(nameInput)
  const fullName = normalizeSizeToken(product.name)
  const productBase = stripSizeSuffixFromName(product.name)
  const inputBase = stripSizeSuffixFromName(nameInput)

  if (fullName === inputNorm) score += 120
  if (productBase && inputBase && productBase === inputBase) score += 100
  if (productBase && inputBase && productBase.startsWith(inputBase)) score += 60
  if (productBase && inputBase && inputBase.startsWith(productBase)) score += 50
  if (fullName.includes(inputNorm)) score += 40
  if (productBase && inputBase && productBase.includes(inputBase)) score += 30
  if (sizeTokensMatch(product, sizeInput)) score += 35

  return score
}

function buildManualOrderProductName(product) {
  const name = (product.name || '').trim()
  const sizeLabel = formatCatalogProductSizeLabel(product)
  if (!sizeLabel) return name
  if (name.toLowerCase().includes(sizeLabel.toLowerCase())) return name
  return `${name} - ${sizeLabel}`
}

function findProductInCache(productName, sizeInput) {
  let nameInput = String(productName || '').trim()
  let sizeInputValue = String(sizeInput || '').trim()

  if (!sizeInputValue) {
    const parsedSize = parseSizeFromCombinedName(nameInput)
    if (parsedSize) sizeInputValue = parsedSize
  }

  if (!nameInput) return null

  const requiresSizeMatch = isValidManualOrderSizeInput(sizeInputValue)

  const scored = productsCache
    .filter((product) => isValidCatalogProductSize(product))
    .map((product) => ({ product, score: scoreProductMatch(product, nameInput, sizeInputValue) }))
    .filter((entry) => {
      if (entry.score < 70) return false
      if (requiresSizeMatch) return sizeTokensMatch(entry.product, sizeInputValue)
      return true
    })
    .sort((a, b) => b.score - a.score)

  if (scored.length === 0) return null

  const topScore = scored[0].score
  const topMatches = scored.filter((entry) => entry.score >= topScore - 5)
  return topMatches[0].product
}

function formatManualOrderMoney(value) {
  const num = parseFloat(value)
  if (Number.isNaN(num)) return '0.00'
  return num.toFixed(2)
}

function formatManualOrderDate(value) {
  const trimmed = String(value || '').trim()
  if (!trimmed) {
    const d = new Date()
    return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`
  }

  // HTML date inputs send YYYY-MM-DD — parse as calendar date, not UTC midnight.
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (isoMatch) {
    const month = parseInt(isoMatch[2], 10)
    const day = parseInt(isoMatch[3], 10)
    const year = isoMatch[1]
    return `${month}/${day}/${year}`
  }

  const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (slashMatch) {
    return `${parseInt(slashMatch[1], 10)}/${parseInt(slashMatch[2], 10)}/${slashMatch[3]}`
  }

  const date = new Date(trimmed)
  if (Number.isNaN(date.getTime())) {
    const d = new Date()
    return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`
  }
  return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`
}

function extractManualOrderNumber(apiData) {
  if (apiData == null) return null
  const objects = [apiData]
  if (typeof apiData === 'object' && apiData.data != null) objects.push(apiData.data)
  if (typeof apiData === 'object' && apiData.result != null) objects.push(apiData.result)

  const keys = [
    'orderNumber',
    'orderNum',
    'ordernum',
    'corpOrderNum',
    'corpOrderNumber',
    'orderId',
    'order_id',
    'id'
  ]

  for (const obj of objects) {
    if (!obj || typeof obj !== 'object') continue
    for (const key of keys) {
      const value = obj[key]
      if (value != null && String(value).trim()) return String(value).trim()
    }
  }
  return null
}

const MANUAL_ORDER_PAYMENT_LINKS_PATH = path.join(__dirname, 'data', 'manual-order-payment-links.json')

async function readManualOrderPaymentLinks() {
  try {
    const raw = await fs.readFile(MANUAL_ORDER_PAYMENT_LINKS_PATH, 'utf8')
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

async function saveManualOrderPaymentLinks(store) {
  await fs.mkdir(path.dirname(MANUAL_ORDER_PAYMENT_LINKS_PATH), { recursive: true })
  await fs.writeFile(MANUAL_ORDER_PAYMENT_LINKS_PATH, JSON.stringify(store, null, 2))
}

async function saveManualOrderPaymentLink(orderNumber, paymentLink) {
  if (!orderNumber || !paymentLink?.url) return
  const store = await readManualOrderPaymentLinks()
  const stripeAccountId = resolveManualOrderStripeAccountId({
    stripeAccountId: paymentLink.stripeAccountId,
    url: paymentLink.url
  })
  store[orderNumber] = {
    ...paymentLink,
    stripeAccountId,
    orderNumber,
    savedAt: new Date().toISOString()
  }
  await saveManualOrderPaymentLinks(store)
}

async function clearManualOrderPaymentLink(orderNumber) {
  if (!orderNumber) return
  const store = await readManualOrderPaymentLinks()
  if (!store[orderNumber]) return
  delete store[orderNumber]
  await saveManualOrderPaymentLinks(store)
}

function buildStripeDashboardUrl(type, id, livemode) {
  const prefix = livemode ? 'https://dashboard.stripe.com' : 'https://dashboard.stripe.com/test'
  if (type === 'invoice') return `${prefix}/invoices/${id}`
  if (type === 'payment_link') return `${prefix}/payment-links/${id}`
  return null
}

function buildStripeConnectDashboardUrl(type, id, livemode, stripeAccountId) {
  if (!stripeAccountId) return buildStripeDashboardUrl(type, id, livemode)
  const prefix = livemode ? 'https://dashboard.stripe.com' : 'https://dashboard.stripe.com/test'
  if (type === 'invoice') return `${prefix}/connect/accounts/${stripeAccountId}/invoices/${id}`
  if (type === 'payment_link') return `${prefix}/connect/accounts/${stripeAccountId}/payment-links/${id}`
  return buildStripeDashboardUrl(type, id, livemode)
}

function normalizeRetailerStoreNameKey(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function isTotalWineManualRetailer(storeName) {
  return normalizeRetailerStoreNameKey(storeName) === 'total wine manual'
}

/** Total Wine Manual is not a Connect account — the full invoice is on Bevvi's platform. */
function usesBevviPlatformSettlement(storeName) {
  return isTotalWineManualRetailer(storeName)
}

function normalizeEmailAddress(value) {
  return String(value || '').trim().toLowerCase()
}

function registerStripeAccountStoreAliases(targetMap, account) {
  const accountId = String(account?.id || '').trim()
  if (!accountId.startsWith('acct_')) return 0

  const aliasKeys = new Set()
  const addAlias = (value) => {
    const normalized = normalizeRetailerStoreNameKey(value)
    if (normalized && normalized !== 'total wine manual') {
      aliasKeys.add(normalized)
    }
  }

  addAlias(account.metadata?.bevviStoreName)
  addAlias(account.metadata?.storeName)
  addAlias(account.business_profile?.name)
  addAlias(account.company?.name)
  addAlias(account.settings?.dashboard?.display_name)

  let added = 0
  for (const key of aliasKeys) {
    if (!targetMap[key]) {
      targetMap[key] = accountId
      added += 1
    } else if (targetMap[key] !== accountId) {
      console.warn(
        `⚠️ Duplicate Stripe account alias "${key}": keeping ${targetMap[key]}, ignoring ${accountId}`
      )
    }
  }
  return added
}

function applyStripeStoreAccountEnvOverrides(targetMap) {
  const raw = process.env.STRIPE_STORE_ACCOUNTS_JSON
  if (!raw) return 0

  let applied = 0
  try {
    const parsed = JSON.parse(raw)
    for (const [name, accountId] of Object.entries(parsed)) {
      const normalized = normalizeRetailerStoreNameKey(name)
      const acct = String(accountId || '').trim()
      if (normalized && normalized !== 'total wine manual' && acct.startsWith('acct_')) {
        targetMap[normalized] = acct
        applied += 1
      }
    }
  } catch (error) {
    console.warn('⚠️ Invalid STRIPE_STORE_ACCOUNTS_JSON:', error.message)
  }
  return applied
}

let stripeConnectedAccountsCache = {
  byStoreName: {},
  accounts: [],
  loadedAt: null
}

async function matchStripeAccountsToBevviStoresByEmail(targetMap, stripeAccounts) {
  try {
    const response = await axios.get('https://api.getbevvi.com/api/corputil/getStoresAsJSON', {
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      timeout: 10000
    })

    const stores = normalizeStoresFromApi(response.data)
    const accountsByEmail = new Map()
    for (const account of stripeAccounts) {
      const email = normalizeEmailAddress(account.email)
      if (email && account.id) {
        accountsByEmail.set(email, account.id)
      }
    }

    let matched = 0
    for (const store of stores) {
      const storeKey = normalizeRetailerStoreNameKey(store?.name)
      if (!storeKey || storeKey === 'total wine manual' || targetMap[storeKey]) continue

      const accountId = accountsByEmail.get(normalizeEmailAddress(store?.email))
      if (accountId) {
        targetMap[storeKey] = accountId
        matched += 1
      }
    }
    return matched
  } catch (error) {
    console.warn('⚠️ Could not match Stripe accounts to Bevvi stores by email:', error.message)
    return 0
  }
}

async function refreshStripeConnectedAccountsCache() {
  const byStoreName = {}
  const accounts = []

  if (!stripe) {
    const envOverrides = applyStripeStoreAccountEnvOverrides(byStoreName)
    stripeConnectedAccountsCache = {
      byStoreName,
      accounts,
      loadedAt: new Date().toISOString(),
      envOverrides
    }
    return stripeConnectedAccountsCache
  }

  try {
    let startingAfter = null
    for (let page = 0; page < 50; page++) {
      const params = { limit: 100 }
      if (startingAfter) params.starting_after = startingAfter

      const result = await stripe.accounts.list(params)
      for (const account of result.data || []) {
        accounts.push({
          id: account.id,
          email: account.email || null,
          businessName: account.business_profile?.name || account.company?.name || null,
          chargesEnabled: account.charges_enabled === true,
          payoutsEnabled: account.payouts_enabled === true
        })
        registerStripeAccountStoreAliases(byStoreName, account)
      }

      if (!result.has_more || !result.data?.length) break
      startingAfter = result.data[result.data.length - 1].id
    }

    const emailMatches = await matchStripeAccountsToBevviStoresByEmail(byStoreName, accounts)
    const envOverrides = applyStripeStoreAccountEnvOverrides(byStoreName)

    stripeConnectedAccountsCache = {
      byStoreName,
      accounts,
      loadedAt: new Date().toISOString(),
      emailMatches,
      envOverrides
    }

    console.log(
      `💳 Stripe Connect cache: ${accounts.length} accounts, ${Object.keys(byStoreName).length} retailer mappings` +
        (emailMatches ? ` (${emailMatches} by store email)` : '') +
        (envOverrides ? ` (${envOverrides} env override${envOverrides === 1 ? '' : 's'})` : '')
    )
  } catch (error) {
    console.warn('⚠️ Could not load Stripe connected accounts from API:', error.message)
    applyStripeStoreAccountEnvOverrides(byStoreName)
    stripeConnectedAccountsCache = {
      byStoreName,
      accounts,
      loadedAt: new Date().toISOString(),
      error: error.message
    }
  }

  return stripeConnectedAccountsCache
}

function getStripeStoreAccountsByName() {
  return stripeConnectedAccountsCache.byStoreName || {}
}

function resolveRetailerStripeAccountId(storeName) {
  // Total Wine Manual is never a connected account — all funds stay on Bevvi.
  if (usesBevviPlatformSettlement(storeName)) return null
  return getStripeStoreAccountsByName()[normalizeRetailerStoreNameKey(storeName)] || null
}

function getRetailerStripeAccountInfo(storeName) {
  const name = String(storeName || '').trim()
  if (!name) return null

  if (usesBevviPlatformSettlement(name)) {
    return {
      storeName: name,
      settlementType: 'bevvi_platform',
      stripeAccountId: null,
      businessName: null
    }
  }

  const stripeAccountId = resolveRetailerStripeAccountId(name)
  const account = (stripeConnectedAccountsCache.accounts || []).find(
    (entry) => entry.id === stripeAccountId
  )

  return {
    storeName: name,
    settlementType: stripeAccountId ? 'connected_account' : 'unconfigured',
    stripeAccountId: stripeAccountId || null,
    businessName: account?.businessName || null
  }
}

function buildStripeConnectRequestOptions(stripeAccountId) {
  if (!stripeAccountId) return undefined
  return { stripeAccount: stripeAccountId }
}

function extractStripeAccountIdFromInvoiceUrl(url) {
  const match = String(url || '').match(/\/i\/(acct_[^/]+)\//)
  return match ? match[1] : null
}

function resolveManualOrderStripeAccountId({ stripeAccountId, url, invoice } = {}) {
  const fromRecord = String(stripeAccountId || '').trim()
  if (fromRecord && fromRecord !== 'platform') return fromRecord

  const fromUrl = extractStripeAccountIdFromInvoiceUrl(url)
  if (fromUrl) return fromUrl

  const fromMetadata = String(invoice?.metadata?.stripeAccountId || '').trim()
  if (fromMetadata && fromMetadata !== 'platform') return fromMetadata

  return null
}

function isStripeMissingInvoiceError(error) {
  return (
    error?.code === 'resource_missing' ||
    /No such invoice/i.test(String(error?.message || ''))
  )
}

async function retrieveManualOrderStripeInvoice(invoiceId, stripeAccountId = null) {
  const preferredAccountId = resolveManualOrderStripeAccountId({ stripeAccountId })
  const accountAttempts = []
  if (preferredAccountId) accountAttempts.push(preferredAccountId)
  accountAttempts.push(null)

  for (const account of stripeConnectedAccountsCache.accounts || []) {
    const accountId = String(account?.id || '').trim()
    if (accountId && !accountAttempts.includes(accountId)) {
      accountAttempts.push(accountId)
    }
  }

  let lastError = null
  for (const accountId of accountAttempts) {
    try {
      const connectOpts = buildStripeConnectRequestOptions(accountId)
      const invoice = await stripe.invoices.retrieve(invoiceId, {}, connectOpts)
      return { invoice, stripeAccountId: accountId }
    } catch (error) {
      lastError = error
      if (!isStripeMissingInvoiceError(error)) throw error
    }
  }

  throw lastError || new Error(`No such invoice: '${invoiceId}'`)
}

function filterRetailInvoiceLines(lines = []) {
  return lines.filter(
    (line) => line.feeType !== 'service' && line.feeType !== 'serviceChargeTax'
  )
}

async function computeManualOrderPlatformFeeCents(input, { useAutomaticTax }) {
  const service = parseMoneyValue(input.service)
  const serviceChargeTax = parseMoneyValue(input.serviceChargeTax)
  let salesTax = 0

  if (useAutomaticTax) {
    const taxResult = await calculateManualOrderStripeTax({
      ...input,
      service: 0,
      serviceChargeTax: 0
    })
    if (!taxResult.skipped) {
      salesTax = taxResult.salesTax ?? 0
    }
  } else {
    salesTax = parseMoneyValue(input.salesTax)
  }

  const platformFeeDollars = service + serviceChargeTax + salesTax
  return Math.max(0, Math.round(platformFeeDollars * 100))
}

function appendPrefilledEmailToPaymentUrl(url, email) {
  const customerEmail = String(email || '').trim()
  if (!customerEmail) return url
  return `${url}${url.includes('?') ? '&' : '?'}prefilled_email=${encodeURIComponent(customerEmail)}`
}

function extractStripeInvoiceTaxDollars(invoice) {
  if (!invoice) return null

  if (Array.isArray(invoice.total_taxes) && invoice.total_taxes.length > 0) {
    const cents = invoice.total_taxes.reduce((sum, entry) => sum + (Number(entry.amount) || 0), 0)
    if (cents > 0) return Math.round(cents) / 100
  }

  if (typeof invoice.tax === 'number' && invoice.tax > 0) {
    return invoice.tax / 100
  }

  return null
}

function extractStripeTaxCalculationDollars(calculation) {
  if (!calculation) return null

  if (typeof calculation.tax_amount_exclusive === 'number' && calculation.tax_amount_exclusive > 0) {
    return Math.round(calculation.tax_amount_exclusive) / 100
  }

  if (Array.isArray(calculation.tax_breakdown)) {
    const cents = calculation.tax_breakdown.reduce(
      (sum, entry) => sum + (Number(entry.amount) || 0),
      0
    )
    if (cents > 0) return Math.round(cents) / 100
  }

  return 0
}

function splitManualOrderTaxFromStripeCalculation(calculation, taxableLineMeta = []) {
  let salesTaxCents = 0
  let serviceChargeTaxCents = 0

  const stripeLines = calculation?.line_items?.data || []
  for (let i = 0; i < stripeLines.length; i++) {
    const taxCents = Number(stripeLines[i]?.amount_tax) || 0
    const feeType = taxableLineMeta[i]?.feeType
    if (feeType === 'service') {
      serviceChargeTaxCents += taxCents
    } else {
      salesTaxCents += taxCents
    }
  }

  const shippingTaxCents = Number(calculation?.shipping_cost?.amount_tax) || 0
  salesTaxCents += shippingTaxCents

  if (salesTaxCents > 0 || serviceChargeTaxCents > 0) {
    return {
      salesTax: Math.round(salesTaxCents) / 100,
      serviceChargeTax: Math.round(serviceChargeTaxCents) / 100
    }
  }

  return null
}

async function fetchStripeTaxCalculationForLines(lines, shippingAddress) {
  if (!lines.length) {
    return { tax: 0, calculationId: null }
  }

  const { request } = buildStripeTaxCalculationRequest(lines, shippingAddress)
  if (request.line_items.length === 0 && !request.shipping_cost) {
    return { tax: 0, calculationId: null }
  }

  const calculation = await stripe.tax.calculations.create(request)
  return {
    tax: extractStripeTaxCalculationDollars(calculation) ?? 0,
    calculationId: calculation.id
  }
}

async function calculateManualOrderStripeTax({
  matchedProducts = [],
  streetAddress,
  city,
  state,
  zip,
  country = 'US',
  delivery = 0,
  shipping = 0,
  service = 0,
  engraving = 0,
  tip = 0
}) {
  if (!stripe) {
    return { skipped: true, reason: 'Stripe is not configured on the server' }
  }

  const shippingAddress = buildStripeShippingAddress({
    streetAddress,
    city,
    state,
    zip,
    country
  })
  if (!shippingAddress) {
    return { skipped: true, reason: 'Recipient zip is required to calculate tax' }
  }

  const lines = buildManualOrderStripeLineItems({
    matchedProducts,
    delivery,
    shipping,
    service,
    serviceChargeTax: 0,
    engraving,
    tip,
    salesTax: 0,
    useAutomaticTax: true
  })

  if (lines.length === 0) {
    return { success: true, salesTax: 0, serviceChargeTax: 0, taxableSubtotal: 0 }
  }

  const serviceAmount = parseMoneyValue(service)
  const retailLines = buildManualOrderStripeLineItems({
    matchedProducts,
    delivery,
    shipping,
    service: 0,
    serviceChargeTax: 0,
    engraving,
    tip,
    salesTax: 0,
    useAutomaticTax: true
  })
  const serviceLines =
    serviceAmount > 0
      ? buildManualOrderStripeLineItems({
          matchedProducts: [],
          delivery: 0,
          shipping: 0,
          service: serviceAmount,
          serviceChargeTax: 0,
          engraving: 0,
          tip: 0,
          salesTax: 0,
          useAutomaticTax: true
        })
      : []

  const [retailTaxResult, serviceTaxResult] = await Promise.all([
    fetchStripeTaxCalculationForLines(retailLines, shippingAddress),
    serviceLines.length > 0
      ? fetchStripeTaxCalculationForLines(serviceLines, shippingAddress)
      : Promise.resolve({ tax: 0, calculationId: null })
  ])

  return {
    success: true,
    salesTax: retailTaxResult.tax,
    serviceChargeTax: serviceTaxResult.tax,
    taxableSubtotal: sumManualOrderLineItems(lines),
    calculationId: retailTaxResult.calculationId
  }
}

async function getStripeInvoiceRecordForOrder(orderNumber, stripeAccountId = null) {
  if (!stripe || !orderNumber) return null

  const invoices = await findStripeInvoicesForOrder(orderNumber, stripeAccountId)
  const preferred =
    invoices.find((invoice) => invoice.status === 'open') ||
    invoices.find((invoice) => invoice.status === 'paid') ||
    invoices[0]

  if (!preferred) return null

  if (Array.isArray(preferred.total_taxes) || typeof preferred.tax === 'number') {
    return preferred
  }

  return stripe.invoices.retrieve(
    preferred.id,
    {},
    buildStripeConnectRequestOptions(stripeAccountId)
  )
}

async function getStripeInvoiceTaxForOrder(orderNumber) {
  try {
    const store = await readManualOrderPaymentLinks()
    const storedAccountId = store[orderNumber]?.stripeAccountId || null
    const invoice = await getStripeInvoiceRecordForOrder(orderNumber, storedAccountId)
    return extractStripeInvoiceTaxDollars(invoice)
  } catch (error) {
    console.warn('Could not read Stripe invoice tax:', orderNumber, error.message)
    return null
  }
}

async function enrichPaymentLinkWithInvoiceTax(paymentLink) {
  if (!paymentLink || !stripe) return paymentLink

  const invoiceId =
    paymentLink.invoiceId ||
    (String(paymentLink.paymentLinkId || '').startsWith('in_') ? paymentLink.paymentLinkId : null)

  if (!invoiceId) return paymentLink

  try {
    const stripeAccountId = paymentLink.stripeAccountId || null
    const invoice = await stripe.invoices.retrieve(
      invoiceId,
      {},
      buildStripeConnectRequestOptions(stripeAccountId)
    )
    const stripeTaxAmount = extractStripeInvoiceTaxDollars(invoice)
    if (stripeTaxAmount == null) return paymentLink
    return { ...paymentLink, stripeTaxAmount }
  } catch (error) {
    console.warn('Could not enrich payment link with Stripe tax:', invoiceId, error.message)
    return paymentLink
  }
}

async function resolveStoredManualOrderPaymentLink(cached, orderNumber) {
  if (!cached?.url) return null
  if (!stripe) return cached

  const storedId = cached.paymentLinkId || cached.invoiceId || null
  if (!storedId) return cached

  try {
    if (String(storedId).startsWith('plink_')) {
      const link = await stripe.paymentLinks.retrieve(storedId)
      if (link.active) {
        const customerEmail = cached.customerEmail || link.metadata?.customerEmail || null
        return {
          ...cached,
          url: appendPrefilledEmailToPaymentUrl(link.url, customerEmail),
          paymentLinkId: link.id,
          paymentType: 'payment_link',
          livemode: link.livemode,
          stripeDashboardUrl: buildStripeDashboardUrl('payment_link', link.id, link.livemode),
          orderNumber,
          customerEmail,
          automaticTax: cached.automaticTax ?? link.metadata?.automaticTax === 'true',
          recipientZip: cached.recipientZip || link.metadata?.recipientZip || null
        }
      }
      await clearManualOrderPaymentLink(orderNumber)
      return null
    }

    if (String(storedId).startsWith('in_')) {
      const stripeAccountId = cached.stripeAccountId || null
      const connectOpts = buildStripeConnectRequestOptions(stripeAccountId)
      const invoice = await stripe.invoices.retrieve(storedId, {}, connectOpts)
      if (invoice.status === 'open' && invoice.hosted_invoice_url) {
        return {
          ...cached,
          url: invoice.hosted_invoice_url,
          invoiceId: invoice.id,
          paymentLinkId: invoice.id,
          paymentType: 'invoice',
          livemode: invoice.livemode,
          stripeDashboardUrl: buildStripeConnectDashboardUrl(
            'invoice',
            invoice.id,
            invoice.livemode,
            stripeAccountId
          ),
          orderNumber,
          customerEmail: cached.customerEmail || invoice.customer_email || invoice.metadata?.customerEmail || null,
          automaticTax: cached.automaticTax ?? invoice.metadata?.automaticTax === 'true',
          recipientZip: cached.recipientZip || invoice.metadata?.recipientZip || null,
          stripeTaxAmount: extractStripeInvoiceTaxDollars(invoice)
        }
      }
      await clearManualOrderPaymentLink(orderNumber)
      return null
    }
  } catch (error) {
    console.warn('Could not validate stored payment resource:', storedId, error.message)
    await clearManualOrderPaymentLink(orderNumber)
  }

  return null
}

function parseMoneyValue(value) {
  const parsed = parseFloat(String(value ?? '').replace(/,/g, '').trim())
  return Number.isNaN(parsed) ? 0 : parsed
}

function sumManualOrderLineItems(lines) {
  return (lines || []).reduce((sum, line) => sum + line.unitAmount * line.quantity, 0)
}

function computeManualOrderProductSubtotal(matchedProducts = []) {
  return matchedProducts.reduce((sum, product) => {
    const qty = parseInt(product.quantity, 10) || 1
    const price = parseMoneyValue(product.price)
    return sum + price * qty
  }, 0)
}

function resolveManualOrderEmbeddedTax(input = {}) {
  return parseMoneyValue(
    input.orderTax ?? input.originalSalesTax ?? input.taxes ?? input.salesTax
  )
}

function resolveManualOrderPaymentFees(input = {}) {
  const matchedProducts = input.matchedProducts || []
  const productSubtotal = computeManualOrderProductSubtotal(matchedProducts)
  const shipping = parseMoneyValue(input.shipping)
  const service = parseMoneyValue(input.service)
  const serviceChargeTax = parseMoneyValue(input.serviceChargeTax)
  const networkServiceCharge = parseMoneyValue(input.networkServiceCharge)
  const giftNoteCharge = parseMoneyValue(input.giftNoteCharge || input.engraving)
  const tip = parseMoneyValue(input.tip)
  const discount = parseMoneyValue(input.discount)
  const orderTotal = parseMoneyValue(input.totalAmount)
  const orderTax = resolveManualOrderEmbeddedTax(input)
  const salesTax = parseMoneyValue(input.salesTax)

  let delivery = parseMoneyValue(input.delivery)
  if (delivery <= 0) {
    const accountedWithoutDelivery =
      productSubtotal +
      shipping +
      service +
      serviceChargeTax +
      networkServiceCharge +
      giftNoteCharge +
      tip -
      discount

    if (orderTotal > 0) {
      const preTaxFromOrder = orderTax > 0 ? Math.max(0, orderTotal - orderTax) : orderTotal
      const remainder = Math.round((preTaxFromOrder - accountedWithoutDelivery) * 100) / 100
      if (remainder > 0.02) {
        delivery = remainder
      }
    }
  }

  const preTaxTotal =
    productSubtotal +
    delivery +
    shipping +
    service +
    serviceChargeTax +
    networkServiceCharge +
    giftNoteCharge +
    tip -
    discount

  return {
    matchedProducts,
    productSubtotal,
    delivery,
    shipping,
    service,
    serviceChargeTax,
    networkServiceCharge,
    giftNoteCharge,
    tip,
    discount,
    preTaxTotal,
    salesTax,
    orderTax,
    orderTotal
  }
}

function normalizeManualOrderPaymentInput(input = {}) {
  const fees = resolveManualOrderPaymentFees(input)

  return {
    ...input,
    ...fees
  }
}

const STRIPE_TAX_CODES = {
  NON_TAXABLE: 'txcd_00000000',
  GENERAL_TANGIBLE: 'txcd_99999999',
  GENERAL_SERVICE: 'txcd_20030000',
  ALCOHOL_BEER: 'txcd_41020001',
  ALCOHOL_SPIRITS: 'txcd_41020002',
  ALCOHOL_WINE: 'txcd_41020003',
  NON_ALCOHOLIC_BEVERAGE: 'txcd_41040008',
  GRATUITY: 'txcd_90020001',
  SHIPPING: 'txcd_92010001'
}

function resolveStripeTaxCodeForCatalogProduct(product) {
  const category = String(product?.category || '').trim().toLowerCase()
  const subCategory = String(product?.subCategory || '').trim().toLowerCase()

  if (category === 'wine') return STRIPE_TAX_CODES.ALCOHOL_WINE
  if (category === 'beer') return STRIPE_TAX_CODES.ALCOHOL_BEER
  if (category === 'mixer') return STRIPE_TAX_CODES.NON_ALCOHOLIC_BEVERAGE

  if (category === 'liquor') {
    if (subCategory.includes('ready-to-drink') || subCategory.includes('ready to drink')) {
      return STRIPE_TAX_CODES.ALCOHOL_SPIRITS
    }
    if (
      subCategory.includes('vermouth') ||
      subCategory.includes('aperitif') ||
      subCategory.includes('dessert') ||
      subCategory.includes('fortified')
    ) {
      return STRIPE_TAX_CODES.ALCOHOL_WINE
    }
    return STRIPE_TAX_CODES.ALCOHOL_SPIRITS
  }

  return STRIPE_TAX_CODES.ALCOHOL_SPIRITS
}

function resolveStripeTaxCodeFromProductName(name) {
  const label = String(name || '').toLowerCase()
  if (/\b(beer|lager|ale|cider|ipa|stout|pilsner|hefeweizen)\b/.test(label)) {
    return STRIPE_TAX_CODES.ALCOHOL_BEER
  }
  if (
    /\b(wine|champagne|prosecco|pinot|cabernet|merlot|chardonnay|sauvignon|ros[eé]|sake|shochu)\b/.test(
      label
    )
  ) {
    return STRIPE_TAX_CODES.ALCOHOL_WINE
  }
  if (/\b(mixer|juice|soda|tonic|bitters|cola|puree|grenadine|sweet & sour)\b/.test(label)) {
    return STRIPE_TAX_CODES.NON_ALCOHOLIC_BEVERAGE
  }
  if (
    /\b(vodka|gin|rum|tequila|whiskey|whisky|bourbon|scotch|mezcal|cognac|brandy|liqueur|spirit|soju|grappa)\b/.test(
      label
    )
  ) {
    return STRIPE_TAX_CODES.ALCOHOL_SPIRITS
  }
  return STRIPE_TAX_CODES.ALCOHOL_SPIRITS
}

function resolveStripeTaxCodeForFeeType(feeType) {
  switch (feeType) {
    case 'delivery':
    case 'shipping':
      return STRIPE_TAX_CODES.SHIPPING
    case 'tip':
      return STRIPE_TAX_CODES.GRATUITY
    case 'serviceChargeTax':
      return STRIPE_TAX_CODES.NON_TAXABLE
    case 'service':
      // Bevvi platform service charge is taxed at the standard rate, not as a generic service.
      return STRIPE_TAX_CODES.GENERAL_TANGIBLE
    case 'networkServiceCharge':
    case 'engraving':
    case 'giftNoteCharge':
      return STRIPE_TAX_CODES.GENERAL_SERVICE
    default:
      return STRIPE_TAX_CODES.GENERAL_SERVICE
  }
}

function resolveManualOrderProductTaxCode({ name, size, taxCode, category, subCategory }) {
  if (taxCode) return taxCode
  if (category || subCategory) {
    return resolveStripeTaxCodeForCatalogProduct({ category, subCategory })
  }
  const cached = findProductInCache(name, size)
  if (cached) return resolveStripeTaxCodeForCatalogProduct(cached)
  return resolveStripeTaxCodeFromProductName(`${name} ${size}`.trim())
}

function enrichManualOrderProductsForTax(productInputs = []) {
  return productInputs
    .map((item) => {
      const name = String(item.name || '').trim()
      const size = String(item.size || '').trim()
      const quantity = parseInt(item.quantity, 10) || 1
      const price = parseFloat(item.price)
      if (!name || Number.isNaN(price) || price < 0 || quantity <= 0) return null

      const cached = findProductInCache(name, size || parseSizeFromCombinedName(name) || '')
      const displayName = cached ? buildManualOrderProductName(cached) : `${name}${size ? ` ${size}` : ''}`.trim()

      return {
        name: displayName,
        quantity,
        price,
        category: cached?.category || item.category,
        subCategory: cached?.subCategory || item.subCategory,
        taxCode: resolveManualOrderProductTaxCode({
          name,
          size,
          taxCode: item.taxCode,
          category: cached?.category || item.category,
          subCategory: cached?.subCategory || item.subCategory
        })
      }
    })
    .filter(Boolean)
}

function buildManualOrderStripeLineItems({
  matchedProducts = [],
  delivery = 0,
  shipping = 0,
  service = 0,
  serviceChargeTax = 0,
  networkServiceCharge = 0,
  giftNoteCharge = 0,
  engraving = 0,
  tip = 0,
  salesTax = 0,
  useAutomaticTax = false
}) {
  const lines = []

  for (const product of matchedProducts) {
    const quantity = parseInt(product.quantity, 10) || 1
    const unitAmount = parseFloat(product.price)
    if (Number.isNaN(unitAmount) || unitAmount < 0) continue
    lines.push({
      type: 'product',
      name: String(product.name || 'Product').trim().slice(0, 250) || 'Product',
      unitAmount,
      quantity,
      taxCode: resolveManualOrderProductTaxCode(product)
    })
  }

  const feeLines = [
    ['delivery', 'Delivery Fee', delivery],
    ['shipping', 'Shipping Fee', shipping],
    ['service', 'Service Charge', service],
    ['serviceChargeTax', 'Service Charge Tax', serviceChargeTax],
    ['networkServiceCharge', 'Network Service Charge', networkServiceCharge],
    ['engraving', 'Gift Note / Engraving', giftNoteCharge || engraving],
    ['tip', 'Tip', tip]
  ]

  for (const [feeType, name, amount] of feeLines) {
    const value = parseMoneyValue(amount)
    if (value > 0) {
      lines.push({
        type: 'fee',
        feeType,
        name,
        unitAmount: value,
        quantity: 1,
        taxCode: resolveStripeTaxCodeForFeeType(feeType)
      })
    }
  }

  if (!useAutomaticTax) {
    const taxAmount = parseMoneyValue(salesTax)
    if (taxAmount > 0) {
      lines.push({ type: 'fee', name: 'Sales Tax', unitAmount: taxAmount, quantity: 1 })
    }
  }

  return lines
}

function reconcileManualOrderLineItems(lines, discount, expectedPayable) {
  if (expectedPayable == null || Number.isNaN(expectedPayable)) {
    return { lines: [...lines], discount }
  }

  const normalizedDiscount = Math.max(0, parseMoneyValue(discount))
  const subtotal = sumManualOrderLineItems(lines)
  const diff = Math.round((subtotal - normalizedDiscount - expectedPayable) * 100) / 100

  if (Math.abs(diff) <= 0.02) {
    return { lines: [...lines], discount: normalizedDiscount }
  }

  if (diff > 0) {
    return { lines: [...lines], discount: normalizedDiscount + diff }
  }

  const gap = Math.round(Math.abs(diff) * 100) / 100
  const hasDeliveryOrShipping = lines.some(
    (line) => line.feeType === 'delivery' || line.feeType === 'shipping'
  )

  const gapLine = hasDeliveryOrShipping
    ? {
        type: 'fee',
        feeType: 'service',
        name: 'Order adjustment',
        unitAmount: gap,
        quantity: 1,
        taxCode: STRIPE_TAX_CODES.GENERAL_SERVICE
      }
    : {
        type: 'fee',
        feeType: 'delivery',
        name: 'Delivery Fee',
        unitAmount: gap,
        quantity: 1,
        taxCode: STRIPE_TAX_CODES.SHIPPING
      }

  return {
    lines: [...lines, gapLine],
    discount: normalizedDiscount
  }
}

function toStripeTaxCalculationLineItem(line, index) {
  return {
    amount: Math.max(0, Math.round(line.unitAmount * line.quantity * 100)),
    reference: `manual-line-${index}`,
    tax_behavior: 'exclusive',
    tax_code: line.taxCode || STRIPE_TAX_CODES.GENERAL_TANGIBLE
  }
}

function partitionManualOrderLinesForAutomaticTax(lines = []) {
  const taxableLines = []
  let shippingCents = 0

  for (const line of lines) {
    if (line.feeType === 'delivery' || line.feeType === 'shipping') {
      shippingCents += Math.max(0, Math.round(line.unitAmount * line.quantity * 100))
      continue
    }
    taxableLines.push(line)
  }

  return { taxableLines, shippingCents }
}

function buildStripeTaxCalculationRequest(lines, shippingAddress) {
  const { taxableLines, shippingCents } = partitionManualOrderLinesForAutomaticTax(lines)
  const taxableLineMeta = []
  const stripeLineItems = []

  for (const line of taxableLines) {
    const amount = Math.max(0, Math.round(line.unitAmount * line.quantity * 100))
    if (amount <= 0) continue
    taxableLineMeta.push({
      feeType: line.feeType || null,
      lineType: line.type || null
    })
    stripeLineItems.push({
      amount,
      reference: `manual-line-${stripeLineItems.length}`,
      tax_behavior: 'exclusive',
      tax_code: line.taxCode || STRIPE_TAX_CODES.GENERAL_TANGIBLE
    })
  }

  const request = {
    currency: 'usd',
    line_items: stripeLineItems,
    customer_details: {
      address: shippingAddress,
      address_source: 'shipping'
    }
  }

  if (shippingCents > 0) {
    request.shipping_cost = {
      amount: shippingCents,
      tax_code: STRIPE_TAX_CODES.SHIPPING,
      tax_behavior: 'exclusive'
    }
  }

  return { request, taxableLineMeta }
}

function buildStripeInvoiceShippingCost(shippingCents) {
  if (shippingCents <= 0) return null
  return {
    shipping_rate_data: {
      type: 'fixed_amount',
      fixed_amount: {
        amount: shippingCents,
        currency: 'usd'
      },
      display_name: 'Delivery & shipping',
      tax_code: STRIPE_TAX_CODES.SHIPPING,
      tax_behavior: 'exclusive'
    }
  }
}

function toStripeCheckoutLineItems(lines, useAutomaticTax) {
  return lines.map((line) => ({
    price_data: {
      currency: 'usd',
      unit_amount: Math.round(line.unitAmount * 100),
      ...(useAutomaticTax ? { tax_behavior: 'exclusive' } : {}),
      product_data: {
        name: line.name.slice(0, 250),
        ...(useAutomaticTax
          ? { tax_code: line.taxCode || STRIPE_TAX_CODES.GENERAL_TANGIBLE }
          : {}),
        metadata: {
          lineType: line.type || 'fee',
          feeType: line.feeType || ''
        }
      }
    },
    quantity: line.quantity
  }))
}

async function createStripeDiscountCoupon(discountAmount, orderNumber, stripeAccountId = null) {
  const amountOff = Math.round(parseMoneyValue(discountAmount) * 100)
  if (amountOff <= 0) return null

  return stripe.coupons.create({
    amount_off: amountOff,
    currency: 'usd',
    duration: 'once',
    name: orderNumber ? `Discount — ${orderNumber}` : 'Order discount',
    metadata: {
      source: 'manual-order',
      orderNumber: orderNumber || ''
    }
  }, buildStripeConnectRequestOptions(stripeAccountId))
}

function buildStripeShippingAddress({ streetAddress, city, state, zip, country = 'US' }) {
  const postalCode = String(zip || '').trim()
  if (!postalCode) return null

  const address = {
    line1: String(streetAddress || '').trim() || 'Address on file',
    postal_code: postalCode,
    country: String(country || 'US').trim().toUpperCase() || 'US'
  }

  const cityValue = String(city || '').trim()
  const stateValue = String(state || '').trim()
  if (cityValue) address.city = cityValue
  if (stateValue) address.state = stateValue

  return address
}

async function findStripePaymentLinkForOrder(orderNumber) {
  if (!stripe || !orderNumber) return null

  let startingAfter = null
  for (let page = 0; page < 5; page++) {
    const params = { limit: 100, active: true }
    if (startingAfter) params.starting_after = startingAfter

    const result = await stripe.paymentLinks.list(params)
    const match = result.data.find((link) => link.metadata?.orderNumber === orderNumber)
    if (match) {
      const customerEmail = match.metadata?.customerEmail || null
      return {
        url: appendPrefilledEmailToPaymentUrl(match.url, customerEmail),
        paymentLinkId: match.id,
        paymentType: 'payment_link',
        livemode: match.livemode,
        stripeDashboardUrl: buildStripeDashboardUrl('payment_link', match.id, match.livemode),
        orderNumber,
        customerEmail,
        automaticTax: match.metadata?.automaticTax === 'true',
        recipientZip: match.metadata?.recipientZip || null
      }
    }

    if (!result.has_more || result.data.length === 0) break
    startingAfter = result.data[result.data.length - 1].id
  }

  return null
}

async function findStripeCheckoutSessionForOrder(orderNumber) {
  if (!stripe || !orderNumber) return null

  let startingAfter = null
  for (let page = 0; page < 5; page++) {
    const params = { limit: 100 }
    if (startingAfter) params.starting_after = startingAfter

    const result = await stripe.checkout.sessions.list(params)
    const match = result.data.find(
      (session) =>
        session.metadata?.orderNumber === orderNumber &&
        session.status === 'open' &&
        session.url
    )
    if (match) {
      return {
        url: match.url,
        paymentLinkId: match.id,
        sessionId: match.id,
        orderNumber,
        customerEmail: match.customer_details?.email || match.metadata?.customerEmail || null,
        automaticTax: match.metadata?.automaticTax === 'true',
        recipientZip: match.metadata?.recipientZip || null
      }
    }

    if (!result.has_more || result.data.length === 0) break
    startingAfter = result.data[result.data.length - 1].id
  }

  return null
}

async function findStripeInvoicesForOrder(orderNumber, stripeAccountId = null) {
  if (!stripe || !orderNumber) return []

  const matches = []
  const seen = new Set()
  const connectOpts = buildStripeConnectRequestOptions(stripeAccountId)

  try {
    const searchResult = await stripe.invoices.search(
      {
        query: `metadata['orderNumber']:'${orderNumber}'`,
        limit: 20
      },
      connectOpts
    )
    for (const invoice of searchResult.data || []) {
      if (invoice.metadata?.source === 'manual-order' && !seen.has(invoice.id)) {
        seen.add(invoice.id)
        matches.push(invoice)
      }
    }
    if (matches.length > 0) return matches
  } catch (error) {
    console.warn('Stripe invoice search unavailable, falling back to list:', error.message)
  }

  let startingAfter = null
  for (let page = 0; page < 5; page++) {
    const params = { limit: 100 }
    if (startingAfter) params.starting_after = startingAfter

    const result = await stripe.invoices.list(params, connectOpts)
    for (const invoice of result.data) {
      if (invoice.metadata?.orderNumber === orderNumber && invoice.metadata?.source === 'manual-order') {
        if (!seen.has(invoice.id)) {
          seen.add(invoice.id)
          matches.push(invoice)
        }
      }
    }

    if (!result.has_more || result.data.length === 0) break
    startingAfter = result.data[result.data.length - 1].id
  }

  return matches
}

async function findStripeInvoiceForOrder(orderNumber) {
  const store = await readManualOrderPaymentLinks()
  const storedAccountId = store[orderNumber]?.stripeAccountId || null
  const invoices = await findStripeInvoicesForOrder(orderNumber, storedAccountId)
  const openInvoice = invoices.find(
    (invoice) => invoice.status === 'open' && invoice.hosted_invoice_url
  )
  if (!openInvoice) return null

  const stripeTaxAmount = extractStripeInvoiceTaxDollars(openInvoice)
  const stripeAccountId = storedAccountId || openInvoice.metadata?.stripeAccountId || null
  const resolvedAccountId = stripeAccountId && stripeAccountId !== 'platform' ? stripeAccountId : null

  return {
    url: openInvoice.hosted_invoice_url,
    paymentLinkId: openInvoice.id,
    invoiceId: openInvoice.id,
    paymentType: 'invoice',
    livemode: openInvoice.livemode,
    stripeDashboardUrl: buildStripeConnectDashboardUrl(
      'invoice',
      openInvoice.id,
      openInvoice.livemode,
      resolvedAccountId
    ),
    stripeAccountId: resolvedAccountId,
    orderNumber,
    customerEmail: openInvoice.customer_email || openInvoice.metadata?.customerEmail || null,
    automaticTax: openInvoice.metadata?.automaticTax === 'true',
    recipientZip: openInvoice.metadata?.recipientZip || null,
    stripeTaxAmount
  }
}

async function archiveManualOrderStripeInvoice(invoiceId, stripeAccountId = null) {
  const { invoice, stripeAccountId: resolvedAccountId } = await retrieveManualOrderStripeInvoice(
    invoiceId,
    stripeAccountId
  )
  const connectOpts = buildStripeConnectRequestOptions(resolvedAccountId)

  if (invoice.status === 'paid') {
    const error = new Error('This invoice has already been paid and cannot be voided.')
    error.code = 'INVOICE_ALREADY_PAID'
    throw error
  }

  if (invoice.status === 'void') {
    return 'already_voided'
  }

  if (invoice.status === 'draft') {
    await stripe.invoices.del(invoiceId, {}, connectOpts)
    return 'deleted'
  }

  if (invoice.status === 'open') {
    await stripe.invoices.voidInvoice(invoiceId, {}, connectOpts)
    return 'voided'
  }

  return 'skipped'
}

async function voidManualOrderStripePayment(orderNumber) {
  if (!stripe) {
    return { skipped: true, reason: 'Stripe is not configured on the server' }
  }

  if (!stripeConnectedAccountsCache.loadedAt) {
    await refreshStripeConnectedAccountsCache()
  }

  const normalizedOrderNumber = String(orderNumber || '').trim()
  if (!normalizedOrderNumber) {
    const error = new Error('orderNumber is required')
    error.code = 'ORDER_NUMBER_REQUIRED'
    throw error
  }

  const store = await readManualOrderPaymentLinks()
  const existingRecord = store[normalizedOrderNumber] || null
  const archiveActions = await archiveManualOrderStripePaymentResources(
    existingRecord,
    normalizedOrderNumber
  )

  if (archiveActions.length === 0) {
    const store = await readManualOrderPaymentLinks()
    const storedRecord = store[normalizedOrderNumber] || null
    const storedAccountId = resolveManualOrderStripeAccountId({
      stripeAccountId: storedRecord?.stripeAccountId,
      url: storedRecord?.url
    })
    const invoices = await findStripeInvoicesForOrder(normalizedOrderNumber, storedAccountId)
    const voidable = invoices.filter((invoice) => ['draft', 'open'].includes(invoice.status))
    if (voidable.length === 0) {
      return {
        orderNumber: normalizedOrderNumber,
        voided: false,
        message: 'No open Stripe invoice found for this order.',
        archiveActions: []
      }
    }
  }

  await clearManualOrderPaymentLink(normalizedOrderNumber)

  const invoiceAction = archiveActions.find((action) => action.type === 'invoice')
  return {
    orderNumber: normalizedOrderNumber,
    voided: true,
    invoiceId: invoiceAction?.id || existingRecord?.invoiceId || null,
    result: invoiceAction?.result || 'voided',
    archiveActions
  }
}

async function archiveManualOrderStripePaymentResources(existingRecord, orderNumber) {
  if (!stripe || !orderNumber) return []

  const actions = []
  const handledInvoiceIds = new Set()
  const resolvedAccountId = resolveManualOrderStripeAccountId({
    stripeAccountId: existingRecord?.stripeAccountId,
    url: existingRecord?.url
  })

  const archiveInvoice = async (invoiceId, source, stripeAccountId = null) => {
    if (!invoiceId || handledInvoiceIds.has(invoiceId)) return
    handledInvoiceIds.add(invoiceId)
    try {
      const accountId =
        resolveManualOrderStripeAccountId({
          stripeAccountId: stripeAccountId || resolvedAccountId,
          url: existingRecord?.url
        }) || null
      const result = await archiveManualOrderStripeInvoice(invoiceId, accountId)
      actions.push({ type: 'invoice', id: invoiceId, result, source })
    } catch (error) {
      if (error.code === 'INVOICE_ALREADY_PAID') throw error
      if (isStripeMissingInvoiceError(error)) {
        console.warn(`Stripe invoice not found during archive (${source}):`, invoiceId, error.message)
        actions.push({ type: 'invoice', id: invoiceId, result: 'not_found', source })
        return
      }
      throw error
    }
  }

  const sessionId =
    existingRecord?.sessionId ||
    (String(existingRecord?.paymentLinkId || '').startsWith('cs_') ? existingRecord.paymentLinkId : null)

  if (sessionId) {
    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId)
      if (session.invoice) {
        await archiveInvoice(session.invoice, 'checkout_session', resolvedAccountId)
      }
      if (session.status === 'open') {
        await stripe.checkout.sessions.expire(sessionId)
        actions.push({ type: 'checkout_session', id: sessionId, result: 'expired' })
      }
    } catch (error) {
      if (error.code === 'INVOICE_ALREADY_PAID') throw error
      console.warn('Could not archive checkout session:', sessionId, error.message)
    }
  }

  const paymentLinkId = String(existingRecord?.paymentLinkId || '').startsWith('plink_')
    ? existingRecord.paymentLinkId
    : null
  if (paymentLinkId) {
    try {
      await stripe.paymentLinks.update(paymentLinkId, { active: false })
      actions.push({ type: 'payment_link', id: paymentLinkId, result: 'deactivated' })
    } catch (error) {
      console.warn('Could not deactivate payment link:', paymentLinkId, error.message)
    }
  }

  if (existingRecord?.invoiceId) {
    await archiveInvoice(existingRecord.invoiceId, 'stored_record', resolvedAccountId)
  }

  const invoices = await findStripeInvoicesForOrder(
    orderNumber,
    resolvedAccountId
  )
  for (const invoice of invoices) {
    if (['draft', 'open'].includes(invoice.status)) {
      await archiveInvoice(
        invoice.id,
        'order_lookup',
        resolveManualOrderStripeAccountId({
          stripeAccountId: resolvedAccountId,
          invoice
        })
      )
    }
  }

  return actions
}

async function createManualOrderStripeInvoiceItems(customerId, lines, useAutomaticTax, stripeAccountId = null) {
  const connectOpts = buildStripeConnectRequestOptions(stripeAccountId)
  for (const line of lines) {
    await stripe.invoiceItems.create({
      customer: customerId,
      description: line.name.slice(0, 250),
      quantity: line.quantity,
      currency: 'usd',
      unit_amount_decimal: String(Math.round(line.unitAmount * 100)),
      ...(useAutomaticTax ? { tax_behavior: 'exclusive' } : {}),
      ...(useAutomaticTax
        ? { tax_code: line.taxCode || STRIPE_TAX_CODES.GENERAL_TANGIBLE }
        : {}),
      metadata: {
        lineType: line.type || 'fee',
        feeType: line.feeType || '',
        taxCode: line.taxCode || ''
      }
    }, connectOpts)
  }
}

async function getManualOrderPaymentLink(orderNumber) {
  let paymentLink = null

  const store = await readManualOrderPaymentLinks()
  const cached = store[orderNumber]
  if (cached?.url) {
    const resolved = await resolveStoredManualOrderPaymentLink(cached, orderNumber)
    if (resolved) paymentLink = resolved
  }

  if (!paymentLink) {
    const fromInvoice = await findStripeInvoiceForOrder(orderNumber)
    if (fromInvoice) {
      await saveManualOrderPaymentLink(orderNumber, fromInvoice)
      paymentLink = fromInvoice
    }
  }

  if (!paymentLink) {
    const fromPaymentLink = await findStripePaymentLinkForOrder(orderNumber)
    if (fromPaymentLink) {
      await saveManualOrderPaymentLink(orderNumber, fromPaymentLink)
      paymentLink = fromPaymentLink
    }
  }

  if (!paymentLink) return null
  return enrichPaymentLinkWithInvoiceTax(paymentLink)
}

async function createStripePaymentLinkForManualOrder(input) {
  if (!stripe) {
    return { skipped: true, reason: 'Stripe is not configured on the server' }
  }

  const {
    orderNumber,
    email,
    customerName,
    storeName,
    totalAmount,
    matchedProducts,
    streetAddress,
    city,
    state,
    zip,
    salesTax,
    delivery,
    shipping,
    service,
    serviceChargeTax,
    networkServiceCharge,
    giftNoteCharge,
    tip,
    discount,
    country,
    preTaxTotal,
    orderTotal
  } = normalizeManualOrderPaymentInput(input)

  const shippingAddress = buildStripeShippingAddress({
    streetAddress,
    city,
    state,
    zip,
    country
  })
  const useAutomaticTax = Boolean(shippingAddress)
  const settleOnBevviPlatform = usesBevviPlatformSettlement(storeName)
  const stripeAccountId = resolveRetailerStripeAccountId(storeName)
  const useConnectedAccount = Boolean(stripeAccountId)

  if (!settleOnBevviPlatform && !stripeAccountId) {
    return {
      skipped: true,
      reason: `No Stripe connected account configured for retailer "${storeName || 'Unknown'}". Add it to STRIPE_STORE_ACCOUNTS_JSON.`
    }
  }

  const serviceAmount = parseMoneyValue(service)
  const serviceChargeTaxAmount = parseMoneyValue(serviceChargeTax)
  const retailerPreTaxTotal = Math.max(0, preTaxTotal - serviceAmount - serviceChargeTaxAmount)
  const expectedPayable = useAutomaticTax
    ? (useConnectedAccount ? retailerPreTaxTotal : preTaxTotal)
    : orderTotal > 0
      ? orderTotal
      : preTaxTotal + parseMoneyValue(salesTax)

  const productSummary = (matchedProducts || [])
    .map((p) => `${p.quantity}x ${p.name}`)
    .join(', ')
    .slice(0, 500)

  const productName = orderNumber
    ? `Bevvi Order ${orderNumber}`
    : `Bevvi order — ${storeName || 'Manual'}`

  const sharedMetadata = {
    source: 'manual-order',
    orderNumber: orderNumber || '',
    storeName: storeName || '',
    customerEmail: email || '',
    customerName: customerName || '',
    productSummary: productSummary || '',
    automaticTax: useAutomaticTax ? 'true' : 'false',
    recipientZip: shippingAddress?.postal_code || '',
    stripeAccountId: stripeAccountId || 'platform',
    useConnectedAccount: useConnectedAccount ? 'true' : 'false',
    settleOnBevviPlatform: settleOnBevviPlatform ? 'true' : 'false'
  }

  let { lines, discount: normalizedDiscount } = reconcileManualOrderLineItems(
    buildManualOrderStripeLineItems({
      matchedProducts,
      delivery,
      shipping,
      service,
      serviceChargeTax,
      networkServiceCharge,
      giftNoteCharge,
      tip,
      salesTax,
      useAutomaticTax
    }),
    discount,
    expectedPayable
  )

  if (useConnectedAccount) {
    lines = filterRetailInvoiceLines(lines)
  }

  if (lines.length === 0) {
    return { skipped: true, reason: 'No line items available to create a payment link' }
  }

  const payableBeforeTax = Math.max(0, sumManualOrderLineItems(lines) - normalizedDiscount)
  if (payableBeforeTax < 0.5) {
    return { skipped: true, reason: 'Order total is below the Stripe minimum ($0.50)' }
  }

  const stripeLineItems = toStripeCheckoutLineItems(lines, useAutomaticTax)
  const discountCoupon =
    normalizedDiscount > 0
      ? await createStripeDiscountCoupon(normalizedDiscount, orderNumber, stripeAccountId)
      : null
  const customerEmail = String(email || '').trim()

  if (useAutomaticTax) {
    const connectOpts = buildStripeConnectRequestOptions(stripeAccountId)
    if (settleOnBevviPlatform) {
      console.log('💳 Creating Bevvi platform invoice (Total Wine Manual — full payment to Bevvi):', {
        orderNumber: orderNumber || null,
        storeName
      })
    } else {
      console.log('💳 Creating connected-account invoice:', {
        orderNumber: orderNumber || null,
        storeName,
        stripeAccountId
      })
    }

    const customer = await stripe.customers.create({
      email: customerEmail || undefined,
      name: customerName || undefined,
      shipping: {
        name: customerName || 'Customer',
        address: shippingAddress
      },
      tax: { validate_location: 'immediately' },
      metadata: {
        source: 'manual-order',
        orderNumber: orderNumber || ''
      }
    }, connectOpts)

    const { taxableLines, shippingCents } = partitionManualOrderLinesForAutomaticTax(lines)

    await createManualOrderStripeInvoiceItems(customer.id, taxableLines, true, stripeAccountId)

    const invoiceParams = {
      customer: customer.id,
      automatic_tax: { enabled: true },
      collection_method: 'send_invoice',
      days_until_due: 30,
      metadata: sharedMetadata,
      description: productName
    }

    if (useConnectedAccount) {
      const platformFeeCents = await computeManualOrderPlatformFeeCents(
        normalizeManualOrderPaymentInput(input),
        { useAutomaticTax: true }
      )
      if (platformFeeCents > 0) {
        invoiceParams.application_fee_amount = platformFeeCents
      }
    }

    const shippingCost = buildStripeInvoiceShippingCost(shippingCents)
    if (shippingCost) {
      invoiceParams.shipping_cost = shippingCost
    }

    if (discountCoupon) {
      invoiceParams.discounts = [{ coupon: discountCoupon.id }]
    }

    const draftInvoice = await stripe.invoices.create(
      {
        ...invoiceParams,
        pending_invoice_items_behavior: 'include'
      },
      connectOpts
    )
    const invoice = await stripe.invoices.finalizeInvoice(draftInvoice.id, {}, connectOpts)
    const stripeTaxAmount = extractStripeInvoiceTaxDollars(invoice)
    const platformFeeCents = Number(invoice.application_fee_amount) || 0

    return {
      url: invoice.hosted_invoice_url,
      paymentLinkId: invoice.id,
      invoiceId: invoice.id,
      paymentType: 'invoice',
      livemode: invoice.livemode,
      stripeDashboardUrl: buildStripeConnectDashboardUrl(
        'invoice',
        invoice.id,
        invoice.livemode,
        stripeAccountId
      ),
      stripeAccountId: stripeAccountId || null,
      settlementType: settleOnBevviPlatform ? 'bevvi_platform' : 'connected_account',
      platformFeeAmount: platformFeeCents > 0 ? platformFeeCents / 100 : null,
      totalAmount: orderTotal || parseFloat(totalAmount),
      taxableAmount: payableBeforeTax,
      lineItemCount: lines.length,
      automaticTax: true,
      recipientZip: shippingAddress.postal_code,
      orderNumber: orderNumber || null,
      customerEmail: customerEmail || null,
      stripeTaxAmount
    }
  }

  const paymentLinkParams = {
    line_items: stripeLineItems,
    metadata: {
      ...sharedMetadata,
      paymentType: 'payment_link',
      productName
    },
    after_completion: {
      type: 'redirect',
      redirect: { url: STRIPE_PAYMENT_SUCCESS_URL.replace('{CHECKOUT_SESSION_ID}', '') }
    }
  }

  if (discountCoupon) {
    paymentLinkParams.discounts = [{ coupon: discountCoupon.id }]
  }

  const paymentLink = await stripe.paymentLinks.create(paymentLinkParams)
  const paymentUrl = appendPrefilledEmailToPaymentUrl(paymentLink.url, customerEmail)

  return {
    url: paymentUrl,
    paymentLinkId: paymentLink.id,
    paymentType: 'payment_link',
    livemode: paymentLink.livemode,
    stripeDashboardUrl: buildStripeDashboardUrl('payment_link', paymentLink.id, paymentLink.livemode),
    totalAmount: orderTotal || parseFloat(totalAmount),
    taxableAmount: payableBeforeTax,
    lineItemCount: lines.length,
    automaticTax: false,
    recipientZip: null,
    orderNumber: orderNumber || null,
    customerEmail: customerEmail || null
  }
}

function splitCustomerName(fullName) {
  const trimmed = String(fullName || '').trim()
  if (!trimmed) return { firstName: '', lastName: '' }
  const parts = trimmed.split(/\s+/)
  if (parts.length === 1) return { firstName: parts[0], lastName: '' }
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') }
}

// Product search endpoint - searches cached products
app.get('/api/products/search', async (req, res) => {
  try {
    const { q } = req.query
    
    if (!q || q.length < 3) {
      return res.json({
        success: true,
        results: [],
        message: 'Search term must be at least 3 characters'
      })
    }
    
    await ensureProductsCacheLoaded()
    
    // Check if cache needs refresh (older than 1 hour)
    const cacheAge = productsCacheTimestamp ? Date.now() - productsCacheTimestamp : null
    const cacheExpired = !productsCacheTimestamp || cacheAge > PRODUCTS_CACHE_DURATION
    
    if (cacheExpired) {
      console.log('⚠️ Products cache expired or empty, may need refresh')
    }
    
    const results = searchProducts(q)
    
    res.json({
      success: true,
      results: results,
      totalProducts: productsCache.length,
      searchTerm: q,
      cacheAge: cacheAge ? Math.floor(cacheAge / 1000) : null,
      cacheExpired: cacheExpired
    })
  } catch (error) {
    console.error('Error searching products:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to search products',
      message: error.message
    })
  }
})

// Refresh products cache endpoint
app.post('/api/products/refresh', async (req, res) => {
  try {
    console.log('🔄 Refreshing products cache...')
    const count = await loadAllProducts()
    
    res.json({
      success: true,
      message: 'Products cache refreshed',
      totalProducts: count,
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    console.error('Error refreshing products cache:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to refresh products cache',
      message: error.message
    })
  }
})

// Get products cache status
app.get('/api/products/status', (req, res) => {
  const cacheAge = productsCacheTimestamp ? Date.now() - productsCacheTimestamp : null
  
  res.json({
    totalProducts: productsCache.length,
    cacheTimestamp: productsCacheTimestamp,
    cacheAge: cacheAge ? Math.floor(cacheAge / 1000) : null,
    cacheExpired: !productsCacheTimestamp || cacheAge > PRODUCTS_CACHE_DURATION,
    lastUpdated: productsCacheTimestamp ? new Date(productsCacheTimestamp).toISOString() : null
  })
})

const GOOGLE_PLACES_NEW_BASE = 'https://places.googleapis.com/v1'

function googlePlacesNewHeaders(fieldMask) {
  const headers = {
    'Content-Type': 'application/json',
    'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY
  }
  if (fieldMask) headers['X-Goog-FieldMask'] = fieldMask
  return headers
}

function normalizeGooglePlaceId(placeId) {
  const raw = String(placeId || '').trim()
  if (!raw) return ''
  return raw.startsWith('places/') ? raw.slice('places/'.length) : raw
}

function parseGoogleAddressComponents(components) {
  let streetNumber = ''
  let route = ''
  let city = ''
  let state = ''
  let zip = ''

  for (const component of components || []) {
    const types = component.types || []
    const longName = component.longText ?? component.long_name ?? ''
    const shortName = component.shortText ?? component.short_name ?? ''
    if (types.includes('street_number')) streetNumber = longName
    if (types.includes('route')) route = longName
    if (types.includes('locality')) city = longName
    if (!city && types.includes('postal_town')) city = longName
    if (!city && types.includes('sublocality')) city = longName
    if (types.includes('administrative_area_level_1')) state = shortName
    if (types.includes('postal_code')) zip = longName
  }

  return {
    streetAddress: [streetNumber, route].filter(Boolean).join(' ').trim(),
    city,
    state,
    zip
  }
}

function googlePlacesNewErrorMessage(data, fallback) {
  if (!data) return fallback
  if (typeof data === 'string' && data.trim()) return data.trim()
  if (typeof data.error === 'string') return data.error
  if (data.error?.message) return data.error.message
  if (data.message) return data.message
  return fallback
}

app.get('/api/address/config', (req, res) => {
  res.json({ enabled: !!GOOGLE_MAPS_API_KEY })
})

app.get('/api/address/autocomplete', async (req, res) => {
  if (!GOOGLE_MAPS_API_KEY) {
    return res.status(503).json({
      success: false,
      error: 'Google Maps API key not configured',
      message: 'Set GOOGLE_MAPS_API_KEY in the server environment to enable address lookup.'
    })
  }

  const { input } = req.query
  if (!input || String(input).trim().length < 3) {
    return res.json({ success: true, predictions: [] })
  }

  try {
    const response = await axios.post(
      `${GOOGLE_PLACES_NEW_BASE}/places:autocomplete`,
      {
        input: String(input).trim(),
        includedRegionCodes: ['us'],
        includedPrimaryTypes: ['street_address', 'premise', 'subpremise']
      },
      {
        headers: googlePlacesNewHeaders(
          'suggestions.placePrediction.placeId,suggestions.placePrediction.text'
        ),
        timeout: 10000
      }
    )

    const predictions = (response.data?.suggestions || [])
      .map((s) => s.placePrediction)
      .filter(Boolean)
      .map((p) => ({
        description: p.text?.text || '',
        placeId: p.placeId || normalizeGooglePlaceId(p.place)
      }))
      .filter((p) => p.description && p.placeId)

    res.json({ success: true, predictions })
  } catch (error) {
    console.error('Address autocomplete error:', error.message)
    const status = error.response?.status || 500
    const message = googlePlacesNewErrorMessage(
      error.response?.data,
      error.message || 'Address autocomplete failed'
    )
    res.status(status >= 400 && status < 600 ? status : 500).json({
      success: false,
      error: message,
      message
    })
  }
})

app.get('/api/address/details', async (req, res) => {
  if (!GOOGLE_MAPS_API_KEY) {
    return res.status(503).json({ success: false, error: 'Google Maps API key not configured' })
  }

  const { placeId } = req.query
  if (!placeId) {
    return res.status(400).json({ success: false, error: 'placeId is required' })
  }

  try {
    const id = normalizeGooglePlaceId(placeId)
    const response = await axios.get(`${GOOGLE_PLACES_NEW_BASE}/places/${encodeURIComponent(id)}`, {
      headers: googlePlacesNewHeaders('formattedAddress,addressComponents'),
      timeout: 10000
    })

    const result = response.data || {}
    const parsed = parseGoogleAddressComponents(result.addressComponents)
    res.json({
      success: true,
      formattedAddress: result.formattedAddress || '',
      ...parsed
    })
  } catch (error) {
    console.error('Address details error:', error.message)
    const status = error.response?.status || 500
    const message = googlePlacesNewErrorMessage(
      error.response?.data,
      error.message || 'Address details failed'
    )
    res.status(status >= 400 && status < 600 ? status : 500).json({
      success: false,
      error: message,
      message
    })
  }
})

app.get('/api/address/geocode', async (req, res) => {
  if (!GOOGLE_MAPS_API_KEY) {
    return res.status(503).json({ success: false, error: 'Google Maps API key not configured' })
  }

  const { address } = req.query
  if (!address || !String(address).trim()) {
    return res.status(400).json({ success: false, error: 'address is required' })
  }

  try {
    const url = 'https://maps.googleapis.com/maps/api/geocode/json'
    const response = await axios.get(url, {
      params: {
        address: String(address).trim(),
        components: 'country:US',
        key: GOOGLE_MAPS_API_KEY
      },
      timeout: 10000
    })

    const status = response.data?.status
    if (status !== 'OK' || !response.data.results?.length) {
      return res.status(404).json({
        success: false,
        error: response.data?.error_message || status || 'Address not found'
      })
    }

    const top = response.data.results[0]
    const parsed = parseGoogleAddressComponents(top.address_components)
    res.json({
      success: true,
      formattedAddress: top.formatted_address || String(address).trim(),
      ...parsed
    })
  } catch (error) {
    console.error('Address geocode error:', error.message)
    res.status(500).json({ success: false, error: 'Address geocode failed', message: error.message })
  }
})

app.post('/api/manual-order/parse-receipt', async (req, res) => {
  req.setTimeout(180000)
  res.setTimeout(180000)
  try {
    const { mimeType, dataBase64, fileName } = req.body || {}

    if (!mimeType || !dataBase64) {
      return res.status(400).json({
        success: false,
        error: 'mimeType and dataBase64 are required'
      })
    }

    const byteLength = Buffer.byteLength(String(dataBase64), 'base64')
    if (byteLength > 10 * 1024 * 1024) {
      return res.status(400).json({
        success: false,
        error: 'File must be under 10 MB'
      })
    }

    const result = await parseManualOrderReceiptWithAI({
      mimeType,
      dataBase64,
      fileName: fileName || 'receipt'
    })

    if (result.skipped) {
      return res.status(result.reason?.includes('OpenAI') ? 503 : 400).json({
        success: false,
        error: result.reason
      })
    }

    if (!result.success) {
      return res.status(422).json(result)
    }

    res.json(result)
  } catch (error) {
    console.error('Error parsing manual order receipt:', error.message)
    res.status(500).json({
      success: false,
      error: 'Failed to parse receipt',
      message: error.message
    })
  }
})

// Submit manual order to Bevvi after validating products against cache
app.post('/api/manual-order', async (req, res) => {
  try {
    await ensureProductsCacheLoaded()

    const {
      products: lineItems,
      storeName,
      companyName,
      customerName,
      firstName: firstNameInput,
      lastName: lastNameInput,
      email,
      streetAddress,
      city,
      state,
      zip,
      orderDate,
      externalOrderNumber,
      delivery = 0,
      discount = 0,
      engraving = 0,
      salesTax = 0,
      service = 0,
      serviceChargeTax = 0,
      shipping = 0,
      tip = 0
    } = req.body || {}

    if (!Array.isArray(lineItems) || lineItems.length === 0) {
      return res.status(400).json({ success: false, error: 'At least one product is required' })
    }
    if (!storeName || !email || !streetAddress || !city || !state || !zip) {
      return res.status(400).json({
        success: false,
        error: 'storeName, email, streetAddress, city, state, and zip are required'
      })
    }

    const splitName = splitCustomerName(customerName)
    const firstName = (firstNameInput || splitName.firstName || '').trim()
    const lastName = (lastNameInput || splitName.lastName || '').trim()
    if (!firstName) {
      return res.status(400).json({ success: false, error: 'Customer name is required' })
    }

    const matchedProducts = []
    const productErrors = []
    for (let i = 0; i < lineItems.length; i++) {
      const item = lineItems[i] || {}
      const name = String(item.name || '').trim()
      const size = String(item.size || '').trim()
      const quantity = parseInt(item.quantity, 10)
      const price = parseFloat(item.price)
      const effectiveSize = size || parseSizeFromCombinedName(name) || ''

      if (!name || !effectiveSize || !quantity || quantity < 1 || Number.isNaN(price) || price < 0) {
        productErrors.push({ index: i, name, size, message: 'Each product needs name, size, quantity, and price' })
        continue
      }

      const matched = findProductInCache(name, size || effectiveSize)
      if (!matched) {
        productErrors.push({
          index: i,
          name,
          size: size || effectiveSize,
          message: size || effectiveSize
            ? 'Product not found in master list — pick a suggestion that includes bottle size (e.g. 750 ML)'
            : 'Product not found — include size in your search (e.g. "Perrier Jouet Grand Brut 750 ML")'
        })
        continue
      }

      matchedProducts.push({
        name: buildManualOrderProductName(matched),
        price,
        quantity,
        category: matched.category,
        subCategory: matched.subCategory,
        taxCode: resolveStripeTaxCodeForCatalogProduct(matched)
      })
    }

    if (productErrors.length > 0) {
      return res.status(400).json({ success: false, error: 'Product validation failed', productErrors })
    }

    const subTotal = matchedProducts.reduce((sum, p) => sum + p.price * p.quantity, 0)
    const total =
      subTotal +
      parseFloat(delivery || 0) +
      parseFloat(salesTax || 0) +
      parseFloat(service || 0) +
      parseFloat(serviceChargeTax || 0) +
      parseFloat(shipping || 0) +
      parseFloat(tip || 0) +
      parseFloat(engraving || 0) -
      parseFloat(discount || 0)

    const payload = {
      city: String(city).trim(),
      companyName: String(companyName || '').trim(),
      delivery: formatManualOrderMoney(delivery),
      discount: formatManualOrderMoney(discount),
      engraving: formatManualOrderMoney(engraving),
      firstName,
      lastName,
      orderDate: formatManualOrderDate(orderDate),
      externalOrderNumber: String(externalOrderNumber || '').trim(),
      products: JSON.stringify(matchedProducts),
      salesTax: formatManualOrderMoney(salesTax),
      service: formatManualOrderMoney(service),
      serviceChargeTax: formatManualOrderMoney(serviceChargeTax),
      shipping: formatManualOrderMoney(shipping),
      state: String(state).trim(),
      storeName: String(storeName).trim(),
      streetAddress: String(streetAddress).trim(),
      subTotal: formatManualOrderMoney(subTotal),
      tip: formatManualOrderMoney(tip),
      total: formatManualOrderMoney(total),
      zip: String(zip).trim(),
      email: String(email).trim()
    }

    console.log('📤 Submitting manual order:', { storeName: payload.storeName, email: payload.email, products: matchedProducts.length })

    const response = await axios.post('https://api.getbevvi.com/api/shopifyorders/manualOrderAPI', payload, {
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      timeout: 30000
    })

    const orderNumber = extractManualOrderNumber(response.data)

    res.json({
      success: true,
      data: response.data,
      orderNumber,
      orderTotal: total,
      matchedProducts,
      payload
    })
  } catch (error) {
    console.error('Error submitting manual order:', error.message)
    const bevviError = error.response?.data?.error
    const bevviMessage =
      (typeof bevviError === 'object' && bevviError?.message) ||
      error.response?.data?.message ||
      error.message
    const status = error.response?.status || 500
    res.status(status).json({
      success: false,
      error: 'Failed to submit manual order',
      message: bevviMessage,
      details: error.response?.data || null
    })
  }
})

app.get('/api/manual-order/retailer-stripe-account', async (req, res) => {
  try {
    const storeName = String(req.query.storeName || '').trim()
    if (!storeName) {
      return res.status(400).json({
        success: false,
        error: 'storeName query parameter is required'
      })
    }

    if (stripe && !stripeConnectedAccountsCache.loadedAt) {
      await refreshStripeConnectedAccountsCache()
    }

    res.json({
      success: true,
      ...getRetailerStripeAccountInfo(storeName)
    })
  } catch (error) {
    console.error('❌ Error resolving retailer Stripe account:', error.message)
    res.status(500).json({
      success: false,
      error: 'Failed to resolve retailer Stripe account',
      message: error.message
    })
  }
})

app.post('/api/manual-order/calculate-tax', async (req, res) => {
  try {
    await ensureProductsCacheLoaded()

    const {
      products = [],
      streetAddress,
      city,
      state,
      zip,
      country = 'US',
      delivery = 0,
      shipping = 0,
      service = 0,
      engraving = 0,
      tip = 0
    } = req.body || {}

    const matchedProducts = enrichManualOrderProductsForTax(
      Array.isArray(products) ? products : []
    )

    const result = await calculateManualOrderStripeTax({
      matchedProducts,
      streetAddress,
      city,
      state,
      zip,
      country,
      delivery,
      shipping,
      service,
      engraving,
      tip
    })

    if (result.skipped) {
      return res.status(result.reason?.includes('zip') ? 400 : 503).json({
        success: false,
        error: result.reason
      })
    }

    res.json(result)
  } catch (error) {
    console.error('Error calculating manual order tax:', error.message)
    res.status(500).json({
      success: false,
      error: 'Failed to calculate tax',
      message: error.message
    })
  }
})

app.get('/api/manual-order/payment-link', async (req, res) => {
  try {
    const orderNumber = String(req.query.orderNumber || '').trim()
    if (!orderNumber) {
      return res.status(400).json({
        success: false,
        error: 'orderNumber query parameter is required'
      })
    }

    if (!stripe) {
      return res.json({
        success: true,
        configured: false,
        paymentLink: null
      })
    }

    const paymentLink = await getManualOrderPaymentLink(orderNumber)
    res.json({
      success: true,
      configured: true,
      paymentLink
    })
  } catch (error) {
    console.error('❌ Manual order payment link lookup error:', error.message)
    res.status(500).json({
      success: false,
      error: 'Failed to look up payment link',
      message: error.message
    })
  }
})

app.post('/api/manual-order/payment-link', async (req, res) => {
  try {
    const {
      orderNumber,
      email,
      customerName,
      storeName,
      totalAmount,
      matchedProducts,
      streetAddress,
      city,
      state,
      zip,
      salesTax,
      orderTax,
      originalSalesTax,
      taxes,
      delivery,
      shipping,
      service,
      serviceChargeTax,
      networkServiceCharge,
      giftNoteCharge,
      engraving,
      tip,
      discount,
      country,
      regenerate = false
    } = req.body || {}

    if (!email || totalAmount == null) {
      return res.status(400).json({
        success: false,
        error: 'email and totalAmount are required to create a payment link'
      })
    }

    const normalizedOrderNumber = String(orderNumber || '').trim() || null
    const shouldRegenerate = regenerate === true || regenerate === 'true'
    const existingLink =
      !shouldRegenerate && normalizedOrderNumber
        ? await getManualOrderPaymentLink(normalizedOrderNumber)
        : null
    if (existingLink?.url) {
      return res.json({ success: true, paymentLink: existingLink, existing: true })
    }

    if (shouldRegenerate && normalizedOrderNumber) {
      try {
        const store = await readManualOrderPaymentLinks()
        await clearManualOrderPaymentLink(normalizedOrderNumber)
        const archiveActions = await archiveManualOrderStripePaymentResources(
          store[normalizedOrderNumber],
          normalizedOrderNumber
        )
        if (archiveActions.length > 0) {
          console.log('🗑️ Archived previous Stripe payment resources:', {
            orderNumber: normalizedOrderNumber,
            archiveActions
          })
        }
      } catch (error) {
        if (error.code === 'INVOICE_ALREADY_PAID') {
          return res.status(409).json({
            success: false,
            error: error.message
          })
        }
        throw error
      }
    }

    const paymentLink = await createStripePaymentLinkForManualOrder({
      orderNumber: normalizedOrderNumber,
      email: String(email).trim(),
      customerName: String(customerName || '').trim(),
      storeName: String(storeName || '').trim(),
      totalAmount: parseFloat(totalAmount),
      matchedProducts: Array.isArray(matchedProducts) ? matchedProducts : [],
      streetAddress: String(streetAddress || '').trim(),
      city: String(city || '').trim(),
      state: String(state || '').trim(),
      zip: String(zip || '').trim(),
      salesTax,
      orderTax,
      originalSalesTax,
      taxes,
      delivery,
      shipping,
      service,
      serviceChargeTax,
      networkServiceCharge,
      giftNoteCharge,
      engraving,
      tip,
      discount,
      country: String(country || 'US').trim() || 'US'
    })

    if (paymentLink?.skipped) {
      return res.status(400).json({
        success: false,
        error: paymentLink.reason || 'Could not create Stripe invoice'
      })
    }

    if (paymentLink?.url && normalizedOrderNumber) {
      await saveManualOrderPaymentLink(normalizedOrderNumber, paymentLink)
      console.log(
        shouldRegenerate ? '💳 Stripe payment link regenerated:' : '💳 Stripe payment link created:',
        { orderNumber: normalizedOrderNumber, paymentLinkId: paymentLink.paymentLinkId }
      )
    }

    res.json({
      success: true,
      paymentLink,
      regenerated: shouldRegenerate && Boolean(paymentLink?.url)
    })
  } catch (error) {
    console.error('❌ Stripe payment link error:', error.message)
    res.status(500).json({
      success: false,
      error: 'Failed to create Stripe payment link',
      message: error.message
    })
  }
})

async function handleVoidManualOrderPaymentLinkRequest(req, res) {
  try {
    const orderNumber = String(req.query.orderNumber || req.body?.orderNumber || '').trim()
    if (!orderNumber) {
      return res.status(400).json({
        success: false,
        error: 'orderNumber is required to void an invoice'
      })
    }

    if (!stripe) {
      return res.status(503).json({
        success: false,
        error: 'Stripe is not configured on the server'
      })
    }

    const result = await voidManualOrderStripePayment(orderNumber)

    if (result.skipped) {
      return res.status(503).json({
        success: false,
        error: result.reason
      })
    }

    if (!result.voided) {
      return res.status(404).json({
        success: false,
        error: result.message || 'No open Stripe invoice found for this order.'
      })
    }

    console.log('🚫 Voided Stripe invoice:', {
      orderNumber: result.orderNumber,
      invoiceId: result.invoiceId,
      result: result.result
    })

    res.json({
      success: true,
      orderNumber: result.orderNumber,
      invoiceId: result.invoiceId,
      result: result.result,
      archiveActions: result.archiveActions
    })
  } catch (error) {
    console.error('❌ Stripe invoice void error:', error.message)
    if (error.code === 'INVOICE_ALREADY_PAID') {
      return res.status(409).json({
        success: false,
        error: error.message
      })
    }
    res.status(500).json({
      success: false,
      error: 'Failed to void Stripe invoice',
      message: error.message
    })
  }
}

app.post('/api/manual-order/payment-link/void', handleVoidManualOrderPaymentLinkRequest)
app.delete('/api/manual-order/payment-link', handleVoidManualOrderPaymentLinkRequest)

// Add product via UPC enrichment + external API
app.post('/api/products/add-from-upc', async (req, res) => {
  try {
    const { products } = req.body || {}
    if (!Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ error: 'products array is required' })
    }

    const results = []
    for (const product of products) {
      const userFields = normalizeUserFields(product || {})
      const upc = typeof userFields.upc === 'string' ? userFields.upc.trim() : ''
      const name = typeof userFields.name === 'string' ? userFields.name.trim() : ''

      const needsEnrichment = REQUIRED_PRODUCT_FIELDS.some(field => userFields[field] === null || userFields[field] === undefined || (typeof userFields[field] === 'string' && userFields[field].trim() === ''))
      const enriched = needsEnrichment
        ? await enrichProductFromWeb({ upc: upc || null, name: name || null, userFields })
        : userFields
      const payload = {
        ...enriched,
        upc: enriched.upc || upc || null,
        name: enriched.name || name || null
      }

      const missingFields = REQUIRED_PRODUCT_FIELDS.filter(field => {
        const value = payload[field]
        if (value === null || value === undefined) return true
        if (typeof value === 'string' && value.trim() === '') return true
        return false
      })

      if (missingFields.length > 0) {
        results.push({
          success: false,
          upc: payload.upc || null,
          name: payload.name || null,
          error: 'Missing required fields',
          missingFields
        })
        continue
      }

      const { formattedDisplay, ...apiPayload } = payload
      try {
        const response = await axios.post('https://api.getbevvi.com/api/shopifyorders/addProduct', apiPayload, {
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          },
          timeout: 20000
        })

        results.push({
          success: true,
          upc,
          name: payload.name,
          data: response.data
        })
      } catch (error) {
        results.push({
          success: false,
          upc,
          name: payload.name || name || null,
          error: error.response?.data || error.message
        })
      }
    }

    res.json({ success: true, results, searchEnabled: !!SERPAPI_API_KEY })
  } catch (error) {
    console.error('Error adding products from UPC:', error)
    res.status(500).json({ error: 'Failed to add products', message: error.message })
  }
})

// Enrich product via UPC without adding
app.post('/api/products/enrich-from-upc', async (req, res) => {
  try {
    const { products } = req.body || {}
    if (!Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ error: 'products array is required' })
    }

    const results = []
    for (const product of products) {
      const userFields = normalizeUserFields(product || {})
      const upc = typeof userFields.upc === 'string' ? userFields.upc.trim() : ''
      const name = typeof userFields.name === 'string' ? userFields.name.trim() : ''

      const enriched = await enrichProductFromWeb({ upc: upc || null, name: name || null, userFields })
      const payload = {
        ...enriched,
        upc: enriched.upc || upc || null,
        name: enriched.name || name || null
      }

      const missingFields = REQUIRED_PRODUCT_FIELDS.filter(field => {
        const value = payload[field]
        if (value === null || value === undefined) return true
        if (typeof value === 'string' && value.trim() === '') return true
        return false
      })

      const formattedDisplay = await formatProductForDisplayWithAI(payload)

      results.push({
        success: missingFields.length === 0,
        upc: payload.upc || null,
        name: payload.name || null,
        payload: { ...payload, formattedDisplay: formattedDisplay || undefined },
        missingFields
      })
    }

    res.json({ success: true, results })
  } catch (error) {
    console.error('Error enriching products from UPC:', error)
    res.status(500).json({ error: 'Failed to enrich products', message: error.message })
  }
})

// Health check endpoint
app.get('/api/health', (req, res) => {
  const now = new Date()
  const nextRefresh = autoRefreshTimer ? new Date(Date.now() + AUTO_REFRESH_INTERVAL) : null
  const timeUntilNext = nextRefresh ? Math.max(0, nextRefresh.getTime() - now.getTime()) : null
  
  // Format time until next refresh
  let timeUntilNextFormatted = null
  if (timeUntilNext !== null) {
    const minutes = Math.floor(timeUntilNext / (1000 * 60))
    const seconds = Math.floor((timeUntilNext % (1000 * 60)) / 1000)
    timeUntilNextFormatted = `${minutes}m ${seconds}s`
  }
  
  res.json({ 
    status: 'OK', 
    message: 'Bevvi Order Tracking System API is running',
    timestamp: now.toISOString(),
    serverTime: now.toLocaleString(),
    autoRefresh: {
      active: !!autoRefreshTimer,
      interval: `${AUTO_REFRESH_INTERVAL / 60000} minutes`,
      lastRefresh: lastAutoRefreshDate,
      lastRefreshFormatted: lastAutoRefreshDate ? lastAutoRefreshDate.toLocaleString() : null,
      currentRange: lastAutoRefreshRange,
      nextRefresh: nextRefresh,
      nextRefreshFormatted: nextRefresh ? nextRefresh.toLocaleString() : null,
      timeUntilNext: timeUntilNextFormatted
    }
  })
})

// Clear cache endpoint (orders cache removed - endpoint kept for compatibility)
app.post('/api/cache/clear', (req, res) => {
  try {
    console.log(`🧹 Cache clear requested (orders cache disabled - always fetches fresh)`)
    
    res.json({
      success: true,
      message: `Orders cache is disabled - orders are always fetched fresh from the API.`,
      previousSize: 0
    })
  } catch (error) {
    console.error('❌ Error clearing cache:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to clear cache',
      message: error.message
    })
  }
})

// Proxy endpoint for order details API
app.get('/api/order-details/:orderNumber', async (req, res) => {
  try {
    const { orderNumber } = req.params
    console.log('🔍 Proxying order details request for:', orderNumber)
    
    const response = await axios.get(`https://api.getbevvi.com/api/corputil/getOrderInfo?orderNumber=${orderNumber}`, {
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      timeout: 10000
    })
    
    console.log('📊 Order details response status:', response.status)
    console.log('📊 Order details response data:', response.data)

    const data = response.data
    const recipient = Array.isArray(data?.recipientorders) ? data.recipientorders[0] : null
    const externalOrderNumber = String(
      data?.externalOrderNumber || data?.origOrderNumber || recipient?.externalOrderNumber || ''
    ).trim()
    if (externalOrderNumber) {
      data.externalOrderNumber = externalOrderNumber
      if (!String(data.origOrderNumber || '').trim()) {
        data.origOrderNumber = externalOrderNumber
      }
    }

    const isManualOrder =
      /^BEV-MAN-/i.test(String(orderNumber)) ||
      data?.isManualOrder ||
      data?.recipientorders?.[0]?.isManualOrder

    if (isManualOrder && stripe) {
      data.originalSalesTax = data.taxes
      const stripeTaxAmount = await getStripeInvoiceTaxForOrder(orderNumber)
      if (stripeTaxAmount != null) {
        data.taxes = stripeTaxAmount
        data.salesTax = stripeTaxAmount
        data.stripeTaxPopulated = true
      }
    }

    res.json(data)
  } catch (error) {
    console.error('❌ Error proxying order details:', error.message)
    res.status(500).json({
      error: 'Failed to fetch order details',
      message: error.message
    })
  }
})

// Proxy endpoint for GoPuff order status (timeline)
app.get('/api/gopuff/order-status/:orderNumber', async (req, res) => {
  try {
    const { orderNumber } = req.params
    const url = `https://api.getbevvi.com/api/gopuff/getCorpGopuffOrderStatus?corpOrderNum=${encodeURIComponent(orderNumber)}`
    const response = await axios.get(url, {
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      timeout: 10000
    })
    res.json(response.data)
  } catch (error) {
    console.error('❌ Error fetching GoPuff order status:', error.message)
    res.status(500).json({
      error: 'Failed to fetch GoPuff order status',
      message: error.message
    })
  }
})

// GoPuff order checker: validate → preview → submit (proxies Bevmo corp APIs)
function requireOrderNumberQuery(req, res) {
  const raw = req.query.orderNumber
  const orderNumber = raw === undefined || raw === null ? '' : String(raw).trim()
  if (!orderNumber) {
    res.status(400).json({
      error: 'Bad Request',
      message: 'Order number is required'
    })
    return null
  }
  return orderNumber
}

function sendBevmoGoPuffProxyError(res, error, logLabel) {
  console.error(`❌ ${logLabel}:`, error.message, error.response?.status)
  if (error.response) {
    const status = error.response.status
    const data = error.response.data
    let message = `Request failed with status ${status}`
    if (data != null && typeof data === 'object' && !Array.isArray(data)) {
      message =
        data.message ||
        data.error ||
        data.msg ||
        message
      if (Array.isArray(data.errors)) {
        const parts = data.errors.map((e) =>
          typeof e === 'string' ? e : e?.message || JSON.stringify(e)
        )
        if (parts.length) message = parts.join('; ')
      }
    } else if (typeof data === 'string' && data.trim()) {
      message = data.trim()
    }
    return res.status(status).json({
      error: 'Bevmo API error',
      message,
      response: data
    })
  }
  const code = error.code
  if (
    error.request ||
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'ETIMEDOUT' ||
    code === 'ECONNABORTED' ||
    code === 'ECONNRESET'
  ) {
    return res.status(503).json({
      error: 'Service Unavailable',
      message: "Can't reach Bevmo. Try again later."
    })
  }
  return res.status(500).json({
    error: 'Internal Server Error',
    message: error.message || 'An unexpected error occurred'
  })
}

const BEVMO_GOPUFF_JSON_HEADERS = {
  Accept: 'application/json',
  'Content-Type': 'application/json'
}
const BEVMO_GOPUFF_REQUEST_TIMEOUT_MS = 30000

app.get('/api/validate-order', async (req, res) => {
  const orderNumber = requireOrderNumberQuery(req, res)
  if (!orderNumber) return
  try {
    const url = `https://api.getbevvi.com/api/gopuff/validateCorpGoPuffOrder?corpOrderNum=${encodeURIComponent(orderNumber)}`
    const response = await axios.get(url, {
      headers: BEVMO_GOPUFF_JSON_HEADERS,
      timeout: BEVMO_GOPUFF_REQUEST_TIMEOUT_MS
    })
    res.json(response.data)
  } catch (error) {
    sendBevmoGoPuffProxyError(res, error, 'validate-order')
  }
})

app.get('/api/preview-order', async (req, res) => {
  const orderNumber = requireOrderNumberQuery(req, res)
  if (!orderNumber) return
  try {
    const url = `https://api.getbevvi.com/api/gopuff/previewCorpOrderToGoPuff?orderNumber=${encodeURIComponent(orderNumber)}`
    const response = await axios.get(url, {
      headers: BEVMO_GOPUFF_JSON_HEADERS,
      timeout: BEVMO_GOPUFF_REQUEST_TIMEOUT_MS
    })
    res.json(response.data)
  } catch (error) {
    sendBevmoGoPuffProxyError(res, error, 'preview-order')
  }
})

app.get('/api/submit-order', async (req, res) => {
  const orderNumber = requireOrderNumberQuery(req, res)
  if (!orderNumber) return
  try {
    const url = `https://api.getbevvi.com/api/gopuff/sendCorpOrderToGoPuff?corpOrderNum=${encodeURIComponent(orderNumber)}`
    const response = await axios.get(url, {
      headers: BEVMO_GOPUFF_JSON_HEADERS,
      timeout: BEVMO_GOPUFF_REQUEST_TIMEOUT_MS
    })
    res.json(response.data)
  } catch (error) {
    sendBevmoGoPuffProxyError(res, error, 'submit-order')
  }
})

app.get('/api/resend-order', async (req, res) => {
  const orderNumber = requireOrderNumberQuery(req, res)
  if (!orderNumber) return
  try {
    const url = `https://api.getbevvi.com/api/gopuff/resendCorpOrderToGoPuff?corpOrderNum=${encodeURIComponent(orderNumber)}`
    const response = await axios.get(url, {
      headers: BEVMO_GOPUFF_JSON_HEADERS,
      timeout: BEVMO_GOPUFF_REQUEST_TIMEOUT_MS
    })
    res.json(response.data)
  } catch (error) {
    sendBevmoGoPuffProxyError(res, error, 'resend-order')
  }
})

// Proxy endpoint for stores API
// CRITICAL: This route MUST be defined before any static middleware or catch-all routes
app.get('/api/stores', async (req, res) => {
  // Immediately set JSON content type to prevent any middleware from changing it
  res.setHeader('Content-Type', 'application/json')
  
  try {
    console.log('🔍 /api/stores route handler EXECUTED - Route handler hit!')
    console.log('🔍 Request path:', req.path)
    console.log('🔍 Request URL:', req.url)
    console.log('🔍 Request method:', req.method)
    
    const response = await axios.get('https://api.getbevvi.com/api/corputil/getStoresAsJSON', {
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      timeout: 10000
    })
    
    const storesList = normalizeStoresFromApi(response.data)
    console.log('📊 Stores response status:', response.status)
    console.log('📊 Stores loaded:', storesList.length, 'stores')
    
    res.json({ results: storesList })
  } catch (error) {
    console.error('❌ Error proxying stores:', error.message)
    console.error('❌ Error stack:', error.stack)
    res.status(500).json({
      error: 'Failed to fetch stores',
      message: error.message
    })
  }
})

// Asana API helper functions
// Helper to generate Asana task URL from task GID
function getAsanaTaskUrl(taskGid) {
  return `https://app.asana.com/0/0/${taskGid}`
}

// Helper to determine project GID based on customer name
function getProjectGidForCustomer(customerName) {
  if (!customerName) {
    // Default to Bevvi project if no customer name
    return process.env.ASANA_PROJECT_GID || null
  }
  
  const customerLower = customerName.toLowerCase().trim()
  
  // Map customer names to project GIDs
  // Reachdesk orders → Reachdesk - Issue Tracking
  if (customerLower.includes('reachdesk')) {
    return '1203929818315927' // Reachdesk - Issue Tracking
  }
  
  // OnGoody orders → Goody - Issue Tracking
  if (customerLower.includes('ongoody') || customerLower.includes('goody')) {
    return '1203911426248815' // Goody - Issue Tracking
  }
  
  // Sendoso orders → Corp Orders - Issue Tracking
  if (customerLower.includes('sendoso')) {
    return '1203948231536518' // Corp Orders - Issue Tracking
  }
  
  // Default to Bevvi project for all other customers
  return process.env.ASANA_PROJECT_GID || null
}

// Helper to build comprehensive order notes
function buildOrderNotes(orderNumber, orderData) {
  let notes = `Order: ${orderNumber}\n`
  notes += `Customer: ${orderData.customerName || 'N/A'}\n`
  notes += `Status: ${orderData.status || 'N/A'}\n`
  notes += `Total: $${orderData.total || 0}\n`
  
  if (orderData.orderDate) {
    notes += `Order Date: ${orderData.orderDate}\n`
  }
  if (orderData.deliveryDate && orderData.deliveryDate !== 'N/A') {
    notes += `Delivery Date: ${orderData.deliveryDate}\n`
  }
  if (orderData.establishment) {
    notes += `Establishment: ${orderData.establishment}\n`
  }
  if (orderData.address) {
    notes += `Address: ${orderData.address}\n`
  }
  
  notes += `\n---\n\n`
  return notes
}

// Improved task search with pagination support
async function searchAsanaTask(orderNumber, projectGid, workspaceGid, headers, asanaApiUrl) {
  // Search for tasks with just the order number (no "Order " prefix)
  // Also check for old format "Order <number>" for backward compatibility
  const taskName = orderNumber
  const oldTaskName = `Order ${orderNumber}`
  let allTasks = []
  let offset = null
  
  try {
    if (projectGid) {
      // Search in project with pagination
      do {
        let url = `${asanaApiUrl}/projects/${projectGid}/tasks?opt_fields=gid,name,notes&limit=100`
        if (offset) {
          url += `&offset=${offset}`
        }
        
        const response = await axios.get(url, { headers, timeout: 10000 })
        const tasks = response.data.data || []
        allTasks = allTasks.concat(tasks)
        
        // Check for pagination
        offset = response.data.next_page?.offset || null
      } while (offset)
    } else {
      // Search in workspace with pagination
      do {
        let url = `${asanaApiUrl}/tasks?workspace=${workspaceGid}&opt_fields=gid,name,notes&limit=100`
        if (offset) {
          url += `&offset=${offset}`
        }
        
        const response = await axios.get(url, { headers, timeout: 10000 })
        const tasks = response.data.data || []
        allTasks = allTasks.concat(tasks)
        
        // Check for pagination
        offset = response.data.next_page?.offset || null
      } while (offset)
    }
    
    // Find matching task (check both new format and old format for backward compatibility)
    const existingTask = allTasks.find(task => 
      task.name === taskName || task.name === oldTaskName || task.name.includes(orderNumber)
    )
    
    return existingTask ? existingTask.gid : null
  } catch (error) {
    console.log(`⚠️ Error searching for task: ${error.message}`)
    return null
  }
}

// Find Asana task (search only, don't create)
async function findAsanaTask(orderNumber, orderData = {}) {
  try {
    if (!process.env.ASANA_ACCESS_TOKEN || !process.env.ASANA_WORKSPACE_GID) {
      return null // Return null instead of throwing, so we can handle gracefully
    }

    const asanaApiUrl = 'https://app.asana.com/api/1.0'
    const headers = {
      'Authorization': `Bearer ${process.env.ASANA_ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    }

    // Determine project based on customer name
    const projectGid = getProjectGidForCustomer(orderData.customerName)
    const workspaceGid = process.env.ASANA_WORKSPACE_GID

    // Search for existing task only (no creation)
    // First try the customer-specific project, then fallback to workspace search
    let existingTaskGid = await searchAsanaTask(orderNumber, projectGid, workspaceGid, headers, asanaApiUrl)
    
    // If not found in customer-specific project, search entire workspace
    if (!existingTaskGid && projectGid) {
      console.log(`ℹ️  Task not found in customer project, searching entire workspace...`)
      existingTaskGid = await searchAsanaTask(orderNumber, null, workspaceGid, headers, asanaApiUrl)
    }
    
    if (existingTaskGid) {
      console.log(`✅ Found existing Asana task for order ${orderNumber}`)
      return existingTaskGid
    }

    // Task not found - return null (don't create)
    console.log(`ℹ️  No Asana task found for order ${orderNumber} (not creating)`)
    return null
  } catch (error) {
    console.error('❌ Error finding Asana task:', error.message)
    return null // Return null on error instead of throwing
  }
}

async function findOrCreateAsanaTask(orderNumber, orderData) {
  try {
    if (!process.env.ASANA_ACCESS_TOKEN || !process.env.ASANA_WORKSPACE_GID) {
      throw new Error('Asana configuration missing. Please set ASANA_ACCESS_TOKEN and ASANA_WORKSPACE_GID in your .env file.')
    }

    const asanaApiUrl = 'https://app.asana.com/api/1.0'
    const headers = {
      'Authorization': `Bearer ${process.env.ASANA_ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    }

    // Use just the order number as task name (no "Order " prefix)
    const taskName = orderNumber
    
    // Determine project based on customer name
    const projectGid = getProjectGidForCustomer(orderData?.customerName)
    const workspaceGid = process.env.ASANA_WORKSPACE_GID
    
    const customerName = orderData?.customerName || 'Unknown'
    const projectName = projectGid === '1203929818315927' ? 'Reachdesk - Issue Tracking' :
                       projectGid === '1203911426248815' ? 'Goody - Issue Tracking' :
                       projectGid === '1203948231536518' ? 'Corp Orders - Issue Tracking' :
                       projectGid ? 'Bevvi' : 'Workspace (no project)'
    
    console.log(`🔍 Searching for task: ${orderNumber}, Customer: ${customerName}, Project: ${projectName}`)

    // Search for existing task - first in customer-specific project, then entire workspace
    let existingTaskGid = await searchAsanaTask(orderNumber, projectGid, workspaceGid, headers, asanaApiUrl)
    
    // If not found in customer-specific project, search entire workspace
    if (!existingTaskGid && projectGid) {
      console.log(`ℹ️  Task not found in customer project, searching entire workspace...`)
      existingTaskGid = await searchAsanaTask(orderNumber, null, workspaceGid, headers, asanaApiUrl)
    }
    
    if (existingTaskGid) {
      console.log(`✅ Found existing Asana task for order ${orderNumber}`)
      return existingTaskGid
    }

    // Create new task if not found
    console.log(`📝 Creating new Asana task: ${orderNumber} in project: ${projectName}`)
    const orderNotes = buildOrderNotes(orderNumber, orderData || {})
    
    const taskData = {
      data: {
        name: taskName,
        notes: orderNotes,
        workspace: workspaceGid
      }
    }

    if (projectGid) {
      taskData.data.projects = [projectGid]
    }

    const createResponse = await axios.post(`${asanaApiUrl}/tasks`, taskData, { headers, timeout: 10000 })
    const newTaskGid = createResponse.data.data.gid
    console.log(`✅ Created new Asana task ${newTaskGid} for order ${orderNumber}`)
    return newTaskGid
  } catch (error) {
    console.error('❌ Error finding/creating Asana task:', error.message)
    if (error.response) {
      console.error('Asana API error details:', error.response.data)
    }
    throw error
  }
}

// Get comments from Asana for an order
app.get('/api/orders/:orderNumber/comments', async (req, res) => {
  try {
    const { orderNumber } = req.params
    const { customerName } = req.query
    
    if (!process.env.ASANA_ACCESS_TOKEN) {
      return res.status(500).json({
        success: false,
        error: 'Asana not configured',
        message: 'ASANA_ACCESS_TOKEN is not set in environment variables.'
      })
    }

    const orderData = customerName ? { customerName } : {}
    const taskGid = await findAsanaTask(orderNumber, orderData)
    
    if (!taskGid) {
      return res.json({
        success: true,
        comments: [],
        taskExists: false
      })
    }
    
    const asanaApiUrl = 'https://app.asana.com/api/1.0'
    const headers = {
      'Authorization': `Bearer ${process.env.ASANA_ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    }

    // Get stories (which includes comments)
    const storiesResponse = await axios.get(
      `${asanaApiUrl}/tasks/${taskGid}/stories?opt_fields=type,text,created_at,created_by`,
      { headers, timeout: 10000 }
    )

    const stories = storiesResponse.data.data || []
    
    // Filter for comments only (type === 'comment')
    const comments = stories
      .filter(story => story.type === 'comment')
      .map(story => ({
        id: story.gid,
        text: story.text || '',
        createdAt: story.created_at,
        createdBy: story.created_by?.name || 'Unknown',
        createdByEmail: story.created_by?.email || null
      }))
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)) // Sort by date, oldest first

    res.json({
      success: true,
      comments: comments,
      taskGid: taskGid,
      taskExists: true
    })
  } catch (error) {
    console.error('❌ Error fetching comments from Asana:', error.message)
    const errorMessage = error.response?.data?.errors?.[0]?.message || error.message
    res.status(500).json({
      success: false,
      error: 'Failed to fetch comments from Asana',
      message: errorMessage || 'An error occurred while fetching comments from Asana.'
    })
  }
})

// Get notes from Asana for an order (read-only, doesn't create tasks)
app.get('/api/orders/:orderNumber/notes', async (req, res) => {
  try {
    const { orderNumber } = req.params
    const { customerName } = req.query // Optional customer name from query params
    
    if (!process.env.ASANA_ACCESS_TOKEN) {
      return res.status(500).json({
        success: false,
        error: 'Asana not configured',
        message: 'ASANA_ACCESS_TOKEN is not set in environment variables. Please configure Asana in your .env file.'
      })
    }

    const orderNumberFromParam = orderNumber
    // Use customer name from query params if provided (for project-specific search)
    const orderData = customerName ? { customerName } : {}
    const taskGid = await findAsanaTask(orderNumberFromParam, orderData)
    
    // If no task exists, return empty notes (don't create task)
    if (!taskGid) {
      return res.json({
        success: true,
        notes: '',
        taskGid: null,
        taskUrl: null,
        lastModified: null,
        createdAt: null,
        completed: false,
        taskExists: false
      })
    }
    
    const asanaApiUrl = 'https://app.asana.com/api/1.0'
    const headers = {
      'Authorization': `Bearer ${process.env.ASANA_ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    }

    // Get task details including notes
    const taskResponse = await axios.get(
      `${asanaApiUrl}/tasks/${taskGid}?opt_fields=name,notes,created_at,modified_at,completed`,
      { headers, timeout: 10000 }
    )

    const task = taskResponse.data.data
    
    // Extract notes (remove the order info header if present)
    let notes = task.notes || ''
    // Remove order info header (everything before the --- separator)
    // The separator is '\n\n---\n\n' (two newlines before ---)
    const separatorPattern = '\n\n---\n\n'
    const separatorIndex = notes.indexOf(separatorPattern)
    if (separatorIndex !== -1) {
      // +7 is correct: '\n\n---\n\n' = 7 characters (\n\n---\n\n)
      notes = notes.substring(separatorIndex + separatorPattern.length).trim()
    } else {
      // Fallback: try single newline before ---
      const altSeparator = '\n---\n\n'
      const altIndex = notes.indexOf(altSeparator)
      if (altIndex !== -1) {
        notes = notes.substring(altIndex + 7).trim()
      } else {
        // Fallback: try to find where order info ends
        // Look for pattern: Order: ... \n\n (followed by user notes)
        const orderInfoMatch = notes.match(/Order:.*?\n\n(.*)/s)
        if (orderInfoMatch && orderInfoMatch[1]) {
          notes = orderInfoMatch[1].trim()
        } else if (notes.startsWith('Order:')) {
          // If it starts with Order: but no match, try to find first double newline
          const doubleNewlineIndex = notes.indexOf('\n\n')
          if (doubleNewlineIndex !== -1) {
            notes = notes.substring(doubleNewlineIndex + 2).trim()
          }
        }
      }
    }

    res.json({
      success: true,
      notes: notes,
      taskGid: taskGid,
      taskUrl: getAsanaTaskUrl(taskGid),
      lastModified: task.modified_at,
      createdAt: task.created_at,
      completed: task.completed || false,
      taskExists: true
    })
  } catch (error) {
    console.error('❌ Error fetching notes from Asana:', error.message)
    const errorMessage = error.response?.data?.errors?.[0]?.message || error.message
    res.status(500).json({
      success: false,
      error: 'Failed to fetch notes from Asana',
      message: errorMessage || 'An error occurred while fetching notes from Asana. Please check your Asana configuration.'
    })
  }
})

// Get Asana task details and URL for an order (read-only, doesn't create tasks)
app.get('/api/orders/:orderNumber/asana-task', async (req, res) => {
  try {
    const { orderNumber } = req.params
    const { customerName } = req.query // Optional customer name from query params
    
    if (!process.env.ASANA_ACCESS_TOKEN) {
      return res.status(500).json({
        success: false,
        error: 'Asana not configured',
        message: 'ASANA_ACCESS_TOKEN is not set in environment variables'
      })
    }

    // Use customer name from query params if provided (for project-specific search)
    const orderData = customerName ? { customerName } : {}
    const taskGid = await findAsanaTask(orderNumber, orderData)
    
    // If no task exists, return null values
    if (!taskGid) {
      return res.json({
        success: true,
        taskGid: null,
        taskUrl: null,
        taskName: null,
        completed: false,
        assignee: null,
        assigneeStatus: null,
        createdAt: null,
        lastModified: null,
        taskExists: false
      })
    }
    
    const taskUrl = getAsanaTaskUrl(taskGid)
    
    const asanaApiUrl = 'https://app.asana.com/api/1.0'
    const headers = {
      'Authorization': `Bearer ${process.env.ASANA_ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    }

    // Get task details
    const taskResponse = await axios.get(
      `${asanaApiUrl}/tasks/${taskGid}?opt_fields=name,notes,created_at,modified_at,completed,assignee,assignee_status`,
      { headers, timeout: 10000 }
    )

    const task = taskResponse.data.data

    res.json({
      success: true,
      taskGid: taskGid,
      taskUrl: taskUrl,
      taskName: task.name,
      completed: task.completed || false,
      assignee: task.assignee || null,
      assigneeStatus: task.assignee_status || null,
      createdAt: task.created_at,
      lastModified: task.modified_at,
      taskExists: true
    })
  } catch (error) {
    console.error('❌ Error fetching Asana task details:', error.message)
    res.status(500).json({
      success: false,
      error: 'Failed to fetch Asana task details',
      message: error.message
    })
  }
})

// Save notes to Asana for an order
app.post('/api/orders/:orderNumber/notes', async (req, res) => {
  try {
    const { orderNumber } = req.params
    const { notes, orderData } = req.body
    
    if (!process.env.ASANA_ACCESS_TOKEN) {
      return res.status(500).json({
        success: false,
        error: 'Asana not configured',
        message: 'ASANA_ACCESS_TOKEN is not set in environment variables. Please configure Asana in your .env file.'
      })
    }

    const orderNumberFromParam = orderNumber
    const taskGid = await findOrCreateAsanaTask(orderNumberFromParam, orderData || {})
    
    const asanaApiUrl = 'https://app.asana.com/api/1.0'
    const headers = {
      'Authorization': `Bearer ${process.env.ASANA_ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    }

    // Build notes content with order info header
    // Format: Order info followed by separator, then user notes
    const orderInfo = buildOrderNotes(orderNumber, orderData || {})
    
    // Combine order info with user notes (remove any existing order info to avoid duplication)
    let userNotes = notes || ''
    // Remove any existing order info header from user notes (everything before ---)
    const separatorIndex = userNotes.indexOf('\n---\n\n')
    if (separatorIndex !== -1) {
      userNotes = userNotes.substring(separatorIndex + 7).trim()
    } else {
      // Fallback: remove order info pattern
      userNotes = userNotes.replace(/^Order:.*?\n\n/s, '').trim()
    }
    
    const fullNotes = orderInfo + userNotes

    // Update task notes
    await axios.put(
      `${asanaApiUrl}/tasks/${taskGid}`,
      {
        data: {
          notes: fullNotes
        }
      },
      { headers, timeout: 10000 }
    )

    res.json({
      success: true,
      message: 'Notes saved to Asana successfully',
      taskGid: taskGid,
      taskUrl: getAsanaTaskUrl(taskGid)
    })
  } catch (error) {
    console.error('❌ Error saving notes to Asana:', error.message)
    const errorMessage = error.response?.data?.errors?.[0]?.message || error.message
    res.status(500).json({
      success: false,
      error: 'Failed to save notes to Asana',
      message: errorMessage || 'An error occurred while saving notes to Asana. Please check your Asana configuration.'
    })
  }
})

// AI Prompt Parsing endpoint using GPT-4o-mini
app.post('/api/parse-prompt', async (req, res) => {
  try {
    const { prompt, context } = req.body
    
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({
        error: 'Prompt is required and must be a string'
      })
    }
    
    // Check if OpenAI API key is configured
    if (!process.env.OPENAI_API_KEY) {
      console.error('⚠️ OPENAI_API_KEY not configured')
      return res.status(500).json({
        error: 'OpenAI API key not configured',
        fallback: true
      })
    }
    
    console.log('🤖 Parsing prompt with GPT-4o-mini:', prompt)
    if (context) {
      console.log('💬 Conversation context:', context)
    }
    
    // Build context string for GPT
    let contextString = ''
    if (context) {
      const contextParts = []
      if (context.lastCustomer) contextParts.push(`Last customer mentioned: ${context.lastCustomer}`)
      if (context.lastDateRange) contextParts.push(`Last date range: ${context.lastDateRange.startDate} to ${context.lastDateRange.endDate}`)
      if (context.lastIntent) contextParts.push(`Last query type: ${context.lastIntent}`)
      if (context.lastRetailer) contextParts.push(`Last retailer mentioned: ${context.lastRetailer}`)
      if (context.lastBrand) contextParts.push(`Last brand mentioned: ${context.lastBrand}`)
      if (context.lastQuery) contextParts.push(`Last query: "${context.lastQuery}"`)
      
      if (contextParts.length > 0) {
        contextString = `\n\nCONVERSATION CONTEXT (for follow-up queries):\n${contextParts.join('\n')}\n\nIf the current query is a follow-up (e.g., "what about last month?", "show me more details", "what's the revenue?") and doesn't specify certain fields, use the context values:\n- If no customer is mentioned, use lastCustomer from context\n- If no date range is mentioned, use lastDateRange from context\n- If no retailer is mentioned but context has lastRetailer, use it\n- If no brand is mentioned but context has lastBrand, use it\n`
      }
    }
    
    const systemPrompt = `You are an AI assistant that parses natural language queries about order data into structured JSON.

Today's date is ${new Date().toISOString().split('T')[0]}.${contextString}

Extract the following information from the user's query:
- intent: The type of query. Choose from:
  * revenue: asking about TOTAL revenue/sales amounts for a period (e.g., "revenue for Nov", "revenue for Oct 2025")
  * tax: asking about tax amounts
  * service_charge: asking about service charge amounts (NOT tips or delivery)
  * tip: asking about tip/gratuity amounts
  * delivery_charge: asking about delivery fee/charge amounts (shipping fee, delivery fee)
  * delayed_orders: specifically asking for DELAYED orders
  * pending_orders: specifically asking for PENDING STATUS orders (must mention "pending")
  * delivered_orders: specifically asking for DELIVERED STATUS orders (must mention "delivered")
  * accepted_orders: specifically asking for ACCEPTED STATUS orders (e.g., "show me all accepted orders", "list accepted orders", "see the accepted orders")
  * not_delivered_orders: asking for orders that have NOT been delivered (e.g., "show me all orders that have not been delivered", "orders that haven't been delivered", "undelivered orders"). This should include orders with status "accepted" or "pending", but NOT "delivered".
  * total_orders: asking for ALL orders, order count, transactions, or "orders placed today/this week" (general order queries). Also includes "show me all orders from [customer]", "orders from [customer]", "list orders for [customer]", "show me all transactions for [customer]", "transactions for [customer]"
  * order_status_check: asking to validate/check order statuses (e.g., "are all orders accepted", "are any orders pending", "how many rejected", "check order statuses", "order status summary", "what's the status breakdown")
  * average_order_value: asking for AOV or average
  * aov_by_retailer: asking for AOV filtered by a specific retailer/store (e.g., "AOV for Liquor Master", "average order value from retailer [name]", "show me the AOV for all orders in Dec from retailer Liquor Master")
  * total_transactions_by_retailer: asking for total transaction count filtered by a specific retailer/store (e.g., "total transactions from Liquor Master", "how many orders from retailer [name]", "show me the total transactions in Dec from retailer Liquor Master")
  * revenue_by_retailer: asking for total revenue or total value filtered by a specific retailer/store (e.g., "revenue from Liquor Master", "total revenue from retailer [name]", "total value of transactions for retailer [name]", "show me the Total Revenue for all orders in Dec from retailer Liquor Master")
  * revenue_by_month: ONLY use when explicitly asking for BREAKDOWN by month (e.g., "revenue by month", "breakdown by month")
  * revenue_by_customer: asking for revenue for a specific customer
  * revenue_by_brand: asking for revenue breakdown by PRODUCT BRAND (e.g., "revenue by brand", "top brands", "which brands sell the most", "top brands sold in Dec 2025", "brand performance") - actual liquor brands like Tito's, Grey Goose, etc.
  * revenue_by_store: asking for revenue breakdown by store/retailer/establishment (e.g., "revenue by store", "top stores", "which retailers make the most", "revenue by retailer")
  * customers_by_brand: asking which customers bought/ordered/purchased a specific brand (e.g., "which customers bought Schrader", "who ordered Dom Perignon", "which customers purchased Tito's", "who bought Macallan")
  * delayed_orders_by_customer: asking for delayed orders for a specific customer
  * tax_by_state: asking for tax breakdown by state (e.g., "tax by state for Oct")
  * sales_by_state: asking for sales/revenue breakdown by state (e.g., "sales by state for Nov")
  * add_product: add product(s) using UPC and product name (e.g., "add product 012345678905 name Tito's Vodka")
  * unknown: if the query is NOT about orders, revenue, tax, tips, delivery, or customer data (e.g., weather, personal questions, unrelated topics)
  
- customer: Customer name if mentioned (Sendoso, OnGoody, Air Culinaire, Air Culinaire Worldwide, Vistajet, VistaJet, etc.). Always extract full company name, not partial words. Extract customer names from phrases like "orders from [customer]", "orders for [customer]", "orders of [customer]", "revenue from [customer]", "revenue for [month] for [customer]". For queries like "revenue for Oct for Air Culinaire" or "show me all orders of Vistajet in Dec 2025", extract the full customer name. Note: "Vistajet" and "VistaJet" refer to the same customer - extract as "Vistajet" or "VistaJet" based on what appears in the query.
- brand: Brand name if mentioned (Schrader, Dom Perignon, Tito's, Grey Goose, etc.). Extract the full brand name.
- retailer: Retailer/store/establishment name if mentioned (e.g., "Liquor Master", "Wine & Spirits Market", "Freshco", etc.). Extract from phrases like "from retailer [name]", "from store [name]", "from [retailer name]". Extract the full retailer name.
- products: Array of objects with { upc, name } when intent is add_product. Extract UPCs (8-14 digits) and product name(s). If one name applies to all UPCs, repeat it. If name is missing, set needsClarification true and clarificationNeeded to "product_name".
- startDate: Start date in YYYY-MM-DD format
- endDate: End date in YYYY-MM-DD format
- isMTD: Boolean, true if asking for "month to date" or "this month so far"
- needsClarification: Boolean, true if the query is too open-ended and needs more information
- clarificationNeeded: String indicating what's missing - "date_range" if no date/timeframe specified, "customer_name" if asking about a customer but not specifying which one, "brand_name" if asking about a brand but not specifying which one, "product_upc" if add_product without UPC, "product_name" if add_product without name

Important: 
- Customer names should be exact - "Sendoso" not "sendoso in", "Air Culinaire" not "air", "Vistajet" not "vista", etc.
- "show me orders", "orders placed today", "how many orders" = total_orders intent (NOT pending_orders)
- "show me all orders from Vistajet", "orders from Sendoso", "list orders for Air Culinaire" = total_orders intent WITH customer extracted
- "show me pending orders", "pending status" = pending_orders intent
- If intent is add_product and UPC is missing, set needsClarification to true and clarificationNeeded to "product_upc"
- If intent is add_product and name is missing, set needsClarification to true and clarificationNeeded to "product_name"
- If a query asks for orders, revenue, tax, etc. WITHOUT specifying any timeframe (no "today", "this month", specific month, etc.), set needsClarification to true and clarificationNeeded to "date_range"
- Queries like "show me all orders", "what's the revenue", "how much tax" without dates = needsClarification: true
- EXCEPTION: Status-specific queries (accepted_orders, pending_orders, delivered_orders, delayed_orders, not_delivered_orders) do NOT need clarification even without dates - they can use current loaded data
- "show me all accepted orders", "list pending orders", "show me orders that have not been delivered" = NO clarification needed, process immediately

FOLLOW-UP QUERIES:
- If the query is a follow-up (e.g., "what about last month?", "show me more details", "what's the revenue?", "how about Sendoso?") and doesn't specify certain fields, use the context values:
  * If no customer is mentioned but context has lastCustomer, use it
  * If no date range is mentioned but context has lastDateRange, use it (unless query explicitly asks for a different period like "last month")
  * If no retailer is mentioned but context has lastRetailer, use it
  * If no brand is mentioned but context has lastBrand, use it
- Examples of follow-up queries: "what about last month?", "show me more details", "what's the revenue?", "how about Sendoso?", "and what about Oct?", "also show me"
- When a follow-up query mentions a different period (e.g., "what about last month?"), use that period but keep other context (customer, retailer, brand) if not mentioned

Date parsing rules:
- "today", "for today" = today's date for both start and end date
- "this week" = current week Sunday through Saturday (from this week's Sunday to this week's Saturday)
- "last week" = previous week Sunday through Saturday. Calculate: Find this week's Sunday, then go back 7 days to get last week's Sunday. Last week's Saturday is 6 days after last week's Sunday. Example: If today is Saturday Jan 3, 2026, last week is Sunday Dec 21, 2025 to Saturday Dec 28, 2025.
- "this month", "this month so far", "MTD", "month to date" = first day of current month to today
- "last month" = full previous month (1st to last day)
- "YTD", "year to date", "this year" = January 1st of current year to today
- "October 2025", "Oct 2025" = 2025-10-01 to 2025-10-31 (explicit year)
- "October", "Oct" (no year) = Use smart default: if month is more than 2 months in the future relative to current month, use previous year; otherwise use current year. Then apply MTD logic if end date is in the future.
- "Aug - Dec 2025", "August to December 2025", "Aug-Dec 2025" = 2025-08-01 to 2025-12-31 (month range)
- "Aug - Dec" (no year) = Use current year (or previous year if range would be in future)
- If end date is in the future, set it to today (MTD logic)

Return ONLY valid JSON, no explanation. Format:
{
  "intent": "revenue",
  "customer": "Sendoso",
  "brand": "Schrader",
  "startDate": "2025-10-01",
  "endDate": "2025-10-31",
  "isMTD": false,
  "needsClarification": false,
  "clarificationNeeded": null
}

If customer is not mentioned, omit the "customer" field.
If intent is add_product, include "products" array.
If brand is not mentioned, omit the "brand" field.
If retailer is not mentioned, omit the "retailer" field.
If no clarification needed, omit "clarificationNeeded" field or set to null.`

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
      ],
      temperature: 0.1, // Low temperature for consistent parsing
      max_tokens: 150, // Keep output small to reduce costs
      response_format: { type: 'json_object' }
    })
    
    const parsedData = JSON.parse(completion.choices[0].message.content)
    
    console.log('✅ Parsed result:', parsedData)
    console.log('📊 Tokens used:', {
      prompt: completion.usage.prompt_tokens,
      completion: completion.usage.completion_tokens,
      total: completion.usage.total_tokens,
      estimatedCost: `$${((completion.usage.prompt_tokens * 0.15 + completion.usage.completion_tokens * 0.60) / 1000000).toFixed(6)}`
    })
    
    res.json({
      success: true,
      parsed: parsedData,
      usage: {
        promptTokens: completion.usage.prompt_tokens,
        completionTokens: completion.usage.completion_tokens,
        totalTokens: completion.usage.total_tokens
      }
    })
    
  } catch (error) {
    console.error('❌ Error parsing prompt:', error)
    res.status(500).json({
      error: 'Failed to parse prompt',
      message: error.message,
      fallback: true
    })
  }
})

// Auto-refresh control endpoints
app.post('/api/auto-refresh/start', (req, res) => {
  const { startDate, endDate, timeZone: timeZoneBody } = req.body
  const refreshTz = resolveOrderTimeZone(timeZoneBody)
  
  if (!startDate || !endDate) {
    return res.status(400).json({
      error: 'Start date and end date are required'
    })
  }

  const dateRangeError = validateOrderDateRange(startDate, endDate)
  if (dateRangeError) {
    return res.status(400).json({
      success: false,
      error: 'Invalid date range',
      message: dateRangeError,
      dateRange: { startDate, endDate },
      maxDays: MAX_ORDER_DATE_RANGE_DAYS
    })
  }
  
  updateAutoRefreshRange(startDate, endDate, refreshTz)
  startAutoRefresh()
  
  res.json({
    success: true,
    message: 'Auto-refresh started',
    interval: `${AUTO_REFRESH_INTERVAL / 60000} minutes`,
    dateRange: { startDate, endDate, timeZone: refreshTz }
  })
})

app.post('/api/auto-refresh/stop', (req, res) => {
  stopAutoRefresh()
  res.json({
    success: true,
    message: 'Auto-refresh stopped'
  })
})

app.get('/api/auto-refresh/status', (req, res) => {
  const now = new Date()
  const nextRefresh = autoRefreshTimer ? new Date(Date.now() + AUTO_REFRESH_INTERVAL) : null
  const timeUntilNext = nextRefresh ? Math.max(0, nextRefresh.getTime() - now.getTime()) : null
  
  // Format time until next refresh
  let timeUntilNextFormatted = null
  if (timeUntilNext !== null) {
    const minutes = Math.floor(timeUntilNext / (1000 * 60))
    const seconds = Math.floor((timeUntilNext % (1000 * 60)) / 1000)
    timeUntilNextFormatted = `${minutes}m ${seconds}s`
  }
  
  res.json({
    active: !!autoRefreshTimer,
    interval: `${AUTO_REFRESH_INTERVAL / 60000} minutes`,
    lastRefresh: lastAutoRefreshDate,
    lastRefreshFormatted: lastAutoRefreshDate ? lastAutoRefreshDate.toLocaleString() : null,
    currentRange: lastAutoRefreshRange,
    nextRefresh: nextRefresh,
    nextRefreshFormatted: nextRefresh ? nextRefresh.toLocaleString() : null,
    timeUntilNext: timeUntilNextFormatted,
    serverTime: now.toLocaleString(),
    serverTimeISO: now.toISOString()
  })
})

// Server-Sent Events endpoint for real-time updates
app.get('/api/events', (req, res) => {
  // Set headers for SSE
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control'
  })
  
  // Send initial connection message
  res.write(`data: ${JSON.stringify({
    type: 'connected',
    message: 'Connected to real-time updates',
    timestamp: new Date().toISOString()
  })}\n\n`)
  
  // Create client object with unique ID
  const client = {
    id: Date.now() + Math.random(),
    res: res
  }
  
  // Add client to connected clients
  addClient(client)
  
  // Handle client disconnect
  req.on('close', () => {
    removeClient(client)
  })
  
  // Keep connection alive with heartbeat
  const heartbeat = setInterval(() => {
    if (res.destroyed) {
      clearInterval(heartbeat)
      return
    }
    res.write(`data: ${JSON.stringify({
      type: 'heartbeat',
      timestamp: new Date().toISOString()
    })}\n\n`)
  }, 30000) // Send heartbeat every 30 seconds
})

// Set no-cache headers for HTML files
app.use((req, res, next) => {
  if (req.url.endsWith('.html') || req.url === '/' || req.url === '/dashboard' || req.url === '/products') {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
    res.setHeader('Pragma', 'no-cache')
    res.setHeader('Expires', '0')
  }
  next()
})

// Serve static files from dist directory (for assets like JS, CSS, images)
// IMPORTANT: Explicitly exclude /api/* paths to prevent API routes from being served as static files
app.use((req, res, next) => {
  // Skip static file serving for API routes
  if (req.path.startsWith('/api/')) {
    return next()
  }
  // Serve static files for non-API routes
  express.static(path.join(__dirname, 'dist'), {
    index: false
  })(req, res, next)
})

// Serve React app for all non-API routes (must be last)
// CRITICAL: This catch-all must NEVER match API routes - they should be handled by specific routes above
app.get('*', (req, res, next) => {
  // CRITICAL CHECK: If this is an API route, something is wrong - API routes should be handled above
  if (req.path.startsWith('/api/')) {
    console.error(`❌ CRITICAL: Catch-all route intercepted API request: ${req.path}`)
    console.error(`❌ This should never happen - API routes should be matched before this catch-all`)
    // Return JSON error, not HTML
    return res.status(404).json({ 
      error: 'API endpoint not found',
      path: req.path,
      message: 'The API route was not matched by any specific route handler'
    })
  }
  
  console.log(`📄 Serving React app for route: ${req.path}`)
  const indexPath = path.resolve(__dirname, 'dist', 'index.html')
  const fs = require('fs')
  
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath, (err) => {
      if (err) {
        console.error('❌ Error sending index.html:', err)
        if (!res.headersSent) {
          res.status(500).json({ 
            error: 'Failed to serve frontend',
            message: err.message,
            path: req.path
          })
        }
      } else {
        console.log(`✅ Served index.html for route: ${req.path}`)
      }
    })
  } else {
    console.error('❌ index.html not found at:', indexPath)
    res.status(404).json({ 
      error: 'Frontend not built. Please run npm run build first.',
      path: indexPath,
      requestedPath: req.path
    })
  }
})

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error)
  res.status(500).json({ 
    error: 'Internal server error',
    message: error.message 
  })
})

app.listen(PORT, async () => {
  console.log(`🚀 Bevvi Order Tracking System server running on port ${PORT}`)
  console.log(`📊 API available at http://localhost:${PORT}/api`)
  console.log(`🌐 Frontend available at http://localhost:${PORT}`)
  console.log(`🔄 Auto-refresh system ready (20-minute intervals)`)
  console.log(`📋 Auto-refresh endpoints:`)
  console.log(`   POST /api/auto-refresh/start - Start auto-refresh with date range`)
  console.log(`   POST /api/auto-refresh/stop - Stop auto-refresh`)
  console.log(`   GET  /api/auto-refresh/status - Check auto-refresh status`)
  console.log(`📦 Product endpoints:`)
  console.log(`   GET  /api/products/search?q=<term> - Search products`)
  console.log(`   POST /api/products/refresh - Refresh products cache`)
  console.log(`   GET  /api/products/status - Get cache status`)
  console.log(`   POST /api/products/add-from-upc - Enrich + add product`)
  console.log(`   POST /api/manual-order - Submit manual order (validates products against cache)`)
  console.log(`   GET  /api/manual-order/retailer-stripe-account?storeName= - Stripe Connect account for retailer`)
  console.log(`   POST /api/manual-order/calculate-tax - Estimate sales tax via Stripe Tax`)
  console.log(`   POST /api/manual-order/parse-receipt - Scan receipt image/PDF into order fields`)
  console.log(`   GET  /api/manual-order/payment-link?orderNumber= - Look up Stripe payment link for manual order`)
  console.log(`   POST /api/manual-order/payment-link - Create Stripe payment link for manual order`)
  console.log(`   POST /api/manual-order/payment-link/void - Void Stripe invoice for manual order`)
  console.log(`   DELETE /api/manual-order/payment-link?orderNumber= - Void Stripe invoice for manual order`)
  console.log(`   GET  /api/address/autocomplete?input= - Google address suggestions`)
  console.log(`   GET  /api/address/details?placeId= - Resolve Google place to street/city/state/zip`)
  console.log(`🛵 GoPuff order checker:`)
  console.log(`   GET  /api/validate-order?orderNumber= - Validate corp order for GoPuff`)
  console.log(`   GET  /api/preview-order?orderNumber= - Preview order payload`)
  console.log(`   GET  /api/submit-order?orderNumber= - Send corp order to GoPuff`)
  console.log(`   GET  /api/resend-order?orderNumber= - Resend corp order to GoPuff`)
  console.log(``)
  
  // Orders cache disabled - always fetch fresh from API
  console.log(`📦 Orders cache disabled - always fetching fresh data from API`)
  
  console.log(`📦 Loading all Bevvi products on startup...`)
  await loadAllProducts()
  console.log(`✅ Server ready with products cache loaded`)

  if (stripe) {
    console.log(`💳 Loading Stripe connected accounts from API...`)
    await refreshStripeConnectedAccountsCache()
  }

  // Start periodic Slack checks independent of auto-refresh
  startSlackChecks()
})
