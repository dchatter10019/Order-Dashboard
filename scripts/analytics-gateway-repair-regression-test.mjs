#!/usr/bin/env node
import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'
import {
  handleAnalyticsMcpRequest,
  __testOnlyResetSessions,
  __testOnlyRegisterSession
} from '../lib/analyticsGateway/createMcpGateway.mjs'
import { createSecureArtifactDownloader } from '../lib/analyticsGateway/secureArtifactDownload.mjs'
import { __testOnlySetDownloader } from '../lib/analyticsGateway/computerMcpLive.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

const savedEnv = { ...process.env }
const jobRoot = path.join(__dirname, '..', 'data', 'analytics-gateway', 'repair-regression-jobs')
fs.rmSync(jobRoot, { recursive: true, force: true })
fs.mkdirSync(jobRoot, { recursive: true })

process.env.BEVVI_ANALYTICS_GATEWAY_MODE = 'mock'
process.env.BEVVI_ANALYTICS_GATEWAY_JOBS_DIR = jobRoot
process.env.BEVVI_ANALYTICS_GATEWAY_ENABLED = 'true'

const { sha256Hex, parseClientsRegistry } = require('../lib/analyticsGateway/gatewayAuth.cjs')
const { validateOperationInput } = require('../lib/analyticsGateway/operations.cjs')
const { validateDecisionSupportV3 } = require('../lib/analyticsGateway/decisionSupportV3.cjs')
const { finalizeValidatedJob } = require('../lib/analyticsGateway/jobValidation.cjs')
const { wrapHandlerArtifact, buildJobBinding } = require('../lib/analyticsGateway/jobBinding.cjs')
const { hashCanonicalArguments } = require('../lib/analyticsGateway/canonicalJson.cjs')
const { readJob, createJob, jobsDir } = require('../lib/analyticsGateway/jobStore.cjs')
const { validateStartupEnvironment } = require('../lib/analyticsGateway/gatewayLimits.cjs')
const { requestAnalytics, resumeArtifactDelivery } = require('../lib/analyticsGateway/worker.cjs')
const { clientMetaFromAuth } = require('../lib/analyticsGateway/gatewayRpc.cjs')

process.env.BEVVI_ANALYTICS_GATEWAY_CLIENTS_JSON = JSON.stringify({
  alpha: {
    tokenSha256: sha256Hex('alpha-token'),
    scopes: ['analytics:read', 'analytics:submit']
  },
  beta: {
    tokenSha256: sha256Hex('beta-token'),
    scopes: ['analytics:read', 'analytics:submit']
  },
  readOnly: {
    tokenSha256: sha256Hex('read-only-token'),
    scopes: ['analytics:read']
  },
  restricted: {
    tokenSha256: sha256Hex('restricted-token'),
    allowedCustomers: ['Acme Corp'],
    scopes: ['analytics:read', 'analytics:submit']
  }
})

const samplePath = path.join(
  __dirname,
  '..',
  'test-fixtures',
  'analytics-gateway',
  'artifacts',
  'decision_support_v3.sample.json'
)
const sampleHandler = JSON.parse(fs.readFileSync(samplePath, 'utf8'))

function authMeta(token) {
  const { authenticateGatewayRequest, loadClientVerifiers } = require('../lib/analyticsGateway/gatewayAuth.cjs')
  const auth = authenticateGatewayRequest(`Bearer ${token}`, loadClientVerifiers())
  assert.strictEqual(auth.ok, true)
  return clientMetaFromAuth(auth)
}

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    headersSent: false,
    body: '',
    writeHead(code, headers) {
      this.statusCode = code
      this.headers = headers || {}
      this.headersSent = true
    },
    end(chunk) {
      this.body += chunk || ''
    }
  }
}

function mockReq(method, headers, body) {
  return { method, headers, auth: null }
}

// Unexpected network guard
const realFetch = globalThis.fetch
globalThis.fetch = async (url, ...rest) => {
  const s = String(url)
  if (s.startsWith('mock:') || s.startsWith('file:')) return realFetch(url, ...rest)
  throw new Error(`Unexpected network access in regression tests: ${s}`)
}

