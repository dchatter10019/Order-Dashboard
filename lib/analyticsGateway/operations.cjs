const ALLOWED_OPERATIONS = new Set([
  'bevvi_analysis_data_quality',
  'bevvi_planning_forecast',
  'bevvi_period_comparison',
  'bevvi_customer_trends',
  'bevvi_historical_seasonality'
])

const { validateAgainstSchema } = require('./authoritativeSchemas.cjs')

const FORECAST_OUTPUT_HORIZONS = new Set([30, 60, 90])

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function validateOperationInput(operation, args) {
  if (!ALLOWED_OPERATIONS.has(operation)) {
    return { ok: false, error: `Operation not allowlisted: ${operation}` }
  }
  if (!isPlainObject(args)) {
    return { ok: false, error: 'arguments must be a JSON object' }
  }

  if (operation === 'bevvi_planning_forecast') {
    if (args.customer != null) {
      return { ok: false, error: 'customer filter is not supported for bevvi_planning_forecast' }
    }
    if (args.gateway_output_horizon_days != null && args.gateway_output_horizon_days !== undefined) {
      const extra = { ...args }
      const horizon = Number(extra.gateway_output_horizon_days)
      delete extra.gateway_output_horizon_days
      const base = validateAgainstSchema(operation, extra)
      if (!base.ok) return base
      if (!FORECAST_OUTPUT_HORIZONS.has(horizon)) {
        return {
          ok: false,
          error: 'gateway_output_horizon_days must be 30, 60, or 90 (gateway output selection only)'
        }
      }
      return {
        ok: true,
        normalized: { ...base.normalized, gateway_output_horizon_days: horizon },
        pythonArguments: base.pythonArguments,
        gatewayOutputSelection: { horizon_days: horizon }
      }
    }
  } else if (args.gateway_output_horizon_days != null) {
    return { ok: false, error: 'gateway_output_horizon_days is only valid for bevvi_planning_forecast' }
  }

  const base = validateAgainstSchema(operation, args)
  if (!base.ok) return base
  return {
    ok: true,
    normalized: base.normalized,
    pythonArguments: base.pythonArguments,
    gatewayOutputSelection: null
  }
}

module.exports = {
  ALLOWED_OPERATIONS,
  validateOperationInput
}
