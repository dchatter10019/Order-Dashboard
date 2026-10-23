/**
 * Gateway-facing validation aligned to Bevvi-Authoritative-Analytics-Tool-Schemas.json.
 * gateway_output_horizon_days is gateway-only output selection (not sent to Python).
 */

const { isSettledAsOfEligible } = require('./operationalGuards.cjs')
const { validateAgainstSchema } = require('./authoritativeSchemas.cjs')

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const FORECAST_OUTPUT_HORIZONS = new Set([30, 60, 90])

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

function validateDateRange({ as_of, start_date, end_date }) {
  const asOfCheck = isSettledAsOfEligible(as_of)
  if (!asOfCheck.ok) return asOfCheck
  if (start_date > end_date) {
    return { ok: false, error: 'start_date must be on or before end_date' }
  }
  if (end_date > as_of) {
    return { ok: false, error: 'end_date must not be after as_of' }
  }
  if (start_date > as_of) {
    return { ok: false, error: 'start_date must not be after as_of' }
  }
  return { ok: true }
}

function validateOperationInput(operation, args) {
  const base = validateAgainstSchema(operation, args)
  if (!base.ok) return base

  if (operation === 'bevvi_planning_forecast') {
    const gatewayOnly = {}
    let outputHorizon = 90
    if (args.gateway_output_horizon_days != null) {
      if (Object.keys(args).some((k) => k !== 'as_of' && k !== 'model' && k !== 'gateway_output_horizon_days')) {
        /* caught by schema */
      }
      if (args.customer != null) {
        return { ok: false, error: 'customer filter is not supported for bevvi_planning_forecast' }
      }
      outputHorizon = Number(args.gateway_output_horizon_days)
      if (!FORECAST_OUTPUT_HORIZONS.has(outputHorizon)) {
        return {
          ok: false,
          error: 'gateway_output_horizon_days must be 30, 60, or 90 (gateway output selection only)'
        }
      }
      gatewayOnly.gateway_output_horizon_days = outputHorizon
    }
    return {
      ok: true,
      normalized: { ...base.normalized, ...gatewayOnly },
      pythonArguments: base.pythonArguments,
      gatewayOutputSelection: { horizon_days: outputHorizon }
    }
  }

  if (args.gateway_output_horizon_days != null) {
    return { ok: false, error: 'gateway_output_horizon_days is only valid for bevvi_planning_forecast' }
  }

  return {
    ok: true,
    normalized: base.normalized,
    pythonArguments: base.pythonArguments,
    gatewayOutputSelection: null
  }
}

module.exports = {
  DATE_RE,
  FORECAST_OUTPUT_HORIZONS,
  parseCalendarDate,
  validateDateRange,
  validateOperationInput
}
