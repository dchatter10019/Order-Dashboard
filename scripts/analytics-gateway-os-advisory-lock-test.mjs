#!/usr/bin/env node
import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { spawn } from 'child_process'
import { createRequire } from 'module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

const jobRoot = path.join(__dirname, '..', 'data', 'analytics-gateway', 'os-advisory-lock-jobs')
fs.rmSync(jobRoot, { recursive: true, force: true })
fs.mkdirSync(jobRoot, { recursive: true })

process.env.BEVVI_ANALYTICS_GATEWAY_MODE = 'mock'
process.env.BEVVI_ANALYTICS_GATEWAY_JOBS_DIR = jobRoot
process.env.BEVVI_ANALYTICS_GATEWAY_ENABLED = 'true'

const {
  assertAdvisoryLockCapability,
  jobProcessingMutexSegment,
  mutexPathForSegment,
  withExclusiveAdvisoryLock,
  __testOnlyAcquireAndHold,
  __testOnlyHeldInProcessCount
} = require('../lib/analyticsGateway/osAdvisoryLock.cjs')
const {
  withJobProcessingMutex,
  processingJobMutexPath,
  withProcessingLeaseGate
} = require('../lib/analyticsGateway/jobClaim.cjs')

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

assertAdvisoryLockCapability()

const probeSegment = `probe-${Date.now()}.mutex`
const probePath = mutexPathForSegment(probeSegment)

const first = withExclusiveAdvisoryLock(probeSegment, () => 'held')
assert.strictEqual(first.ok, true)
assert.strictEqual(first.value, 'held')
assert.strictEqual(fs.existsSync(probePath), true)

const nested = withExclusiveAdvisoryLock(probeSegment, () => {
  const inner = withExclusiveAdvisoryLock(probeSegment, () => 'nested')
  assert.strictEqual(inner.ok, true)
  assert.strictEqual(inner.reentrant, true)
  return inner.value
})
assert.strictEqual(nested.ok, true)
assert.strictEqual(__testOnlyHeldInProcessCount(), 0)

const hold = __testOnlyAcquireAndHold(probeSegment)
assert.strictEqual(hold.ok, true)
const blocked = withExclusiveAdvisoryLock(probeSegment, () => 'never')
assert.strictEqual(blocked.ok, false)
assert.strictEqual(blocked.code, 'mutex_busy')
hold.release()

// Concurrent overlap via real child processes
{
  const jobId = `mutex-overlap-${Date.now()}`
  const coord = path.join(jobRoot, 'overlap-coord')
  fs.mkdirSync(coord, { recursive: true })
  const pausedFile = path.join(coord, 'paused')
  const proceedFile = path.join(coord, 'proceed')
  const insideFile = path.join(coord, 'inside')
  const outA = path.join(coord, 'out-a.json')
  const outB = path.join(coord, 'out-b.json')
  const childPath = path.join(__dirname, 'analytics-gateway-os-mutex-contention-child.mjs')
  const env = { ...process.env }

  const mutexPath = processingJobMutexPath(jobId)
  const childA = spawn(
    process.execPath,
    [childPath, jobId, pausedFile, proceedFile, insideFile, outA, 'A'],
    { env, stdio: 'ignore' }
  )
  const childB = spawn(
    process.execPath,
    [childPath, jobId, pausedFile, proceedFile, insideFile, outB, 'B'],
    { env, stdio: 'ignore' }
  )

  const start = Date.now()
  while (!fs.existsSync(pausedFile) && Date.now() - start < 10_000) sleep(25)
  assert.ok(fs.existsSync(pausedFile), 'holder paused after OS lock acquisition')
  sleep(150)
  fs.writeFileSync(proceedFile, 'go\n')

  await Promise.all([
    new Promise((resolve) => childA.on('close', resolve)),
    new Promise((resolve) => childB.on('close', resolve))
  ])

  const resultA = JSON.parse(fs.readFileSync(outA, 'utf8'))
  const resultB = JSON.parse(fs.readFileSync(outB, 'utf8'))
  const insideA = resultA.ok === true && resultA.value === 'A'
  const insideB = resultB.ok === true && resultB.value === 'B'
  assert.strictEqual(insideA && insideB, false, JSON.stringify({ resultA, resultB }))
  assert.strictEqual(fs.existsSync(mutexPath), true, 'mutex file must remain on disk')
}

// SIGKILL releases kernel flock without deleting mutex file
{
  const jobId = `mutex-kill-${Date.now()}`
  const readyFile = path.join(jobRoot, '.kill-ready')
  const childPath = path.join(__dirname, 'analytics-gateway-process-boundary-gate-hold-child.mjs')
  const mutexPath = processingJobMutexPath(jobId)
  const child = spawn(process.execPath, [childPath, jobId, readyFile], {
    env: { ...process.env },
    stdio: 'ignore'
  })
  const start = Date.now()
  while (!fs.existsSync(readyFile) && Date.now() - start < 5000) sleep(50)
  assert.ok(fs.existsSync(readyFile))
  child.kill('SIGKILL')
  await new Promise((r) => child.on('close', r))
  sleep(100)
  assert.strictEqual(fs.existsSync(mutexPath), true)
  const after = withProcessingLeaseGate(jobId, () => 'recovered')
  assert.strictEqual(after.ok, true, JSON.stringify(after))
}

// Throwing callback still releases descriptor
{
  const seg = `throw-${Date.now()}.mutex`
  assert.throws(() => {
    withExclusiveAdvisoryLock(seg, () => {
      throw new Error('boom')
    })
  }, /boom/)
  const after = withExclusiveAdvisoryLock(seg, () => 'ok')
  assert.strictEqual(after.ok, true)
}

fs.rmSync(jobRoot, { recursive: true, force: true })
console.log('analytics-gateway-os-advisory-lock-test: OK')
