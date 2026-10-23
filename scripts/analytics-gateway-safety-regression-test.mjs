#!/usr/bin/env node
import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { spawnSync } from 'child_process'
import { createRequire } from 'module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

const jobRoot = path.join(__dirname, '..', 'data', 'analytics-gateway', 'safety-regression-jobs')
fs.rmSync(jobRoot, { recursive: true, force: true })
fs.mkdirSync(jobRoot, { recursive: true })

process.env.BEVVI_ANALYTICS_GATEWAY_MODE = 'mock'
process.env.BEVVI_ANALYTICS_GATEWAY_JOBS_DIR = jobRoot
process.env.BEVVI_ANALYTICS_GATEWAY_ENABLED = 'true'

const { createJob, readJob, updateJob } = require('../lib/analyticsGateway/jobStore.cjs')
const {
  processJob,
  reconcileSubmissionUncertain,
  dispatchQueuedJobsAfterAdmissionRelease,
  __testOnlyFlushQueue
} = require('../lib/analyticsGateway/worker.cjs')
const { reclaimAbandonedProcessingLeases } = require('../lib/analyticsGateway/jobClaim.cjs')
const {
  listRecoverableJobs,
  recoverInterruptedJobs,
  markRunningCrashUncertain
} = require('../lib/analyticsGateway/jobRecovery.cjs')
const { acquireThreadAdmission, readLock } = require('../lib/analyticsGateway/jobAdmission.cjs')
const {
  __testOnlySetSubmitSpy
} = require('../lib/analyticsGateway/computerMcpClient.cjs')

// Two-process duplicate submission guard
{
  const { jobId } = createJob({
    clientId: 'alpha',
    operation: 'bevvi_analysis_data_quality',
    arguments: { as_of: '2026-10-02' }
  }).job
  updateJob(jobId, { state: 'queued' })

  const workerPath = path.join(__dirname, 'analytics-gateway-safety-worker-once.mjs')
  const ownerA = `proc-a-${Date.now()}`
  const ownerB = `proc-b-${Date.now()}`
  const env = { ...process.env }
  const a = spawnSync(process.execPath, [workerPath, jobId, ownerA], { env, encoding: 'utf8' })
  const b = spawnSync(process.execPath, [workerPath, jobId, ownerB], { env, encoding: 'utf8' })
  assert.strictEqual(a.status, 0, a.stderr || a.stdout)
  assert.strictEqual(b.status, 0, b.stderr || b.stdout)
  const submitTotal = Number(a.stdout.trim()) + Number(b.stdout.trim())
  assert.strictEqual(submitTotal, 1, 'expected exactly one upstream submission across two workers')
}

// Running crash → uncertain + reconcile (no blind resubmit while uncertain)
{
  const { jobId } = createJob({
    clientId: 'alpha',
    operation: 'bevvi_analysis_data_quality',
    arguments: { as_of: '2026-10-03' },
    idempotencyKey: `crash-${Date.now()}`
  }).job
  updateJob(jobId, {
    state: 'running',
    submissionAttemptId: 'attempt-crash',
    computerTaskSubmitted: false
  })
  markRunningCrashUncertain(jobId)
  const after = readJob(jobId)
  assert.strictEqual(after.state, 'submission_uncertain')
  assert.ok(listRecoverableJobs().some((e) => e.jobId === jobId && e.mode === 'reconcile'))
}

// needs_input blocks new thread admission
{
  const blockingId = createJob({
    clientId: 'alpha',
    operation: 'bevvi_analysis_data_quality',
    arguments: { as_of: '2026-10-04' },
    idempotencyKey: `needs-input-${Date.now()}`
  }).job.jobId
  updateJob(blockingId, { state: 'needs_input', computerTaskSubmitted: true })
  fs.writeFileSync(
    path.join(jobRoot, 'thread-admission.lock'),
    `${JSON.stringify({
      threadId: require('../lib/analyticsGateway/constants.cjs').COMPUTER_THREAD_ID,
      jobId: blockingId,
      ownerId: 'blocker',
      state: 'needs_input'
    })}\n`
  )
  const { jobId: nextId } = createJob({
    clientId: 'alpha',
    operation: 'bevvi_analysis_data_quality',
    arguments: { as_of: '2026-10-05' },
    idempotencyKey: `blocked-${Date.now()}`
  }).job
  const admission = acquireThreadAdmission(nextId, 'new-owner')
  assert.strictEqual(admission.ok, false)
  assert.strictEqual(admission.code, 'thread_busy')
  fs.unlinkSync(path.join(jobRoot, 'thread-admission.lock'))
}

