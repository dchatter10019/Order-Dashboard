/** Revenue questions about periods/aggregates — not "revenue for Customer X". */
export function isAggregateRevenueQuery(text) {
  const lower = String(text || '').toLowerCase()
  if (!lower.includes('revenue') && !lower.includes('sales') && !lower.includes('gmv')) {
    return false
  }

  const periodPhrases = [
    'total revenue',
    'my revenue',
    'this month',
    'month to date',
    'mtd',
    'ytd',
    'year to date',
    'this year',
    'last month',
    'today',
    'so far',
    'what is my',
    'how much revenue'
  ]
  if (periodPhrases.some((phrase) => lower.includes(phrase))) {
    return true
  }

  if (/\brevenue\s+for\s+(this|the)\s+(month|week|year|quarter)\b/.test(lower)) {
    return true
  }
  if (/\bsales\s+for\s+(this|the)\s+(month|week|year|quarter)\b/.test(lower)) {
    return true
  }

  return false
}

export function looksLikeRevenueByCustomerQuery(text) {
  const lower = String(text || '').toLowerCase()
  if (!lower.includes('revenue') && !lower.includes('sales')) return false
  if (isAggregateRevenueQuery(text)) return false
  if (!/(?:\bfor\b|\bfrom\b|\bof\b)/.test(lower)) return false

  const knownCustomers = ['sendoso', 'ongoody', 'on goody', 'goody', 'air culinaire']
  return knownCustomers.some((name) => lower.includes(name))
}
