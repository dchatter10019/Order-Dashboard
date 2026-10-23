#!/usr/bin/env node
import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { spawn, spawnSync } from 'child_process'
import { createRequire } from 'module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

const jobRootA = path.join(__dirname, '..', 'data', 'analytics-gateway', 'store-singleton-a')
const jobRootB = path.join(__dirname, '..', 'data', 'analytics-gateway', 'store-singleton-b')
fs.rmSync(jobRootA, { recursive: true, force: true })
fs.rmSync(jobRootB, { recursive: true, force: true })
fs.mkdirSync(jobRootA, { recursive: true })
fs.mkdirSync(jobRootB, { recursive: true })

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function openFdCount() {
  try {
    return fs.readdirSync(`/proc/${process.pid}/fd`).length
  } catch {
    try {
      return fs.readdirSync('/dev/fd').length
    } catch {
      return null
    }
  }
}

function resetGatewayModules(jobsDir) {
  process.env.BEVVI_ANALYTICS_GATEWAY_JOBS_DIR = jobsDir
  process.env.BEVVI_ANALYTICS_GATEWAY_MODE = 'mock'
  for (const mod of [
    '../lib/analyticsGateway/gatewayStoreSingleton.cjs',
    '../lib/analyticsGateway/osAdvisoryLock.cjs',
    '../lib/analyticsGateway/jobStore.cjs',
    '../lib/analyticsGateway/reconcileJob.cjs'
  ]) {
    delete require.cache[require.resolve(mod)]
  }
  return require('../lib/analyticsGateway/gatewayStoreSingleton.cjs')
}

// Separate jobs stores can each have an owner
{
  const a = resetGatewayModules(jobRootA)
  assert.strictEqual(a.acquireGatewayServerStoreOwnership().ok, true)
  a.releaseGatewayServerStoreOwnership()
  const b = resetGatewayModules(jobRootB)
  assert.strictEqual(b.acquireGatewayServerStoreOwnership().ok, true)
  b.releaseGatewayServerStoreOwnership()
}

// Second gateway owner on same store is rejected (separate process)
{
  resetGatewayModules(jobRootA)
  const holdPath = path.join(__dirname, 'analytics-gateway-gateway-store-hold-child.mjs')
  const acquirePath = path.join(__dirname, 'analytics-gateway-gateway-store-acquire-child.mjs')
  const readyFile = path.join(jobRootA, '.hold-ready')
  const outFile = path.join(jobRootA, '.acquire-out.json')
  const holder = spawn(process.execPath, [holdPath, jobRootA, readyFile], {
    env: { ...process.env, BEVVI_ANALYTICS_GATEWAY_JOBS_DIR: jobRootA },
    stdio: 'ignore'
  })
  const start = Date.now()
  while (!fs.existsSync(readyFile) && Date.now() - start < 5000) sleep(50)
  assert.ok(fs.existsSync(readyFile))
  const contender = spawn(process.execPath, [acquirePath, jobRootA, outFile], {
    env: { ...process.env, BEVVI_ANALYTICS_GATEWAY_JOBS_DIR: jobRootA },
    stdio: 'ignore'
  })
  assert.strictEqual(await new Promise((r) => contender.on('close', r)), 1)
  const parsed = JSON.parse(fs.readFileSync(outFile, 'utf8'))
  assert.strictEqual(parsed.ok, false)
  assert.strictEqual(parsed.code, 'gateway_store_busy')
  holder.kill('SIGKILL')
  await new Promise((r) => holder.on('close', r))
}

// Mutating reconcile blocked while server owns store (same mutex, server-first)
{
  const g = resetGatewayModules(jobRootB)
  assert.strictEqual(g.acquireGatewayServerStoreOwnership().ok, true)
  const { createJob, updateJob } = require('../lib/analyticsGateway/jobStore.cjs')
  const { reconcileGatewayJob } = require('../lib/analyticsGateway/reconcileJob.cjs')
  const { jobId } = createJob({
    clientId: 'alpha',
    operation: 'bevvi_analysis_data_quality',
    arguments: { as_of: '2026-10-01' }
  }).job
  updateJob(jobId, { state: 'submission_uncertain', computerTaskSubmitted: true })
  const blocked = await reconcileGatewayJob(jobId)
  assert.strictEqual(blocked.ok, false)
  assert.strictEqual(blocked.code, 'gateway_store_busy')
  g.releaseGatewayServerStoreOwnership()
}

