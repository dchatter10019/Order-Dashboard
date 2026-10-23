#!/usr/bin/env node
/**
 * Fourth independent review follow-up probes (synthetic only).
 */
import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

const jobRoot = path.join(__dirname, '..', 'data', 'analytics-gateway', 'fourth-followup-jobs')
fs.rmSync(jobRoot, { recursive: true, force: true })
fs.mkdirSync(jobRoot, { recursive: true })

process.env.BEVVI_ANALYTICS_GATEWAY_MODE = 'mock'
process.env.BEVVI_ANALYTICS_GATEWAY_JOBS_DIR = jobRoot
process.env.BEVVI_ANALYTICS_GATEWAY_ENABLED = 'true'

const { validateOperationInput } = require('../lib/analyticsGateway/operations.cjs')
const {
  __testOnlyResetToolsListCache,
  patternImpliesIsoCalendarDate
} = require('../lib/analyticsGateway/pythonToolsListLoader.cjs')
const {
  isPidAlive,
  isPidConfirmedDead,
  acquireArtifactDeliveryLease,
  releaseProcessingLease
} = require('../lib/analyticsGateway/jobClaim.cjs')
const { createJob, readJob, updateJob } = require('../lib/analyticsGateway/jobStore.cjs')
const {
  resumeArtifactDelivery,
  reconcileSubmissionUncertain,
  __testOnlyFlushQueue
} = require('../lib/analyticsGateway/worker.cjs')
const { applyArtifactValidation } = require('../lib/analyticsGateway/reconcileJob.cjs')
const { wrapHandlerArtifact } = require('../lib/analyticsGateway/jobBinding.cjs')
const { buildMockHandlerResult } = require('../lib/analyticsGateway/mockHandlerResult.cjs')
const { __testOnlySetSubmitSpy, __testOnlySetArtifactOnlyQueue } = require('../lib/analyticsGateway/computerMcpClient.cjs')
const { COMPUTER_THREAD_ID } = require('../lib/analyticsGateway/constants.cjs')