// Duplicate token registry rejected
{
  const bad = parseClientsRegistry(
    JSON.stringify({
      a: { tokenSha256: 'a'.repeat(64) },
      b: { tokenSha256: 'a'.repeat(64) }
    })
  )
  assert.strictEqual(bad.ok, false)
}

// Empty allowlist forbids company-wide submission
{
  const denied = requestAnalytics(authMeta('restricted-token'), {
    operation: 'bevvi_customer_trends',
    arguments: { as_of: '2026-10-02', start_date: '2026-09-01', end_date: '2026-09-30' },
    idempotencyKey: 'deny-cw'
  })
  assert.strictEqual(denied.ok, false)
  assert.strictEqual(denied.code, 'forbidden')
}

// Read-only scope cannot submit
{
  const denied = requestAnalytics(authMeta('read-only-token'), {
    operation: 'bevvi_analysis_data_quality',
    arguments: { as_of: '2026-10-02' },
    idempotencyKey: 'read-only'
  })
  assert.strictEqual(denied.code, 'forbidden')
}

// Operation contracts
assert.strictEqual(validateOperationInput('bevvi_customer_trends', { as_of: '2026-10-02', limit: 5 }).ok, false)
assert.strictEqual(
  validateOperationInput('bevvi_historical_seasonality', { as_of: '2026-10-02', months_back: 12 }).ok,
  false
)
assert.strictEqual(
  validateOperationInput('bevvi_period_comparison', {
    as_of: '2026-10-02',
    start_date: '2026-09-01',
    end_date: '2026-09-30'
  }).ok,
  true
)
assert.strictEqual(
  validateOperationInput('bevvi_planning_forecast', {
    as_of: '2026-10-02',
    gateway_output_horizon_days: 60
  }).ok,
  true
)
assert.strictEqual(validateOperationInput('bevvi_analysis_data_quality', { as_of: ['2026-10-02'] }).ok, false)

// Notifications / uninitialized MCP must not create jobs
{
  __testOnlyResetSessions()
  const before = fs.existsSync(jobRoot)
    ? fs.readdirSync(jobRoot).filter((f) => f.endsWith('.json')).length
    : 0
  const res = mockRes()
  await handleAnalyticsMcpRequest(
    mockReq('POST', { authorization: 'Bearer alpha-token' }),
    res,
    { jsonrpc: '2.0', id: 1, method: 'notifications/initialized', params: {} },
    authMeta('alpha-token')
  )
  assert.ok(res.statusCode >= 400)
  const after = fs.readdirSync(jobRoot).filter((f) => f.endsWith('.json')).length
  assert.strictEqual(after, before)
}

// Session ownership: beta cannot use alpha session id
{
  __testOnlyResetSessions()
  const sid = '00000000-0000-4000-8000-0000000000aa'
  __testOnlyRegisterSession(sid, 'alpha')
  const hijack = mockRes()
  await handleAnalyticsMcpRequest(
    mockReq('POST', {
      authorization: 'Bearer beta-token',
      'mcp-session-id': sid
    }),
    hijack,
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    authMeta('beta-token')
  )
  assert.strictEqual(hijack.statusCode, 403)
}

// Evidence fail-closed: cache_age 1000+ and future generation
{
  const job = {
    jobId: '00000000-0000-4000-8000-000000000099',
    operation: 'bevvi_analysis_data_quality',
    arguments: { as_of: '2026-10-02' },
    requestHash: hashCanonicalArguments({ as_of: '2026-10-02' })
  }
  const handler = { ...sampleHandler, job_id: job.jobId, operation: job.operation }
  handler.provenance.cache_age_hours = 1500
  const wrapped = wrapHandlerArtifact(job, handler)
  const out = finalizeValidatedJob({
    job,
    rawResult: wrapped,
    assetIdentity: { id: 'a1', name: `${job.jobId}.json` },
    gatewayMode: 'smoke',
    nowMs: Date.parse('2026-10-04T12:00:00Z')
  })
  assert.strictEqual(out.ok, false)
}

