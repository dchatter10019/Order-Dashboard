#!/usr/bin/env node
/**
 * Sequential approved local_test manifest jobs via MCP.
 * On success, writes bound cutover validation evidence for the parent cutover wrapper.
 * Use analytics-gateway-local-test-cutover-run.mjs (--restore-mock) with pipefail if tee logging.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import dotenv from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '..', '.env') })

const require = createRequire(import.meta.url)
const { readManifest } = require('../lib/analyticsGateway/localTestManifest.cjs')
const { readJob } = require('../lib/analyticsGateway/jobStore.cjs')
const {
  invocationFromEnv, validateInvocationManifest, buildCutoverEvidence,
  writeCutoverEvidenceAtomic, digest
} = require('../lib/analyticsGateway/localTestCutoverEvidence.cjs')
const {
  buildLiveSmokeReport,
  liveSmokeReportExitCode
} = require('../lib/analyticsGateway/liveSmokeReportValidation.cjs')

const base = process.env.BEVVI_ANALYTICS_GATEWAY_VERIFY_URL || 'http://127.0.0.1:8791/analytics'
const token = process.env.BEVVI_ANALYTICS_GATEWAY_CLIENT_TOKEN || ''
const artifactDir =
  process.env.BEVVI_ANALYTICS_GATEWAY_LOCAL_TEST_ARTIFACT_DIR ||
  path.join(__dirname, '..', 'data', 'analytics-gateway', 'local-test-artifacts')
const TIMEOUT_MS = Number(process.env.BEVVI_ANALYTICS_GATEWAY_LOCAL_TEST_TIMEOUT_MS || 900000)

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

if (!token) checkpoint('missing_token', { message: 'BEVVI_ANALYTICS_GATEWAY_CLIENT_TOKEN not configured' })

const manifest = readManifest()
if (!manifest) checkpoint('manifest_missing', { message: 'Local test manifest not found' })
const invocation = invocationFromEnv()
const invocationCheck = validateInvocationManifest(invocation)
if (!invocationCheck.ok) checkpoint('validation_failed', invocationCheck)

fs.mkdirSync(artifactDir, { recursive: true, mode: 0o700 })

const transport = new StreamableHTTPClientTransport(new URL(base), {
  requestInit: { headers: { Authorization: `Bearer ${token}` } }
})
const client = new Client({ name: 'bevvi-local-test-run', version: '1.0.0' })
await client.connect(transport)

const results = []
const evidenceJobs = []

for (const entry of manifest.entries) {
  const submit = await client.callTool({
    name: 'request_analytics',
    arguments: {
      operation: entry.operation,
      arguments: entry.arguments,
      idempotency_key: entry.idempotency_key
    }
  })
  const submitJson = toolPayload(submit)
  if (!submitJson.ok && submitJson.error) checkpoint('submit_rejected', submitJson)
  const jobId = submitJson.jobId
  let lastState = submitJson.state
  const deadline = Date.now() + TIMEOUT_MS
  while (Date.now() < deadline) {
    await sleep(3000)
    const status = toolPayload(
      await client.callTool({ name: 'get_analytics_job', arguments: { job_id: jobId } })
    )
    lastState = status.job?.state
    if (lastState === 'succeeded') break
    if (['failed', 'needs_auth', 'needs_input', 'validation_failed', 'submission_uncertain'].includes(lastState)) {
      checkpoint('terminal_failure', { entry_id: entry.entry_id, jobId, state: lastState })
    }
  }
  if (lastState !== 'succeeded') {
    checkpoint('timeout', { entry_id: entry.entry_id, jobId, state: lastState })
  }

  const resultTool = toolPayload(
    await client.callTool({ name: 'get_analytics_result', arguments: { job_id: jobId } })
  )
  const job = readJob(jobId)
  const envelope = job?.resultEnvelope || resultTool.envelope
  const artifactPath = path.join(artifactDir, `${jobId}.json`)
  process.env.BEVVI_ANALYTICS_GATEWAY_SMOKE_ARTIFACT_PATH = artifactPath
  let artifactBytes = null
  if (fs.existsSync(artifactPath)) {
    artifactBytes = fs.readFileSync(artifactPath)
  }
  const report = buildLiveSmokeReport({
    jobId,
    envelope,
    meta: { entry_id: entry.entry_id, run_id: manifest.run_id },
    artifactBytes,
    asOf: entry.arguments.as_of
  })
  results.push({
    entry_id: entry.entry_id,
    operation: entry.operation,
    arguments: entry.arguments,
    jobId,
    validation: report.identity_validation,
    unresolved: report.unresolved,
    consumer_result: envelope?.result ?? null
  })
  if (liveSmokeReportExitCode(report) !== 0) {
    checkpoint('validation_failed', { entry_id: entry.entry_id, jobId, unresolved: report.unresolved })
  }
  if (envelope?.gateway_mode !== 'local_test' || envelope.integration_test_passed !== true) {
    checkpoint('validation_failed', { entry_id: entry.entry_id, jobId, code: 'live_validation_required' })
  }
  evidenceJobs.push({
    entry_id: entry.entry_id, job_id: jobId, operation: entry.operation,
    request_hash: job.requestHash,
    validation: { consumer: true, artifact: true, operational: true, integration: true },
    artifact_sha256: report.identity_validation.artifact_revalidation.byte_digest,
    envelope_sha256: digest(envelope)
  })
}

await client.close()

const evidence = buildCutoverEvidence({
  invocation,
  runId: manifest.run_id,
  expectedJobs: evidenceJobs
})
const evidenceWrite = writeCutoverEvidenceAtomic(evidence)
if (!evidenceWrite.ok) {
  checkpoint('validation_failed', { code: evidenceWrite.code, message: evidenceWrite.message })
}

console.log(JSON.stringify({ run_id: manifest.run_id, results, cutover_evidence: evidenceWrite.path }, null, 2))
