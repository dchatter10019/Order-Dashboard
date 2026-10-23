#!/usr/bin/env node
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
const require = createRequire(import.meta.url)
const Module = require('module')
const originalLoad = Module._load
Module._load = function (name, ...args) {
  assert(!/(worker\.cjs|jobRecovery\.cjs|computerMcpLive|computerMcpClient|perplexityOAuth|admissionDispatch|queuedJobDispatch|artifactRetryScheduler)/.test(name),
    `Forbidden operational import: ${name}`)
  return originalLoad.call(this, name, ...args)
}
const { repairOfflineArtifact } = require('../lib/analyticsGateway/offlineArtifactRepair.cjs')
const ownership = require('../lib/analyticsGateway/gatewayStoreSingleton.cjs')
const locks = require('../lib/analyticsGateway/osAdvisoryLock.cjs')
const { hashCanonicalArguments } = require('../lib/analyticsGateway/canonicalJson.cjs')
const { buildMockHandlerResult } = require('../lib/analyticsGateway/mockHandlerResult.cjs')
const { wrapHandlerArtifact } = require('../lib/analyticsGateway/jobBinding.cjs')
const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex')
const encode = (x) => Buffer.from(`${JSON.stringify(x, null, 2)}\n`)
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'q3-repair-synthetic-'))
const priorEnv = process.env.BEVVI_ANALYTICS_GATEWAY_JOBS_DIR
let checks = 0
function test(name, callback) {
  callback()
  checks++
  console.log(`OK ${name}`)
}
function fixture() {
  const base = fs.mkdtempSync(path.join(root, 'case-'))
  const dir = path.join(base, 'jobs')
  const evidence = path.join(base, 'evidence')
  fs.mkdirSync(dir); fs.mkdirSync(evidence)
  process.env.BEVVI_ANALYTICS_GATEWAY_JOBS_DIR = dir
  const policy = {
    jobId: crypto.randomUUID(), operation: 'bevvi_planning_forecast',
    arguments: { as_of: '2026-10-02', model: 'planning_blend_v1' },
    threadId: '40f3ef7a-ab04-486c-9e52-9c2485d1cec8',
    idempotencyKey: `synthetic-only-${crypto.randomUUID()}`, assetId: crypto.randomUUID()
  }
  policy.requestHash = hashCanonicalArguments(policy.arguments)
  const job = {
    jobId: policy.jobId, clientId: 'synthetic', operation: policy.operation,
    arguments: policy.arguments, pythonArguments: policy.arguments, requestHash: policy.requestHash,
    computerThreadId: policy.threadId, idempotencyKey: policy.idempotencyKey,
    submissionAttemptId: crypto.randomUUID(), computerTaskSubmitted: true,
    state: 'succeeded', gatewayExecutionMode: null, artifactRetryCount: 0,
    createdAt: '2026-10-04T21:26:00Z', updatedAt: '2026-10-04T21:27:00Z',
    resultEnvelope: { gateway_mode: 'mock', provenance: { asset_identity: null }, result: { placeholder: true } },
    auditHistory: [{ type: 'prior_event' }], customPreservedField: { marker: 123 }
  }
  const file = path.join(dir, `${policy.jobId}.json`)
  const jobBytes = encode(job); fs.writeFileSync(file, jobBytes)
  policy.jobSha256 = digest(jobBytes)
  const handler = buildMockHandlerResult({ operation: policy.operation, args: policy.arguments })
  handler.provenance.cache_age_hours = 0 // Synthetic generation/refresh are equal.
  const artifact = wrapHandlerArtifact(job, handler)
  const artifactPath = path.join(base, 'artifact.json')
  fs.writeFileSync(artifactPath, encode(artifact)); policy.artifactSha256 = digest(encode(artifact))
  const contextPath = path.join(base, 'submission.log')
  const contextText = `SYNTHETIC FIXTURE ONLY local_test ${job.jobId} ${job.idempotencyKey} ${job.submissionAttemptId}`
  fs.writeFileSync(contextPath, contextText)
  const manifestPath = path.join(base, 'manifest.json')
  const manifest = { run_id: crypto.randomUUID(), submissions_attempted: 1, note: 'Regenerated current baseline, NOT historical count 3' }
  fs.writeFileSync(manifestPath, encode(manifest))
  fs.writeFileSync(path.join(dir, 'queued-dispatch.signal.json'), '{"seq":17,"reason":"historical"}\n')
  const plan = {
    schema_version: 'q3_offline_repair_plan_v1', jobs_dir: dir, evidence_parent: evidence,
    artifact_path: artifactPath, manifest_path: manifestPath,
    manifest_run_id: manifest.run_id, manifest_sha256: digest(encode(manifest)),
    execution_context: {
      mode: 'local_test', job_id: job.jobId, request_hash: job.requestHash,
      idempotency_key: job.idempotencyKey, thread_id: policy.threadId,
      submission_attempt_id: job.submissionAttemptId, reviewer: 'synthetic reviewer',
      reviewed_statement: 'Original submission was local_test; not inferred from the mock envelope or artifact.',
      references: [{ path: contextPath, sha256: digest(Buffer.from(contextText)),
        kind: 'submission_log', excerpts: [contextText] }]
    }
  }
  const planPath = path.join(base, 'plan.json')
  function run() {
    fs.writeFileSync(planPath, encode(plan))
    return repairOfflineArtifact({ planPath, approvedPlanSha256: digest(encode(plan)), policy, executionApproved: true })
  }
  function alterJob(fn) {
    fn(job); fs.writeFileSync(file, encode(job)); policy.jobSha256 = digest(encode(job))
  }
  function alterArtifact(fn) {
    fn(artifact); fs.writeFileSync(artifactPath, encode(artifact)); policy.artifactSha256 = digest(encode(artifact))
  }
  return { base, dir, evidence, file, jobBytes, job, policy, plan, planPath, manifestPath,
    artifact, artifactPath, contextPath, run, alterJob, alterArtifact }
}
function blocked(f, expectedCode) {
  const before = fs.readFileSync(f.file)
  const manifest = fs.readFileSync(f.manifestPath)
  const r = f.run()
  assert.equal(r.ok, false, JSON.stringify(r))
  assert.equal(r.committed, false, JSON.stringify(r))
  if (expectedCode) assert.equal(r.code, expectedCode, JSON.stringify(r))
  assert.deepEqual(fs.readFileSync(f.file), before)
  assert.deepEqual(fs.readFileSync(f.manifestPath), manifest)
  return r
}
try {
  test('no approval: no directory creation or lock acquisition', () => {
    const f = fixture()
    const r = repairOfflineArtifact({ executionApproved: false })
    assert.equal(r.code, 'execution_approval_required')
    assert(!fs.existsSync(path.join(f.dir, '.os-mutex')))
  })
  test('CLI --help does not access a store', () => {
    const f = fixture()
    const p = spawnSync(process.execPath, ['scripts/analytics-gateway-q3-offline-repair.mjs', '--help'], { encoding: 'utf8' })
    assert.equal(p.status, 0, p.stderr)
    assert(!fs.existsSync(path.join(f.dir, '.os-mutex')))
  })
  test('wrong approved plan digest fails before locks', () => {
    const f = fixture(); fs.writeFileSync(f.planPath, encode(f.plan))
    const r = repairOfflineArtifact({ planPath: f.planPath, approvedPlanSha256: '0'.repeat(64), executionApproved: true, policy: f.policy })
    assert.equal(r.code, 'plan_digest_mismatch'); assert(!fs.existsSync(path.join(f.dir, '.os-mutex')))
  })
  test('successful synthetic import preserves bytes, all submission fields and current manifest count 1', () => {
    const f = fixture()
    const manifest = fs.readFileSync(f.manifestPath)
    const signal = fs.readFileSync(path.join(f.dir, 'queued-dispatch.signal.json'))
    const result = f.run()
    assert.equal(result.ok, true, JSON.stringify(result))
    const after = JSON.parse(fs.readFileSync(f.file))
    assert.equal(after.gatewayExecutionMode, 'local_test')
    assert.equal(after.resultEnvelope.integration_test_passed, true)
    assert.equal(after.resultEnvelope.provenance.asset_identity.byte_digest, f.policy.artifactSha256)
    assert.equal(after.auditHistory.length, 2)
    assert.equal(after.auditHistory[1].recovery_method, 'offline_verified_artifact_import')
    const mutable = new Set(['gatewayExecutionMode', 'resultEnvelope', 'state', 'error', 'updatedAt', 'auditHistory'])
    for (const [key, value] of Object.entries(f.job)) if (!mutable.has(key)) assert.deepEqual(after[key], value, key)
    assert.deepEqual(fs.readFileSync(f.manifestPath), manifest)
    assert.deepEqual(fs.readFileSync(path.join(f.dir, 'queued-dispatch.signal.json')), signal)
    assert.deepEqual(fs.readFileSync(path.join(result.evidence_directory, 'job-before.json')), f.jobBytes)
    assert.deepEqual(fs.readFileSync(path.join(result.evidence_directory, 'artifact.json')), fs.readFileSync(f.artifactPath))
    assert.equal(fs.statSync(result.evidence_directory).mode & 0o777, 0o700)
    assert.equal(fs.statSync(path.join(result.evidence_directory, 'artifact.json')).mode & 0o777, 0o600)
    const receipt = JSON.parse(fs.readFileSync(path.join(result.evidence_directory, 'receipt.json')))
    assert.equal(receipt.committed, true)
    assert.equal(receipt.original_automatic_delivery_proven, false)
    assert.equal(receipt.provider_calls, 0)
    assert.equal(digest(fs.readFileSync(f.file)), receipt.after_job_sha256)
    const repeat = f.run()
    assert.equal(repeat.code, 'job_baseline_mismatch') // No second mutation, no optimistic already-repaired claim.
  })
  test('existing stable mutex files do not block', () => {
    const f = fixture()
    fs.mkdirSync(path.join(f.dir, '.os-mutex'))
    for (const n of ['gateway-server.singleton.mutex', `processing-${f.policy.jobId}.mutex`]) {
      fs.writeFileSync(path.join(f.dir, '.os-mutex', n), '')
    }
    assert.equal(f.run().ok, true)
  })
  test('four queued jobs block; no queue repair or evidence writes', () => {
    const f = fixture()
    for (let i = 0; i < 4; i++) {
      const id = crypto.randomUUID(); fs.writeFileSync(path.join(f.dir, `${id}.json`), encode({ jobId: id, state: 'queued' }))
    }
    blocked(f, 'store_not_quiescent')
    assert.deepEqual(fs.readdirSync(f.evidence), [])
  })
  test('unknown job state fails closed', () => {
    const f = fixture(); const id = crypto.randomUUID()
    fs.writeFileSync(path.join(f.dir, `${id}.json`), encode({ jobId: id, state: 'unrecognized' }))
    blocked(f, 'unknown_job_state')
  })
  test('malformed job fails closed', () => {
    const f = fixture(); fs.writeFileSync(path.join(f.dir, `${crypto.randomUUID()}.json`), '{')
    blocked(f, 'malformed_job_record')
  })
  for (const name of ['thread-admission.lock', '.processing-test.lock', '.jobmut-test.lock']) {
    test(`lease blocks without deletion: ${name}`, () => {
      const f = fixture(); fs.writeFileSync(path.join(f.dir, name), 'unknown owner')
      blocked(f, 'admission_or_processing_lease_present')
      assert.equal(fs.readFileSync(path.join(f.dir, name), 'utf8'), 'unknown owner')
    })
  }
  test('same-process server owner blocks', () => {
    const f = fixture(); assert.equal(ownership.acquireGatewayServerStoreOwnership().ok, true)
    try { blocked(f, 'gateway_store_busy') } finally { ownership.releaseGatewayServerStoreOwnership() }
  })
  test('second maintenance owner blocks', () => {
    const f = fixture(); const hold = ownership.acquireGatewayMaintenanceStoreOwnership()
    try { blocked(f, 'gateway_store_busy') } finally { hold.release() }
  })
  test('processing mutex owner blocks', () => {
    const f = fixture(); const hold = locks.acquireAdvisoryLockHold(locks.jobProcessingMutexSegment(f.policy.jobId))
    try { blocked(f, 'processing_mutex_busy') } finally { hold.release() }
  })
  test('manifest drift blocks', () => {
    const f = fixture(); fs.appendFileSync(f.manifestPath, ' ')
    blocked(f, 'manifest_digest_mismatch')
  })
  test('job baseline drift blocks', () => {
    const f = fixture(); fs.appendFileSync(f.file, ' ')
    blocked(f, 'job_baseline_mismatch')
  })
  test('artifact byte drift blocks', () => {
    const f = fixture(); fs.appendFileSync(f.artifactPath, ' ')
    blocked(f, 'artifact_digest_mismatch')
  })
  test('context required and never inferred from envelope', () => {
    const f = fixture(); delete f.plan.execution_context
    blocked(f, 'execution_context_mismatch')
  })
  test('wrong context attempt ID blocks', () => {
    const f = fixture(); f.plan.execution_context.submission_attempt_id = crypto.randomUUID()
    blocked(f, 'execution_context_mismatch')
  })
  test('source context digest must match', () => {
    const f = fixture(); fs.appendFileSync(f.contextPath, ' ')
    blocked(f, 'context_digest_mismatch')
  })
  test('human-reviewed independent references required', () => {
    const f = fixture(); f.plan.execution_context.references[0].kind = 'artifact'
    blocked(f, 'unsupported_context_reference')
  })
  test('original artifact cannot serve as context reference', () => {
    const f = fixture(); f.plan.execution_context.references[0].path = f.artifactPath
    blocked(f, 'context_reference_not_independent')
  })
  test('conflicting persisted mode blocks', () => {
    const f = fixture(); f.alterJob(j => { j.gatewayExecutionMode = 'mock' })
    blocked(f, 'conflicting_execution_mode')
  })
  test('binding mismatch fails even when artifact digest is approved in synthetic policy', () => {
    const f = fixture(); f.alterArtifact(a => { a.gateway_job_binding.job_id = crypto.randomUUID() })
    blocked(f, 'job_mismatch')
  })
  test('handler-only artifact rejected, no wrapper reconstruction', () => {
    const f = fixture(); fs.writeFileSync(f.artifactPath, encode(f.artifact.handler_result))
    f.policy.artifactSha256 = digest(fs.readFileSync(f.artifactPath))
    blocked(f, 'artifact_wrapper_required')
  })
  test('unapproved analysis source blocked', () => {
    const f = fixture(); f.alterArtifact(a => { a.handler_result.provenance.analysis_source_sha256 = '0'.repeat(64) })
    blocked(f, 'unapproved_code_hash')
  })
  test('stale evidence evaluated at actual current time', () => {
    const f = fixture(); f.alterArtifact(a => {
      const old = new Date(Date.now() - 8 * 86400000).toISOString()
      a.handler_result.generated_at_utc = old
      a.handler_result.provenance.newest_cache_refresh_at_utc = old
    })
    blocked(f, 'cache_stale_at_delivery')
  })
  test('live gate ON rejected', () => {
    const f = fixture(); f.alterArtifact(a => { a.handler_result.live_gate_status = 'ON' })
    blocked(f, 'live_gate_not_off')
  })
  test('phase1 off rejected', () => {
    const f = fixture(); f.alterArtifact(a => { a.handler_result.provenance.phase1_active = false })
    blocked(f, 'phase1_inactive')
  })
  test('artifact path inside jobs rejected', () => {
    const f = fixture(); f.plan.artifact_path = f.file
    blocked(f, 'unsafe_input_location')
  })
  test('evidence parent inside jobs rejected', () => {
    const f = fixture(); f.plan.evidence_parent = f.dir
    blocked(f, 'unsafe_evidence_parent')
  })
  test('symlink artifact rejected', () => {
    const f = fixture(); const alias = path.join(f.base, 'alias.json')
    fs.symlinkSync(f.artifactPath, alias); f.plan.artifact_path = alias
    blocked(f, 'symlink_rejected')
  })
  test('locks held continuously through replacement and receipt; competing process blocked', () => {
    const f = fixture()
    const originalRename = fs.renameSync
    let observations = 0
    fs.renameSync = function (...args) {
      if (args[1] === f.file || args[1].endsWith('/receipt.json')) {
        assert.equal(ownership.acquireGatewayServerStoreOwnership().ok, false)
        const p = spawnSync(process.execPath, ['-e',
          `const m=require('./lib/analyticsGateway/gatewayStoreSingleton.cjs');const h=m.acquireGatewayMaintenanceStoreOwnership();if(h.ok)h.release();process.exit(h.ok?7:0)`],
        { encoding: 'utf8', env: { ...process.env } })
        assert.equal(p.status, 0, p.stderr)
        observations++
      }
      return originalRename.apply(this, args)
    }
    try { assert.equal(f.run().ok, true); assert.equal(observations, 2) }
    finally { fs.renameSync = originalRename }
    const h = ownership.acquireGatewayMaintenanceStoreOwnership(); assert.equal(h.ok, true); h.release()
  })
  test('evidence write failure leaves job unchanged and releases lock', () => {
    const f = fixture(); const originalOpen = fs.openSync
    fs.openSync = function (file, ...args) {
      if (String(file).endsWith('/artifact.json') && args[0] === 'wx') {
        throw Object.assign(new Error('synthetic disk failure'), { code: 'ENOSPC' })
      }
      return originalOpen.call(this, file, ...args)
    }
    try { blocked(f, 'ENOSPC') } finally { fs.openSync = originalOpen }
    const h = ownership.acquireGatewayMaintenanceStoreOwnership(); assert.equal(h.ok, true); h.release()
  })
  test('commit failure does not change job or leave temp job files', () => {
    const f = fixture(); const originalRename = fs.renameSync
    fs.renameSync = function (...args) {
      if (args[1] === f.file) throw Object.assign(new Error('synthetic rename failure'), { code: 'EIO' })
      return originalRename.apply(this, args)
    }
    try { blocked(f, 'EIO') } finally { fs.renameSync = originalRename }
    assert(!fs.readdirSync(f.dir).some(n => n.endsWith('.tmp')))
  })
  test('context change during evidence phase blocks before commit', () => {
    const f = fixture(); const originalOpen = fs.openSync
    fs.openSync = function (file, ...args) {
      if (String(file).endsWith('/prepared-receipt.json') && args[0] === 'wx') {
        fs.appendFileSync(f.contextPath, 'external synthetic mutation')
      }
      return originalOpen.call(this, file, ...args)
    }
    try { blocked(f, 'context_changed') } finally { fs.openSync = originalOpen }
  })
  test('new queued job during evidence phase blocks before commit without removing it', () => {
    const f = fixture(); const originalOpen = fs.openSync
    const id = crypto.randomUUID()
    fs.openSync = function (file, ...args) {
      if (String(file).endsWith('/prepared-receipt.json') && args[0] === 'wx') {
        fs.writeFileSync(path.join(f.dir, `${id}.json`), encode({ jobId: id, state: 'queued' }))
      }
      return originalOpen.call(this, file, ...args)
    }
    try { blocked(f, 'store_changed') } finally { fs.openSync = originalOpen }
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.dir, `${id}.json`))).state, 'queued')
  })
  test('other terminal jobs and dispatch signal remain byte-identical', () => {
    const f = fixture(); const id = crypto.randomUUID()
    const file = path.join(f.dir, `${id}.json`)
    const bytes = encode({ jobId: id, state: 'succeeded', marker: 'not part of this repair' })
    fs.writeFileSync(file, bytes)
    assert.equal(f.run().ok, true)
    assert.deepEqual(fs.readFileSync(file), bytes)
  })
  test('post-commit readback failure reports committed and retains the repaired job', () => {
    const f = fixture(); const originalRead = fs.readFileSync
    let writesCompleted = false
    const originalRename = fs.renameSync
    fs.renameSync = function (...args) {
      const result = originalRename.apply(this, args)
      if (args[1] === f.file) writesCompleted = true
      return result
    }
    fs.readFileSync = function (file, ...args) {
      if (writesCompleted && typeof file === 'number') {
        throw Object.assign(new Error('synthetic readback failure'), { code: 'EIO' })
      }
      return originalRead.call(this, file, ...args)
    }
    let result
    try { result = f.run() }
    finally { fs.readFileSync = originalRead; fs.renameSync = originalRename }
    assert.equal(result.ok, false); assert.equal(result.committed, true)
    assert.equal(result.stage, 'readback')
    assert.equal(JSON.parse(fs.readFileSync(f.file)).resultEnvelope.gateway_mode, 'local_test')
  })
  test('post-commit receipt failure reports committed, never rolls back to mock', () => {
    const f = fixture(); const originalRename = fs.renameSync
    fs.renameSync = function (...args) {
      if (args[1].endsWith('/receipt.json')) throw Object.assign(new Error('synthetic receipt failure'), { code: 'EIO' })
      return originalRename.apply(this, args)
    }
    let result
    try { result = f.run() } finally { fs.renameSync = originalRename }
    assert.equal(result.ok, false); assert.equal(result.committed, true); assert.equal(result.stage, 'receipt')
    assert.equal(JSON.parse(fs.readFileSync(f.file)).resultEnvelope.gateway_mode, 'local_test')
    assert(fs.existsSync(path.join(result.evidence_directory, 'prepared-receipt.json')))
    const h = ownership.acquireGatewayMaintenanceStoreOwnership(); assert.equal(h.ok, true); h.release()
  })
  console.log(`analytics-gateway-q3-offline-repair-test: OK (${checks} checks; synthetic only)`)
} finally {
  Module._load = originalLoad
  if (priorEnv === undefined) delete process.env.BEVVI_ANALYTICS_GATEWAY_JOBS_DIR
  else process.env.BEVVI_ANALYTICS_GATEWAY_JOBS_DIR = priorEnv
  fs.rmSync(root, { recursive: true, force: true })
}