// Secure downloader blocks private redirect targets
{
  const dl = createSecureArtifactDownloader({
    allowedHosts: new Set(['allowed.test']),
    trustAllowedHostsWithoutDns: true,
    fetchImpl: async () => ({
      status: 302,
      ok: false,
      headers: { get: () => 'https://127.0.0.1/evil.json' }
    })
  })
  const out = await dl.downloadJson('https://allowed.test/file.json')
  assert.strictEqual(out.ok, false)
}

// Idempotency conflict
{
  const meta = authMeta('alpha-token')
  const first = requestAnalytics(meta, {
    operation: 'bevvi_analysis_data_quality',
    arguments: { as_of: '2026-10-01' },
    idempotencyKey: 'same-key'
  })
  assert.strictEqual(first.ok, true)
  const conflict = requestAnalytics(meta, {
    operation: 'bevvi_analysis_data_quality',
    arguments: { as_of: '2026-10-02' },
    idempotencyKey: 'same-key'
  })
  assert.strictEqual(conflict.code, 'idempotency_conflict')
}

// Path traversal on job read
assert.strictEqual(readJob('../../../etc/passwd'), null)

// Disabled gateway rejects work
{
  process.env.BEVVI_ANALYTICS_GATEWAY_ENABLED = 'false'
  const denied = requestAnalytics(authMeta('alpha-token'), {
    operation: 'bevvi_analysis_data_quality',
    arguments: { as_of: '2026-10-02' },
    idempotencyKey: 'disabled'
  })
  assert.strictEqual(denied.code, 'disabled')
  process.env.BEVVI_ANALYTICS_GATEWAY_ENABLED = 'true'
}

// Conflicting startup flags
{
  process.env.BEVVI_ANALYTICS_GATEWAY_MODE = 'production'
  process.env.BEVVI_ANALYTICS_GATEWAY_PRODUCTION_ENABLE = 'true'
  process.env.BEVVI_ANALYTICS_GATEWAY_SMOKE_ENABLE = 'true'
  assert.strictEqual(validateStartupEnvironment().ok, false)
  process.env.BEVVI_ANALYTICS_GATEWAY_SMOKE_ENABLE = 'false'
  process.env.BEVVI_ANALYTICS_GATEWAY_MODE = 'mock'
}

// Delayed artifact retry scheduling
{
  const { applyUpstreamOutcome } = require('../lib/analyticsGateway/worker.cjs')
  const { jobId } = createJob({
    clientId: 'alpha',
    operation: 'bevvi_analysis_data_quality',
    arguments: { as_of: '2026-10-02' }
  }).job
  applyUpstreamOutcome(jobId, {
    ok: false,
    code: 'awaiting_artifact',
    message: 'waiting',
    computerTaskSubmitted: true
  })
  const pending = readJob(jobId)
  assert.strictEqual(pending.state, 'awaiting_artifact')
  assert.ok(pending.artifactNextRetryAt)
}

// submission_uncertain reconciles read-only (no processJob resubmit)
{
  const { listRecoverableJobs } = require('../lib/analyticsGateway/jobRecovery.cjs')
  const { jobId } = createJob({
    clientId: 'alpha',
    operation: 'bevvi_analysis_data_quality',
    arguments: { as_of: '2026-10-01' },
    idempotencyKey: `uncertain-${Date.now()}`
  }).job
  const { updateJob } = require('../lib/analyticsGateway/jobStore.cjs')
  updateJob(jobId, { state: 'submission_uncertain', computerTaskSubmitted: true })
  const entry = listRecoverableJobs().find((e) => e.jobId === jobId)
  assert.ok(entry)
  assert.strictEqual(entry.mode, 'reconcile')
}

__testOnlySetDownloader(
  createSecureArtifactDownloader({
    allowedHosts: new Set(['mock']),
    fetchImpl: realFetch,
    trustAllowedHostsWithoutDns: true
  })
)

fs.rmSync(jobRoot, { recursive: true, force: true })
process.env = savedEnv
globalThis.fetch = realFetch

console.log('analytics-gateway-repair-regression-test: OK')
