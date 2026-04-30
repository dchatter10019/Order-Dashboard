export const MAX_ORDER_DATE_RANGE_DAYS = 31

const MS_PER_DAY = 24 * 60 * 60 * 1000

export function parseLocalDateOnly(dateString, endOfDay = false) {
  if (!dateString) return null
  const time = endOfDay ? 'T23:59:59' : 'T00:00:00'
  const parsed = new Date(`${dateString}${time}`)
  return isNaN(parsed.getTime()) ? null : parsed
}

export function getInclusiveDateRangeDays(startDate, endDate) {
  const start = parseLocalDateOnly(startDate)
  const end = parseLocalDateOnly(endDate)
  if (!start || !end) return null
  return Math.floor((end.getTime() - start.getTime()) / MS_PER_DAY) + 1
}

export function isDateRangeOverLimit(startDate, endDate, maxDays = MAX_ORDER_DATE_RANGE_DAYS) {
  const inclusiveDays = getInclusiveDateRangeDays(startDate, endDate)
  return inclusiveDays != null && inclusiveDays > maxDays
}
