#!/usr/bin/env node
import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { spawn } from 'child_process'
import { createRequire } from 'module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

const jobRoot = path.join(__dirname, '..', 'data', 'analytics-gateway', 'concurrency-probes-jobs')
fs.rmSync(jobRoot, { recursive: true, force: true })
fs.mkdirSync(jobRoot, { recursive: true })

process.env.BEVVI_ANALYTICS_GATEWAY_MODE = 'mock'
process.env.BEVVI_ANALYTICS_GATEWAY_JOBS_DIR = jobRoot
process.env.BEVVI_ANALYTICS_GATEWAY_ENABLED = 'true'

const { processingJobMutexPath } = require('../lib/analyticsGateway/jobClaim.cjs')
const { createJob, readJob, updateJob } = require('../lib/analyticsGateway/jobStore.cjs')
const {
  signalWriteLockPath,
  runQueuedJobDispatchTick,
  __testOnlyResetDispatchWatcherState,
  __testOnlySetDispatchFn
} = require('../lib/analyticsGateway/queuedJobDispatch.cjs')
const { listQueuedJobsForDispatch } = require('../lib/analyticsGateway/jobStore.cjs')
const { processJob, __testOnlyFlushQueue } = require('../lib/analyticsGateway/worker.cjs')
const { __testOnlySetSubmitSpy } = require('../lib/analyticsGateway/computerMcpClient.cjs')
const {
  SIGNAL_MUTEX_SEGMENT,
  __testOnlyAcquireAndHold
} = require('../lib/analyticsGateway/osAdvisoryLock.cjs')

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

// Replacement for legacy gate-reclaim unlink race: OS mutex mutual exclusion + stable file
{
  const coord = path.join(jobRoot, 'gate-race-coord')
  fs.mkdirSync(coord, { recursive: true })
  const jobId = `gate-race-${Date.now()}`
  const mutexPath = processingJobMutexPath(jobId)

  const pausedFile = path.join(coord, 'a-paused')
  const proceedFile = path.join(coord, 'proceed')
  const outA = path.join(coord, 'out-a.json')
  const outB = path.join(coord, 'out-b.json')
  const childAPath = path.join(__dirname, 'analytics-gateway-gate-reclaim-race-child-a.mjs')
  const childBPath = path.join(__dirname, 'analytics-gateway-gate-reclaim-race-child-b.mjs')
  const env = { ...process.env }

  const childA = spawn(process.execPath, [childAPath, jobId, pausedFile, proceedFile, outA], {
    env,
    stdio: 'ignore'
  })
  const childB = spawn(process.execPath, [childBPath, jobId, pausedFile, outB], {
    env,
    stdio: 'ignore'
  })

  const start = Date.now()
  while (!fs.existsSync(pausedFile) && Date.now() - start < 10_000) sleep(25)
  assert.ok(fs.existsSync(pausedFile), 'process A paused after OS mutex acquisition')
  sleep(150)
  fs.writeFileSync(proceedFile, 'go\n')

  const codes = await Promise.all([
    new Promise((resolve) => childA.on('close', resolve)),
    new Promise((resolve) => childB.on('close', resolve))
  ])
  assert.strictEqual(codes.every((c) => c === 0), true, `children exited ${codes.join(',')}`)

  const resultA = JSON.parse(fs.readFileSync(outA, 'utf8'))
  const resultB = JSON.parse(fs.readFileSync(outB, 'utf8'))
  const insideA = resultA.ok === true && resultA.value === 'A'
  const insideB = resultB.ok === true && resultB.value === 'B'
  assert.strictEqual(
    insideA && insideB,
    false,
    `bothInside OS mutex race: ${JSON.stringify({ resultA, resultB })}`
  )
  assert.strictEqual(insideA || insideB, true, 'expected exactly one contender to hold the mutex')
  assert.strictEqual(fs.existsSync(mutexPath), true, 'mutex path must not be unlinked')
}

__testOnlySetDispatchFn((jobId) => processJob(jobId))

// Busy signal mutex during completion must not downgrade validated success
{
  let submits = 0
  __testOnlySetSubmitSpy(() => {
    submits += 1
  })

  const { jobId: completingId } = createJob({
    clientId: 'alpha',
    operation: 'bevvi_analysis_data_quality',
    arguments: { as_of: '2026-10-22' },
    idempotencyKey: `busy-signal-complete-${Date.now()}`
  }).job
  updateJob(completingId, {
    state: 'queued',
    waitingForThreadAdmission: false,
    submissionAttemptId: `attempt-${Date.now()}`
  })

  const hold = __testOnlyAcquireAndHold(SIGNAL_MUTEX_SEGMENT)
  assert.strictEqual(hold.ok, true)
  assert.strictEqual(fs.existsSync(signalWriteLockPath()), true)

  await processJob(completingId)
  await __testOnlyFlushQueue()

  const completed = readJob(completingId)
  assert.strictEqual(completed.state, 'succeeded')
  assert.ok(completed.resultEnvelope)
  assert.strictEqual(completed.error, null)

  hold.release()

  const { jobId: waitingId } = createJob({
    clientId: 'alpha',
    operation: 'bevvi_analysis_data_quality',
    arguments: { as_of: '2026-10-23' },
    idempotencyKey: `busy-signal-wait-${Date.now()}`
  }).job
  updateJob(waitingId, {
    state: 'queued',
    waitingForThreadAdmission: true,
    submissionAttemptId: null
  })
  assert.strictEqual(listQueuedJobsForDispatch().length, 1)

  __testOnlyResetDispatchWatcherState()
  runQueuedJobDispatchTick()
  await __testOnlyFlushQueue()

  assert.strictEqual(readJob(waitingId).state, 'succeeded')
  assert.strictEqual(submits, 2, 'one submit for completing job and one for waiting job')
  assert.strictEqual(fs.existsSync(signalWriteLockPath()), true)
}

fs.rmSync(jobRoot, { recursive: true, force: true })
console.log('analytics-gateway-concurrency-probes-test: OK')