// raw-dates: [0-9] pattern enforces calendar semantics
{
  assert.strictEqual(patternImpliesIsoCalendarDate('^[0-9]{4}-[0-9]{2}-[0-9]{2}$'), true)
  __testOnlyResetToolsListCache()
  const rawTrendsSchema = {
    result: {
      tools: [
        {
          name: 'bevvi_customer_trends',
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['as_of', 'start_date', 'end_date'],
            properties: {
              as_of: { type: 'string', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' },
              start_date: { type: 'string', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' },
              end_date: { type: 'string', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' }
            }
          }
        }
      ]
    }
  }
  const exportPath = path.join(
    __dirname,
    '..',
    'test-fixtures',
    'analytics-gateway',
    'Bevvi-Python-Tools-List-Export.json'
  )
  const prior = fs.readFileSync(exportPath, 'utf8')
  fs.writeFileSync(exportPath, `${JSON.stringify(rawTrendsSchema, null, 2)}\n`)
  __testOnlyResetToolsListCache()
  try {
    assert.strictEqual(
      validateOperationInput('bevvi_customer_trends', {
        as_of: '2026-03-01',
        start_date: '2026-02-01',
        end_date: '2026-02-28'
      }).ok,
      true
    )
    assert.strictEqual(
      validateOperationInput('bevvi_customer_trends', {
        as_of: '2026-03-01',
        start_date: '2026-02-30',
        end_date: '2026-02-28'
      }).ok,
      false
    )
    assert.strictEqual(
      validateOperationInput('bevvi_customer_trends', {
        as_of: '2026-03-01',
        start_date: '2026-02-xx',
        end_date: '2026-02-28'
      }).ok,
      false
    )
  } finally {
    fs.writeFileSync(exportPath, prior)
    __testOnlyResetToolsListCache()
  }
}

// EPERM / indeterminate PID must not be treated as dead
{
  assert.strictEqual(isPidAlive(process.pid), true)
  assert.strictEqual(isPidConfirmedDead(process.pid), false)
  assert.strictEqual(isPidConfirmedDead(999999), true)
}

// crash-delivery: dead post-submission lease must not block eventual artifact retry
{
  let artifactOnlyCalls = 0
  __testOnlySetSubmitSpy((params) => {
    if (params.artifactOnly) artifactOnlyCalls += 1
  })
  __testOnlySetArtifactOnlyQueue([
    { ok: false, code: 'awaiting_artifact', message: 'not ready', computerTaskSubmitted: true },
    (params) => {
      const job = readJob(params.jobId)
      const handler = buildMockHandlerResult({
        operation: job.operation,
        args: job.arguments
      })
      return {
        ok: true,
        mode: 'mock',
        result: wrapHandlerArtifact(job, handler),
        computerTaskSubmitted: true
      }
    }
  ])

  const { jobId } = createJob({
    clientId: 'alpha',
    operation: 'bevvi_analysis_data_quality',
    arguments: { as_of: '2026-10-02' },
    idempotencyKey: `crash-${Date.now()}`
  }).job
  updateJob(jobId, {
    state: 'submission_uncertain',
    computerTaskSubmitted: true,
    submissionAttemptId: 'attempt-1'
  })
  fs.writeFileSync(
    path.join(jobRoot, 'thread-admission.lock'),
    `${JSON.stringify({
      threadId: COMPUTER_THREAD_ID,
      jobId,
      ownerId: 'dead-owner',
      state: 'submission_uncertain'
    })}\n`
  )
  fs.writeFileSync(
    path.join(jobRoot, `.processing-${jobId}.lock`),
    `${JSON.stringify({
      jobId,
      ownerId: 'dead-owner',
      pid: 999999,
      acquiredAt: new Date(0).toISOString(),
      purpose: 'submission'
    })}\n`
  )

  reconcileSubmissionUncertain(jobId)
  await __testOnlyFlushQueue()
  assert.strictEqual(readJob(jobId).state, 'awaiting_artifact')
  assert.strictEqual(artifactOnlyCalls, 1)
  updateJob(jobId, { artifactNextRetryAt: null })

  resumeArtifactDelivery(jobId)
  await __testOnlyFlushQueue()
  assert.strictEqual(readJob(jobId).state, 'succeeded')
  assert.strictEqual(artifactOnlyCalls, 2)
  __testOnlySetArtifactOnlyQueue(null)
}

// manual-wakeup: applyArtifactValidation success dispatches waiting job
{
  let submits = 0
  __testOnlySetSubmitSpy(() => {
    submits += 1
  })
  const { jobId: firstId } = createJob({
    clientId: 'alpha',
    operation: 'bevvi_analysis_data_quality',
    arguments: { as_of: '2026-10-03' },
    idempotencyKey: `manual-a-${Date.now()}`
  }).job
  const { jobId: secondId } = createJob({
    clientId: 'alpha',
    operation: 'bevvi_analysis_data_quality',
    arguments: { as_of: '2026-10-04' },
    idempotencyKey: `manual-b-${Date.now()}`
  }).job
  updateJob(firstId, {
    state: 'awaiting_artifact',
    computerTaskSubmitted: true,
    waitingForThreadAdmission: false
  })
  updateJob(secondId, { state: 'queued', waitingForThreadAdmission: true, submissionAttemptId: null })
  fs.writeFileSync(
    path.join(jobRoot, 'thread-admission.lock'),
    `${JSON.stringify({
      threadId: COMPUTER_THREAD_ID,
      jobId: firstId,
      ownerId: 'manual-owner',
      state: 'awaiting_artifact'
    })}\n`
  )

  const job = readJob(firstId)
  const handler = buildMockHandlerResult({ operation: job.operation, args: job.arguments })
  const wrapped = wrapHandlerArtifact(job, handler)
  const result = await applyArtifactValidation(firstId, {
    ok: true,
    payload: wrapped,
    assetIdentity: { name: `${firstId}.json`, byte_digest: 'a'.repeat(64) }
  })
  assert.strictEqual(result.ok, true)
  await __testOnlyFlushQueue()
  assert.strictEqual(readJob(firstId).state, 'succeeded')
  assert.strictEqual(readJob(secondId).state, 'succeeded')
  assert.strictEqual(submits, 1)
}

fs.rmSync(jobRoot, { recursive: true, force: true })
console.log('analytics-gateway-fourth-followup-test: OK')
