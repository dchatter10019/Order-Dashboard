#!/usr/bin/env node
/**
 * ONE approved local live smoke: bevvi_analysis_data_quality @ as_of 2026-10-02.
 * Fresh idempotency key only; no pre-submit reconcile; stops on submission_uncertain.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'
import { spawnSync } from 'child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '..', '.env') })

const require = createRequire(import.meta.url)
const { readJob } = require('../lib/analyticsGateway/jobStore.cjs')
const {
  buildLiveSmokeReport,
  liveSmokeReportExitCode,
  loadSmokeArtifactBytesFromEnv
} = require('../lib/analyticsGateway/liveSmokeReportValidation.cjs')
const { COMPUTER_THREAD_ID } = require('../lib/analyticsGateway/constants.cjs')

const OPERATION = 'bevvi_analysis_data_quality'
const ARGS = { as_of: '2026-10-02' }
const LEGACY_IDEMPOTENCY_KEY = 'approved-live-smoke-2026-10-02'
const IDEMPOTENCY_KEY =
  process.env.BEVVI_ANALYTICS_GATEWAY_SMOKE_IDEMPOTENCY_KEY ||
  'approved-local-live-smoke-2026-10-04'
const base = process.env.BEVVI_ANALYTICS_GATEWAY_VERIFY_URL || 'http://127.0.0.1:8791/analytics'
const token = process.env.BEVVI_ANALYTICS_GATEWAY_CLIENT_TOKEN || ''

const TERMINAL_FAIL = new Set(['failed', 'needs_auth', 'needs_input', 'validation_failed'])
const WAIT_STATES = new Set([
  'queued',
  'running',
  'processing',
  'validating',
  'awaiting_artifact',
  'delivery_failed',
  'submission_uncertain'
])

function toolPayload(result) {
  const text = result.content?.find((c) => c.type === 'text')?.text
  if (text) return JSON.parse(text)
  if (result.structuredContent && typeof result.structuredContent === 'object') {
    return result.structuredContent
  }
  const { content, isError, ...rest } = result
  if (Object.keys(rest).length) return rest
  throw new Error(`Empty tool result: ${JSON.stringify(result)}`)
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function checkpoint(code, detail) {
  console.error(JSON.stringify({ status: 'CHECKPOINT', code, detail }, null, 2))
  process.exit(1)
}

if (IDEMPOTENCY_KEY === LEGACY_IDEMPOTENCY_KEY) {
  checkpoint('legacy_idempotency_key', 'Refusing to reuse approved-live-smoke-2026-10-02')
}

const preflight = spawnSync(process.execPath, [path.join(__dirname, 'analytics-gateway-preflight-checks.mjs')], {
  stdio: 'inherit',
  env: process.env
})
if (preflight.status !== 0) {
  process.exit(preflight.status || 1)
}

const transport = new StreamableHTTPClientTransport(new URL(base), {
  requestInit: { headers: { Authorization: `Bearer ${token}` } }
})
const client = new Client({ name: 'bevvi-live-smoke', version: '1.0.0' })
await client.connect(transport)

const submit = await client.callTool({
  name: 'request_analytics',
  arguments: {
    operation: OPERATION,
    arguments: ARGS,
    idempotency_key: IDEMPOTENCY_KEY
  }
})
const submitJson = toolPayload(submit)
if (!submitJson.ok && submitJson.error) {
  checkpoint('submit_rejected', submitJson)
}
if (submitJson.created === false && submitJson.state !== 'queued') {
  checkpoint('idempotency_replay', { jobId: submitJson.jobId, state: submitJson.state })
}
const jobId = submitJson.jobId
console.log(
  JSON.stringify(
    {
      live_smoke: 'submitted',
      jobId,
      idempotency_key: IDEMPOTENCY_KEY,
      state: submitJson.state,
      created: submitJson.created
    },
    null,
    2
  )
)

const existing = readJob(jobId)
if (
  existing?.resultEnvelope?.live_gate_status === 'mock' ||
  existing?.resultEnvelope?.result?.limitations?.includes('review_only fixture')
) {
  checkpoint('mock_job_rejected', { jobId })
}

const deadline = Date.now() + Number(process.env.BEVVI_ANALYTICS_GATEWAY_SMOKE_TIMEOUT_MS || 900000)
let lastState = submitJson.state
while (Date.now() < deadline) {
  await sleep(3000)
  const status = toolPayload(
    await client.callTool({ name: 'get_analytics_job', arguments: { job_id: jobId } })
  )
  lastState = status.job?.state
  if (lastState === 'succeeded') break
  if (TERMINAL_FAIL.has(lastState)) {
    checkpoint('terminal_failure', { jobId, state: lastState, error: status.job?.error || readJob(jobId)?.error })
  }
  if (lastState === 'submission_uncertain') {
    checkpoint('submission_uncertain', { jobId, message: 'Stop without resubmit or manual reconcile' })
  }
  if (!WAIT_STATES.has(lastState) && lastState !== 'succeeded') {
    checkpoint('unexpected_state', { jobId, state: lastState })
  }
}

await client.close()

const job = readJob(jobId)
if (lastState === 'succeeded' && job?.resultEnvelope) {
  if (!job.resultEnvelope.provenance?.asset_identity?.id) {
    checkpoint('artifact_delivery_incomplete', {
      jobId,
      message: 'Job succeeded without job-bound asset identity; automatic artifact path did not complete'
    })
  }
  reportSuccess(jobId, job.resultEnvelope, { reconciled: false })
  process.exit(process.exitCode || 0)
}

checkpoint('smoke_timeout', {
  jobId,
  state: lastState,
  error: job?.error || null,
  thread: COMPUTER_THREAD_ID
})

function reportSuccess(jobId, envelope, meta) {
  const loaded = loadSmokeArtifactBytesFromEnv()
  const report = buildLiveSmokeReport({
    jobId,
    envelope,
    meta,
    artifactBytes: loaded.bytes,
    asOf: ARGS.as_of
  })
  if (loaded.status === 'unavailable' && loaded.message) {
    report.identity_validation.artifact_revalidation.hint = loaded.message
  }

  console.log(JSON.stringify(report, null, 2))
  if (liveSmokeReportExitCode(report) !== 0) {
    checkpoint('validation_failed', { jobId, unresolved: report.unresolved })
  }
}
