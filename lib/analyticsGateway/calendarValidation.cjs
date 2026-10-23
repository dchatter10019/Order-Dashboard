const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function parseCalendarDate(field, value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) {
    return { ok: false, error: `${field} required (YYYY-MM-DD string)` }
  }
  const [y, m, d] = value.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return { ok: false, error: `${field} is not a valid calendar date` }
  }
  return { ok: true, value }
}

function isCompleteCalendarMonthRange(start, end) {
  const startCheck = parseCalendarDate('start_date', start)
  if (!startCheck.ok) return false
  const endCheck = parseCalendarDate('end_date', end)
  if (!endCheck.ok) return false
  const [sy, sm, sd] = start.split('-').map(Number)
  const [ey, em, ed] = end.split('-').map(Number)
  if (sd !== 1) return false
  const lastDay = new Date(Date.UTC(ey, em, 0)).getUTCDate()
  return ed === lastDay
}

module.exports = {
  DATE_RE,
  parseCalendarDate,
  isCompleteCalendarMonthRange
}
