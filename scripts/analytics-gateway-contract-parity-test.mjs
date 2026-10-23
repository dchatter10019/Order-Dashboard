#!/usr/bin/env node
import assert from 'assert'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const { validateOperationInput } = require('../lib/analyticsGateway/operations.cjs')
const {
  validateHandlerOutputShape,
  verifyExportSha256,
  extractToolsFromExport,
  assertToolsListIntegrity
} = require('../lib/analyticsGateway/authoritativeSchemas.cjs')
const { validateEvidenceTimestamps } = require('../lib/analyticsGateway/evidencePolicy.cjs')
const { applyPlanningHorizonSelection, buildMockHandlerResult } = require('../lib/analyticsGateway/mockHandlerResult.cjs')
const { paginateAssets } = require('../lib/analyticsGateway/resultRetrieval.cjs')

assert.strictEqual(assertToolsListIntegrity().ok, true)
assert.strictEqual(verifyExportSha256().ok, true)

const rpcWrapped = { jsonrpc: '2.0', result: { tools: [{ name: 'bevvi_analysis_data_quality', inputSchema: { type: 'object' } }] } }
assert.strictEqual(extractToolsFromExport(rpcWrapped).length, 1)

assert.strictEqual(
  validateOperationInput('bevvi_planning_forecast', {
    as_of: '2026-10-02',
    customer: 'Acme'
  }).ok,
  false
)
assert.strictEqual(
  validateOperationInput('bevvi_planning_forecast', {
    as_of: '2026-10-02',
    model: 'phase1_baseline'
  }).ok,
  false
)
assert.strictEqual(
  validateOperationInput('bevvi_planning_forecast', {
    as_of: '2026-10-02',
    model: 'planning_blend_v1'
  }).ok,
  true
)

assert.strictEqual(
  validateOperationInput('bevvi_period_comparison', {
    as_of: '2026-10-02',
    start_date: '2026-09-01',
    end_date: '2026-09-30',
    comparison: 'yoy'
  }).ok,
  true
)
assert.strictEqual(
  validateOperationInput('bevvi_period_comparison', {
    as_of: '2026-10-02',
    start_date: '2026-09-01',
    end_date: '2026-09-30',
    comparison: 'custom_baseline'
  }).ok,
  false
)
assert.strictEqual(
  validateOperationInput('bevvi_period_comparison', {
    as_of: '2026-10-02',
    start_date: '2026-09-01',
    end_date: '2026-09-30',
    baseline_start: '2026-08-01',
    baseline_end: '2026-08-31',
    comparison: 'custom'
  }).ok,
  true
)

assert.strictEqual(
  validateOperationInput('bevvi_period_comparison', {
    as_of: '2026-02-31',
    start_date: '2026-09-01',
    end_date: '2026-09-30'
  }).ok,
  false
)
assert.strictEqual(
  validateOperationInput('bevvi_period_comparison', {
    as_of: '2026-10-02',
    start_date: '2026-09-01',
    end_date: '2026-09-30',
    customers: []
  }).ok,
  false
)
assert.strictEqual(
  validateOperationInput('bevvi_historical_seasonality', {
    as_of: '2026-10-02',
    start_date: '2026-01-01',
    end_date: '2026-12-31',
    bulk_threshold_usd: '1000'
  }).ok,
  false
)
assert.strictEqual(
  validateOperationInput('bevvi_period_comparison', {
    as_of: '2026-10-02',
    start_date: '2026-09-01',
    end_date: '2026-09-30',
    comparison: 'custom',
    baseline_start: '2026-09-01',
    baseline_end: '2026-09-30',
    customers: ['Acme']
  }).ok,
  false
)
assert.strictEqual(
  validateOperationInput('bevvi_period_comparison', {
    as_of: '2026-10-02',
    start_date: '2026-09-01',
    end_date: '2026-09-30',
    customers: Array.from({ length: 101 }, (_, i) => `c${i}`)
  }).ok,
  false
)
assert.strictEqual(
  validateHandlerOutputShape('bevvi_historical_seasonality', {
    months: [],
    bulk_threshold_usd: null,
    limitations: []
  }).ok,
  true
)

assert.strictEqual(
  validateHandlerOutputShape('bevvi_period_comparison', { comparison: 'yoy' }).ok,
  false
)
assert.strictEqual(
  validateHandlerOutputShape('bevvi_analysis_data_quality', { eligible_orders: '10' }).ok,
  false
)

const handler = {
  eligible_orders: 10,
  review_only: true,
  production_ready: false,
  writes_performed: false,
  live_gate_status: 'OFF',
  generated_at_utc: '2026-10-04T12:00:00+00:00',
  provenance: {
    live_gate_status: 'OFF',
    phase1_active: true,
    analysis_source_sha256: '8a8539119267a0ebbea7d44d62d09a32c5abda2a82b0f69bf22e9098ffcce9a4',
    input_sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    as_of: '2026-10-02',
    settled_through: '2026-10-03',
    newest_cache_refresh_at_utc: '2026-10-03T11:30:00+00:00',
    cache_age_hours: 24,
    analysis_contract: 'decision_support_v3_identity_and_input_guards'
  }
}
assert.strictEqual(validateEvidenceTimestamps(handler, Date.parse('2026-10-04T12:00:00Z')).ok, false)

const mockForecast = buildMockHandlerResult({
  operation: 'bevvi_planning_forecast',
  args: { as_of: '2026-10-02' }
})
const selected = applyPlanningHorizonSelection(mockForecast, 60)
assert.ok(selected.gateway_selected_horizon)
assert.strictEqual(selected.gateway_selected_horizon.orders, 200)

const incomplete = await paginateAssets(
  async () => ({
    assets: [],
    next_cursor: 'more'
  }),
  '00000000-0000-4000-8000-000000000001'
)
assert.strictEqual(incomplete.error, 'listing_incomplete')

const jobId = '11111111-1111-4111-8111-111111111111'
const twoPage = await paginateAssets(async ({ cursor }) => {
  if (!cursor) {
    return { assets: [], next_cursor: 'page-2' }
  }
  return { assets: [{ filename: `${jobId}.json` }], next_cursor: null }
}, jobId)
assert.ok(twoPage.asset)
assert.strictEqual(twoPage.asset.filename, `${jobId}.json`)

console.log('analytics-gateway-contract-parity-test: OK')