// Reconcile-first: server cannot acquire while maintenance holds mutex through paused read
{
  resetGatewayModules(jobRootA)
  const { createJob, updateJob } = require('../lib/analyticsGateway/jobStore.cjs')
  const { jobId } = createJob({
    clientId: 'alpha',
    operation: 'bevvi_analysis_data_quality',
    arguments: { as_of: '2026-10-02' },
    idempotencyKey: `reconcile-first-${Date.now()}`
  }).job
  updateJob(jobId, {
    state: 'succeeded',
    computerTaskSubmitted: true,
    resultEnvelope: { gateway_mode: 'mock', handler_live_gate_status: 'mock' }
  })

  const pausedFile = path.join(jobRootA, '.reconcile-paused')
  const proceedFile = path.join(jobRootA, '.reconcile-proceed')
  const outFile = path.join(jobRootA, '.reconcile-out.json')
  const acquirePath = path.join(__dirname, 'analytics-gateway-gateway-store-acquire-child.mjs')
  const serverOut = path.join(jobRootA, '.server-during-reconcile.json')
  const reconcileChild = path.join(__dirname, 'analytics-gateway-gateway-store-reconcile-pause-child.mjs')

  const child = spawn(
    process.execPath,
    [reconcileChild, jobRootA, jobId, pausedFile, proceedFile, outFile],
    { env: { ...process.env, BEVVI_ANALYTICS_GATEWAY_JOBS_DIR: jobRootA }, stdio: 'ignore' }
  )

  const start = Date.now()
  while (!fs.existsSync(pausedFile) && Date.now() - start < 10_000) sleep(25)
  assert.ok(fs.existsSync(pausedFile), 'reconcile paused while holding maintenance mutex')

  const serverTry = spawn(process.execPath, [acquirePath, jobRootA, serverOut], {
    env: { ...process.env, BEVVI_ANALYTICS_GATEWAY_JOBS_DIR: jobRootA },
    stdio: 'ignore'
  })
  assert.strictEqual(await new Promise((r) => serverTry.on('close', r)), 1)
  const serverDuring = JSON.parse(fs.readFileSync(serverOut, 'utf8'))
  assert.strictEqual(serverDuring.ok, false)
  assert.strictEqual(serverDuring.code, 'gateway_store_busy')

  fs.writeFileSync(proceedFile, 'go\n')
  const childCode = await new Promise((r) => child.on('close', r))
  assert.strictEqual(childCode, 0, fs.readFileSync(outFile, 'utf8'))
  const parsed = JSON.parse(fs.readFileSync(outFile, 'utf8'))
  assert.strictEqual(parsed.state, 'awaiting_artifact')
}

// Two concurrent maintenance owners: second rejected
{
  resetGatewayModules(jobRootA)
  const holdPath = path.join(__dirname, 'analytics-gateway-gateway-store-maintenance-hold-child.mjs')
  const acquireMaintPath = path.join(__dirname, 'analytics-gateway-gateway-store-maintenance-acquire-child.mjs')
  const readyFile = path.join(jobRootA, '.maint-ready')
  const outFile = path.join(jobRootA, '.maint-second.json')
  const holder = spawn(process.execPath, [holdPath, jobRootA, readyFile], {
    env: { ...process.env, BEVVI_ANALYTICS_GATEWAY_JOBS_DIR: jobRootA },
    stdio: 'ignore'
  })
  const start = Date.now()
  while (!fs.existsSync(readyFile) && Date.now() - start < 5000) sleep(50)
  const second = spawn(process.execPath, [acquireMaintPath, jobRootA, outFile], {
    env: { ...process.env, BEVVI_ANALYTICS_GATEWAY_JOBS_DIR: jobRootA },
    stdio: 'ignore'
  })
  assert.strictEqual(await new Promise((r) => second.on('close', r)), 1)
  const parsed = JSON.parse(fs.readFileSync(outFile, 'utf8'))
  assert.strictEqual(parsed.ok, false)
  assert.strictEqual(parsed.code, 'gateway_store_busy')
  holder.kill('SIGKILL')
  await new Promise((r) => holder.on('close', r))
}

