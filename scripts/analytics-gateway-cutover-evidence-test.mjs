#!/usr/bin/env node
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const saved = { ...process.env }
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cutover-v3-tests-'))
const jobs = path.join(temp, 'jobs')
fs.mkdirSync(jobs)
process.env.BEVVI_ANALYTICS_GATEWAY_JOBS_DIR = jobs
process.env.BEVVI_ANALYTICS_GATEWAY_MODE = 'mock'
process.env.BEVVI_ANALYTICS_GATEWAY_LOCAL_TEST_MANIFEST_PATH = path.join(temp, 'manifest.json')
const support = require('../reviewer-original-probes/synthetic-cutover-support.cjs')
const evidence = require('../lib/analyticsGateway/localTestCutoverEvidence.cjs')
const cutover = require('../lib/analyticsGateway/localTestCutover.cjs')
const store = require('../lib/analyticsGateway/jobStore.cjs')
const gateway = require('../lib/analyticsGateway/gatewayStoreSingleton.cjs')
let count = 0
const contexts = []
function check(name, condition) {
  assert.ok(condition, name)
  count += 1
}
function saveReceipt(context, value) {
  const { validation_digest: _, ...body } = value
  fs.writeFileSync(context.invocation.evidence_file,
    JSON.stringify({ ...body, validation_digest: evidence.digest(body) }))
}
function attemptOwner() {
  const code = `
    const g=require('./lib/analyticsGateway/gatewayStoreSingleton.cjs');
    const r=g.acquireGatewayServerStoreOwnership();
    console.log(JSON.stringify(r)); if(r.ok)g.releaseGatewayServerStoreOwnership();
  `
  const out = spawnSync(process.execPath, ['-e', code], {
    cwd: root, env: process.env, encoding: 'utf8'
  })
  assert.equal(out.status, 0, out.stderr)
  return JSON.parse(out.stdout)
}
function runParent(behavior, extraEnv = {}) {
  return spawnSync(process.execPath, [
    '--require', path.join(root, 'reviewer-original-probes/child-harness-preload.cjs'),
    path.join(root, 'scripts/analytics-gateway-local-test-cutover-run.mjs'), '--preflight'
  ], { cwd: root, env: { ...process.env, REVIEW_CHILD_BEHAVIOR: behavior, ...extraEnv },
    encoding: 'utf8' })
}
try {
  support.prepareManifest(process.env.BEVVI_ANALYTICS_GATEWAY_LOCAL_TEST_MANIFEST_PATH)
  const context = evidence.createCutoverInvocation()
  contexts.push(context)
  Object.assign(process.env, context.childEnv)
  const good = support.writeSuccessfulReceipt()
  check('fresh complete receipt passes', evidence.validateCutoverEvidence({ invocation: context.invocation }).ok)
  check('receipt cannot be overwritten by the child', !evidence.writeCutoverEvidenceAtomic(good).ok)

  const mutations = [
    ['wrong nonce', r => { r.invocation_nonce = 'b'.repeat(64) }],
    ['stale run with correct hashes', r => { r.run_id = 'different-run' }],
    ['missing job', r => { r.expected_jobs.pop() }],
    ['duplicate job', r => { r.expected_jobs[1] = r.expected_jobs[0] }],
    ['wrong entry', r => { r.expected_jobs[0].entry_id = 'not-approved' }],
    ['wrong hash', r => { r.expected_jobs[0].request_hash = 'wrong' }],
    ['old same-run evidence', r => { r.validated_at = '2000-01-01T00:00:00Z' }],
    ['invalid timestamp', r => { r.validated_at = 'not-a-date' }],
    ['future timestamp', r => { r.validated_at = '2099-01-01T00:00:00Z' }],
    ['missing validation attestation', r => { delete r.expected_jobs[0].validation }],
    ['artifact validation false', r => { r.expected_jobs[0].validation.artifact = false }],
    ['altered envelope digest', r => { r.expected_jobs[0].envelope_sha256 = 'f'.repeat(64) }],
    ['altered artifact digest', r => { r.expected_jobs[0].artifact_sha256 = 'f'.repeat(64) }]
  ]
  for (const [name, mutate] of mutations) {
    const value = structuredClone(good)
    mutate(value)
    saveReceipt(context, value)
    check(name, !evidence.validateCutoverEvidence({ invocation: context.invocation }).ok)
  }
  saveReceipt(context, good)
  const jobId = good.expected_jobs[0].job_id
  const original = store.readJob(jobId)
  for (const [name, mutate] of [
    ['succeeded without envelope is insufficient', j => { j.resultEnvelope = null }],
    ['mock envelope is insufficient', j => { j.resultEnvelope.gateway_mode = 'mock' }],
    ['integration false is insufficient', j => { j.resultEnvelope.integration_test_passed = false }],
    ['wrong client is insufficient', j => { j.clientId = 'other' }]
  ]) {
    const changed = structuredClone(original)
    mutate(changed)
    store.writeJobAtomic(changed)
    check(name, !evidence.validateCutoverEvidence({ invocation: context.invocation }).ok)
    store.writeJobAtomic(original)
  }

  const manifest = JSON.parse(fs.readFileSync(process.env.BEVVI_ANALYTICS_GATEWAY_LOCAL_TEST_MANIFEST_PATH))
  const modified = structuredClone(manifest)
  modified.run_id = 'replacement-manifest'
  fs.writeFileSync(process.env.BEVVI_ANALYTICS_GATEWAY_LOCAL_TEST_MANIFEST_PATH, JSON.stringify(modified))
  check('changed manifest rejected', !evidence.validateCutoverEvidence({ invocation: context.invocation }).ok)
  fs.writeFileSync(process.env.BEVVI_ANALYTICS_GATEWAY_LOCAL_TEST_MANIFEST_PATH, JSON.stringify(manifest))
  const fresh = evidence.createCutoverInvocation()
  contexts.push(fresh)
  fs.copyFileSync(context.invocation.evidence_file, fresh.invocation.evidence_file)
  check('prior invocation rejected even on same run', !evidence.validateCutoverEvidence({ invocation: fresh.invocation }).ok)

  const success = runParent('success', { LOCAL_TEST_CUTOVER_VALIDATION_PASSED: 'true' })
  check('actual parent recognizes complete current child receipt', success.status === 0)
  check('parent never authorizes a later restart', success.stderr.includes('"restore_authorized":false') &&
    !success.stderr.includes('mock_restore_allowed'))
  const stale = runParent('replay', { REVIEW_STALE_RECEIPT: context.invocation.evidence_file })
  check('actual parent rejects replay copied to its fresh destination', stale.status === 1)
  const absent = runParent('no-signal', { LOCAL_TEST_CUTOVER_VALIDATION_PASSED: 'true' })
  check('actual parent ignores inherited context/path/flag without new child receipt', absent.status === 1)
  check('actual parent preserves failed child', runParent('fail').status === 1)

  const heldResult = await cutover.withCutoverStoreOwnership(async guard => {
    check('quiescence checked while owned', guard.ok)
    check('competitor blocked during callback', !attemptOwner().ok)
    await new Promise(resolve => setTimeout(resolve, 15))
    check('competitor blocked after await', !attemptOwner().ok)
    return { ok: true }
  })
  check('callback completes', heldResult.ok)
  check('ownership released on success', attemptOwner().ok)
  await assert.rejects(() => cutover.withCutoverStoreOwnership(async () => {
    throw new Error('synthetic failure')
  }), /synthetic failure/)
  check('ownership released on failure', attemptOwner().ok)
  const competing = gateway.acquireGatewayServerStoreOwnership()
  check('setup owner acquired', competing.ok)
  try {
    let called = false
    const blocked = await cutover.withCutoverStoreOwnership(() => { called = true })
    check('competing owner blocks callback', !blocked.ok && !called)
  } finally { gateway.releaseGatewayServerStoreOwnership() }
  fs.writeFileSync(path.join(jobs, 'thread-admission.lock'), '{invalid')
  check('malformed admission blocks', !cutover.evaluateCutoverGuard().ok)
  fs.unlinkSync(path.join(jobs, 'thread-admission.lock'))
  console.log(`analytics-gateway-cutover-evidence-test: OK (${count} checks; synthetic only)`)
} finally {
  for (const context of contexts) context.cleanup()
  process.env = saved
  fs.rmSync(temp, { recursive: true, force: true })
}
