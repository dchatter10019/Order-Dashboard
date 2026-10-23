#!/usr/bin/env node
import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { spawn } from 'child_process'
import { createRequire } from 'module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

const jobRoot = path.join(__dirname, '..', 'data', 'analytics-gateway', 'recovery-coherence-jobs')
fs.rmSync(jobRoot, { recursive: true, force: true })
fs.mkdirSync(jobRoot, { recursive: true })

process.env.BEVVI_ANALYTICS_GATEWAY_MODE = 'mock'
process.env.BEVVI_ANALYTICS_GATEWAY_JOBS_DIR = jobRoot
process.env.BEVVI_ANALYTICS_GATEWAY_ENABLED = 'true'

const {
  acquireArtifactDeliveryLease,
  isPidConfirmedDead,
  processingJobMutexPath
} = require('../lib/analyticsGateway/jobClaim.cjs')
const { createJob, readJob, updateJob } = require('../lib/analyticsGateway/jobStore.cjs')
const {
  signalQueuedJobDispatchRequest,
  runQueuedJobDispatchTick,
  __testOnlyResetDispatchWatcherState,
  __testOnlySetDispatchFn
} = require('../lib/analyticsGateway/queuedJobDispatch.cjs')
const { listQueuedJobsForDispatch } = require('../lib/analyticsGateway/jobStore.cjs')
const { processJob, __testOnlyFlushQueue } = require('../lib/analyticsGateway/worker.cjs')
const { __testOnlySetSubmitSpy } = require('../lib/analyticsGateway/computerMcpClient.cjs')


function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

// Killed mutex holder is recoverable (kernel releases flock on process death)
{
  const { jobId } = createJob({
    clientId: 'alpha',
    operation: 'bevvi_analysis_data_quality',
    arguments: { as_of: '2026-10-20' },
    idempotencyKey: `gate-kill-${Date.now()}`
  }).job
  const readyFile = path.join(jobRoot, '.gate-hold-ready')
  const childPath = path.join(__dirname, 'analytics-gateway-process-boundary-gate-hold-child.mjs')
  const child = spawn(process.execPath, [childPath, jobId, readyFile], {
    env: { ...process.env },
    stdio: 'ignore'
  })
  const start = Date.now()
  while (!fs.existsSync(readyFile) && Date.now() - start < 5000) sleep(50)
  assert.ok(fs.existsSync(readyFile), 'child entered processing mutex')
  child.kill('SIGKILL')
  await new Promise((r) => child.on('close', r))
  assert.strictEqual(isPidConfirmedDead(child.pid), true)

  const attempt = acquireArtifactDeliveryLease(jobId, 'recovery-owner')
  assert.strictEqual(attempt.ok, true, JSON.stringify(attempt))
  assert.strictEqual(fs.existsSync(processingJobMutexPath(jobId)), true)
}

__testOnlySetDispatchFn((jobId) => processJob(jobId))

// Coalesced signal sequence still dispatches pending queued work
{
  let submits = 0
  __testOnlySetSubmitSpy(() => {
    submits += 1
  })

  fs.writeFileSync(
    path.join(jobRoot, 'queued-dispatch.signal.json'),
    `${JSON.stringify({ seq: 1, at: new Date().toISOString(), pid: process.pid })}\n`
  )
  signalQueuedJobDispatchRequest('fast-writer')
  __testOnlyResetDispatchWatcherState()
  runQueuedJobDispatchTick()

  const { jobId: waitingId } = createJob({
    clientId: 'alpha',
    operation: 'bevvi_analysis_data_quality',
    arguments: { as_of: '2026-10-21' },
    idempotencyKey: `signal-wait-${Date.now()}`
  }).job
  updateJob(waitingId, { state: 'queued', waitingForThreadAdmission: true, submissionAttemptId: null })
  assert.strictEqual(listQueuedJobsForDispatch().length, 1)

  fs.writeFileSync(
    path.join(jobRoot, 'queued-dispatch.signal.json'),
    `${JSON.stringify({
      seq: 2,
      at: new Date().toISOString(),
      pid: process.pid,
      reason: 'delayed-writer'
    })}\n`
  )

  const nextTick = runQueuedJobDispatchTick()
  await __testOnlyFlushQueue()

  assert.strictEqual(nextTick.dispatched >= 1, true, JSON.stringify(nextTick))
  assert.strictEqual(readJob(waitingId).state, 'succeeded')
  assert.strictEqual(submits, 1)
}

fs.rmSync(jobRoot, { recursive: true, force: true })
console.log('analytics-gateway-recovery-coherence-test: OK')
