const fs = require('fs')
const path = require('path')
const { EXACT_V3_CONTRACT } = require('./evidencePolicy.cjs')
const { getApprovedAnalysisSourceSha256 } = require('./pythonToolsListLoader.cjs')

function loadFixture(operation) {
  const fixturePath = path.join(
    __dirname,
    '..',
    '..',
    'test-fixtures',
    'analytics-gateway',
    `${operation}.json`
  )
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8'))
}

function approvedCodeHash() {
  const approved = getApprovedAnalysisSourceSha256()
  return approved[0] || '8a8539119267a0ebbea7d44d62d09a32c5abda2a82b0f69bf22e9098ffcce9a4'
}

function buildMockHandlerResult({ operation, args, nowMs = Date.now() }) {
  const fixture = loadFixture(operation)
  const generatedAt = new Date(nowMs).toISOString()
  const codeHash = approvedCodeHash()
  const base = {
    status: 'review_only',
    review_only: true,
    production_ready: false,
    writes_performed: false,
    live_gate_status: 'OFF',
    financial_certification: 'not_certified',
    generated_at_utc: generatedAt,
    analysis_source_sha256: codeHash,
    provenance: {
      live_gate_status: 'OFF',
      phase1_active: true,
      analysis_source_sha256: codeHash,
      input_sha256: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      business_timezone: 'America/New_York',
      as_of: args.as_of,
      settled_through: args.as_of,
      newest_cache_refresh_at_utc: generatedAt,
      cache_age_hours: 1,
      analysis_contract: EXACT_V3_CONTRACT,
      known_limitations: ['Mock fixture — not certified']
    }
  }

  switch (operation) {
    case 'bevvi_analysis_data_quality':
      return { ...base, eligible_orders: fixture.eligible_orders ?? 100 }
    case 'bevvi_planning_forecast':
      return {
        ...base,
        horizons: fixture.horizons || { '30': {}, '60': {}, '90': {} },
        nonoverlapping_30_day_blocks: fixture.nonoverlapping_30_day_blocks || [],
        weekly: fixture.weekly || [],
        monthly: fixture.monthly || []
      }
    case 'bevvi_period_comparison':
      return {
        ...base,
        current_period: fixture.current_period || {
          start_date: args.start_date,
          end_date: args.end_date
        },
        baseline_period: fixture.baseline_period || {},
        metrics: fixture.metrics || { revenue_delta_pct: 0.1 },
        breakdown: fixture.breakdown || [],
        revenue_change_bridge: fixture.revenue_change_bridge || { items: [] }
      }
    case 'bevvi_customer_trends':
      return {
        ...base,
        customers: fixture.customers || [],
        unattributed: fixture.unattributed || { orders: 0 },
        metadata: fixture.metadata || { row_count: 0 }
      }
    case 'bevvi_historical_seasonality':
      return {
        ...base,
        months: fixture.months || [],
        bulk_threshold_usd: fixture.bulk_threshold_usd ?? 1000,
        limitations: fixture.limitations || []
      }
    default:
      return base
  }
}

function applyPlanningHorizonSelection(handler, horizonDays) {
  if (!handler?.horizons) return handler
  const key = String(horizonDays)
  return {
    ...handler,
    gateway_selected_horizon_days: horizonDays,
    gateway_selected_horizon: handler.horizons[key] || null
  }
}

module.exports = {
  buildMockHandlerResult,
  applyPlanningHorizonSelection
}
