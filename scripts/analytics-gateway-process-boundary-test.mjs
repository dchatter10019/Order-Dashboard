#!/usr/bin/env node
import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { spawn, spawnSync } from 'child_process'
import { createRequire } from 'module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

const jobRoot = path.join(__dirname, '..', 'data', 'analytics-gateway', 'process-boundary-jobs')
fs.rmSync(jobRoot, { recursive: true, force: true })
fs.mkdirSync(jobRoot, { recursive: true })

process.env.BEVVI_ANALYTICS_GATEWAY_MODE = 'mock'
process.env.BEVVI_ANALYTICS_GATEWAY_JOBS_DIR = jobRoot
process.env.BEVVI_ANALYTICS_GATEWAY_ENABLED = 'true'

const { createJob, readJob, updateJob } = require('../lib/analyticsGateway/jobStore.cjs')
const { processJob, __testOnlyFlushQueue } = require('../lib/analyticsGateway/worker.cjs')
const { startQueuedJobDispatchWatcher, runQueuedJobDispatchTick } = require('../lib/analyticsGateway/queuedJobDispatch.cjs')
const { __testOnlySetSubmitSpy } = require('../lib/analyticsGateway/computerMcpClient.cjs')
const { readLock } = require('../lib/analyticsGateway/jobAdmission.cjs')
const { COMPUTER_THREAD_ID } = require('../lib/analyticsGateway/constants.cjs')

startQueuedJobDispatchWatcher((jobId) => processJob(jobId))

// Separate-process reconciliation wakes gateway dispatcher
{
  let submits = 0
  __testOnlySetSubmitSpy(() => {
    submits += 1
  })
  const { jobId: firstId } = createJob({
    clientId: 'alpha',
    operation: 'bevvi_analysis_data_quality',
    arguments: { as_of: '2026-10-11' },
    idempotencyKey: `pb-first-${Date.now()}`
  }).job
  const { jobId: secondId } = createJob({
    clientId: 'alpha',
    operation: 'bevvi_analysis_data_quality',
    arguments: { as_of: '2026-10-12' },
    idempotencyKey: `pb-second-${Date.now()}`
  }).job
  updateJob(firstId, { state: 'awaiting_artifact', computerTaskSubmitted: true })
  updateJob(secondId, { state: 'queued', waitingForThreadAdmission: true, submissionAttemptId: null })
  fs.writeFileSync(
    path.join(jobRoot, 'thread-admission.lock'),
    `${JSON.stringify({
      threadId: COMPUTER_THREAD_ID,
      jobId: firstId,
      ownerId: 'pb-owner',
      state: 'awaiting_artifact'
    })}\n`
  )

  const childPath = path.join(__dirname, 'analytics-gateway-process-boundary-reconcile-child.mjs')
  const child = spawnSync(process.execPath, [childPath, firstId], {
    env: { ...process.env },
    encoding: 'utf8'
  })
  assert.strictEqual(child.status, 0, child.stderr || child.stdout)
  const childReport = JSON.parse(child.stdout.trim())
  assert.strictEqual(childReport.workerLoaded, false)
  assert.strictEqual(childReport.ok, true)
  assert.strictEqual(readJob(firstId).state, 'succeeded')

  runQueuedJobDispatchTick()
  await __testOnlyFlushQueue()

  const passed =
    readJob(secondId).state === 'succeeded' && submits === 1 && readLock() == null
  assert.strictEqual(passed, true, JSON.stringify({
    firstState: readJob(firstId).state,
    secondState: readJob(secondId).state,
    secondSubmissions: submits,
    admissionLock: readLock()
  }))
}

// Concurrent dead-owner lease takeover — exactly one winner
{
  const jobId = createJob({
    clientId: 'alpha',
    operation: 'bevvi_analysis_data_quality',
    arguments: { as_of: '2026-10-13' },
    idempotencyKey: `pb-lease-${Date.now()}`
  }).job.jobId
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

  const childPath = path.join(__dirname, 'analytics-gateway-process-boundary-lease-child.mjs')
  const env = { ...process.env }
  const ownerA = `claimant-a-${Date.now()}`
  const ownerB = `claimant-b-${Date.now()}`
  const children = [
    spawn(process.execPath, [childPath, jobId, ownerA], { env }),
    spawn(process.execPath, [childPath, jobId, ownerB], { env })
  ]
  const results = await Promise.all(
    children.map(
      (proc) =>
        new Promise((resolve, reject) => {
          let out = ''
          proc.stdout.on('data', (d) => {
            out += d
          })
          proc.on('close', (code) => {
            if (code !== 0) reject(new Error(out || `exit ${code}`))
            else resolve(JSON.parse(out.trim()))
          })
        })
    )
  )
  const successful = results.filter((r) => r.ok && r.takenOver)
  assert.strictEqual(successful.length, 1, JSON.stringify({ successfulClaimants: successful.length, claimantA: results[0], claimantB: results[1] }))
}

fs.rmSync(jobRoot, { recursive: true, force: true })
console.log('analytics-gateway-process-boundary-test: OK')
