const { isSettledAsOfEligible } = require('./analyticsGateway/operationalGuards.cjs')

function easternCalendarDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now)
}

/** Latest settled as_of for gateway (day before Eastern today). */
function defaultSettledAsOf(now = new Date()) {
  const easternToday = easternCalendarDate(now)
  const d = new Date(`${easternToday}T12:00:00`)
  d.setDate(d.getDate() - 1)
  return d.toISOString().slice(0, 10)
}

function pickRollupContainingDate(rollups, isoDate) {
  if (!Array.isArray(rollups) || !isoDate) return null
  return (
    rollups.find((row) => row.start_date <= isoDate && isoDate <= row.end_date) ||
    rollups.find((row) => row.period === isoDate.slice(0, 7)) ||
    null
  )
}

function formatForecastSlice(label, slice, meta = {}) {
  if (!slice) {
    return { label, available: false, ...meta }
  }
  return {
    label,
    available: true,
    period: slice.period || null,
    start_date: slice.start_date || null,
    end_date: slice.end_date || null,
    days: slice.days ?? null,
    partial_period: slice.partial_period ?? null,
    orders: slice.orders ?? null,
    revenue_usd: slice.revenue_usd ?? null,
    aov_usd: slice.aov_usd ?? null,
    ...meta
  }
}

/**
 * Build dashboard view from planning_forecast handler JSON (envelope.result).
 */
function buildPlanningForecastDashboardView(handlerResult, { asOf, easternToday } = {}) {
  const today = easternToday || easternCalendarDate()
  const settled = asOf || handlerResult?.knowledge_cutoff || defaultSettledAsOf()

  const weeklyToday = pickRollupContainingDate(handlerResult?.weekly, today)
  let todaySlice = weeklyToday
  let todayNote = 'Week containing today (America/New_York)'

  if (!todaySlice && handlerResult?.horizons?.['30']?.cumulative_total) {
    const h = handlerResult.horizons['30']
    todaySlice = {
      start_date: h.start_date,
      end_date: h.end_date,
      days: 30,
      partial_period: true,
      ...h.cumulative_total
    }
    todayNote = '30-day cumulative outlook (no daily row; week rollup unavailable)'
  }

  const monthKey = today.slice(0, 7)
  const monthSlice =
    (handlerResult?.monthly || []).find((m) => m.period === monthKey) ||
    pickRollupContainingDate(handlerResult?.monthly, today)

  return {
    as_of: settled,
    eastern_today: today,
    model: handlerResult?.model || null,
    status: handlerResult?.status || null,
    review_only: handlerResult?.status === 'review_only' || true,
    today: formatForecastSlice("Today's forecast", todaySlice, { interpretation: todayNote }),
    current_month: formatForecastSlice('Current month forecast', monthSlice, {
      interpretation: `Calendar month ${monthKey} (America/New_York)`
    }),
    limitations: handlerResult?.limitations || []
  }
}

function validateAsOf(asOf) {
  return isSettledAsOfEligible(asOf)
}

module.exports = {
  easternCalendarDate,
  defaultSettledAsOf,
  buildPlanningForecastDashboardView,
  validateAsOf
}
