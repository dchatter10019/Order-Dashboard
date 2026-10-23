#!/usr/bin/env node
import assert from 'assert'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

process.env.BEVVI_ANALYTICS_GATEWAY_MODE = 'mock'
const { sha256Hex } = require('../lib/analyticsGateway/gatewayAuth.cjs')
process.env.BEVVI_ANALYTICS_GATEWAY_CLIENTS_JSON = JSON.stringify({
  clientA: {
    tokenSha256: sha256Hex('test-gateway-token'),
    scopes: ['analytics:read', 'analytics:submit']
  },
  clientB: {
    tokenSha256: sha256Hex('other-client'),
    scopes: ['analytics:read', 'analytics:submit']
  }
})
delete process.env.BEVVI_ANALYTICS_GATEWAY_CLIENT_TOKEN
process.env.BEVVI_ANALYTICS_GATEWAY_JOBS_DIR = path.join(
  __dirname,
  '..',
  'data',
  'analytics-gateway',
  'test-jobs'
)

const { validateOperationInput } = require('../lib/analyticsGateway/operations.cjs')
const { handleGatewayRpc } = require('../lib/analyticsGateway/gatewayRpc.cjs')
const fs = require('fs')

const auth = `Bearer test-gateway-token`

function rpc(method, params, id = 1) {
  return handleGatewayRpc({ jsonrpc: '2.0', id, method, params }, auth)
}

assert.strictEqual(validateOperationInput('bevvi_evil', {}).ok, false)
assert.strictEqual(validateOperationInput('bevvi_analysis_data_quality', { as_of: 'bad' }).ok, false)
assert.strictEqual(
  validateOperationInput('bevvi_analysis_data_quality', { as_of: '2026-10-02' }).ok,
  true
)
assert.strictEqual(validateOperationInput('bevvi_planning_forecast', { as_of: '2026-10-02', horizon_days: 90 }).ok, false)

const unauth = handleGatewayRpc({ method: 'tools/list' }, null)
assert.strictEqual(unauth.ok, false)
assert.strictEqual(unauth.status, 401)

const list = rpc('tools/list', {})
assert.strictEqual(list.ok, true)
assert.ok(list.result.tools.some((t) => t.name === 'request_analytics'))

const submit = rpc('tools/call', {
  name: 'request_analytics',
  arguments: {
    operation: 'bevvi_analysis_data_quality',
    arguments: { as_of: '2026-10-02' },
    idempotency_key: 'test-1'
  }
})
assert.strictEqual(submit.ok, true)
const jobId = submit.result.jobId
assert.ok(jobId)

await new Promise((r) => setTimeout(r, 400))

const status = rpc('tools/call', {
  name: 'get_analytics_job',
  arguments: { job_id: jobId }
})
assert.strictEqual(status.ok, true)
assert.strictEqual(status.result.job.state, 'succeeded')

const result = rpc('tools/call', {
  name: 'get_analytics_result',
  arguments: { job_id: jobId }
})
assert.strictEqual(result.ok, true)
assert.strictEqual(result.result.envelope.operation, 'bevvi_analysis_data_quality')
assert.strictEqual(result.result.envelope.request_hash.length, 64)
assert.strictEqual(result.result.envelope.handler_live_gate_status, 'MOCK')

const otherAuth = 'Bearer other-client'
const forbidden = handleGatewayRpc(
  {
    method: 'tools/call',
    params: { name: 'get_analytics_result', arguments: { job_id: jobId } }
  },
  otherAuth
)
assert.strictEqual(forbidden.ok, true)
assert.strictEqual(forbidden.result.ok, false)
assert.strictEqual(forbidden.result.code, 'forbidden')

const dup = rpc('tools/call', {
  name: 'request_analytics',
  arguments: {
    operation: 'bevvi_analysis_data_quality',
    arguments: { as_of: '2026-10-02' },
    idempotency_key: 'test-1'
  }
})
assert.strictEqual(dup.result.created, false)
assert.strictEqual(dup.result.jobId, jobId)

process.env.BEVVI_ANALYTICS_GATEWAY_CLIENTS_JSON = JSON.stringify({
  restricted: {
    tokenSha256: sha256Hex('restricted-token'),
    allowedCustomers: ['Acme Corp'],
    scopes: ['analytics:read', 'analytics:submit']
  },
  clientA: {
    tokenSha256: sha256Hex('test-gateway-token'),
    scopes: ['analytics:read', 'analytics:submit']
  }
})
const restrictedAuth = 'Bearer restricted-token'
const blocked = handleGatewayRpc(
  {
    method: 'tools/call',
    params: {
      name: 'request_analytics',
      arguments: {
        operation: 'bevvi_planning_forecast',
        arguments: { as_of: '2026-10-02', gateway_output_horizon_days: 90 }
      }
    }
  },
  restrictedAuth
)
assert.strictEqual(blocked.ok, false)
assert.strictEqual(blocked.code, 'forbidden')

try {
  fs.rmSync(process.env.BEVVI_ANALYTICS_GATEWAY_JOBS_DIR, { recursive: true, force: true })
} catch {
  /* ignore */
}

console.log('analytics-gateway-test: OK')