// Exhausted artifact retries keep thread (delivery_failed)
{
  const { applyUpstreamOutcome } = require('../lib/analyticsGateway/worker.cjs')
  const { jobId } = createJob({
    clientId: 'alpha',
    operation: 'bevvi_analysis_data_quality',
    arguments: { as_of: '2026-10-06' },
    idempotencyKey: `delivery-${Date.now()}`
  }).job
  fs.writeFileSync(
    path.join(jobRoot, 'thread-admission.lock'),
    `${JSON.stringify({
      threadId: require('../lib/analyticsGateway/constants.cjs').COMPUTER_THREAD_ID,
      jobId,
      ownerId: 'delivery-owner',
      state: 'awaiting_artifact'
    })}\n`
  )
  updateJob(jobId, { artifactRetryCount: 8, computerTaskSubmitted: true })
  applyUpstreamOutcome(
    jobId,
    {
      ok: false,
      code: 'awaiting_artifact',
      message: 'still waiting',
      computerTaskSubmitted: true
    },
    'delivery-owner'
  )
  const job = readJob(jobId)
  assert.strictEqual(job.state, 'delivery_failed')
  assert.ok(readLock(), 'thread lock must remain while delivery is unresolved')
  fs.unlinkSync(path.join(jobRoot, 'thread-admission.lock'))
}

// Uncertain reconciliation must not deadlock the worker queue
{
  let artifactOnly = 0
  __testOnlySetSubmitSpy((params) => {
    if (params.artifactOnly) artifactOnly += 1
  })
  const { jobId: uncertainId } = createJob({
    clientId: 'alpha',
    operation: 'bevvi_analysis_data_quality',
    arguments: { as_of: '2026-10-07' },
    idempotencyKey: `uncertain-queue-${Date.now()}`
  }).job
  updateJob(uncertainId, { state: 'submission_uncertain', computerTaskSubmitted: true })
  const { jobId: followId } = createJob({
    clientId: 'alpha',
    operation: 'bevvi_analysis_data_quality',
    arguments: { as_of: '2026-10-08' },
    idempotencyKey: `follow-queue-${Date.now()}`
  }).job
  reconcileSubmissionUncertain(uncertainId)
  processJob(followId)
  await __testOnlyFlushQueue()
  assert.ok(artifactOnly >= 1, 'uncertain job should artifact-only reconcile')
  assert.strictEqual(readJob(followId).state, 'succeeded')
}

// Abandoned pre-submission lease is reclaimed safely
{
  process.env.BEVVI_ANALYTICS_GATEWAY_STALE_LEASE_MS = '1000'
  const { jobId } = createJob({
    clientId: 'alpha',
    operation: 'bevvi_analysis_data_quality',
    arguments: { as_of: '2026-10-09' },
    idempotencyKey: `stale-lease-${Date.now()}`
  }).job
  fs.writeFileSync(
    path.join(jobRoot, `.processing-${jobId}.lock`),
    `${JSON.stringify({
      jobId,
      ownerId: 'dead-owner',
      pid: 999999,
      acquiredAt: new Date(0).toISOString()
    })}\n`
  )
  assert.ok(reclaimAbandonedProcessingLeases().includes(jobId))
  processJob(jobId)
  await __testOnlyFlushQueue()
  assert.strictEqual(readJob(jobId).state, 'succeeded')
}

// Queued jobs waiting for thread admission are dispatched when admission frees
{
  let submits = 0
  __testOnlySetSubmitSpy(() => {
    submits += 1
  })
  const { jobId: waitingId } = createJob({
    clientId: 'alpha',
    operation: 'bevvi_analysis_data_quality',
    arguments: { as_of: '2026-10-10' },
    idempotencyKey: `waiting-${Date.now()}`
  }).job
  updateJob(waitingId, { state: 'queued', waitingForThreadAdmission: true, submissionAttemptId: null })
  dispatchQueuedJobsAfterAdmissionRelease()
  await __testOnlyFlushQueue()
  assert.strictEqual(submits, 1)
  assert.strictEqual(readJob(waitingId).state, 'succeeded')
}

fs.rmSync(jobRoot, { recursive: true, force: true })
console.log('analytics-gateway-safety-regression-test: OK')
