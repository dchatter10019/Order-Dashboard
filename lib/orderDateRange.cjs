const MAX_ORDER_DATE_RANGE_DAYS = 31
const MS_PER_DAY = 24 * 60 * 60 * 1000

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

module.exports = {
  MAX_ORDER_DATE_RANGE_DAYS,
  MS_PER_DAY,
  parseYyyyMmDdUtc,
  validateOrderDateRange
}
