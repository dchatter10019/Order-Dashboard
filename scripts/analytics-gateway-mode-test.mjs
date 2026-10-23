#!/usr/bin/env node
import assert from 'assert'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const { validateModeConfiguration, isOperationAllowedInMode } = require('../lib/analyticsGateway/modes.cjs')
const { validateStructuredResult, selectJobBoundAsset } = require('../lib/analyticsGateway/resultRetrieval.cjs')

const saved = { ...process.env }

function restoreEnv() {
  process.env = { ...saved }
}

process.env.BEVVI_ANALYTICS_GATEWAY_MODE = 'production'
process.env.BEVVI_ANALYTICS_GATEWAY_PRODUCTION_ENABLE = 'false'
assert.strictEqual(validateModeConfiguration().ok, false)

process.env.BEVVI_ANALYTICS_GATEWAY_PRODUCTION_ENABLE = 'true'
process.env.BEVVI_ANALYTICS_GATEWAY_ALLOW_MOCK = 'true'
assert.strictEqual(validateModeConfiguration().code, 'production_fail_closed')

process.env.BEVVI_ANALYTICS_GATEWAY_ALLOW_MOCK = 'false'
assert.strictEqual(validateModeConfiguration().ok, true)

process.env.BEVVI_ANALYTICS_GATEWAY_MODE = 'smoke'
process.env.BEVVI_ANALYTICS_GATEWAY_SMOKE_ENABLE = 'false'
assert.strictEqual(validateModeConfiguration().ok, false)

process.env.BEVVI_ANALYTICS_GATEWAY_SMOKE_ENABLE = 'true'
assert.strictEqual(validateModeConfiguration().ok, true)
assert.strictEqual(isOperationAllowedInMode('bevvi_planning_forecast', 'smoke'), false)
assert.strictEqual(isOperationAllowedInMode('bevvi_analysis_data_quality', 'smoke'), true)

const job = {
  jobId: 'job-123',
  operation: 'bevvi_analysis_data_quality',
  requestHash: 'abc',
  arguments: { as_of: '2026-10-02' }
}
const { wrapHandlerArtifact } = require('../lib/analyticsGateway/jobBinding.cjs')
const handler = {
  eligible_orders: 1,
  provenance: { as_of: '2026-10-02' }
}
const good = validateStructuredResult({
  job,
  payload: wrapHandlerArtifact(job, handler)
})
assert.strictEqual(good.ok, true)

const badPayload = wrapHandlerArtifact(job, handler)
badPayload.gateway_job_binding.job_id = 'other'
const bad = validateStructuredResult({
  job,
  payload: badPayload
})
assert.strictEqual(bad.ok, false)

const assets = selectJobBoundAsset(
  [{ filename: 'job-123.json' }, { filename: 'other.json' }],
  'job-123'
)
assert.ok(assets.asset)

const ambiguous = selectJobBoundAsset(
  [{ filename: 'job-123.json' }, { filename: 'job-123.json' }],
  'job-123'
)
assert.strictEqual(ambiguous.error, 'ambiguous_asset')

restoreEnv()
console.log('analytics-gateway-mode-test: OK')