// Unrelated async reconciliations in one process must not share a release handle.
{
  const g = resetGatewayModules(jobRootB)
  const store = require('../lib/analyticsGateway/jobStore.cjs')
  const reconcile = require('../lib/analyticsGateway/reconcileJob.cjs')
  const create = () => {
    const job = store.createJob({
      clientId: 'synthetic',
      operation: 'bevvi_analysis_data_quality',
      arguments: { as_of: '2026-10-02' }
    }).job
    store.updateJob(job.jobId, { state: 'submission_uncertain', computerTaskSubmitted: true })
    return job
  }
  const a = create()
  const b = create()
  const beforeB = JSON.stringify(store.readJob(b.jobId))
  let finishA
  let calls = 0
  let settledA = false
  reconcile.__testOnlySetFetchJobBoundArtifact((jobId) => {
    calls += 1
    assert.strictEqual(jobId, a.jobId, 'B must not reach artifact retrieval')
    return new Promise((resolve) => { finishA = resolve })
  })
  const runningA = reconcile.reconcileGatewayJob(a.jobId).finally(() => { settledA = true })
  try {
    const rejectedB = await reconcile.reconcileGatewayJob(b.jobId)
    assert.strictEqual(rejectedB.code, 'gateway_store_busy')
    assert.strictEqual(rejectedB.ok, false)
    assert.strictEqual(calls, 1)
    assert.strictEqual(JSON.stringify(store.readJob(b.jobId)), beforeB, 'B must not mutate its job')
    assert.strictEqual(settledA, false)
    assert.strictEqual(g.acquireGatewayServerStoreOwnership().code, 'gateway_store_busy')

    const outFile = path.join(jobRootB, '.same-process-overlap-server.json')
    const serverTry = spawnSync(process.execPath, [
      path.join(__dirname, 'analytics-gateway-gateway-store-acquire-child.mjs'),
      jobRootB,
      outFile
    ], { env: { ...process.env }, encoding: 'utf8', timeout: 5000 })
    assert.strictEqual(serverTry.status, 1, serverTry.stderr)
    assert.strictEqual(JSON.parse(fs.readFileSync(outFile, 'utf8')).code, 'gateway_store_busy')
  } finally {
    finishA({ ok: false, code: 'awaiting_artifact', message: 'Synthetic artifact pending' })
    await runningA
    reconcile.__testOnlySetFetchJobBoundArtifact(null)
  }
  assert.strictEqual(settledA, true)
  assert.strictEqual(g.acquireGatewayServerStoreOwnership().ok, true)
  g.releaseGatewayServerStoreOwnership()
}

// SIGKILL of holder allows later acquisition; mutex file remains
{
  const g = resetGatewayModules(jobRootA)
  const readyFile = path.join(jobRootA, '.kill-ready')
  const holdPath = path.join(__dirname, 'analytics-gateway-gateway-store-hold-child.mjs')
  const mutexPath = g.gatewayServerMutexPath()
  const child = spawn(process.execPath, [holdPath, jobRootA, readyFile], {
    env: { ...process.env, BEVVI_ANALYTICS_GATEWAY_JOBS_DIR: jobRootA },
    stdio: 'ignore'
  })
  const start = Date.now()
  while (!fs.existsSync(readyFile) && Date.now() - start < 5000) sleep(50)
  child.kill('SIGKILL')
  await new Promise((r) => child.on('close', r))
  sleep(100)
  assert.strictEqual(fs.existsSync(mutexPath), true)
  const after = resetGatewayModules(jobRootA)
  assert.strictEqual(after.acquireGatewayServerStoreOwnership().ok, true)
  after.releaseGatewayServerStoreOwnership()
}

// Native acquisition throw closes descriptor (synthetic ENOSYS)
{
  resetGatewayModules(jobRootA)
  const { acquireAdvisoryLockHold, __testOnlySetFlockSyncImpl } = require('../lib/analyticsGateway/osAdvisoryLock.cjs')
  __testOnlySetFlockSyncImpl(() => {
    const err = new Error('ENOSYS')
    err.code = 'ENOSYS'
    throw err
  })
  const before = openFdCount()
  for (let i = 0; i < 3; i += 1) {
    assert.throws(() => acquireAdvisoryLockHold('fd-leak-probe.mutex'), (e) => e.code === 'ENOSYS')
  }
  const after = openFdCount()
  if (before !== null && after !== null) {
    assert.strictEqual(after, before, `fd leak on flock error (delta ${after - before})`)
  }
  __testOnlySetFlockSyncImpl(null)
}

fs.rmSync(jobRootA, { recursive: true, force: true })
fs.rmSync(jobRootB, { recursive: true, force: true })
console.log('analytics-gateway-gateway-store-singleton-test: OK')
